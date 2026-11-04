'use strict';
// MessagePort authenticates every operation. HTTP only retrieves a bounded,
// authenticated result; neither the caller identity nor the MAC key travels over HTTP.
var crypto=require('crypto'),net=require('net'),validId=require('./app-identity.js').validId;
var TTL=30000,MAX_BODY=16384,MAX_ENTRIES=32,MAX_PER_APP=2,MAX_SEEN=256,MAX_SEEN_PER_APP=64;
var PREFIX='VETRO_APP_REPLY_V2\n';
function hex(value){return typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);}
function address(value){
    if(typeof value!=='string')return null;
    value=value.toLowerCase();
    if(value.indexOf('::ffff:')===0&&net.isIP(value.slice(7))===4)value=value.slice(7);
    return net.isIP(value)?value:null;
}
function grantStamp(access,appId){
    var grant=access.state.grants.find(function(g){return g.identity.appId===appId;});
    return grant?JSON.stringify([grant.generation,grant.enabled,grant.scopes]):'';
}
function Cache(options){
    this.access=options.access;this.interfaces=options.interfaces;this.port=options.port;
    this.now=options.now||Date.now;this.entries=Object.create(null);this.seen=Object.create(null);
}
Cache.prototype.drop=function(id){
    var entry=this.entries[id];
    if(entry){entry.active=false;entry.key.fill(0);delete this.entries[id];}
};
Cache.prototype.prune=function(){
    var self=this,now=this.now();
    Object.keys(this.entries).forEach(function(id){if(self.entries[id].expires<=now)self.drop(id);});
    Object.keys(this.seen).forEach(function(id){if(self.seen[id].expires<=now)delete self.seen[id];});
};
Cache.prototype.clear=function(){
    var self=this;Object.keys(this.entries).forEach(function(id){self.drop(id);});
    // Keep short-lived replay tombstones across a stop/start in this process.
    this.prune();
};
Cache.prototype.capture=function(appId){
    var identity=this.access.options.identity.read(appId);
    return {installation:identity.installation,packageId:identity.packageId,
        epoch:this.access.options.identity.epoch(identity.packageId),grant:grantStamp(this.access,appId),revision:this.access.state.revision};
};
Cache.prototype.invalid=function(entry){
    var access=this.access,current;
    if(access.store.error||!access.transport.available)return 'unavailable';
    if(!access.state.enabled)return 'disabled';
    try{current=this.capture(entry.appId);}catch(_){return 'identity_changed';}
    if(!entry.identity||current.installation!==entry.identity.installation||current.epoch!==entry.identity.epoch)return 'identity_changed';
    // The revision also detects a disable/re-enable between two HTTP reads.
    // Conservatively invalidate all results when any approval state changes.
    if(current.revision!==entry.identity.revision||current.grant!==entry.identity.grant)return 'permission_denied';
    return null;
};
Cache.prototype.reserve=function(appId,message,observe){
    function refused(reason){try{if(typeof observe==='function')observe(reason);}catch(_){}return null;}
    if(!validId(appId)||!message||!message.reply||!hex(message.reply.id)||!hex(message.reply.key))return refused('invalid');
    this.prune();
    var self=this,id=message.reply.id,seen=Object.keys(this.seen),entries=Object.keys(this.entries);
    if(this.seen[id])return refused('replay');
    if(seen.length>=MAX_SEEN)return refused('replay-limit');
    if(seen.filter(function(k){return self.seen[k].appId===appId;}).length>=MAX_SEEN_PER_APP)return refused('app-replay-limit');
    function makeRoom(owned,limit){
        while(owned.length>=limit){
            var completed=owned.filter(function(k){return self.entries[k].body!==null;}).sort(function(a,b){return self.entries[a].created-self.entries[b].created;});
            if(!completed.length)return false;
            var oldest=completed[0];self.drop(oldest);owned=owned.filter(function(k){return k!==oldest;});
        }
        return true;
    }
    if(!makeRoom(entries.filter(function(k){return self.entries[k].appId===appId;}),MAX_PER_APP))return refused('app-busy');
    if(!makeRoom(Object.keys(this.entries),MAX_ENTRIES))return refused('global-busy');
    var now=this.now(),identity=null;
    try{identity=this.capture(appId);}catch(_){}
    var entry={id:id,requestId:message.id,appId:appId,identity:identity,
        key:Buffer.from(message.reply.key,'hex'),created:now,expires:now+TTL,
        active:true,invalidated:false,submitted:null,body:null,mac:null};
    this.entries[id]=entry;this.seen[id]={appId:appId,expires:entry.expires};
    return entry;
};
Cache.prototype.write=function(entry,message){
    var body;
    try{body=JSON.stringify(message);}catch(_){body=null;}
    if(!body||Buffer.byteLength(body)>MAX_BODY)body=JSON.stringify({version:2,id:entry.requestId,ok:false,
        error:{code:body?'limit':'unavailable',message:body?'Response is too large. Request a smaller page.':'App response is unavailable',submitted:entry.submitted}});
    entry.body=body;
    entry.mac=crypto.createHmac('sha256',entry.key).update(PREFIX+entry.id+'\n'+body,'utf8').digest('hex');
};
Cache.prototype.invalidate=function(entry,code){
    entry.invalidated=true;
    this.write(entry,{version:2,id:entry.requestId,ok:false,error:{code:code,
        message:code==='disabled'?'App access is turned off in Vetro':code==='identity_changed'?'App changed. Request approval again.':
            code==='permission_denied'?'Permissions changed. Read the current approval before retrying.':'App communication is unavailable',
        submitted:entry.submitted===true?true:null}});
};
Cache.prototype.complete=function(entry,result,error){
    this.prune();
    if(!entry||!entry.active||this.entries[entry.id]!==entry||entry.invalidated)return;
    entry.submitted=error&&error.submitted===true||result&&result.submitted===true?true:
        error&&error.submitted===false?false:null;
    var invalid=this.invalid(entry);
    if(invalid){this.invalidate(entry,invalid);return;}
    var message={version:2,id:entry.requestId,ok:!error};
    if(error)message.error={code:error.code||'unavailable',message:error.code?error.message:'App request is unavailable',
        submitted:typeof error.submitted==='boolean'?error.submitted:null};
    else message.result=result;
    this.write(entry,message);
};
Cache.prototype.localRequest=function(req){
    var headers=req.headers||{},origin=headers.origin,host=headers.host,peer=address(req.socket&&req.socket.remoteAddress);
    if(origin!==undefined&&origin!=='null'||typeof host!=='string'||!peer)return false;
    var match=/^\[([a-fA-F0-9:.]+)\]:([0-9]+)$/.exec(host)||/^([0-9.]+):([0-9]+)$/.exec(host);
    if(!match||Number(match[2])!==this.port)return false;
    var target=address(match[1]),own={'127.0.0.1':true,'::1':true};
    try{
        var interfaces=this.interfaces();
        Object.keys(interfaces||{}).forEach(function(name){(interfaces[name]||[]).forEach(function(row){var ip=address(row.address);if(ip)own[ip]=true;});});
    }catch(_){return false;}
    return !!target&&own[peer]===true&&own[target]===true;
};
Cache.prototype.handle=function(req,res,url){
    if(typeof url!=='string'||url.indexOf('/app-replies/')!==0)return false;
    var headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store',
        'X-Content-Type-Options':'nosniff','Vary':'Origin'};
    if(req.headers&&req.headers.origin==='null')headers['Access-Control-Allow-Origin']='null';
    function send(code,data){res.writeHead(code,headers);res.end(JSON.stringify(data)+'\n');return true;}
    if(!this.localRequest(req))return send(403,{error:'Local TV response access required'});
    if(req.method!=='GET')return send(405,{error:'Use GET to read a response'});
    if((req.url||url).indexOf('?')>=0)return send(404,{});
    var match=/^\/app-replies\/([a-f0-9]{64})$/.exec(url);
    if(!match)return send(404,{});
    this.prune();var entry=this.entries[match[1]];
    if(!entry)return send(404,{});
    var invalid=this.invalid(entry);
    if(invalid&&!entry.invalidated)this.invalidate(entry,invalid);
    if(entry.body===null)return send(202,{});
    return send(200,{body:entry.body,mac:entry.mac});
};
module.exports={Cache:Cache,TTL:TTL,MAX_BODY:MAX_BODY,PREFIX:PREFIX};

