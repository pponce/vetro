'use strict';
const assert = require('assert').strict;
const http = require('http');
const path = require('path');
const fixture=require('./app-access-fixture.cjs')();
const service = require('./service-harness.cjs')(path.resolve(__dirname, '..'),{tizen:fixture.tizen});
const widget=service.context.auth.issueWidget().token,owner='b'.repeat(64);
service.context.auth.commit([{hash:require('crypto').createHash('sha256').update(owner).digest('hex'),name:'test',created:1,expires:Date.now()+60000}]);
const server = http.createServer(service.router);
function request(method, endpoint, origin, data) {
  return new Promise((resolve, reject) => {
    const body = data ? JSON.stringify(data) : '';
    const req = http.request({host: '127.0.0.1', port: server.address().port,
      method, path: endpoint, headers: {Origin: origin==='owner'?'http://127.0.0.1:'+server.address().port:origin, ...(origin==='owner'?{Authorization:'Bearer '+owner}:method==='OPTIONS'?{}:{'X-Vetro-Widget':widget}), 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)}}, res => {
      let text = ''; res.on('data', c => {text += c;});
      res.on('end', () => resolve({status: res.statusCode, headers: res.headers, text}));
    });
    req.on('error', reject); req.end(body);
  });
}
server.listen(0, '127.0.0.1', async () => {
  try {
    const preflight = await request('OPTIONS', '/probe', 'null');
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers['access-control-allow-origin'], 'null');
    assert.equal(preflight.headers['access-control-allow-headers'], 'Content-Type, X-Vetro-Widget');
    const sent = await request('POST', '/probe', 'null', {probe: {tizenObject: {ok: true, value: true}}, apps: []});
    assert.equal(JSON.parse(sent.text).ok, true);
    const received = await request('GET', '/probe', 'owner');
    assert.equal(JSON.parse(received.text).probe.tizenObject.value, true);
    const external = await request('GET', '/probe', 'https://example.com');
    assert.equal(external.headers['access-control-allow-origin'], undefined);
    const inventory = {apps: Array.from({length: 700}, (_, i) => ({id: 'app' + i, name: 'x'.repeat(100)}))};
    assert.ok(Buffer.byteLength(JSON.stringify(inventory)) > 65536);
    const large = await request('POST', '/probe', 'null', inventory);
    assert.equal(large.status, 200);
    assert.equal(JSON.parse((await request('GET', '/probe', 'owner')).text).apps.length, 700);
    const tooLarge = await request('POST', '/probe', 'null', {padding: 'x'.repeat(262144)});
    assert.equal(tooLarge.status, 413);
    // Only the TV's own widget may replace the stored probe; a LAN client is refused.
    const remote = await new Promise(resolve => {
      const res = {headers: {}, setHeader() {}, writeHead(code) {res.code = code;}, end(text) {resolve({code: res.code, text});}};
      service.router({method: 'POST', url: '/probe', headers: {}, socket: {remoteAddress: '192.0.2.5'}, on() {}}, res);
    });
    assert.equal(remote.code, 403);
    assert.equal(JSON.parse((await request('GET', '/probe', 'owner')).text).apps.length, 700);
    console.log('PASS widget probe HTTP: preflight, report round trip, opaque origin only, loopback writes only');
  } catch (e) {console.error(e); process.exitCode = 1;}
  finally {server.close(); fixture.close();}
});
