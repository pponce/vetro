'use strict';
const assert = require('assert').strict;
const EventEmitter = require('events');
const service = require('./service-harness.cjs')(require('path').resolve(__dirname, '..'));
service.context.auth.gate=()=>false; // Authentication is exercised by app-access-http.test.cjs.
let closes = 0, connects = 0, command, fail = false;
service.context.packageInfo = {read: async path => { if (path !== '/tmp/example.wgt') throw new Error('bad manifest'); return {packageId: 'actualPkg123'}; }};
service.context.platform = {start: () => {}, status: () => ({}), execute: () => Promise.reject(new Error('offline')), install: async (id, path) => {connects++; command = id + ' ' + path; closes++; if (fail) throw new Error('disconnected'); return 'not installed';}};
function request(path) {
  return new Promise(resolve => {
    const req = new EventEmitter(); req.method = 'POST'; req.url = '/install';
    let status; const res = {writeHead: n => {status = n;}, end: body => resolve({status, body: JSON.parse(body)})};
    service.router(req, res); req.emit('data', Buffer.from(JSON.stringify({path}))); req.emit('end');
  });
}
async function main() {
  assert.equal((await request('/tmp/bad.wgt')).status, 400); assert.equal(connects, 0);
  const response = await request('/tmp/example.wgt');
  assert.equal(command, 'actualPkg123 /tmp/example.wgt');
  assert.equal(response.status, 202); assert.equal(response.body.verified, false); assert.equal(response.body.ok, undefined);
  await new Promise(r => setImmediate(r)); assert.equal(closes, 1);
  fail = true; const failed = await request('/tmp/example.wgt');
  assert.equal(failed.status, 503); assert.equal(failed.body.submitted, null);
  assert.equal(closes, 2);
  console.log('PASS installer: manifest ID, rejected input, no false success, adapter cleanup');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
