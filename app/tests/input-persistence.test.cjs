'use strict';
const assert=require('assert').strict, path=require('path'), EventEmitter=require('events');
const load=require('./service-harness.cjs'), root=path.resolve(__dirname,'..');
let disk=JSON.stringify({rules:[{id:'remote',enabled:true,trigger:{type:'physical',value:'67'},actions:[{type:'launch',appId:'example.app'}]}]}), ready=true, node='/dev/input/event4', writesFail=false;
const starts=[], commands=[];let temporary='';
class Dock {constructor(){this.enabled=false;}readState(){return {enabled:this.enabled};}async enable(){this.enabled=true;}async disable(){this.enabled=false;}supervise(){return Promise.resolve();}}
class Bridge {
 constructor(execute,onEvent){this.onEvent=onEvent;this.current={mode:'off',connected:false};}
 inventory(){return Promise.resolve([{name:'Smart Control',node,unique:true,selectable:true}]);}
 status(){return {policy:this.current,events:[]};}
 stop(){this.current={mode:'off',connected:false};}
 async start(device,mode,tokens){assert.ok(ready);assert.ok(device==='Smart Control'||device===node);starts.push({device,mode,tokens});this.current={mode,connected:true,device:'Smart Control',node};return this.status();}
}
function boot(){const timers=[];const service=load(root,{dependencies:{fs:{readFileSync:p=>p.endsWith('vetro-remap.json')?disk:'',writeFileSync:(p,s)=>{if(writesFail)throw Error('disk full');if(p.endsWith('.tmp'))temporary=s;else disk=s;},renameSync:()=>{disk=temporary;},unlinkSync:()=>{}},'./physical-input.js':{Bridge},'./dock.js':{Dock},'./platform.js':{start(){},status:()=>({agent:{connected:ready}}),execute:cmd=>{commands.push(cmd);return Promise.resolve({exit_code:0,stdout:''});}}},setInterval:fn=>{timers.push(fn);return {unref(){}};}});service.context.auth.gate=()=>false; /* Covered by app-access-http.test.cjs. */service.tick=async()=>{timers.forEach(fn=>fn());await new Promise(r=>setImmediate(r));};return service;}
function post(service,body,url='/input'){return new Promise(resolve=>{const req=new EventEmitter();req.method='POST';req.url=url;service.router(req,{writeHead(code){this.code=code;},end(s){resolve(JSON.parse(s));}});req.emit('data',Buffer.from(JSON.stringify(body)));req.emit('end');});}
(async()=>{
 let service=boot();await service.tick();assert.equal(starts.length,0);
 let result=await post(service,{device:node,mode:'filter'});assert.equal(result.ok,true);
 node='/dev/input/event7';ready=false;service=boot();await service.tick();assert.equal(starts.length,1);
 ready=true;await service.tick();assert.equal(starts.length,2,'saved interception must resume after restart when the adapter connects');assert.equal(service.context.physical.status().policy.mode,'filter');
 service.context.physical.onEvent({action:'down',decision:'blocked',code:67});await service.context.actionQueue;assert.ok(commands.includes('/usr/bin/app_launcher -s example.app'),'restored interception must execute the saved app shortcut');
 service.context.physical.stop();await service.tick();assert.equal(starts.length,3,'helper disconnection must reconnect');
 await post(service,{device:node,mode:'observe'});await service.tick();assert.equal(starts.length,4,'listening pauses interception without clearing the preference');assert.equal(JSON.parse(disk).input.enabled,true);
 service=boot();await service.tick();assert.equal(starts.at(-1).mode,'filter','listening is not restored after boot');
 const rules=JSON.parse(disk).rules;rules[0].trigger.value='68';await post(service,{rules},'/remap');await service.tick();assert.equal(starts.at(-1).tokens[0],'68','editing reconfigures saved interception');
 await post(service,{rules:[]},'/remap');let count=starts.length;await service.tick();assert.equal(starts.length,count,'no helper without physical shortcuts');
 await post(service,{rules},'/remap');await service.tick();assert.equal(starts.length,count+1,'interception resumes when shortcuts return');
 await post(service,{mode:'off'});count=starts.length;service=boot();await service.tick();assert.equal(starts.length,count,'explicit off must survive restart');
 const launcherRules=[{id:'home',enabled:true,trigger:{type:'physical',value:'63'},actions:[{type:'launcher'}]}];
 await post(service,{rules:launcherRules},'/remap');await post(service,{device:node,mode:'filter'});
 service=boot();await service.tick();let toggles=0;service.context.dock.toggle=()=>{toggles++;return true;};
 commands.length=0;service.context.physical.onEvent({action:'down',decision:'blocked',code:63});await service.context.actionQueue;
 assert.equal(toggles,1,'launcher action survives saved rule validation and interception restoration');
 assert.deepEqual(commands,[],'restored launcher shortcut does not inject Home or close an app');
 await post(service,{mode:'off'});
 writesFail=true;result=await post(service,{device:node,mode:'filter'});assert.equal(result.ok,false,'unsaved interception must not report success');assert.equal(service.context.physical.status().policy.mode,'filter','failed master change preserves the independently assigned Home route');
 // A lifecycle stop must release input and prevent the still-live retry timer
 // or queued events from resurrecting interception in the stopped context.
 writesFail=false;disk=JSON.stringify({rules:[{id:'remote',enabled:true,trigger:{type:'physical',value:'67'},actions:[{type:'launch',appId:'example.app'}]}],input:{enabled:true,device:'Smart Control',node}});
 service=boot();await service.tick();count=starts.length;const saved=disk;
 service.lifecycle.onStop();service.lifecycle.onExit();
 assert.equal(service.context.physical.status().policy.connected,false);
 await service.tick();await service.tick();assert.equal(starts.length,count,'stopped service cannot restore input on a timer');
 commands.length=0;service.context.physical.onEvent({action:'down',decision:'blocked',code:67});await service.context.actionQueue;
 assert.deepEqual(commands,[],'late input events in the stopped context do not launch an app');
 result=await post(service,{device:node,mode:'filter'});assert.equal(result.error,'Remote service is stopped');
 assert.equal(disk,saved,'lifecycle shutdown preserves the saved remote and rules');
 service.lifecycle.onRequest();await service.tick();assert.equal(starts.length,count+1,'a lifecycle restart restores the saved route once');
 service.lifecycle.onRequest();service.lifecycle.onStart();await service.tick();assert.equal(starts.length,count+1,'healthy lifecycle callbacks do not replace the helper');

 // A delayed restore from before stop must not clear the new restore lock or
 // overwrite its error while a new generation is still obtaining inventory.
 service.context.physical.stop();const pending=[];
 const inventory=service.context.physical.inventory.bind(service.context.physical);
 service.context.physical.inventory=()=>new Promise(resolve=>pending.push(resolve));
 const oldRestore=service.context.restoreInput();assert.equal(pending.length,1);
 service.lifecycle.onStop();service.lifecycle.onStart();assert.equal(pending.length,2);
 pending[0](await inventory());await oldRestore;
 assert.equal(service.context.inputRestoring,true,'old restore completion cannot unlock the current generation');
 assert.equal(service.context.inputError,null,'cancelled old restore does not become a current error');
 pending[1](await inventory());await new Promise(r=>setImmediate(r));
 assert.equal(service.context.inputRestoring,false);assert.equal(service.context.physical.status().policy.connected,true);
 service.context.physical.inventory=inventory;

 // An action already submitted before shutdown may finish later. Its failure
 // must not pause or stop a newly restored helper.
 let rejectAction;service.context.runActions=()=>new Promise((resolve,reject)=>{rejectAction=reject;});
 service.context.physical.onEvent({action:'down',decision:'blocked',code:67});await new Promise(r=>setImmediate(r));
 assert.equal(typeof rejectAction,'function');
 service.lifecycle.onStop();service.lifecycle.onStart();await new Promise(r=>setImmediate(r));
 assert.equal(service.context.physical.status().policy.connected,true);
 rejectAction(Error('late action failure'));await service.context.actionQueue;
 assert.equal(service.context.physical.status().policy.connected,true,'an old action failure cannot stop the current helper');
 assert.equal(service.context.inputPaused,false);assert.equal(service.context.inputError,null);

 // Pending owner requests also belong to their lifecycle generation. Neither
 // an old failed filter request nor late automatic observation may stop or
 // replace the helper restored after a lifecycle restart.
 const start=service.context.physical.start.bind(service.context.physical);let rejectFilter;
 service.context.physical.start=()=>new Promise((resolve,reject)=>{rejectFilter=reject;});
 const filterRequest=post(service,{device:node,mode:'filter'});await new Promise(r=>setImmediate(r));
 service.lifecycle.onStop();service.context.physical.start=start;service.lifecycle.onStart();await service.tick();
 rejectFilter(Error('old filter failed'));result=await filterRequest;
 assert.equal(result.ok,false);assert.equal(service.context.physical.status().policy.connected,true);
 let resolveObserve;service.context.physical.inventory=()=>new Promise(resolve=>{resolveObserve=resolve;});
 const observeRequest=post(service,{device:'auto',mode:'observe'});await new Promise(r=>setImmediate(r));
 service.lifecycle.onStop();service.context.physical.inventory=inventory;service.lifecycle.onStart();await service.tick();count=starts.length;
 resolveObserve(await inventory());result=await observeRequest;
 assert.equal(result.ok,false);assert.equal(starts.length,count,'stale observation does not launch extra helpers');
 assert.equal(service.context.physical.status().policy.connected,true);

 // A request body can arrive after its lifecycle ended. It must not mutate
 // preferences or create a helper, even if another lifecycle has since started.
 for(const restart of [false,true]){
  const req=new EventEmitter();req.method='POST';req.url='/input';
  const response=new Promise(resolve=>service.router(req,{writeHead(){},end(s){resolve(JSON.parse(s));}}));
  const beforeBody=disk;service.lifecycle.onStop();
  if(restart){service.lifecycle.onStart();await service.tick();}
  count=starts.length;req.emit('data',Buffer.from(JSON.stringify({mode:'off'})));req.emit('end');
  result=await response;assert.equal(result.error,'Remote setup cancelled');
  assert.equal(disk,beforeBody,'a request from a stopped lifecycle cannot disable the saved preference');
  assert.equal(starts.length,count);
  if(!restart){service.lifecycle.onStart();await service.tick();}
 }

 // Rejection of a superseded resume request must not overwrite an error from
 // the current lifecycle or stop the helper restored by that lifecycle.
 let resolveResume;service.context.physical.inventory=()=>new Promise(resolve=>{resolveResume=resolve;});
 const resumeRequest=post(service,{mode:'resume'});await new Promise(r=>setImmediate(r));
 service.lifecycle.onStop();service.context.physical.inventory=inventory;service.lifecycle.onStart();await service.tick();
 service.context.inputError='current lifecycle error';resolveResume(await inventory());result=await resumeRequest;
 assert.equal(result.ok,false);assert.equal(service.context.inputError,'current lifecycle error');
 assert.equal(service.context.physical.status().policy.connected,true);
 console.log('PASS input persistence: saved state, lifecycle stop/resume, no stopped-context retries or events, generation-safe restore and action completion');
})().catch(e=>{console.error(e);process.exitCode=1;});

