'use strict';
const assert=require('assert').strict,http=require('http'),path=require('path');
const fixture=require('./app-access-fixture.cjs'),ports=require('../service/app-ports');
(async()=>{const f=fixture(),callbacks={};let server;
 try{
  function port(name){return {addMessagePortListener(fn){callbacks[name]=fn;return 1;},removeMessagePortListener(){}};}
  f.tizen.messageport={requestLocalMessagePort:port,requestTrustedLocalMessagePort:port};
  const {context:c,router}=require('./service-harness.cjs')(path.resolve(__dirname,'..'),{tizen:f.tizen,setInterval:()=>({unref(){}})});
  c.inventory=async()=>({apps:f.rows});
  server=http.createServer(router);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  async function api(route,body,headers={}){const r=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
  function ipc(port,appId,method,params={},trusted=false){return new Promise(resolve=>callbacks[port]([{key:'json',value:JSON.stringify({version:1,id:'http_test',method,params})}],{appId,isTrusted:trusted,sendMessage(data){resolve(JSON.parse(data[0].value));}}));}
  for(const route of ['/startup-app','/return-app','/dock','/remap','/app-access','/exec','/probe','/screen','/status','/monitor','/control','/install','/diagnostics/download'])assert.equal((await api(route)).status,401,route);
  const widget=await ipc(ports.WIDGET_PORT,'vetrotvapp.app','widget.connect',{},true);assert.equal(widget.ok,true);const wh={'X-Vetro-Widget':widget.result.token,Origin:'null'};
  assert.equal((await api('/app-access',undefined,wh)).status,403);assert.equal((await api('/status',undefined,wh)).status,200);
  const pairing=await api('/auth/pair',{name:'fixture'});assert.equal(pairing.status,200);
  const pending=await api('/auth/pending',undefined,wh);const confirmation=await api('/auth/confirm',{id:pairing.body.id,code:pending.body.code});assert.equal(confirmation.status,200);
  const owner={Authorization:'Bearer '+confirmation.body.token};let state=(await api('/app-access',undefined,owner)).body;assert.equal(state.enabled,false);
  const blocked=await ipc(ports.APP_PORT,'garage.app','access.request',{scopes:['apps.read']});assert.equal(blocked.error.code,'disabled');
  state=(await api('/app-access',{action:'enable',enabled:true,expectedRevision:state.revision},owner)).body;
  const request=await ipc(ports.APP_PORT,'garage.app','access.request',{scopes:['apps.read']});assert.equal(request.result.state,'pending');
  state=(await api('/app-access',{action:'approve',requestId:request.result.requestId,scopes:['apps.read'],expectedRevision:state.revision},owner)).body;assert.equal(state.grants.length,1);
  const apps=await ipc(ports.APP_PORT,'garage.app','apps.list');assert.equal(apps.ok,true);assert.equal(apps.result.apps.length,2);
  const denied=await ipc(ports.APP_PORT,'garage.app','tasks.stop',{appId:'media.app'});assert.equal(denied.error.code,'permission_denied');
  await api('/app-access',{action:'revoke',appId:'garage.app',expectedRevision:state.revision},owner);
  assert.equal((await ipc(ports.APP_PORT,'garage.app','apps.list')).error.code,'permission_denied');
  const launchRequest=await ipc(ports.APP_PORT,'garage.app','access.request',{scopes:['apps.launch']});
  state=(await api('/app-access',undefined,owner)).body;
  state=(await api('/app-access',{action:'approve',requestId:launchRequest.result.requestId,scopes:['apps.launch'],expectedRevision:state.revision},owner)).body;
  const commands=[];c.platform.execute=async command=>{commands.push(command);return {exit_code:0,stdout:''};};
  c.startupApp.pending={stage:'waiting'};c.returnApp.pending={appId:'home.app'};
  const launched=await ipc(ports.APP_PORT,'garage.app','apps.launch',{appId:'media.app'});
  assert.equal(launched.ok,true);assert.equal(launched.result.submitted,true);
  assert.equal(c.startupApp.pending.cancelled,true,'approved app launch cancels a waiting power-on attempt');
  assert.equal(c.returnApp.pending,null,'approved app launch retains return coordination');
  assert.deepEqual(commands,['/usr/bin/app_launcher -s media.app']);
  c.startupApp.pending=null;
  await api('/app-access',{action:'revoke',appId:'garage.app',expectedRevision:state.revision},owner);
  assert.equal((await ipc(ports.APP_PORT,'garage.app','apps.launch',{appId:'media.app'})).error.code,'permission_denied');
  assert.equal(commands.length,1,'revoked access never reaches the TV command queue');
  console.log('PASS real HTTP router + MessagePort: closed owner API, widget handshake, pairing, approval, scoped app reads and immediate revocation');
 }finally{if(server)await new Promise(r=>server.close(r));f.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
