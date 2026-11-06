'use strict';
const assert=require('assert').strict,path=require('path'),EventEmitter=require('events');
const load=require('./service-harness.cjs'),remap=require('../service/remap');
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
 }
 const service=load(path.resolve(__dirname,'..'),{setInterval:()=>({unref(){}}),dependencies:{
  './physical-input.js':{Bridge},'./dock.js':{Dock},
  './platform.js':{start(){},status:()=>({agent:{connected:true}}),execute:async cmd=>{commands.push(cmd);return {exit_code:0,stdout:''};}}
 }});
 const ctx=service.context;
 ctx.auth.gate=()=>false;
 ctx.remapStore.rules=remap.validateRules([{id:'home',trigger:{type:'physical',value:'63'},actions:[{type:'launcher'}]}]);
 ctx.inventory=()=>options.holdLookup?new Promise(resolve=>releaseLookup=resolve):Promise.resolve({apps:options.missing?[]:[{appId:'GlassHome1.GlassHome',show:true,disabled:!!options.disabledApp}]});
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

 for(const change of ['disable','mapping','shortcut','stop','reconnect','navigation','later-home']){
  f=fixture({holdHide:true});const pending=f.pair();await tick();
  assert.deepEqual(f.commands,['toggle','hide']);
  if(change==='disable')f.state.enabled=false;
  if(change==='mapping')f.ctx.remapStore.rules[0].actions=[{type:'launch',appId:'other.home'}];
  if(change==='shortcut')f.state.homeShortcut={appId:'different.home',label:'Different'};
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

 f=fixture();let releaseRoot;
 f.ctx.commandQueue=new Promise(resolve=>releaseRoot=resolve);
 const queued=f.pair();await tick();assert.deepEqual(f.commands,['toggle','hide']);
 f.state.doublePressHome=false;releaseRoot();await queued;
 assert.deepEqual(f.commands,['toggle','hide'],'a queued root command rechecks the gesture at dispatch');
 assert.equal(f.ctx.inputPaused,false,'cancelling stale work does not disable the current remote mapping');

 f=fixture();f.send('down',0);f.send('up',40);await f.ctx.actionQueue;
 assert.equal((await f.request({action:'doublePressHome',on:false})).status,200);
 assert.equal((await f.request({action:'doublePressHome',on:true})).body.doublePressHome,true);
 f.send('down',180);await f.ctx.actionQueue;
 assert.deepEqual(f.commands,['toggle','toggle'],'turning off and on does not restore an old pair');
 assert.equal((await f.request({action:'doublePressHome',on:'yes'})).status,409);
 assert.throws(()=>remap.validateAction({type:'launcherHome'}),/unknown action/,'the internal gesture is not a public remap action');
 console.log('PASS double Home integration: immediate first action, saved target, fallback, disabled/direct/native Home, cancellation, settings and navigation');
})().catch(error=>{console.error(error);process.exitCode=1;});
