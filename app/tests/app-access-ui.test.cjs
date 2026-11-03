'use strict';
const assert=require('assert').strict,vm=require('vm'),fixture=require('./app-access-fixture.cjs'),ui=require('../service/app-access-ui');
(async()=>{const f=fixture();try{
 const nodes={},events={},writes=[];let fail=false;
 function el(id){return nodes[id]||(nodes[id]={hidden:false,checked:false,disabled:false,innerHTML:'',textContent:'',setAttribute(k,v){this[k]=v;},querySelectorAll(){return [];},addEventListener(k,fn){events[k]=fn;}});}
 const context={window:{},document:{getElementById:el},confirm:()=>true,fetch:async(url,options)=>{assert.equal(url,'/app-access');if(fail)return {ok:false,json:async()=>({error:'Settings changed. Refresh before saving.'})};let data;if(options&&options.body){const body=JSON.parse(options.body);writes.push(body);try{data=await f.access.admin(body);}catch(e){return {ok:false,json:async()=>({error:e.message})};}}else data=f.access.snapshot();return {ok:true,json:async()=>data};}};
 vm.runInNewContext(ui.script,context);const flush=()=>new Promise(r=>setImmediate(r));
 await context.window.loadAppAccess();assert.equal(el('aaEnabled').checked,false);assert.match(el('aaState').textContent,/Off/);assert.match(el('aaPending').innerHTML,/No pending/);
 el('aaEnabled').checked=true;el('aaEnabled').onchange();await flush();assert.equal(f.access.state.enabled,true);
 f.installed['garage.app'].name='<script>alert(1)</script>';await f.access.call('garage.app','access.request',{scopes:['apps.read','tasks.stop']});await context.window.loadAppAccess();
 assert.ok(el('aaPending').innerHTML.includes('&lt;script&gt;'));assert.ok(!el('aaPending').innerHTML.includes('<script>'));assert.ok(!el('aaPending').innerHTML.includes('checked '),'requested scopes start unchecked');
 function click(action,selected,kind='request') {const card={getAttribute:()=> '0',hasAttribute:k=>k==='data-request'&&kind==='request',querySelectorAll:()=>selected.map(value=>({value}))};const button={getAttribute:()=>action,closest:()=>card};events.click({target:{closest:()=>button}});return flush();}
 const before=writes.length;await click('approve',[]);assert.equal(writes.length,before);assert.match(el('aaMessage').textContent,/Select at least one/);
 await click('approve',['apps.read']);assert.deepEqual(f.access.state.grants[0].scopes,['apps.read']);assert.match(el('aaGrants').innerHTML,/Save permissions/);
 await click('pause',['apps.read'],'grant');assert.equal(f.access.state.grants[0].enabled,false);assert.match(el('aaGrants').innerHTML,/Resume access/);
 await click('pause',['apps.read'],'grant');assert.equal(f.access.state.grants[0].enabled,true);
 await click('save',[],'grant');assert.deepEqual(f.access.state.grants[0].scopes,[]);
 fail=true;await click('revoke',[],'grant');assert.match(el('aaMessage').textContent,/Settings changed/);assert.equal(f.access.state.grants.length,1);assert.equal(el('aaEnabled').disabled,false);
 fail=false;await click('revoke',[],'grant');assert.equal(f.access.state.grants.length,0);
 f.access.transport={available:false,error:'Identity checks unavailable'};await context.window.loadAppAccess();assert.equal(el('aaEnabled').disabled,false,'the global off switch remains usable when identity becomes unavailable');el('aaEnabled').checked=false;el('aaEnabled').onchange();await flush();assert.equal(f.access.state.enabled,false);assert.equal(el('aaEnabled').disabled,true);assert.equal(el('aaUnavailable').hidden,false);assert.equal(el('aaUnavailable').textContent,'Identity checks unavailable');
 console.log('PASS permissions UI: opt-in, unselected scopes, escaped identity, subset approval, reduce/pause/resume/revoke, error recovery and unavailable state');
 }finally{f.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
