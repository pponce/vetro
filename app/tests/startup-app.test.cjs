'use strict';
const assert = require('assert').strict;
const fs = require('fs'), path = require('path');
const {StartupApp} = require('../service/startup-app.js');
const directory = fs.mkdtempSync(path.join(__dirname, '.startup-test-'));
const file = path.join(directory, 'choice.json'), sessionFile = path.join(directory, 'session.json');
const rows = [
    {appId: 'video.one', show: true, disabled: false, onboot: false, autorestart: false},
    {appId: 'video.two', show: true, disabled: false, onboot: true, autorestart: true},
    {appId: 'video.service', show: false, disabled: false, onboot: true},
    {appId: 'video.disabled', show: true, disabled: true, onboot: true}
];
let bootId = 'boot-a', offset = 0, time = 0, power = 'on', ready = true, failure = null;
let foreground = 'video.one', reads = 0, registryFailure = false, beforeLaunch, beforeInventory;
const launches = [];
const options = {
    file, sessionFile, now: () => time, clock: () => ({bootId, suspendOffset: offset}),
    readPower: async () => { reads++; if (failure) throw Error(failure); return power; },
    ready: () => ready,
    inventory: async () => { if (beforeInventory) await beforeInventory(); return {apps: rows, registryError: registryFailure ? 'unavailable' : null}; },
    launch: async (appId, guard) => { if (beforeLaunch) await beforeLaunch(); if (!await guard()) throw Error('cancelled'); launches.push(appId); },
    presence: async () => ({foreground: {appId: foreground}})
};
let app;
async function tick(ms = 2000) { time += ms; await app.tick(); }
async function wake() { power = 'standby'; await tick(); power = 'on'; await tick(); await tick(6000); }

(async () => {
    const originalRows = JSON.stringify(rows);
    app = new StartupApp(options);
    await tick(); assert.equal(reads, 0, 'disabled feature performs no polling');
    let saved = app.configure('video.one', 0, rows);
    assert.equal(saved.verified, true); assert.equal(saved.appId, 'video.one');
    await tick(); await tick(10000);
    assert.equal(launches.length, 0, 'enabling while on waits for the next power-on');

    await wake(); assert.deepEqual(launches, ['video.one'], 'normal standby wake opens the selected app');
    await tick(); assert.equal(app.status().lastResult, 'App confirmed onscreen');
    foreground = 'video.two'; await tick(10000);
    assert.equal(launches.length, 1, 'changing to another app must not pull the user back');

    ready = false; await tick(); ready = true; await tick(10000);
    failure = 'API unavailable'; await tick(); failure = null; await tick(10000);
    assert.equal(launches.length, 1, 'root reconnects and failed power reads are not wake events');

    app = new StartupApp(options); await tick(10000);
    assert.equal(launches.length, 1, 'Vetro restart during the same power session does not relaunch');

    offset += 30; await tick(); await tick(6000);
    assert.equal(launches.length, 2, 'actual suspend/resume is detected even if polling missed standby');
    app = new StartupApp(options); await tick(20000);
    assert.equal(launches.length, 2, 'service restart after a launch request does not replay it');

    bootId = 'boot-b'; offset = 0; ready = false; app = new StartupApp(options);
    await tick(); await tick(90000); assert.equal(launches.length, 2, 'cold boot waits for root readiness');
    ready = true; await tick(); assert.equal(launches.length, 3, 'full boot opens once root is ready');
    foreground = 'video.one'; await tick();

    assert.throws(() => app.configure('video.two', 0, rows), /changed/, 'stale browser cannot overwrite the choice');
    saved = app.configure('video.two', 1, rows);
    assert.equal(saved.previousAppId, 'video.one');
    assert.equal(JSON.parse(fs.readFileSync(file)).appId, 'video.two');
    assert.equal(JSON.stringify(rows), originalRows, 'all boot and restart flags remain untouched');
    await tick(10000); assert.equal(launches.length, 3, 'replacing the choice also waits for next power-on');
    await wake(); assert.equal(launches.at(-1), 'video.two');
    foreground = 'video.two'; await tick();

    for (const id of ['video.service', 'video.disabled', 'missing.app', 'video.one;reboot', '', undefined]) {
        assert.throws(() => app.configure(id, 2, rows));
        assert.equal(app.status().appId, 'video.two');
    }

    // A selection change while inventory is pending cancels the old event.
    power = 'standby'; await tick(); power = 'on'; await tick();
    beforeInventory = async () => { beforeInventory = null; app.configure(null, 2, []); };
    await tick(6000); assert.equal(launches.length, 4);
    app = new StartupApp(options); await tick(); assert.equal(app.status().appId, null);
    assert.equal(JSON.parse(fs.readFileSync(file)).appId, null, 'turning off persists across service restarts');

    app.configure('video.one', 3, rows); await tick();
    power = 'standby'; await tick(); power = 'on'; await tick();
    beforeLaunch = async () => { beforeLaunch = null; app.configure('video.two', 4, rows); };
    await tick(6000); assert.equal(launches.length, 4, 'queued command rechecks the current selection before sending');

    power = 'standby'; await tick(); power = 'on'; await tick();
    beforeLaunch = async () => { beforeLaunch = null; power = 'standby'; };
    await tick(6000); assert.equal(launches.length, 4, 'power-off while queued cancels the launch');
    power = 'on'; await tick(); await tick(6000); assert.equal(launches.length, 5, 'next genuine wake still works');
    foreground = 'some.other.app'; await tick(16000);
    assert.match(app.status().lastResult, /not confirmed/);
    await tick(10000); assert.equal(launches.length, 5, 'failed foreground verification never repeatedly steals focus');

    rows[1].disabled = true; await wake(); assert.equal(launches.length, 5);
    assert.match(app.status().lastResult, /disabled/); rows[1].disabled = false;
    power = 'standby'; await tick(); power = 'on'; await tick(); registryFailure = true;
    await tick(6000); assert.match(app.status().error, /registry/);
    registryFailure = false; await tick(); assert.equal(launches.length, 6, 'temporary registry failure can recover before the deadline');
    foreground = 'video.two'; await tick();

    power = 'standby'; await tick(); power = 'on'; ready = false; await tick(); await tick(181000);
    ready = true; await tick(); assert.equal(launches.length, 6, 'an expired power-on event cannot launch much later');
    assert.match(app.status().lastResult, /expired/);

    // Atomic persistence failures must leave the previous saved selection intact.
    const broken = Object.create(fs); broken.renameSync = () => { throw Error('disk failure'); };
    const failing = new StartupApp({...options, fs: broken});
    assert.throws(() => failing.configure(null, 5, []), /disk failure/);
    assert.equal(JSON.parse(fs.readFileSync(file)).appId, 'video.two');
    assert.equal(failing.status().appId, 'video.two');
    console.log('PASS startup app: standby wake, suspend, cold boot, exclusivity, persistence, independent flags, cancellation, unknown state, expiry, and verified foreground');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(directory, {recursive: true, force: true}));
