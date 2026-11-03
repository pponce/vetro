'use strict';
const assert = require('assert').strict, path = require('path'), EventEmitter = require('events');
const load = require('./service-harness.cjs');
const Real = require('../service/return-app.js');
let selected = null, revision = 0, registryError = null, launchOptions;
const calls = [], rows = [{appId: 'video.one', show: true, disabled: false}, {appId: 'video.two', show: true, disabled: false}];
const service = load(path.resolve(__dirname, '..'), {setInterval: () => ({unref(){}}), dependencies: {
    './return-app.js': {...Real, ReturnApp: function (options) {
        launchOptions = options;
        this.status = () => ({appId: selected, revision}); this.tick = () => Promise.resolve();
        this.configure = (id, expected, apps) => {
            if (expected !== revision) throw Error('Return choice changed');
            if (id && !apps.some(a => a.appId === id)) throw Error('App unavailable');
            calls.push(id); const previousAppId = selected; selected = id; revision++;
            return {...this.status(), verified: true, previousAppId};
        };
    }}
}});
service.context.inventory = async () => ({apps: rows, registryError});
function request(method, body, raw = false) {
    return new Promise(resolve => {
        const req = new EventEmitter(); req.method = method; req.url = '/return-app';
        let code;
        service.router(req, {writeHead(n) {code=n;}, end(text) {resolve({code, body: JSON.parse(text)});}});
        if (method === 'POST') {req.emit('data', Buffer.from(raw ? body : JSON.stringify(body))); req.emit('end');}
    });
}
(async () => {
    assert.equal((await request('GET')).body.appId, null);
    for (const p of [null, [], {}, {appId:'video.one'}, {appId:'video.one;id', expectedRevision:0},
        {appId:'video.one', expectedRevision:'0'}, {appId:'video.one', expectedRevision:0, cmd:'id'}]) {
        assert.equal((await request('POST', p)).code, 400);
    }
    assert.equal((await request('PUT')).code, 405);
    assert.equal((await request('POST', 'x'.repeat(2049), true)).code, 413);
    assert.equal(calls.length, 0);
    let result = await request('POST', {appId:'video.one', expectedRevision:0});
    assert.equal(result.code, 200); assert.equal(result.body.verified, true);
    result = await request('POST', {appId:'video.two', expectedRevision:0});
    assert.equal(result.code, 409); assert.equal((await request('GET')).body.appId, 'video.one');
    result = await request('POST', {appId:'video.two', expectedRevision:1});
    assert.equal(result.code, 200); assert.equal(result.body.previousAppId, 'video.one');
    registryError = 'offline';
    assert.equal((await request('POST', {appId:'video.one', expectedRevision:2})).code, 409);
    result = await request('POST', {appId:null, expectedRevision:2});
    assert.equal(result.code, 200); assert.equal(result.body.appId, null, 'turning off works even while root/inventory is unavailable');
    assert.deepEqual(calls, ['video.one', 'video.two', null]);
    const commands = []; service.context.platform.execute = async command => {commands.push(command); return {exit_code:0};};
    await assert.rejects(service.context.agentExecute('cancelled', 1000, async () => false), /cancelled/);
    await service.context.agentExecute('allowed', 1000, async () => true);
    assert.deepEqual(commands, ['allowed'], 'queue guard runs before TV command submission');
    commands.length=0;
    service.context.platform.execute = async command => {
        commands.push(command);
        return {exit_code:0,stdout: command===Real.COMMAND ? 'value = com.samsung.tv.csfs\nvalue = \nvalue = 0' : ''};
    };
    let timeout;
    try {
        await Promise.race([
            service.context.agentExecute('foreground-launch',1000,async()=> (await launchOptions.snapshot(true)).full==='com.samsung.tv.csfs'),
            new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('launch guard deadlocked the root queue')),1500);})
        ]);
    } finally { clearTimeout(timeout); }
    assert.deepEqual(commands,[Real.COMMAND,'foreground-launch'],'fresh snapshot executes within the occupied queue slot');
    console.log('PASS return API: bounded body, one selected app, stale writes, readback, offline disable, and guarded command dispatch');
})().catch(error => {console.error(error); process.exitCode=1;});
