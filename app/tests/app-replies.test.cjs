'use strict';
const assert=require('assert').strict,crypto=require('crypto'),http=require('http'),path=require('path');
const fixture=require('./app-access-fixture.cjs'),load=require('./service-harness.cjs');
const {Cache,TTL,PREFIX}=require('../service/app-replies.js'),{start,APP_PORT,WIDGET_PORT}=require('../service/app-ports.js');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
let sequence=0;
function message(method='apps.list',params={}){return {version:2,id:'request_'+(++sequence),method,params,reply:{id:crypto.randomBytes(32).toString('hex'),key:crypto.randomBytes(32).toString('hex')}};}
function expectedMac(p,body){return crypto.createHmac('sha256',Buffer.from(p.reply.key,'hex')).update(PREFIX+p.reply.id+'\n'+body).digest('hex');}
function parsed(response,p){assert.equal(response.code,200);assert.equal(response.value.mac,expectedMac(p,response.value.body));const d=JSON.parse(response.value.body);assert.equal(d.version,2);assert.equal(d.id,p.id);return d;}
function read(cache,p,options={}){
 const url=options.url||'/app-replies/'+p.reply.id;
 const req={method:options.method||'GET',url,headers:Object.assign({host:'127.0.0.1:8099',origin:'null'},options.headers),socket:{remoteAddress:options.peer||'127.0.0.1'}};
 const response={};assert.equal(cache.handle(req,{writeHead(code,headers){response.code=code;response.headers=headers;},end(text){response.text=text;response.value=JSON.parse(text);}},url.split('?')[0]),true);return response;
}
function makeCache(f){return new Cache({access:f.access,port:8099,now:f.options.now,interfaces:()=>({eth0:[{address:'192.0.2.10',family:'IPv4',internal:false}]})});}
async function setup(){
 const f=fixture(),cache=makeCache(f),ports={};let nativeSends=0;
 function local(name,trusted){return ports[name]={messagePortName:name,isTrusted:trusted,addMessagePortListener(fn){this.callback=fn;return 1;},removeMessagePortListener(){}};}
 f.tizen.messageport={requestLocalMessagePort:n=>local(n,false),requestTrustedLocalMessagePort:n=>local(n,true),
  requestRemoteMessagePort(){return {sendMessage(){nativeSends++;throw Error('Native replies unavailable');}};},
  requestTrustedRemoteMessagePort(){throw Error('Native replies unavailable');}};
 const handle=start(f.tizen,f.access,{issueWidget(){throw Error('Widget credential must not be issued');}},null,cache);
 await f.approve(['apps.read','apps.launch']);
 const remote={appId:'garage.app',messagePortName:'CLIENT_REPLY',isTrusted:false,sendMessage(){throw Error('Callback send unavailable');}};
 return Object.assign(f,{cache,ports,handle,nativeSends:()=>nativeSends,remote,
  send(p,r=remote){ports[APP_PORT].callback([{key:'json',value:JSON.stringify(p)}],r);},
  cleanup(){handle.stop();f.close();}});
}
(async()=>{
 // Requests retain native identity and permission checks; the reply is usable even
 // when every native outbound send is unavailable. Real HTTP exercises main routing.
 const f=await setup();let server;
 try{
  const p=message();assert.equal(read(f.cache,p).code,404);
  let release;f.options.perform=async(method,params,rows,check)=>{check();f.calls.push({method});await new Promise(r=>{release=r;});check();return {apps:[{appId:'media.app',name:'Télévision 📺'}],total:1,nextOffset:null};};
  f.send(p);await tick();assert.equal(read(f.cache,p).code,202);
  release();await tick();assert.equal(parsed(read(f.cache,p),p).result.apps[0].name,'Télévision 📺');
  assert.equal(f.nativeSends(),0);
  const service=load(path.resolve(__dirname,'..'),{start:false,setInterval:()=>({unref(){}})});
  service.context.appReplies=f.cache;let ownerCalls=0;
  service.context.auth.gate=(req,res)=>{ownerCalls++;res.writeHead(401,{'content-type':'application/json'});res.end('{"error":"Owner authentication required"}');return true;};
  server=http.createServer(service.router);await new Promise(r=>server.listen(0,'127.0.0.1',r));f.cache.port=server.address().port;
  async function get(url){return new Promise((resolve,reject)=>{http.get({host:'127.0.0.1',port:f.cache.port,path:url,headers:{Origin:'null'}},r=>{let text='';r.on('data',c=>text+=c);r.on('end',()=>resolve({code:r.statusCode,headers:r.headers,value:JSON.parse(text)}));}).on('error',reject);});}
  const response=await get('/app-replies/'+p.reply.id);assert.equal(parsed(response,p).ok,true);
  assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.headers['access-control-allow-origin'],'null');assert.equal(response.headers['x-content-type-options'],'nosniff');
  assert.equal(JSON.stringify(response).includes(p.reply.key),false,'HTTP never returns the MAC key');
  assert.equal(ownerCalls,0,'only the narrow capability route precedes the owner gate');
  assert.equal((await get('/app-access')).code,401);assert.equal(ownerCalls,1);
  f.cache.port=8099;
  const before=f.calls.length;f.send(p);f.send({...p,params:{offset:99}});f.send({...p,reply:{...p.reply,key:'0'.repeat(64)}},{...f.remote,appId:'media.app'});await tick();
  assert.equal(f.calls.length,before,'duplicates never execute or replace the original response');assert.equal(parsed(read(f.cache,p),p).ok,true);
  for(const changes of [{appId:''},{appId:undefined},{messagePortName:''},{isTrusted:undefined},{sendMessage:undefined}])f.send(message(),{...f.remote,...changes});
  for(const change of [{appId:'garage.app'},{version:3},{reply:{id:'a',key:'b'}},{reply:{id:'a'.repeat(64),key:'b'.repeat(64),appId:'garage.app'}}])f.send({...message(),...change});
  f.ports[WIDGET_PORT].callback([{key:'json',value:JSON.stringify(message('widget.connect'))}],{...f.remote,appId:'vetrotvapp.app'});
  await tick();assert.equal(f.calls.length,before,'forged or incomplete metadata and framing cannot dispatch');
 }finally{if(server)await new Promise(r=>server.close(r));f.cleanup();}

 const authorization=await setup();try{
  for(const method of ['tasks.stop','exec','app-access.admin']){
   const p=message(method,{appId:'media.app'});authorization.send(p);await tick();
   assert.equal(parsed(read(authorization.cache,p),p).ok,false,'HTTP replies do not expand '+method+' authority');
  }
  assert.equal(authorization.calls.length,0);
  const forged=message('apps.list');authorization.send(forged,{...authorization.remote,appId:'imposter.app'});await tick();
  assert.equal(parsed(read(authorization.cache,forged),forged).ok,false,'a real different sender cannot borrow another approval');
  authorization.options.perform=async()=>({apps:['x'.repeat(17000)]});
  const oversized=message();authorization.send(oversized);await tick();
  const limited=parsed(read(authorization.cache,oversized),oversized);assert.equal(limited.ok,false);assert.equal(limited.error.code,'limit');
  assert.ok(Buffer.byteLength(read(authorization.cache,oversized).value.body)<=16384);
 }finally{authorization.cleanup();}

 // Local HTTP transport is checked from the kernel peer address and assigned
 // interface inventory. Forwarded headers and claimed app IDs confer no authority.
 const network=await setup();try{
  const p=message();network.send(p);await tick();
  const allowed=[{peer:'127.0.0.1'},{peer:'::1',headers:{host:'[::1]:8099'}},{peer:'::ffff:127.0.0.1'},
   {peer:'192.0.2.10',headers:{host:'192.0.2.10:8099'}},{peer:'::ffff:192.0.2.10',headers:{host:'192.0.2.10:8099',origin:undefined}}];
  allowed.forEach(o=>assert.equal(read(network.cache,p,o).code,200));
  const denied=[{peer:'192.0.2.99'},{peer:'192.0.2.99',headers:{'x-forwarded-for':'127.0.0.1'}},
   {headers:{host:'192.0.2.99:8099'}},{headers:{host:'evil.example:8099'}},{headers:{host:'127.0.0.1:80'}},
   {headers:{origin:'https://evil.example'}},{headers:{origin:null}}];
  denied.forEach(o=>assert.equal(read(network.cache,p,o).code,403));
  assert.equal(read(network.cache,p,{method:'POST'}).code,405);
  assert.equal(read(network.cache,p,{url:'/app-replies/'+p.reply.id+'?appId=garage.app'}).code,404);
  assert.equal(read(network.cache,p,{url:'/app-replies/../../exec'}).code,404);
  const calls=network.calls.length;for(let i=0;i<10;i++)read(network.cache,p);assert.equal(network.calls.length,calls,'polling never executes a command');
  network.cache.interfaces=()=>{throw Error('Interface lookup failed');};assert.equal(read(network.cache,p).code,403);
 }finally{network.cleanup();}

 // Approval revisions, installation, storage and service changes invalidate cached
 // results before HTTP disclosure; a fresh authorized request remains available.
 for(const reason of ['grant','package','installation','disabled','reenabled','storage','transport']){
  const s=await setup();try{
   let p=message();s.send(p);await tick();assert.equal(parsed(read(s.cache,p),p).ok,true);
   const pending=await s.access.call('media.app','access.request',{scopes:['apps.read']});
   await s.access.admin({action:'approve',requestId:pending.requestId,scopes:['apps.read'],expectedRevision:s.access.state.revision});
   assert.equal(parsed(read(s.cache,p),p).ok,false,'approval revision invalidates already cached responses');
   p=message();s.send(p);await tick();assert.equal(parsed(read(s.cache,p),p).ok,true,'fresh requests use current approval');
   if(reason==='grant')await s.access.admin({action:'revoke',appId:'garage.app',expectedRevision:s.access.state.revision});
   if(reason==='package')s.identity.changed('garage.app.pkg');
   if(reason==='installation')s.installed['garage.app'].cert+='-changed';
   if(reason==='disabled')await s.access.admin({action:'enable',enabled:false,expectedRevision:s.access.state.revision});
   if(reason==='reenabled'){
    await s.access.admin({action:'enable',enabled:false,expectedRevision:s.access.state.revision});
    await s.access.admin({action:'enable',enabled:true,expectedRevision:s.access.state.revision});
   }
   if(reason==='storage')s.access.store.error='Private security store unavailable';
   if(reason==='transport')s.access.transport.available=false;
   const body=parsed(read(s.cache,p),p);assert.equal(body.ok,false,reason);assert.equal(body.error.submitted,null,'invalidated success never claims no dispatch');
  }finally{s.cleanup();}
 }
 for(const reason of ['revoke','stop','expire']){
  const s=await setup();try{
   let release;s.options.perform=async(method,params,rows,check)=>{check();check.onDispatch();await new Promise(r=>{release=r;});return {submitted:true};};
   const p=message('apps.launch',{appId:'media.app'});s.send(p);await tick();
   const entry=s.cache.entries[p.reply.id];assert.equal(read(s.cache,p).code,202);
   if(reason==='revoke'){await s.access.admin({action:'revoke',appId:'garage.app',expectedRevision:s.access.state.revision});assert.equal(parsed(read(s.cache,p),p).ok,false);}
   if(reason==='stop')s.handle.stop();
   if(reason==='expire')s.advance(TTL);
   release();await tick();
   if(reason==='revoke')assert.equal(parsed(read(s.cache,p),p).ok,false,'late result cannot replace the invalidation');
   else{assert.equal(read(s.cache,p).code,404);assert.ok(entry.key.every(x=>x===0),'expired/stopped response keys are erased');}
  }finally{s.cleanup();}
 }

 // Capacity is bounded independently from execution limits. Evicted completed
 // responses retain replay tombstones for their original thirty-second lifetime.
 const limits=fixture();try{
  const cache=makeCache(limits),a=message(),b=message(),c=message();
  const first=cache.reserve('garage.app',a),second=cache.reserve('garage.app',b);
  assert.ok(first&&second);assert.equal(cache.reserve('garage.app',c),null,'never evict pending work');
  cache.complete(first,{},null);assert.ok(cache.reserve('garage.app',c));assert.equal(cache.reserve('garage.app',a),null,'evicted response cannot be reexecuted');
  cache.complete(first,{secret:'late'},null);assert.equal(cache.entries[a.reply.id],undefined);
  cache.clear();assert.equal(cache.reserve('garage.app',b),null,'stop/start retains replay tombstones');
  limits.advance(TTL);cache.prune();assert.equal(Object.keys(cache.seen).length,0);
  for(let i=0;i<32;i++)assert.ok(cache.reserve('app'+Math.floor(i/2)+'.ui',message()));
  assert.equal(cache.reserve('another.ui',message()),null);assert.equal(Object.keys(cache.entries).length,32);
  cache.clear();limits.advance(TTL);cache.prune();
  for(let app=0;app<4;app++)for(let i=0;i<64;i++){const entry=cache.reserve('app'+app+'.ui',message());assert.ok(entry);cache.complete(entry,null,Error('Denied'));}
  assert.equal(Object.keys(cache.seen).length,256);assert.ok(Object.keys(cache.entries).length<=8);
  assert.equal(cache.reserve('new.ui',message()),null);assert.equal(cache.reserve('app0.ui',message()),null);
 }finally{limits.close();}
 console.log('PASS app reply transport: native identities, real HTTP, HMAC, local peers, no HTTP operations, replay limits, revocation and lifecycle invalidation');
})().catch(e=>{console.error(e);process.exitCode=1;});
