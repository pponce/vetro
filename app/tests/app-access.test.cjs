'use strict';
const assert=require('assert').strict,fs=require('fs'),path=require('path');
const fixture=require('./app-access-fixture.cjs'),{Access,userApp}=require('../service/app-access');
const cases=[];function test(name,fn){cases.push([name,fn]);}const denied=(promise,code)=>assert.rejects(promise,e=>e.code===code);
test('default off, per-scope approval, atomic persistence and reduction only',async f=>{
 await denied(f.access.call('garage.app','apps.list',{}),'disabled');await f.approve(['apps.read','tasks.stop']);
 await f.access.call('garage.app','apps.list',{});await denied(f.access.call('garage.app','brightness.set',{value:10}),'permission_denied');
 const reloaded=new Access(f.options);assert.equal(reloaded.state.grants.length,1);assert.equal(fs.statSync(f.options.file).mode&511,384);
 await denied(Promise.resolve().then(()=>f.access.admin({action:'update',appId:'garage.app',scopes:['power.off'],enabled:true,expectedRevision:f.access.state.revision})),'invalid_request');
 await f.access.admin({action:'update',appId:'garage.app',scopes:['apps.read'],enabled:false,expectedRevision:f.access.state.revision});await denied(f.access.call('garage.app','apps.list',{}),'permission_denied');
 await f.access.admin({action:'revoke',appId:'garage.app',expectedRevision:f.access.state.revision});assert.equal(new Access(f.options).state.grants.length,0);
});
test('unknown methods, scope names and prototype keys never execute',async f=>{
 await f.approve();for(const method of ['exec','uninstall','constructor','toString','__proto__','components.action'])await denied(f.access.call('garage.app',method,{}),'not_allowed');
 await denied(f.access.call('garage.app','access.request',{scopes:['root']}),'invalid_request');assert.equal(f.calls.length,0);
});
test('caller identity derives from installed package and author certificate',async f=>{
 await f.approve();f.installed['garage.app'].cert='another-author';await denied(f.access.call('garage.app','apps.list',{}),'permission_denied');
 f.installed['garage.app'].cert='author-garage.app';f.installed['garage.app'].modified++;await denied(f.access.call('garage.app','apps.list',{}),'permission_denied');
 f.installed['garage.app'].version='2.0';await denied(f.access.call('garage.app','apps.list',{}),'not_allowed');
 delete f.installed['garage.app'];await denied(f.access.call('garage.app','apps.list',{}),'unavailable');
});
test('missing and ambiguous certificate data fail closed',async f=>{
 for(const certs of [[],[{type:'DISTRIBUTOR_SIGNER',value:'a'}],[{type:'AUTHOR_SIGNER',value:''}],[{type:'AUTHOR_SIGNER',value:'a'},{type:'AUTHOR_SIGNER',value:'b'}]]){
  f.tizen.application.getAppCerts=()=>certs;assert.throws(()=>f.identity.read('garage.app'),/certificate/);
 }
 f.tizen.package.getPackageInfo=()=>({id:'garage.app.pkg',appIds:['other'],version:'1.0',lastModified:new Date()});assert.throws(()=>f.identity.read('garage.app'),/package identity/);
});
test('only positively verified user UI apps qualify, including package siblings',async f=>{
 const row=f.rows[0];assert.equal(userApp(row,f.rows),true);
 for(const changed of [{system:true},{system:null},{preload:true},{preload:null},{removable:false},{removable:null},{protected:true},{protected:null},{show:false},{component:'svcapp'},{registryVerified:false},{appId:'vetrotvapp.app'},{packageId:'vetrotvapp'},{appId:'com.samsung.tv.coba.adagent'}])assert.equal(userApp({...row,...changed},[]),false,JSON.stringify(changed));
 assert.equal(userApp(row,[row,{...row,appId:'sibling',system:true}]),false);
 await f.enable();f.rows[0].registryVerified=false;await denied(f.access.call('garage.app','access.request',{scopes:['apps.read']}),'not_allowed');
});
test('approval checks expiration, revision and identity again',async f=>{
 await f.enable();let p=await f.access.call('garage.app','access.request',{scopes:['apps.read']});
 await denied(f.access.admin({action:'approve',requestId:p.requestId,scopes:['apps.read'],expectedRevision:0}),'conflict');
 f.installed['garage.app'].modified++;await denied(f.access.admin({action:'approve',requestId:p.requestId,scopes:['apps.read'],expectedRevision:f.access.state.revision}),'identity_changed');
 f.advance(600001);await denied(f.access.admin({action:'approve',requestId:p.requestId,scopes:['apps.read'],expectedRevision:f.access.state.revision}),'not_found');assert.equal(f.access.snapshot().pending.length,0);
});
test('revoke, global off and signer change while awaiting work prevent dispatch',async f=>{
 await f.approve();let release;f.options.perform=(m,p,r,check)=>new Promise(resolve=>release=()=>{try{check();f.calls.push('bad');resolve({});}catch(e){resolve(Promise.reject(e));}});
 let job=f.access.call('garage.app','apps.list',{});await new Promise(r=>setImmediate(r));
 await f.access.admin({action:'revoke',appId:'garage.app',expectedRevision:f.access.state.revision});release();await denied(job,'permission_denied');assert.equal(f.calls.length,0);
 await f.approve();job=f.access.call('garage.app','apps.list',{});await new Promise(r=>setImmediate(r));
 await f.access.admin({action:'enable',enabled:false,expectedRevision:f.access.state.revision});release();await denied(job,'disabled');
});
test('request cannot appear after disable while inventory was pending',async f=>{
 await f.enable();let release;f.options.inventory=()=>new Promise(r=>release=r);const call=f.access.call('garage.app','access.request',{scopes:['apps.read']});await new Promise(r=>setImmediate(r));
 await f.access.admin({action:'enable',enabled:false,expectedRevision:f.access.state.revision});release({apps:f.rows});await denied(call,'disabled');assert.equal(f.access.pending.length,0);
});
test('busy rejection does not release another in-flight reservation',async f=>{
 await f.approve();let release;f.options.perform=()=>new Promise(r=>release=r);const first=f.access.call('garage.app','apps.list',{});await new Promise(r=>setImmediate(r));
 await denied(f.access.call('garage.app','apps.list',{}),'busy');assert.equal(f.access.active,1);assert.equal(f.access.inFlight['garage.app'],true);await denied(f.access.call('garage.app','apps.list',{}),'busy');release({});await first;assert.equal(f.access.active,0);
});
test('storage corruption and failed writes never grant access',async f=>{
 fs.writeFileSync(f.options.file,'{broken');const bad=new Access(f.options);bad.transport={available:true};await denied(bad.call('garage.app','apps.list',{}),'unavailable');
 await f.enable();fs.mkdirSync(path.join(f.dir,'directory'));f.access.store.file=path.join(f.dir,'directory');assert.throws(()=>f.access.admin({action:'enable',enabled:false,expectedRevision:f.access.state.revision}),/could not be saved/);await denied(f.access.call('garage.app','apps.list',{}),'unavailable');
});
test('post-dispatch revocation is an unknown outcome, never a safe native fallback',async f=>{
 await f.approve(['apps.launch']);
 f.options.perform=async(m,p,r,check)=>{check();check.onDispatch();await f.access.admin({action:'revoke',appId:'garage.app',expectedRevision:f.access.state.revision});return {ok:true};};
 await assert.rejects(f.access.call('garage.app','apps.launch',{appId:'media.app'}),e=>e.code==='not_confirmed'&&e.submitted===true);
 await assert.rejects(f.access.call('garage.app','apps.launch',{appId:'media.app'}),e=>e.code==='permission_denied'&&e.submitted===false);
});
(async()=>{for(const [name,fn] of cases){const f=fixture();try{await fn(f);console.log('PASS '+name);}finally{f.close();}}})().catch(e=>{console.error(e);process.exitCode=1;});
