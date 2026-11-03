'use strict';
const assert=require('assert').strict,path=require('path');
const c=require('./service-harness.cjs')(path.resolve(__dirname,'..')).context;
const original=c.platform.execute;
const starts=[],pending=[];
c.platform.execute=(cmd)=>{starts.push(cmd);return new Promise((resolve,reject)=>pending.push({resolve,reject}));};
(async()=>{
 try {
  const a=c.agentExecute('first'),b=c.agentExecute('second');a.catch(()=>{});
  await new Promise(setImmediate);assert.deepEqual(starts,['first']);
  pending[0].reject(new Error('fixture failure'));await assert.rejects(a,/fixture failure/);
  await new Promise(setImmediate);assert.deepEqual(starts,['first','second']);
  pending[1].resolve({exit_code:0});await b;assert.equal(c.queuedCommands,0);
  let allowed=true;
  const running=c.agentExecute('occupied'),queued=c.agentExecute('must-not-run',1000,()=>{if(!allowed)throw Error('permission revoked');});queued.catch(()=>{});
  await new Promise(setImmediate);allowed=false;pending[2].resolve({exit_code:0});await running;await assert.rejects(queued,/permission revoked/);
  assert.ok(!starts.includes('must-not-run'),'authorization must run after waiting in the TV queue');
  let dispatched=0;const guard=()=>true;guard.onDispatch=()=>{dispatched++;};
  const sent=c.agentExecute('marked',1000,guard);await new Promise(setImmediate);assert.equal(dispatched,1);pending[3].resolve({exit_code:0});await sent;
  const blocked=()=>false;blocked.onDispatch=()=>{dispatched++;};await assert.rejects(c.agentExecute('blocked',1000,blocked));assert.equal(dispatched,1);
  console.log('PASS command queue: serial requests, authorization at dispatch, no submitted marker on refusal, errors do not poison queue');
 } finally {c.platform.execute=original;}
})().catch(e=>{console.error(e);process.exitCode=1});
