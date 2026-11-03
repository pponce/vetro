'use strict';
const assert = require('assert').strict, EventEmitter = require('events');
const {Reader, Sessions, decode, readClock} = require('../service/power-state.js');
assert.equal(decode('{"device":{"PowerState":"on"}}'), 'on');
assert.equal(decode('{"device":{"PowerState":"standby"}}'), 'standby');
for (const body of ['{}', 'null', '{', '{"device":{"PowerState":"unknown"}}']) assert.throws(() => decode(body));
let mode = 'ok', requests = 0;
const http = {get(options, callback) {
    assert.equal(options.hostname, '127.0.0.1'); assert.equal(options.port, 8001);
    assert.equal(options.path, '/api/v2/'); requests++;
    const request = new EventEmitter(); request.destroy = () => {};
    process.nextTick(() => {
        if (mode === 'error') return request.emit('error', Error('refused'));
        const response = new EventEmitter(); response.statusCode = mode === 'redirect' ? 302 : 200; response.resume = () => {};
        callback(response);
        response.emit('data', Buffer.from(mode === 'large' ? 'x'.repeat(32769) : '{"device":{"PowerState":"on"}}'));
        response.emit('end');
    });
    return request;
}};
(async () => {
    const reader = new Reader({http});
    const a = reader.read(), b = reader.read(); assert.equal(a, b);
    assert.equal(await a, 'on'); assert.equal(requests, 1);
    for (mode of ['error', 'large', 'redirect']) await assert.rejects(reader.read());
    mode = 'ok'; assert.equal(await reader.read(), 'on', 'failures release the pending read');
    const clock = readClock(); assert.ok(clock.bootId); assert.ok(Number.isFinite(clock.suspendOffset));
    let now=100;const sessions=new Sessions(()=>now), observed={bootId:'boot-a',suspendOffset:0};
    sessions.observe('on',observed);const first=sessions.current;
    now++;sessions.observe('on',observed);assert.equal(sessions.current,first,'ordinary polling shares the power session');
    sessions.observe('standby',observed);assert.equal(sessions.current,first);
    now++;sessions.observe('on',observed);const wake=sessions.current;assert.notEqual(wake.id,first.id);
    now++;observed.suspendOffset+=30;sessions.observe('on',observed);assert.notEqual(sessions.current.id,wake.id,'missed standby is detected by suspend');
    const resumed=sessions.current;observed.bootId='boot-b';sessions.observe('on',observed);assert.notEqual(sessions.current.id,resumed.id);
    assert.equal(first.observedAt,100,'old result identities are immutable');
    console.log('PASS power reader: explicit status only, bounded local request, no redirect, unknown stays unknown, suspend clock');
})().catch(error => {console.error(error); process.exitCode = 1;});
