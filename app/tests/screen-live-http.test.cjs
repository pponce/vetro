'use strict';
const assert=require('assert').strict,http=require('http'),path=require('path');
const fixture=require('./app-access-fixture.cjs');
(async()=>{
 const f=fixture();let server;
 try{
  const h=require('./service-harness.cjs')(path.resolve(__dirname,'..'),{tizen:f.tizen,setInterval:()=>({unref(){}}),
   dependencies:{os:Object.assign({},require('os'),{networkInterfaces:()=>({})})}}),c=h.context;
  let rootCommands=0,launcherChecks=0,policy={mode:'filter',connected:false},preference={enabled:true};
  c.platform.status=()=>({mode:'tv-integration',agent:{connected:true}});
  c.platform.execute=()=>{rootCommands++;throw Error('Live status must not run root commands');};
  c.dock.readState=()=>({enabled:true});c.dock.installed=()=>true;
  c.dock.probe=async()=>{launcherChecks++;return {running:true};};
  c.inputSnapshot=()=>({policy,preference});c.inputTokens=()=>['63'];c.inputRestoring=true;
  server=http.createServer(h.router);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+server.address().port,token=c.auth.issueWidget().token;
  async function get(route,authenticated=true,method='GET'){
   const r=await fetch(base+route,{method,headers:authenticated?{'X-Vetro-Widget':token,Origin:'null'}:{}});
   return {status:r.status,body:await r.json()};
  }
  assert.equal((await get('/screen?live=1',false)).status,401);
  assert.equal((await get('/screen?live=1',true,'POST')).status,403,'widget cannot turn a read into a mutation');
  let r=await get('/screen?live=1');assert.equal(r.status,200,JSON.stringify(r.body));
  assert.deepEqual(r.body.input,{enabled:true,connected:false,recovering:true});
  assert.equal(r.body.launcher.running,null,'live route does not claim a new launcher process check');
  policy={mode:'filter',connected:true};c.inputRestoring=false;
  r=await get('/screen?live=1');assert.deepEqual(r.body.input,{enabled:true,connected:true,recovering:false});
  assert.equal(launcherChecks,0);assert.equal(rootCommands,0,'repeated live refreshes never join the root queue');
  r=await get('/screen');assert.equal(r.body.launcher.running,true);assert.equal(launcherChecks,1,'full summary keeps its launcher check');
  policy={mode:'off',connected:false};preference={enabled:false};c.inputTokens=()=>[];
  r=await get('/screen?live=1');assert.deepEqual(r.body.input,{enabled:false,connected:false,recovering:false});
  assert.equal(rootCommands,0);
  console.log('PASS live screen HTTP: widget authorization, current input recovery, no root commands or repeated launcher probes');
 }finally{if(server)await new Promise(r=>server.close(r));f.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
