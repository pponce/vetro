'use strict';
const assert=require('assert').strict,fixture=require('./app-access-fixture.cjs'),{create,AUDIO,PLAYBACK}=require('../service/app-api');
(async()=>{const f=fixture();try{const mutations=[],commands=[],launches=[];let processRows=[{appId:'media.app',pid:42,rssBytes:128,kernel:false,commandLine:'private'},{appId:'system.app',pid:1,rssBytes:888}];
 f.rows.push({...f.rows[1],appId:'system.app',packageId:'system.pkg',system:true,show:false});
 const options={identity:f.identity,monitor:async()=>({processes:processRows}),execute:async(cmd,t,guard)=>{if(guard)guard();commands.push(cmd);processRows=[];return {exit_code:0};},launch:async(id,guard)=>{guard();launches.push(id);},mutation:fn=>fn(),settings:{read:async()=>({items:[{id:'backlight',probe:'confirmed',writable:true,value:20,min:0,max:50}]}),write:async(p,guard)=>{guard();mutations.push(p);return {ok:true,verified:true,previous:20,value:p.value};}}};
 const perform=create(options),run=(m,p={})=>perform(m,p,f.rows,()=>{});
 const listed=await run('apps.list');assert.deepEqual(listed.apps.map(x=>x.appId),['garage.app','media.app']);assert.equal((await run('apps.list',{limit:1})).nextOffset,1);
 const tasks=await run('tasks.list');assert.equal(tasks.apps.length,1);assert.deepEqual(tasks.apps[0],{appId:'media.app',name:'media.app',disabled:false,running:true,memoryBytes:128});assert.ok(!JSON.stringify(tasks).includes('private'));
 for(const m of ['tasks.stop','apps.launch'])for(const appId of ['system.app','missing','vetrotvapp.svc','; reboot'])await assert.rejects(run(m,{appId}),e=>e.code==='not_allowed');
 for(const p of [{appId:'media.app',action:'uninstall'},{appId:'media.app',pid:1},{appId:'media.app',all:true}])await assert.rejects(run('tasks.stop',p),e=>e.code==='invalid_request');
 // A visible preinstalled media app can be opened, but never listed/stopped by task access.
 f.rows.push({...f.rows[1],appId:'preloaded.app',packageId:'preloaded.pkg',system:true,preload:true,removable:false});
 f.installed['preloaded.app']={...f.installed['media.app'],id:'preloaded.app',packageId:'preloaded.pkg',cert:null};
 assert.ok((await run('apps.list')).apps.some(x=>x.appId==='preloaded.app'));
 await run('apps.launch',{appId:'preloaded.app'});
 await assert.rejects(run('tasks.stop',{appId:'preloaded.app'}),e=>e.code==='not_allowed');
 processRows.push({appId:'preloaded.app',rssBytes:100});assert.ok(!(await run('tasks.list')).apps.some(x=>x.appId==='preloaded.app'));
 await assert.rejects(Promise.resolve().then(()=>f.identity.read('preloaded.app')));
 for(const patch of [{show:false},{component:'svcapp'},{protected:true},{system:null},{preload:null},{removable:null}]) {
   Object.assign(f.rows[2],{show:true,component:'uiapp',protected:false,system:true,preload:true,removable:false},patch);
   await assert.rejects(run('apps.launch',{appId:'system.app'}));
 }
 await run('apps.launch',{appId:'media.app'});assert.deepEqual(launches,['preloaded.app','media.app']);
 const stop=await run('tasks.stop',{appId:'media.app'});assert.equal(stop.verified,true);assert.equal(Buffer.from(commands[0].split(' ')[1],'base64').toString(),'app_launcher -k media.app');assert.equal(commands.length,1);
 f.rows[1].disabled=true;await assert.rejects(run('apps.launch',{appId:'media.app'}),e=>e.code==='not_allowed');f.rows[1].disabled=false;
 f.installed['media.app'].version='2';await assert.rejects(run('tasks.stop',{appId:'media.app'}),e=>e.code==='identity_changed');f.installed['media.app'].version='1.0';
 for(const p of [{value:-1,expected:20},{value:51,expected:20},{value:20.5,expected:20},{value:25},{value:'20',expected:20},{value:20,expected:20,id:'serviceMenu'}])await assert.rejects(run('brightness.set',p));assert.equal(mutations.length,0);
 assert.equal((await run('brightness.read')).value,20);assert.equal((await run('brightness.set',{value:25,expected:20})).verified,true);assert.deepEqual(mutations,[{id:'backlight',value:25,expected:20}]);
 options.settings.read=async()=>({items:[{id:'backlight',probe:'missing',writable:true}]});await assert.rejects(run('brightness.set',{value:25,expected:20}),e=>e.code==='unavailable');
 for(const key of ['XF86Home','XF86PowerOff','Return','KEY_MENU','; reboot'])for(const method of ['audio.key','playback.key'])await assert.rejects(run(method,{key}),e=>e.code==='not_allowed');
 for(const key of AUDIO)await run('audio.key',{key});for(const key of PLAYBACK)await run('playback.key',{key});await run('power.off');await assert.rejects(run('power.off',{key:'XF86Home'}));
 // A removed permission at the dispatch boundary prevents command execution.
 const count=commands.length;await assert.rejects(perform('audio.key',{key:AUDIO[0]},f.rows,()=>{const e=Error('revoked');e.code='permission_denied';throw e;}));assert.equal(commands.length,count);
 console.log('PASS scoped API: safe app inventory, task privacy, user-app target checks, stop only, bounded brightness and dedicated remote keys');
 }finally{f.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
