'use strict';
const assert = require('assert').strict;
const fs = require('fs'), os = require('os'), path = require('path');
const constants = require('constants');
const {spawnSync} = require('child_process');
const load = require('./service-harness.cjs');
const {Dock} = require('../service/dock.js');
const remap = require('../service/remap.js');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vetro-launcher-remap-'));
const fifo = path.join(directory, 'launcher.fifo');
const stateFile = path.join(directory, 'state.json');
let reader;

(async () => {
    const made = spawnSync('mkfifo', [fifo]);
    assert.equal(made.status, 0, 'real FIFO fixture is available');
    const dock = new Dock({fifo, stateFile});
    dock.installed = () => true;
    fs.writeFileSync(stateFile, JSON.stringify({enabled: true}));
    assert.equal(dock.toggle(), false, 'a FIFO without a reader fails without blocking');
    reader = fs.openSync(fifo, constants.O_RDONLY | constants.O_NONBLOCK);

    const commands = [];
    const service = load(path.resolve(__dirname, '..'), {dependencies: {
        './dock.js': {Dock: function () { return dock; }},
        './platform.js': {start() {}, status: () => ({agent: {connected: false}}),
            execute: command => { commands.push(command); return Promise.resolve({exit_code: 0, stdout: ''}); }}
    }});
    service.context.remapStore.rules = remap.validateRules([{id: 'home',
        trigger: {type: 'physical', value: '063'}, actions: [{type: 'launcher'}]}]);
    const event = (action, decision = 'blocked') => ({action, decision, code: 63});
    // Exercise the actual physical-event callback through the actual nonblocking
    // launcher pipe. No native Home injection or app close belongs on this path.
    service.context.physical.onEvent(event('down'));
    service.context.physical.onEvent(event('repeat'));
    service.context.physical.onEvent(event('up'));
    service.context.physical.onEvent(event('down', 'native'));
    await service.context.actionQueue;
    let buffer = Buffer.alloc(64);
    assert.equal(buffer.subarray(0, fs.readSync(reader, buffer, 0, buffer.length, null)).toString(), 'toggle\n');
    assert.deepEqual(commands, [], 'intercepted Home does not launch or close Samsung Home');
    service.context.physical.onEvent(event('down'));
    await service.context.actionQueue;
    assert.equal(buffer.subarray(0, fs.readSync(reader, buffer, 0, buffer.length, null)).toString(), 'toggle\n', 'next Home toggles once again');

    async function fallback(reason) {
        commands.length = 0;
        service.context.physical.onEvent(event('down'));
        await service.context.actionQueue;
        assert.deepEqual(commands, ['/usr/bin/input_keyevent XF86Home'], reason);
    }
    dock.busy = true;
    await fallback('a launcher restart leaves the Home key usable');
    dock.busy = false;
    dock.installed = () => false;
    await fallback('missing launcher files use the native Home key');
    dock.installed = () => true;
    fs.writeFileSync(stateFile, JSON.stringify({enabled: false}));
    await fallback('disabled launcher uses the native Home key');
    fs.writeFileSync(stateFile, JSON.stringify({enabled: true}));
    fs.closeSync(reader); reader = undefined;
    await fallback('lost launcher reader uses the native Home key without hanging');
    fs.unlinkSync(fifo);
    await fallback('missing launcher pipe uses the native Home key');
    fs.writeFileSync(fifo, 'unchanged');
    await fallback('a regular file is never treated as the launcher');
    assert.equal(fs.readFileSync(fifo, 'utf8'), 'unchanged');
    fs.unlinkSync(fifo);
    const target = path.join(directory, 'target');
    fs.writeFileSync(target, 'untouched'); fs.symlinkSync(target, fifo);
    await fallback('a symlink is never followed');
    assert.equal(fs.readFileSync(target, 'utf8'), 'untouched');
    console.log('PASS direct launcher remap: real FIFO, one toggle per press, no Home closes, unavailable launcher falls back');
})().catch(error => {console.error(error); process.exitCode = 1;}).finally(() => {
    if (reader !== undefined) fs.closeSync(reader);
    fs.rmSync(directory, {recursive: true, force: true});
});
