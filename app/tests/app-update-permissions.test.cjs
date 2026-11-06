'use strict';
const assert=require('assert').strict,fs=require('fs'),path=require('path');
const fixture=require('./app-access-fixture.cjs'),{Access}=require('../service/app-access');
const cases=[];function test(name,fn){cases.push([name,fn]);}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const denied=(promise,code)=>assert.rejects(promise,error=>error.code===code);
function update(f,version='1.1'){
 f.installed['garage.app'].version=version;f.installed['garage.app'].modified++;
 f.rows[0].version=version;return f.tizen.package.getPackageInfo('garage.app.pkg');
}
function changed(f,info,kind='updated'){f.access.packageChanged('garage.app.pkg',kind,info);}
function nativePorts(f){
 function port(name,trusted){return {messagePortName:name,isTrusted:trusted,
  addMessagePortListener(){return 1;},removeMessagePortListener(){}};}
 f.tizen.messageport={requestLocalMessagePort:name=>port(name,false),requestTrustedLocalMessagePort:name=>port(name,true)};
 return require('../service/app-ports').start(f.tizen,f.access,{issueWidget(){throw Error('No widget request expected');}});
}
test('a native same-signer update retains only approved scopes and persists the new identity',async f=>{
 f.access.startPackageWatch();await f.approve(['apps.read','remote.audio']);
 const old=JSON.parse(JSON.stringify(f.access.state.grants[0]));
 changed(f,update(f));
 const grant=f.access.state.grants[0];assert.equal(grant.identity.version,'1.1');
 assert.notEqual(grant.identity.installation,old.identity.installation);assert.notEqual(grant.generation,old.generation);
 assert.deepEqual(grant.scopes,old.scopes);assert.equal(grant.enabled,true);
 assert.equal(f.identity.epoch('garage.app.pkg'),1);assert.equal(f.access.snapshot().grants[0].current,true);
 assert.ok(f.access.events.some(event=>event.appId==='garage.app'&&event.method==='package.updated'&&event.outcome==='approval_retained'));
 await f.access.call('garage.app','apps.list',{});
 await denied(f.access.call('garage.app','power.off',{}),'permission_denied');
 const reloaded=new Access(f.options);reloaded.transport={available:true};reloaded.startPackageWatch();
 assert.deepEqual(reloaded.state.grants[0],grant);await reloaded.call('garage.app','apps.list',{});
 assert.equal(reloaded.packageContinuity['garage.app'],grant.identity.installation);
});
test('a verified same-version update retains approval and invalidates its prior generation',async f=>{
 await f.approve();f.access.startPackageWatch();const old=f.access.state.grants[0].generation;
 changed(f,update(f,'1.0'));assert.notEqual(f.access.state.grants[0].generation,old);
 assert.equal((await f.access.call('garage.app','access.status',{})).state,'approved');
});
test('new scopes still need approval and existing scopes remain usable while requested',async f=>{
 f.access.startPackageWatch();await f.approve();changed(f,update(f));
 const request=await f.access.call('garage.app','access.request',{scopes:['apps.read','power.off']});
 assert.equal(request.state,'pending');await f.access.call('garage.app','apps.list',{});
 await denied(f.access.call('garage.app','power.off',{}),'permission_denied');
 assert.deepEqual(f.access.state.grants[0].scopes,['apps.read']);
});
for(const setting of ['paused','globally off','reduced'])test('updates preserve '+setting+' permission decisions',async f=>{
 f.access.startPackageWatch();await f.approve(['apps.read','remote.audio']);
 if(setting==='globally off')await f.access.admin({action:'enable',enabled:false,expectedRevision:f.access.state.revision});
 else await f.access.admin({action:'update',appId:'garage.app',scopes:setting==='reduced'?['apps.read']:['apps.read','remote.audio'],
  enabled:setting!=='paused',expectedRevision:f.access.state.revision});
 const before=JSON.parse(JSON.stringify(f.access.state));changed(f,update(f));
 assert.equal(f.access.state.enabled,before.enabled);assert.equal(f.access.state.grants[0].enabled,before.grants[0].enabled);
 assert.deepEqual(f.access.state.grants[0].scopes,before.grants[0].scopes);
 if(setting==='globally off')await denied(f.access.call('garage.app','apps.list',{}),'disabled');
 else if(setting==='paused')await denied(f.access.call('garage.app','apps.list',{}),'permission_denied');
 else await denied(f.access.call('garage.app','audio.key',{key:'XF86AudioMute'}),'permission_denied');
});
for(const kind of ['installed','uninstalled',undefined,'unknown'])test(String(kind)+' notifications revoke even matching identities',async f=>{
 f.access.startPackageWatch();await f.approve();const info=f.tizen.package.getPackageInfo('garage.app.pkg');
 f.access.packageChanged('garage.app.pkg',kind,info);assert.equal(f.access.state.grants.length,0);
 assert.equal(f.access.packageContinuity['garage.app'],undefined);
 changed(f,update(f));assert.equal(f.access.state.grants.length,0);
 await denied(f.access.call('garage.app','apps.list',{}),'permission_denied');
});
test('an owner-revoked approval cannot be restored by a later update',async f=>{
 f.access.startPackageWatch();await f.approve();
 await f.access.admin({action:'revoke',appId:'garage.app',expectedRevision:f.access.state.revision});
 changed(f,update(f));assert.equal(f.access.state.grants.length,0);
 await denied(f.access.call('garage.app','apps.list',{}),'permission_denied');
});
for(const mutation of ['signer','missing certificate','removed app','package'])test('an update with changed '+mutation+' cannot retain approval',async f=>{
 f.access.startPackageWatch();await f.approve();const info=update(f);
 if(mutation==='signer')f.installed['garage.app'].cert='different-author';
 if(mutation==='missing certificate')f.tizen.application.getAppCerts=()=>[];
 if(mutation==='removed app')delete f.installed['garage.app'];
 if(mutation==='package')f.installed['garage.app'].packageId='replacement.pkg';
 changed(f,info);assert.equal(f.access.state.grants.length,0);
 assert.equal(f.access.packageContinuity['garage.app'],undefined);
});
for(const field of ['version','lastModified','appIds','id','missing'])test('unverified update metadata '+field+' requires approval',async f=>{
 f.access.startPackageWatch();await f.approve();let info=update(f);
 if(field==='version')info.version='older';
 if(field==='lastModified')info.lastModified=new Date(1);
 if(field==='appIds')info.appIds=['replacement.app'];
 if(field==='id')info.id='different.pkg';
 if(field==='missing')info={id:'garage.app.pkg'};
 changed(f,info);assert.equal(f.access.state.grants.length,0);
});
test('updates missed while Vetro was stopped cannot inherit approval at startup or a later update',async f=>{
 await f.approve();update(f);
 const reloaded=new Access(f.options);reloaded.transport={available:true};reloaded.startPackageWatch();
 await denied(reloaded.call('garage.app','apps.list',{}),'permission_denied');
 reloaded.packageChanged('garage.app.pkg','updated',update(f,'1.2'));
 assert.equal(reloaded.state.grants.length,0);
});
test('a package watcher gap cannot establish continuity for a changed installation',async f=>{
 f.access.startPackageWatch();await f.approve();f.access.stopPackageWatch();update(f);
 f.access.startPackageWatch();changed(f,update(f,'1.2'));assert.equal(f.access.state.grants.length,0);
});
test('fresh registry eligibility still gates a retained approval',async f=>{
 f.access.startPackageWatch();await f.approve();f.rows[0].system=true;
 changed(f,update(f));await denied(f.access.call('garage.app','apps.list',{}),'not_allowed');
 assert.equal(f.calls.length,0);
});
test('an update expires pending extra-scope requests without adding their permissions',async f=>{
 f.access.startPackageWatch();await f.approve();
 const request=await f.access.call('garage.app','access.request',{scopes:['apps.read','power.off']});
 changed(f,update(f));assert.equal(f.access.pending.length,0);
 await denied(f.access.admin({action:'approve',requestId:request.requestId,scopes:['power.off'],expectedRevision:f.access.state.revision}),'not_found');
 assert.deepEqual(f.access.state.grants[0].scopes,['apps.read']);
});
for(const stage of ['inventory','dispatch','after-dispatch'])test('an update invalidates old '+stage+' work without replaying it',async f=>{
 f.access.startPackageWatch();await f.approve(['apps.launch']);let release;
 if(stage==='inventory')f.options.inventory=()=>new Promise(resolve=>release=()=>resolve({apps:f.rows}));
 else f.options.perform=(method,params,rows,check)=>new Promise((resolve,reject)=>{
  if(stage==='after-dispatch'){check.onDispatch();f.calls.push('sent');}
  release=()=>{try{if(stage==='dispatch'){check.onDispatch();f.calls.push('bad');}resolve({ok:true});}catch(error){reject(error);}};
 });
 const work=f.access.call('garage.app','apps.launch',{appId:'media.app'});await tick();changed(f,update(f));release();
 await assert.rejects(work,error=>error.code===(stage==='after-dispatch'?'not_confirmed':'permission_denied')&&error.submitted===(stage==='after-dispatch'));
 assert.equal(f.calls.length,stage==='after-dispatch'?1:0);assert.equal(f.access.state.grants.length,1);
});
test('failed persistence blocks access and cannot retain an uncommitted update after restart',async f=>{
 f.access.startPackageWatch();await f.approve();const old=f.access.state.grants[0].identity.installation;
 const directory=path.join(f.dir,'not-a-file');fs.mkdirSync(directory);f.access.store.file=directory;
 changed(f,update(f));assert.equal(f.access.state.grants[0].identity.installation,old);
 await denied(f.access.call('garage.app','apps.list',{}),'unavailable');
 const reloaded=new Access(f.options);reloaded.transport={available:true};reloaded.startPackageWatch();
 await denied(reloaded.call('garage.app','apps.list',{}),'permission_denied');
});
test('native event types retain updates, revoke installs and ignore stopped listener callbacks',async f=>{
 const first=nativePorts(f);await f.approve();const oldEvents=f.tizen.package.events;
 oldEvents.onupdated(update(f));assert.equal(f.access.state.grants.length,1);
 first.stop();const second=nativePorts(f),epoch=f.identity.epoch('garage.app.pkg');
 oldEvents.onuninstalled('garage.app.pkg');assert.equal(f.identity.epoch('garage.app.pkg'),epoch);
 assert.equal(f.access.state.grants.length,1);
 f.tizen.package.events.onupdated(update(f,'1.2'));assert.equal(f.access.state.grants.length,1);
 f.tizen.package.events.oninstalled(f.tizen.package.getPackageInfo('garage.app.pkg'));assert.equal(f.access.state.grants.length,0);
 second.stop();
});
(async()=>{for(const [name,fn] of cases){const f=fixture();try{await fn(f);console.log('PASS '+name);}finally{f.close();}}})().catch(error=>{console.error(error);process.exitCode=1;});
