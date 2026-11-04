'use strict';
const assert=require('assert').strict,crypto=require('crypto');
const fixture=require('./app-access-fixture.cjs'),ports=require('../service/app-ports');
const {Diagnostics}=require('../service/connection-diagnostics'),{Cache}=require('../service/app-replies');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function setup(enabled=true){
 const f=fixture(),callbacks={},d=new Diagnostics({connectionDiagnostics:enabled});
 function port(name,trusted){return {messagePortName:name,isTrusted:trusted,
  addMessagePortListener(fn){callbacks[name]=fn;return 0;},removeMessagePortListener(){delete callbacks[name];}};}
 f.tizen.messageport={requestLocalMessagePort:n=>port(n,false),requestTrustedLocalMessagePort:n=>port(n,true)};
 const cache=new Cache({access:f.access,interfaces:()=>({}),port:8099,now:()=>1000});
 const handle=ports.start(f.tizen,f.access,{issueWidget(){throw Error('Unexpected widget credential');}},d,cache);
 const remote={appId:'garage.app',messagePortName:'PRIVATE_PORT',isTrusted:false,sendMessage(){}};
 function message(overrides={}){return {version:2,id:'PRIVATE_REQUEST',method:'access.request',params:{scopes:['apps.read']},
  reply:{id:crypto.randomBytes(32).toString('hex'),key:crypto.randomBytes(32).toString('hex')},...overrides};}
 function send(p,r=remote){callbacks[ports.APP_PORT]([{key:'json',value:JSON.stringify(p)}],r);}
 return {f,d,cache,handle,callbacks,remote,message,send,close(){handle.stop();f.close();}};
}
(async()=>{
 const s=setup();try{
  await s.f.enable();
  const p=s.message();s.send(p);await flush();
  const result=JSON.parse(s.cache.entries[p.reply.id].body);
  assert.equal(result.ok,true);assert.equal(result.result.state,'pending');
  assert.equal(s.f.access.pending.length,1,'telemetry does not grant access');
  const state=s.d.snapshot().appRequests;
  assert.deepEqual(state.counts,{'received':1,'reply-reserved':1,'dispatch':1,'handler-resolved':1});
  for(const secret of [p.reply.id,p.reply.key,p.id,'PRIVATE_PORT','garage.app'])assert.ok(!JSON.stringify(state).includes(secret));
  s.send(p);assert.equal(s.d.snapshot().appRequests.events.at(-1).replyReason,'replay');
  assert.equal(s.d.snapshot().appRequests.counts.dispatch,1,'replay is never dispatched');
  s.send(s.message(),{...s.remote,isTrusted:undefined});
  let last=s.d.snapshot().appRequests.events.at(-1);
  assert.equal(last.stage,'sender-rejected');assert.equal(last.sender.trustedIsBoolean,false);
  s.send(s.message({reply:{id:'bad',key:'PRIVATE_KEY'}}));
  assert.equal(s.d.snapshot().appRequests.events.at(-1).stage,'frame-rejected');
  s.send(s.message({params:{scopes:['apps.read'],extra:'PRIVATE_PARAM'}}));
  assert.equal(s.d.snapshot().appRequests.events.at(-1).stage,'params-rejected');
  s.send(s.message({method:'apps.list',params:{}}));await flush();
  assert.equal(s.d.snapshot().appRequests.events.at(-1).stage,'handler-rejected','unapproved requests remain denied');
  assert.equal(s.f.calls.length,0);
  const held1=s.message(),held2=s.message();s.cache.clear();
  assert.ok(s.cache.reserve(s.remote.appId,held1));assert.ok(s.cache.reserve(s.remote.appId,held2));
  s.send(s.message());last=s.d.snapshot().appRequests.events.at(-1);
  assert.equal(last.stage,'reply-rejected');assert.equal(last.replyReason,'app-busy');
  s.cache.clear();
  s.d.appRequest=()=>{throw Error('PRIVATE_TELEMETRY_FAILURE');};
  const succeeds=s.message({method:'access.status',params:{}});s.send(succeeds);await flush();
  assert.equal(JSON.parse(s.cache.entries[succeeds.reply.id].body).result.state,'unapproved','a diagnostic failure cannot block a request');
 }finally{s.close();}
 const quiet=setup(false);try{
  const p=quiet.message();quiet.send(p);await flush();
  assert.deepEqual(quiet.d.snapshot().appRequests,{enabled:false,counts:{},events:[]});
 }finally{quiet.close();}
 const d=new Diagnostics({connectionDiagnostics:true});
 const remote={appId:'GlassHome1.GlassHome',messagePortName:'PRIVATE_PORT',isTrusted:false,sendMessage(){}};
 for(let i=0;i<100;i++)d.appRequest('received',[{key:'json',value:'PRIVATE_BODY'}],remote);
 let state=d.snapshot().appRequests;
 assert.equal(state.events.length,32);assert.equal(state.counts.received,100);assert.equal(state.events[0].sender.app,'glass-ui');
 d.state.appRequests.counts.received=1000000;d.appRequest('received',[],null);
 assert.equal(d.snapshot().appRequests.counts.received,1000000);
 d.appRequest('PRIVATE_STAGE',[],null);assert.equal(d.snapshot().appRequests.events.length,32);
 d.appRequest('frame-rejected',[{key:'json',value:'x'.repeat(5000)}],remote,null,Object.assign(Error('PRIVATE_ERROR'),{name:'TypeError'}));
 state=d.snapshot().appRequests;assert.equal(state.events.at(-1).frame.bytes,4097);assert.equal(state.events.at(-1).error,'TypeError');
 const hostile={get appId(){throw Error('PRIVATE_GETTER');}};d.appRequest('received',[],hostile);
 assert.equal(d.snapshot().appRequests.events.at(-1).sender,null);
 assert.ok(!JSON.stringify(d.snapshot()).includes('PRIVATE_'));
 state.events[0].stage='changed';assert.notEqual(d.snapshot().appRequests.events[0].stage,'changed');
 console.log('PASS app request telemetry: native receive/validation/reservation/dispatch, unchanged approvals, bounded redacted opt-in evidence');
})().catch(error=>{console.error(error);process.exitCode=1;});
