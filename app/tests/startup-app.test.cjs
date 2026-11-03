'use strict';
const assert=require('assert').strict,fs=require('fs'),path=require('path');
const {StartupApp,EVENT_MS,WAKE_MS}=require('../service/startup-app.js');
const directory=fs.mkdtempSync(path.join(__dirname,'.startup-test-'));
const HOME='com.samsung.tv.csfs';let sequence=0;
function fixture(){
 const f={time:100000,power:'on',root:true,clock:{bootId:'boot-a',suspendOffset:0,uptimeSeconds:2},
  activity:{ready:true,sequence:0,lastAt:0,generation:1},foreground:{full:HOME,partial:'',sourceType:0},
  apps:[{appId:'video.one',show:true,disabled:false,onboot:false,autorestart:false},{appId:'video.two',show:true,disabled:false},{appId:'hidden.app',show:false,disabled:false}],launches:[],reads:0,inside:[]};
 const n=sequence++;
 f.options={file:path.join(directory,'choice-'+n),sessionFile:path.join(directory,'session-'+n),now:()=>f.time,clock:()=>({...f.clock}),
  readPower:async()=>{f.reads++;if(f.powerError)throw Error('power unavailable');return f.power;},ready:()=>f.root,activity:()=>({...f.activity}),
  inventory:async()=>{if(f.beforeInventory)await f.beforeInventory();return {apps:f.apps,registryError:f.registryError};},
  snapshot:async inside=>{f.inside.push(inside);if(f.snapshotError)throw Error('foreground unavailable');return {...f.foreground};},
  presence:async()=>({foreground:{appId:f.foreground.full}}),
  launch:async(id,guard)=>{if(f.beforeLaunch)await f.beforeLaunch();if(!await guard())throw Error('cancelled');f.launches.push(id);}};
 f.app=new StartupApp(f.options);
 f.tick=async(ms=2000)=>{f.time+=ms;await f.app.tick();};
 f.choose=id=>f.app.configure(id,f.app.status().revision,f.apps);
 f.startWake=async()=>{f.power='standby';await f.tick();f.power='on';await f.tick();};
 f.wake=async()=>{await f.startWake();await f.tick();};
 f.press=()=>{f.activity.sequence++;f.activity.lastAt=f.time;};
 return f;
}
(async()=>{
 let f=fixture();await f.tick();assert.equal(f.reads,0);const original=JSON.stringify(f.apps);
 f.choose('video.one');await f.tick();await f.tick();assert.deepEqual(f.launches,[],'saving waits for the next wake');
 await f.wake();assert.deepEqual(f.launches,['video.one']);assert.ok(f.inside.includes(true));
 f.foreground.full='video.one';await f.tick();assert.equal(f.app.status().lastResult,'App confirmed onscreen');
 f.foreground.full='video.two';await f.tick(20000);assert.equal(f.launches.length,1,'never repeatedly takes focus');
 f.app=new StartupApp(f.options);await f.tick();assert.equal(f.launches.length,1,'restart does not replay a handled wake');
 f.root=false;await f.tick();f.root=true;f.powerError=true;await f.tick();f.powerError=false;await f.tick();assert.equal(f.launches.length,1,'root recovery and failed power reads do not create wakes');
 assert.equal(JSON.stringify(f.apps),original,'boot/restart flags stay unchanged');
 assert.throws(()=>f.choose('hidden.app'),/launcher/);assert.throws(()=>f.choose('bad;id'),/Invalid/);assert.throws(()=>f.app.configure('video.two',0,f.apps),/changed/);
 f.choose('video.two');assert.equal(f.app.status().appId,'video.two');f.choose(null);f.app=new StartupApp(f.options);assert.equal(f.app.status().appId,null);
 for(const cause of ['press','monitor','generation','other-app','overlay','source','choice','power','deadline','root']){
  f=fixture();f.choose('video.one');await f.startWake();
  const change=()=>{
   if(cause==='press')f.press();if(cause==='monitor')f.activity.ready=false;if(cause==='generation')f.activity.generation++;
   if(cause==='other-app')f.foreground.full='video.two';if(cause==='overlay')f.foreground.partial='org.tizen.menu';if(cause==='source')f.foreground.sourceType=13;
   if(cause==='choice')f.choose('video.two');if(cause==='power')f.power='standby';if(cause==='deadline')f.time+=WAKE_MS;if(cause==='root')f.root=false;
  };
  f.beforeLaunch=change;await f.tick();assert.equal(f.launches.length,0,'dispatch rechecks '+cause);
 }
 f=fixture();f.choose('video.one');await f.startWake();f.press();await f.tick();assert.match(f.app.status().lastResult,/started using/);
 await f.tick(20000);assert.equal(f.launches.length,0);await f.wake();assert.equal(f.launches.length,1,'cancellation applies only to that wake');
 f=fixture();f.choose('video.one');f.beforeInventory=async()=>f.press();await f.wake();assert.equal(f.launches.length,0,'activity during inventory cancels');
 f=fixture();f.choose('video.one');f.activity.ready=false;await f.wake();assert.equal(f.app.status().pending,true);
 f.activity.ready=true;f.activity.generation++;await f.tick();assert.equal(f.launches.length,0,'reconnected monitoring must settle');await f.tick();assert.equal(f.launches.length,1,'monitor recovery keeps the same wake alive');
 f=fixture();f.choose('video.one');f.power='standby';await f.tick();f.power='on';f.press();await f.tick(500);assert.match(f.app.status().lastResult,/activity at power-on/);
 f=fixture();f.choose('video.one');f.power='standby';await f.tick();f.press();f.power='on';await f.tick(4000);assert.equal(f.launches.length,0);assert.match(f.app.status().lastResult,/activity at power-on/,'activity before a slow first on-read also cancels');
 f=fixture();f.choose('video.one');f.power='standby';await f.tick();f.press();await f.tick();f.power='on';await f.tick(4000);
 assert.equal(f.app.status().pending,false);assert.match(f.app.status().lastResult,/activity at power-on/,'standby polling does not erase a non-power wake key');
 f=fixture();f.choose('video.one');f.foreground.full='video.two';await f.wake();assert.equal(f.launches.length,0);assert.match(f.app.status().lastResult,/another app/);
 f=fixture();f.choose('video.one');f.foreground.full='video.one';await f.wake();assert.equal(f.launches.length,0);assert.equal(f.app.status().lastResult,'App already onscreen');
 f=fixture();f.choose('video.one');f.root=false;await f.startWake();await f.tick(WAKE_MS);f.root=true;await f.tick();assert.equal(f.launches.length,0);assert.match(f.app.status().lastResult,/expired/);
 f=fixture();f.choose('video.one');f.clock.bootId='boot-b';f.clock.uptimeSeconds=90;f.app=new StartupApp(f.options);await f.tick();assert.equal(f.launches.length,0);assert.match(f.app.status().lastResult,/expired/,'late service startup cannot reset the cold-boot deadline');
 f=fixture();f.choose('video.one');f.clock.bootId='boot-b';f.clock.uptimeSeconds=null;await f.tick();assert.match(f.app.status().lastResult,/timing unavailable/);
 f=fixture();f.choose('video.one');f.clock.bootId='boot-b';f.app=new StartupApp(f.options);await f.tick();await f.tick();assert.deepEqual(f.launches,['video.one'],'early ready cold boot works');
 f=fixture();f.choose('video.one');await f.tick();f.clock.suspendOffset+=30;await f.tick();await f.tick();assert.equal(f.launches.length,1,'a real resume is still detected');
 f=fixture();f.choose('video.one');f.registryError='offline';await f.wake();assert.match(f.app.status().error,/registry/);f.registryError=null;await f.tick();assert.equal(f.launches.length,1,'transient reads can recover within the early window');
 f=fixture();f.choose('video.one');f.apps[0].disabled=true;await f.wake();assert.match(f.app.status().lastResult,/disabled/);assert.equal(f.launches.length,0);
 f=fixture();f.choose('video.one');await f.wake();await f.tick(16000);assert.match(f.app.status().lastResult,/not confirmed/);assert.equal(f.launches.length,1,'verification may finish after the launch deadline without replay');
 const broken=Object.create(fs);broken.renameSync=()=>{throw Error('disk failure');};const failed=new StartupApp({...f.options,fs:broken});
 assert.throws(()=>failed.configure(null,1,[]),/disk failure/);assert.equal(new StartupApp(f.options).status().appId,'video.one');
 // A positively observed pre-standby app may resume without defeating the choice.
 for (const reconnect of [false,true]) {
  f=fixture();f.choose('video.one');f.foreground.full='video.two';await f.tick();
  f.power='standby';await f.tick();f.activity.ready=!reconnect;f.power='on';await f.tick();
  const deadline=f.app.status().event.deadlineAt;
  if(reconnect){await f.tick(4000);f.activity.ready=true;f.activity.generation++;await f.tick();}
  await f.tick();assert.deepEqual(f.launches,['video.one'],'resumed app yields after wake readiness');
  assert.equal(f.app.status().event.deadlineAt,deadline,'reconnect cannot extend the wake deadline');
  assert.equal(f.app.status().event.resumedAppId,'video.two');
  assert.equal(f.app.status().lastResultAt,f.time);
 }
 // An arbitrary foreground discovered only after waking is not resume evidence.
 for (const cause of ['missing','stale','failed','activity','overlay','source','different-app','ineligible','native-app','native-home','native-input','native-visible']) {
  f=fixture();f.choose('video.one');f.foreground.full='video.two';
  if(cause!=='missing')await f.tick();
  if(cause==='stale')f.time+=9000;
  if(cause==='failed'){f.snapshotError=true;await f.tick();f.snapshotError=false;}
  if(cause==='activity')f.press();
  f.power='standby';await f.tick();
  if(cause==='overlay')f.foreground.partial='org.tizen.menu';
  if(cause==='source')f.foreground.sourceType=13;
  if(cause==='different-app')f.foreground.full='video.three';
  if(cause==='ineligible')f.apps[1].show=false;
  f.power='on';await f.tick();
  if(cause.startsWith('native-'))f.foreground.navigation={kind:cause.slice(7),token:'new:1',at:f.time,visible:cause==='native-visible'};
  await f.tick();assert.equal(f.launches.length,0,'resume is refused for '+cause);
 }
 // Readiness gaps are bounded and never erase observed navigation.
 for(const cause of ['activity','repeated-reconnect','never-ready','restart']) {
  f=fixture();f.choose('video.one');f.activity.ready=false;await f.startWake();
  const deadline=f.app.status().event.deadlineAt;
  if(cause==='activity'){f.press();await f.tick();f.activity.ready=true;}
  if(cause==='restart'){f.app=new StartupApp(f.options);f.activity.ready=true;}
  while(f.time<deadline){if(cause==='repeated-reconnect'){f.activity.ready=true;f.activity.generation++;}await f.tick();}
  f.activity.ready=true;await f.tick();await f.tick();assert.equal(f.launches.length,0,cause+' cannot create a late launch');
 }
 // A service restart during standby has no continuous remote activity baseline.
 f=fixture();f.choose('video.one');f.foreground.full='video.two';await f.tick();f.power='standby';await f.tick();
 f.app=new StartupApp(f.options);f.power='on';await f.tick();await f.tick();assert.equal(f.launches.length,0);
 assert.match(f.app.status().lastResult,/service restart/);
 // Suspend detection can use pre-suspend evidence even when standby polling stops.
 f=fixture();f.choose('video.one');f.foreground.full='video.two';await f.tick();
 f.time+=30000;f.clock.suspendOffset+=30;await f.tick();await f.tick();assert.deepEqual(f.launches,['video.one']);
 // Navigation and source changes are checked again inside the dispatch queue.
 for(const cause of ['press','native','source','app','overlay','intent']) {
  f=fixture();f.choose('video.one');f.foreground.full='video.two';await f.tick();await f.startWake();
  f.beforeLaunch=()=>{
   if(cause==='press')f.press();if(cause==='native')f.foreground.navigation={kind:'home',token:'new:2',at:f.time,visible:false};
   if(cause==='intent')f.app.noteNavigation();
   if(cause==='source')f.foreground.sourceType=13;if(cause==='app')f.foreground.full='video.three';if(cause==='overlay')f.foreground.partial='org.tizen.menu';
  };await f.tick();assert.equal(f.launches.length,0,'resumed dispatch guard: '+cause);
 }
 f=fixture();f.choose('video.one');let session={id:'wake-one'};f.app.powerSession=()=>session;
 await f.wake();f.foreground.full='video.one';await f.tick();const resultAt=f.app.status().lastResultAt;
 session={id:'wake-two'};assert.equal(f.app.status().lastResultSession.id,'wake-one');assert.equal(f.app.status().powerSession.id,'wake-two');
 assert.equal(f.app.status().lastResultAt,resultAt,'reading status does not relabel a prior result');
 f=fixture();f.choose('video.one');f.apps.push({appId:'org.tizen.menu',show:true,disabled:false});f.foreground.full='org.tizen.menu';await f.tick();await f.wake();
 assert.equal(f.launches.length,0,'a full-screen system menu is never a resumable app');
 f=fixture();f.choose('video.one');f.foreground.full='video.two';await f.tick();await f.startWake();f.foreground.full=HOME;f.apps[1].disabled=true;
 f.beforeLaunch=()=>{f.foreground.full='video.two';};await f.tick();assert.equal(f.launches.length,0,'queued resume target must remain eligible even when the first check saw Home');
 console.log('PASS startup: bounded reconnect, verified resumed app, cold-boot age, activity/menu/input/native cancellation, queue guards, restart/no replay and timestamped sessions');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>fs.rmSync(directory,{recursive:true,force:true}));
