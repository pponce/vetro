'use strict';
const assert=require('assert').strict,path=require('path'),EventEmitter=require('events');
const load=require('./service-harness.cjs'),remap=require('../service/remap'),RealDock=require('../service/dock.js').Dock;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(options={}){
 const commands=[],state={enabled:true,doublePressHome:options.double!==false,homeShortcut:options.defaultHome?null:{appId:'GlassHome1.GlassHome',label:'Glass Home'}};
 let releaseHide,releaseLookup;
 class Bridge{
  constructor(execute,onEvent){this.onEvent=onEvent;this.policy={mode:'filter',connected:true,blocked:['63']};}
  status(){return {policy:this.policy,events:[]};}inventory(){return Promise.resolve([]);}
  stop(){this.policy={mode:'off',connected:false};}
 }
 class Dock{
  readState(){return {...state};}status(){return Promise.resolve({...state,installed:true,running:true});}
  toggle(){commands.push('toggle');return Promise.resolve(true);}
  hide(){commands.push('hide');if(options.holdHide)return new Promise(resolve=>releaseHide=resolve);return Promise.resolve(true);}
  setDoublePressHome(on){if(typeof on!=='boolean')return Promise.reject(Error('Choose on or off'));state.doublePressHome=on;return this.status();}
  installed(){return true;}patchState(patch){Object.assign(state,patch);}
  setDoublePressHomeTarget(appId,available){return RealDock.prototype.setDoublePressHomeTarget.call(this,appId,available);}
 }
 const service=load(path.resolve(__dirname,'..'),{setInterval:()=>({unref(){}}),dependencies:{
  './physical-input.js':{Bridge},'./dock.js':{Dock},
  './platform.js':{start(){},status:()=>({agent:{connected:true}}),execute:async cmd=>{commands.push(cmd);return {exit_code:0,stdout:''};}}
 }});
 const ctx=service.context;
 ctx.auth.gate=()=>false;
 ctx.remapStore.rules=remap.validateRules([{id:'home',trigger:{type:'physical',value:'63'},actions:[{type:'launcher'}]}]);
 ctx.inventory=()=>options.holdLookup?new Promise(resolve=>releaseLookup=resolve):Promise.resolve({apps:options.missing?[]:[{appId:'GlassHome1.GlassHome',show:true,disabled:!!options.disabledApp},{appId:'other.home',name:'Other Home',show:true,disabled:false}]});
 function send(action,ms,code=63){ctx.physical.onEvent({action,code,decision:code===63?'blocked':'native',time_seconds:1000+Math.floor(ms/1000),time_microseconds:(ms%1000)*1000});}
 function pair(){send('down',0);send('up',40);send('down',180);send('up',220);return ctx.actionQueue;}
 function request(body){return new Promise(resolve=>{const req=new EventEmitter();req.url='/dock';req.method='POST';let status;service.router(req,{writeHead(code){status=code;},end(text){resolve({status,body:JSON.parse(text)});}});req.emit('data',Buffer.from(JSON.stringify(body)));req.emit('end');});}
 return {ctx,state,commands,send,pair,request,releaseHide:()=>releaseHide(true),releaseLookup:()=>releaseLookup({apps:[{appId:'GlassHome1.GlassHome',show:true,disabled:false}]})};
}
(async()=>{
 let f=fixture();f.send('down',0);await f.ctx.actionQueue;
 assert.deepEqual(f.commands,['toggle'],'the first Home press is dispatched before a second press');
 f.send('up',40);f.send('down',180);await f.ctx.actionQueue;
 assert.deepEqual(f.commands,['toggle','hide','/usr/bin/app_launcher -s GlassHome1.GlassHome']);
 assert.equal(f.ctx.returnApp.navigation.intent.appId,'GlassHome1.GlassHome','automatic return respects the selected destination');

 f=fixture();
 let saved=await f.request({action:'doublePressHomeTarget',appId:'other.home'});
 assert.equal(saved.status,200);assert.equal(saved.body.doublePressHomeTarget.appId,'other.home');
 assert.equal(f.state.homeShortcut.appId,'GlassHome1.GlassHome','the launcher shortcut stays separate');
 await f.pair();assert.equal(f.commands.at(-1),'/usr/bin/app_launcher -s other.home');
 f.state.homeShortcut={appId:'a.changed.shortcut',label:'Changed'};
 f.send('down',800);f.send('up',840);f.send('down',980);await f.ctx.actionQueue;
 assert.equal(f.commands.at(-1),'/usr/bin/app_launcher -s other.home','changing the launcher shortcut does not redirect a separate app');
 assert.equal((await f.request({action:'doublePressHomeTarget',appId:null})).body.doublePressHomeTarget,null);
 f.state.homeShortcut={appId:'GlassHome1.GlassHome',label:'Glass Home'};
 f.send('up',1000);f.send('down',1800);f.send('up',1840);f.send('down',1980);await f.ctx.actionQueue;
 assert.equal(f.commands.at(-1),'/usr/bin/app_launcher -s GlassHome1.GlassHome','following the shortcut resumes after switching modes');
 f=fixture();await f.request({action:'doublePressHomeTarget',appId:'com.samsung.tv.csfs'});await f.pair();
 assert.equal(f.commands.at(-1),'/usr/bin/app_launcher -s com.samsung.tv.csfs','Samsung Home can be independent of Glass Home in the launcher');
 for(const setting of ['missing','disabledApp']){
  f=fixture({[setting]:true});f.state.doublePressHomeTarget={appId:'GlassHome1.GlassHome',label:'Glass Home'};
  f.state.homeShortcut={appId:'other.home',label:'Other'};await f.pair();
  assert.equal(f.commands.at(-1),'/usr/bin/app_launcher -s com.samsung.tv.csfs','unavailable separate target falls back to Samsung Home: '+setting);
 }
 f=fixture();
 assert.equal((await f.request({action:'doublePressHomeTarget',appId:'not.installed'})).status,409);
 assert.equal((await f.request({action:'doublePressHomeTarget',appId:'bad;command'})).status,409);
 assert.equal((await f.request({action:'doublePressHomeTarget'})).status,409);
 f.ctx.inventory=async()=>({registryError:'unavailable',apps:[]});
 assert.equal((await f.request({action:'doublePressHomeTarget',appId:'other.home'})).status,409);
 assert.equal(f.state.doublePressHomeTarget,undefined,'failed selection does not change the saved mode');

 for(const setting of ['defaultHome','missing','disabledApp']){
  f=fixture({[setting]:true});await f.pair();
  assert.deepEqual(f.commands,['toggle','hide','/usr/bin/app_launcher -s com.samsung.tv.csfs'],setting);
 }
 f=fixture({double:false});await f.pair();assert.deepEqual(f.commands,['toggle','toggle'],'feature off preserves ordinary Home');
 for(const launcherEnabled of [true,false]){
  f=fixture();f.state.enabled=launcherEnabled;
  f.ctx.remapStore.rules=remap.validateRules([{id:'home',trigger:{type:'physical',value:'63'},actions:[{type:'launch',appId:'other.home'}]}]);
  await f.pair();assert.deepEqual(f.commands,['/usr/bin/app_launcher -s other.home','/usr/bin/app_launcher -s other.home'],
   'a direct Home mapping wins even if another shortcut keeps the launcher running');
 }
 f=fixture();f.ctx.remapStore.rules=[];await f.pair();assert.deepEqual(f.commands,[],'native Home has no launcher gesture');
 f=fixture();f.send('down',0);f.send('up',40);f.send('down',80,108);f.send('down',180);await f.ctx.actionQueue;
 assert.deepEqual(f.commands,['toggle','toggle'],'intervening navigation breaks the pair');
 f=fixture();f.send('down',0);f.send('up',40);f.send('down',180);f.send('up',220);f.send('down',300);await f.ctx.actionQueue;
 assert.equal(f.commands.filter(c=>c.includes('app_launcher')).length,1,'a fast triple only launches once');

 for(const change of ['disable','mapping','shortcut','target','stop','reconnect','navigation','later-home']){
  f=fixture({holdHide:true});const pending=f.pair();await tick();
  assert.deepEqual(f.commands,['toggle','hide']);
  if(change==='disable')f.state.enabled=false;
  if(change==='mapping')f.ctx.remapStore.rules[0].actions=[{type:'launch',appId:'other.home'}];
  if(change==='shortcut')f.state.homeShortcut={appId:'different.home',label:'Different'};
  if(change==='target')f.state.doublePressHomeTarget={appId:'other.home',label:'Other'};
  if(change==='stop')f.ctx.stopInputLifecycle();
  if(change==='reconnect')f.ctx.physical.generation=1;
  if(change==='navigation')f.send('down',260,108);
  if(change==='later-home')f.send('down',800);
  f.releaseHide();await pending;
  if(change==='later-home'){await f.ctx.actionQueue;assert.deepEqual(f.commands,['toggle','hide','toggle']);}
  else assert.equal(f.commands.length,2,'no stale app launch after '+change);
 }
 f=fixture({holdLookup:true});const pending=f.pair();await tick();
 f.state.enabled=false;f.releaseLookup();await pending;
 assert.deepEqual(f.commands,['toggle'],'disabling during lookup does not hide or launch');

 f=fixture({holdLookup:true});const pendingTarget=f.pair();await tick();
 f.state.doublePressHomeTarget={appId:'other.home',label:'Other'};f.releaseLookup();await pendingTarget;
 assert.deepEqual(f.commands,['toggle'],'changing the destination during lookup cancels the old launch');

 f=fixture();let releaseRoot;
 f.ctx.commandQueue=new Promise(resolve=>releaseRoot=resolve);
 const queued=f.pair();await tick();assert.deepEqual(f.commands,['toggle','hide']);
 f.state.doublePressHome=false;releaseRoot();await queued;
 assert.deepEqual(f.commands,['toggle','hide'],'a queued root command rechecks the gesture at dispatch');
 assert.equal(f.ctx.inputPaused,false,'cancelling stale work does not disable the current remote mapping');

 f=fixture();f.ctx.commandQueue=new Promise(resolve=>releaseRoot=resolve);
 const queuedTarget=f.pair();await tick();f.state.doublePressHomeTarget={appId:'other.home',label:'Other'};releaseRoot();await queuedTarget;
 assert.deepEqual(f.commands,['toggle','hide'],'a queued launch cannot use a replaced destination');

 f=fixture();f.send('down',0);f.send('up',40);await f.ctx.actionQueue;
 await f.request({action:'doublePressHomeTarget',appId:'other.home'});
 await f.request({action:'doublePressHomeTarget',appId:null});
 f.send('down',180);await f.ctx.actionQueue;
 assert.deepEqual(f.commands,['toggle','toggle'],'switching modes and back does not revive an unfinished gesture');

 f=fixture();f.send('down',0);f.send('up',40);await f.ctx.actionQueue;
 assert.equal((await f.request({action:'doublePressHome',on:false})).status,200);
 assert.equal((await f.request({action:'doublePressHome',on:true})).body.doublePressHome,true);
 f.send('down',180);await f.ctx.actionQueue;
 assert.deepEqual(f.commands,['toggle','toggle'],'turning off and on does not restore an old pair');
 assert.equal((await f.request({action:'doublePressHome',on:'yes'})).status,409);
 assert.throws(()=>remap.validateAction({type:'launcherHome'}),/unknown action/,'the internal gesture is not a public remap action');
 console.log('PASS double Home integration: immediate first action, saved target, fallback, disabled/direct/native Home, cancellation, settings and navigation');
})().catch(error=>{console.error(error);process.exitCode=1;});
