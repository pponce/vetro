'use strict';
// Pairing UI and protocol adapted from zerodevb/vetro PR #9 (MIT), commit 0983b97.
// Local TV requests require verified widget credentials or the separate app MessagePort API.
var crypto=require('crypto'), Store=require('./access-store.js').Store;
var COOKIE='vetro_session',CODE_MS=120000,KEY_MS=365*86400000,MAX_SESSIONS=20;
function hash(v){return crypto.createHash('sha256').update(v).digest('hex');}
function same(a,b){a=Buffer.from(String(a));b=Buffer.from(String(b));return a.length===b.length&&crypto.timingSafeEqual(a,b);}
function json(res,status,value,headers){res.writeHead(status,Object.assign({'content-type':'application/json; charset=utf-8','cache-control':'no-store','X-Content-Type-Options':'nosniff'},headers||{}));res.end(JSON.stringify(value)+'\n');}
function originOk(req){
    var h=req.headers||{},o=h.origin;
    if(o===undefined)return true;
    if(typeof o!=='string'||o==='null'||typeof h.host!=='string')return false;
    // A TLS reverse proxy must preserve Host. Forwarded headers do not confer authority.
    return o==='http://'+h.host||o==='https://'+h.host;
}
function hostOk(req){
    var host=String((req.headers||{}).host||'').replace(/:\d+$/,'').replace(/^\[|\]$/g,'');
    return host==='localhost'||require('net').isIP(host)!==0;
}
function readBody(req,res,cb){
    var data='',done=false;
    if(!/^application\/json(?:\s*;|$)/i.test((req.headers||{})['content-type']||'')){json(res,415,{error:'Use application/json'});return;}
    var timer=setTimeout(function(){if(!done){done=true;json(res,408,{error:'Request timed out'});}},10000);
    function finish(){done=true;clearTimeout(timer);}
    req.on('error',function(){if(!done){finish();json(res,400,{error:'Request interrupted'});}});
    req.on('data',function(c){if(done)return;data+=c;if(Buffer.byteLength(data)>2048){finish();json(res,413,{error:'Request too large'});}});
    req.on('end',function(){if(done)return;finish();var p;try{p=JSON.parse(data);}catch(_){return json(res,400,{error:'Invalid JSON'});}
        if(!p||typeof p!=='object'||Array.isArray(p))return json(res,400,{error:'Expected a JSON object'});cb(p);});
}
function validateState(s){
    if(!s||s.schema!==1||!Array.isArray(s.sessions)||s.sessions.length>MAX_SESSIONS)throw Error('Invalid sign-in store');
    s.sessions.forEach(function(x){if(!x||!/^[0-9a-f]{64}$/.test(x.hash)||typeof x.name!=='string'||x.name.length>40||
        !Number.isInteger(x.created)||!Number.isInteger(x.expires)||x.expires<=x.created)throw Error('Invalid sign-in session');});
}
function Auth(options){
    options=options||{};this.now=options.now||Date.now;this.store=new Store(validateState);
    this.state={schema:1,sessions:[]};this.pending=null;this.lastPairAt=null;this.widgets=[];
    if(options.file)this.configure(options.file);
}
Auth.prototype.configure=function(file){try{this.state=this.store.configure(file,this.state);}catch(_){}};
Auth.prototype.commit=function(s){this.store.save({schema:1,sessions:s});this.state={schema:1,sessions:s};};
Auth.prototype.issueWidget=function(){
    if(this.store.error)throw Error('Private security storage is unavailable');
    var now=this.now(),key=crypto.randomBytes(32).toString('hex');
    this.widgets=this.widgets.filter(function(x){return x.expires>now;}).slice(-3);
    this.widgets.push({hash:hash(key),expires:now+300000});
    return {token:key,expires:now+300000};
};
Auth.prototype.session=function(req){
    var h=req.headers||{},authorization=h.authorization,m;
    if(authorization!==undefined){m=/^Bearer ([a-f0-9]{64})$/.exec(authorization);if(!m)return null;}
    else m=/(?:^|;\s*)vetro_session=([a-f0-9]{64})(?:;|$)/.exec(h.cookie||'');
    if(!m)return null;
    var hashed=hash(m[1]),now=this.now();
    return this.state.sessions.find(function(s){return s.expires>now&&same(s.hash,hashed);})||null;
};
Auth.prototype.startPair=function(req,res,onPair){
    var self=this;
    readBody(req,res,function(p){
        var now=self.now();
        if(self.store.error)return json(res,503,{error:self.store.error});
        if(self.pending&&self.pending.expires>now)return json(res,429,{error:'A pairing is already in progress. Wait for its code to expire.'});
        if(self.lastPairAt!==null&&now-self.lastPairAt<10000)return json(res,429,{error:'Wait a few seconds before pairing again'});
        if(self.state.sessions.filter(function(s){return s.expires>now;}).length>=MAX_SESSIONS)return json(res,409,{error:'Sign out a paired device before adding another'});
        if(Object.keys(p).some(function(k){return k!=='name';}))return json(res,400,{error:'Unexpected pairing parameter'});
        self.lastPairAt=now;
        var name=String(p.name||'Browser').replace(/[^\w .()+-]/g,'').slice(0,40)||'Browser';
        self.pending={id:crypto.randomBytes(16).toString('hex'),code:('000000'+(crypto.randomBytes(4).readUInt32BE(0)%1000000)).slice(-6),name:name,expires:now+CODE_MS,tries:0};
        if(onPair)try{Promise.resolve(onPair()).catch(function(){});}catch(_){}
        json(res,200,{id:self.pending.id,expiresIn:CODE_MS/1000});
    });
};
Auth.prototype.confirmPair=function(req,res){
    var self=this;
    readBody(req,res,function(p){
        var now=self.now(),pending=self.pending;
        if(!pending||pending.expires<=now||typeof p.id!=='string'||!same(pending.id,p.id))return json(res,410,{error:'This code expired. Start again.'});
        if(typeof p.code!=='string'||!/^\d{6}$/.test(p.code)||!same(pending.code,p.code)){
            if(++pending.tries>=5)self.pending=null;return json(res,403,{error:self.pending?'Wrong code':'Too many attempts. Start again.'});
        }
        var sessions=self.state.sessions.filter(function(s){return s.expires>now;});
        if(sessions.length>=MAX_SESSIONS)return json(res,409,{error:'Too many paired devices'});
        var key=crypto.randomBytes(32).toString('hex');
        sessions.push({hash:hash(key),name:pending.name,created:now,expires:now+KEY_MS});
        try{self.commit(sessions);}catch(e){return json(res,503,{error:e.message});}
        self.pending=null;
        json(res,200,{ok:true,token:key},{'set-cookie':COOKIE+'='+key+'; Max-Age='+KEY_MS/1000+'; Path=/; HttpOnly; SameSite=Strict'});
    });
};
Auth.prototype.gate=function(req,res,url,options){
    options=options||{};var self=this,h=req.headers||{},origin=originOk(req);
    function unavailable(status,message) {
        var body={error:message};
        // Explicit diagnostic packages can report connection milestones while
        // preserving the refusal. This never provides a token, code or API access.
        if(origin && req.method==='GET' && url==='/status' &&
            typeof options.connectionDiagnostics==='function') {
            try { body.connectionDiagnostics=options.connectionDiagnostics(); } catch (_) {}
        }
        json(res,status,body);
    }
    if(options.open)return origin&&(hostOk(req)||!h.host)?false:(json(res,403,{error:'Cross-site request refused'}),true);
    if(!hostOk(req)){json(res,403,{error:'Open Vetro using the TV IP address'});return true;}
    if(this.store.error){unavailable(503,this.store.error);return true;}
    // Widget bootstrap is available only over the trusted MessagePort to vetrotvapp.app.
    if(h['x-vetro-widget']!==undefined){
        var token=h['x-vetro-widget'],address=req.socket&&req.socket.remoteAddress;
        var local=['127.0.0.1','::1','::ffff:127.0.0.1'].indexOf(address)>=0;
        var now=this.now(),valid=typeof token==='string'&&/^[a-f0-9]{64}$/.test(token)&&this.widgets.some(function(w){return w.expires>now&&same(w.hash,hash(token));});
        if(!local||!hostOk(req)||!valid){json(res,401,{error:'Reconnect the Vetro widget'});return true;}
        if(url==='/auth/pending'&&req.method==='GET'){
            var p=this.pending&&this.pending.expires>now?this.pending:null;
            json(res,200,p?{code:p.code,name:p.name,expiresIn:Math.ceil((p.expires-now)/1000)}:{code:null},{'Access-Control-Allow-Origin':'null'});return true;
        }
        if((url==='/status'||url==='/screen')&&req.method==='GET'||url==='/probe'&&req.method==='POST')return false;
        json(res,403,{error:'The widget cannot use this route'});return true;
    }
    // Preflight never performs an operation or authenticates the following request.
    if(req.method==='OPTIONS'&&h.origin==='null'&&['/status','/screen','/probe','/auth/pending'].indexOf(url)>=0){
        json(res,204,null,{'Access-Control-Allow-Origin':'null','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, X-Vetro-Widget','Vary':'Origin'});return true;
    }
    if(!origin){json(res,403,{error:'Cross-site request refused'});return true;}
    if((url==='/auth/pair'||url==='/auth/confirm')&&req.method==='POST'){
        (url==='/auth/pair'?this.startPair(req,res,options.onPair):this.confirmPair(req,res));return true;
    }
    if(url==='/auth/pending'){json(res,403,{error:'Pairing codes are available only to the Vetro widget'});return true;}
    var session=this.session(req);
    if(!session){
        if((url==='/'||url==='/index.html')&&req.method==='GET'){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','X-Frame-Options':'DENY','X-Content-Type-Options':'nosniff'});res.end(LOGIN);}
        else unavailable(401,'Pair this device in the Vetro dashboard first');
        return true;
    }
    if(req.method!=='GET'&&req.method!=='POST'){json(res,405,{error:'Unsupported method'});return true;}
    if(url==='/auth/signout'||url==='/auth/signout-all'){
        if(req.method!=='POST'){json(res,405,{error:'Use POST'});return true;}
        try{this.commit(url==='/auth/signout-all'?[]:this.state.sessions.filter(function(s){return s!==session;}));}
        catch(e){json(res,503,{error:e.message});return true;}
        json(res,200,{ok:true},{'set-cookie':COOKIE+'=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict'});return true;
    }
    if(url==='/auth/devices'&&req.method==='GET'){
        json(res,200,{devices:this.state.sessions.filter(function(s){return s.expires>self.now();}).map(function(s){return {name:s.name,created:s.created,expires:s.expires,current:s===session};})});return true;
    }
    return false;
};
function decorate(html){
    return html.replace('</body>','<div class="session-bar"><button id="authSignOut">Sign out</button><button id="authSignOutAll">Sign out all devices</button></div><script>(function(){function send(all){if(all&&!confirm("Sign out every browser and script? App permissions stay saved."))return;fetch(all?"/auth/signout-all":"/auth/signout",{method:"POST"}).then(function(r){if(!r.ok)throw Error("Sign-out could not be saved");location.reload()}).catch(function(e){alert(e.message)})}document.getElementById("authSignOut").onclick=function(){send(false)};document.getElementById("authSignOutAll").onclick=function(){send(true)}})();</script></body>');
}

var LOGIN = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
'<title>Vetro sign-in</title><style>:root{--night:#111315;--deep:#191c1f;--mint:#a3c7bd;--chalk:#e2e5e8;--muted:#a0a6ad}' +
'*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--night);color:var(--chalk);font:16px/1.5 -apple-system,"Segoe UI",Roboto,sans-serif;padding:16px}' +
'main{width:100%;max-width:400px}h1{font-size:22px;margin:0 0 6px}p{color:var(--muted);margin:0 0 18px}' +
'input{width:100%;padding:14px;border:0;border-radius:12px;background:var(--deep);color:var(--chalk);font:inherit;font-size:24px;letter-spacing:8px;text-align:center}' +
'input:focus{outline:2px solid var(--mint)}button{width:100%;margin-top:14px;padding:14px;border:0;border-radius:12px;background:var(--mint);color:var(--night);font:inherit;font-weight:700}' +
'.msg{margin-top:14px;color:var(--muted)}.err{color:#ff9b9b}[hidden]{display:none}</style></head><body><main>' +
'<h1>Pair with your TV</h1><p>Vetro controls your TV as root, so each browser pairs once with a code shown on the TV. If no code appears, open the Vetro app on the TV.</p>' +
'<div id="s1"><button id="start">Show a code on the TV</button></div>' +
'<form id="s2" hidden><input id="code" aria-label="Six digit pairing code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000"><button>Pair</button></form>' +
'<div class="msg" id="msg" role="status" aria-live="polite"></div></main><script>' +
'var id,$=function(i){return document.getElementById(i)},say=function(t,e){$("msg").textContent=t;$("msg").className=e?"msg err":"msg"};' +
'function call(u,b){return fetch(u,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)}).then(function(r){return r.json().then(function(d){if(!r.ok)throw Error(d.error);return d})})}' +
'$("start").onclick=function(){say("Asking the TV…");call("/auth/pair",{name:navigator.platform||"Browser"}).then(function(d){id=d.id;$("s1").hidden=true;$("s2").hidden=false;$("code").focus();say("Enter the 6-digit code now on the TV screen. It expires in 2 minutes.")}).catch(function(e){say(e.message,1)})};' +
'$("s2").onsubmit=function(e){e.preventDefault();call("/auth/confirm",{id:id,code:$("code").value}).then(function(d){say(d.warning||"Paired.",!!d.warning);setTimeout(function(){location.reload()},d.warning?6000:300)}).catch(function(e){say(e.message,1);if(/start again/.test(e.message)){$("s1").hidden=false;$("s2").hidden=true}})};' +
'</script></body></html>';


module.exports={Auth:Auth,decorate:decorate,originOk:originOk,hostOk:hostOk};
