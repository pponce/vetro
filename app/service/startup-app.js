'use strict';
// One foreground choice, independent of Tizen's per-app onboot/autorestart flags.
var fs = require('fs');
var Power = require('./power-state.js');
var CONFIG = '/opt/usr/home/owner/share/vetro-startup-app.json';
var SESSION = '/tmp/vetro-startup-app-session.json';
var SETTLE_MS = 1000, EVENT_MS = 10000, VERIFY_MS = 15000;
var FALLBACK = /^(org\.tizen\.tv-viewer|com\.samsung\.tv\.csfs)$/;
var ID = /^[A-Za-z0-9_.-]{1,120}$/;

function validId(value) { return value === null || typeof value === 'string' && ID.test(value); }
function emptyConfig() { return {version: 1, appId: null, revision: 0, selectedBootId: null}; }
function readJson(io, file) {
    try { return JSON.parse(io.readFileSync(file, 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
function writeJson(io, file, value) {
    var text = JSON.stringify(value) + '\n', temporary = file + '.tmp';
    try {
        io.writeFileSync(temporary, text, {mode: 384});
        io.renameSync(temporary, file);
        if (io.readFileSync(file, 'utf8') !== text) throw Error('Saved value could not be verified');
    } catch (e) {
        try { io.unlinkSync(temporary); } catch (ignored) {}
        throw e;
    }
}
function eligible(row) {
    return !!row && row.show === true && row.disabled === false;
}

function StartupApp(options) {
    options = options || {};
    this.fs = options.fs || fs;
    this.file = options.file || CONFIG;
    this.sessionFile = options.sessionFile || SESSION;
    this.clock = options.clock || Power.readClock;
    this.now = options.now || Date.now;
    var reader = new Power.Reader();
    this.readPower = options.readPower || reader.read.bind(reader);
    this.ready = options.ready || function () { return false; };
    this.inventory = options.inventory;
    this.launch = options.launch;
    this.presence = options.presence;
    this.snapshot = options.snapshot;
    this.activity = options.activity || function () { return {ready:false}; };
    this.config = emptyConfig();
    this.session = null;
    this.busy = false;
    this.pending = null;
    this.error = null;
    this.power = null;
    this.lastResult = null;
    this.lastActivity = null;
    try {
        var stored = readJson(this.fs, this.file);
        if (stored) {
            if (stored.version !== 1 || !validId(stored.appId) || !Number.isInteger(stored.revision) || stored.revision < 0) throw Error('Invalid saved startup choice');
            this.config = stored;
        }
    } catch (e) { this.error = 'Startup choice could not be read: ' + e.message; }
    try { this.session = readJson(this.fs, this.sessionFile); } catch (e) { this.error = 'Startup session could not be read: ' + e.message; }
}
StartupApp.prototype.status = function () {
    return {appId: this.config.appId, revision: this.config.revision, powerState: this.power,
        pending: !!this.pending, lastResult: this.lastResult, error: this.error};
};
StartupApp.prototype.saveSession = function () { writeJson(this.fs, this.sessionFile, this.session); };
StartupApp.prototype.configure = function (value, expectedRevision, rows) {
    if (!validId(value) || !Number.isInteger(expectedRevision)) throw Error('Invalid startup selection');
    if (expectedRevision !== this.config.revision) throw Error('Startup choice changed. Refresh and try again.');
    if (value && !eligible((rows || []).find(function (row) { return row.appId === value; }))) throw Error('Choose an installed, enabled app with a launcher entry');
    var previous = this.config.appId;
    if (previous === value) return Object.assign(this.status(), {verified: true, previousAppId: previous});
    var clock = this.clock();
    if (!clock.bootId) throw Error('TV boot identity unavailable; selection was not changed');
    var next = {version: 1, appId: value, revision: this.config.revision + 1, selectedBootId: clock.bootId};
    // The current session is consumed before saving: enabling or changing the choice never opens it now.
    this.session = {bootId: clock.bootId, power: this.power, suspendOffset: clock.suspendOffset, handled: true};
    this.saveSession();
    writeJson(this.fs, this.file, next);
    this.config = next;
    this.pending = null;
    this.error = null;
    this.lastResult = null;
    return Object.assign(this.status(), {verified: true, previousAppId: previous});
};
StartupApp.prototype.observe = function (power, clock) {
    if (!clock.bootId) throw Error('TV boot identity unavailable');
    var activity = this.activity(), previousActivity = this.lastActivity;
    this.lastActivity = activity;
    var old = this.session, freshBoot = !old || old.bootId !== clock.bootId;
    var resumed = !freshBoot && typeof old.suspendOffset === 'number' && typeof clock.suspendOffset === 'number' && clock.suspendOffset - old.suspendOffset > 1;
    var waking = !freshBoot && old.power === 'standby' && power === 'on';
    if (freshBoot) {
        old = this.session = {bootId: clock.bootId, power: null, suspendOffset: clock.suspendOffset,
            handled: this.config.selectedBootId === clock.bootId};
        this.pending = null;
    }
    if (power === 'standby') { this.pending = null; this.session.handled = false; }
    if (waking || resumed) { this.pending = null; this.session.handled = false; }
    var changed = freshBoot || old.power !== power || resumed;
    this.session.power = power;
    this.session.suspendOffset = clock.suspendOffset;
    this.power = power;
    if (changed) this.saveSession();
    if (power === 'on' && !this.session.handled && !this.pending) {
        // Service startup does not restart the cold-boot deadline.
        var validBootAge = typeof clock.uptimeSeconds === 'number' && isFinite(clock.uptimeSeconds) && clock.uptimeSeconds >= 0;
        var bootAge = freshBoot && validBootAge ? clock.uptimeSeconds * 1000 : 0;
        this.pending = {appId: this.config.appId, revision: this.config.revision, bootId: clock.bootId,
            started: this.now() - bootAge, stage: 'waiting', activity: activity, foreground: null};
        this.lastResult = null;
        if (freshBoot && !validBootAge) this.finish('Skipped: boot timing unavailable');
        else if (bootAge > EVENT_MS) this.finish('Skipped: power-on launch expired before Vetro was ready');
        else if (!activity.ready) this.finish('Skipped: remote activity monitoring was not ready at power-on');
        else if (!freshBoot && (!previousActivity || previousActivity.generation !== activity.generation)) this.finish('Skipped: remote activity monitoring was interrupted');
        else if (previousActivity && previousActivity.sequence !== activity.sequence ||
            activity.lastAt && activity.lastAt >= this.now() - Math.max(2000, bootAge)) this.finish('Skipped: remote activity at power-on');
    }
};
StartupApp.prototype.current = function (event) {
    return this.pending === event && this.config.appId === event.appId && this.config.revision === event.revision &&
        this.power === 'on' && this.session.bootId === event.bootId;
};
StartupApp.prototype.finish = function (result) {
    this.session.handled = true;
    this.saveSession();
    this.pending = null;
    this.lastResult = result;
};
StartupApp.prototype.idle = function (event) {
    if (!this.current(event)) return false;
    if (this.now() - event.started >= EVENT_MS) { this.finish('Skipped: power-on launch expired before the TV was ready'); return false; }
    var activity = this.activity();
    if (!activity.ready || activity.generation !== event.activity.generation) {
        this.finish('Skipped: remote activity monitoring was interrupted'); return false;
    }
    if (activity.sequence !== event.activity.sequence) { this.finish('Skipped: you started using the TV'); return false; }
    return true;
};
StartupApp.prototype.checkForeground = function (event, state) {
    if (state.full === event.appId || state.partial === event.appId) { this.finish('App already onscreen'); return false; }
    if (!FALLBACK.test(state.full) || state.partial && !FALLBACK.test(state.partial) ||
        event.foreground && event.foreground.sourceType !== state.sourceType) {
        this.finish('Skipped: another app, menu or input is active'); return false;
    }
    event.foreground = state;
    return true;
};
StartupApp.prototype.tick = function () {
    if (this.busy || !this.config.appId) return Promise.resolve();
    var self = this;
    this.busy = true;
    return Promise.resolve().then(function () { return self.readPower(); }).then(function (power) {
        self.observe(power, self.clock());
        self.error = null;
        var event = self.pending;
        if (!event || !self.current(event)) return;
        if (event.stage === 'verifying') {
            return self.presence().then(function (state) {
                if (!self.current(event)) return;
                if (state.foreground && state.foreground.appId === event.appId) self.finish('App confirmed onscreen');
                else if (self.now() - event.sent >= VERIFY_MS) self.finish('Launch requested; onscreen state was not confirmed');
            }).catch(function () {
                if (self.current(event) && self.now() - event.sent >= VERIFY_MS) self.finish('Launch requested; onscreen state was not confirmed');
            });
        }
        if (!self.idle(event) || !self.ready()) return;
        return self.snapshot(false).then(function (state) {
            if (!self.idle(event) || !self.checkForeground(event, state) || self.now() - event.started < SETTLE_MS) return;
            return self.inventory().then(function (data) {
            if (!self.idle(event)) return;
            if (data.registryError) throw Error('App registry unavailable');
            if (!eligible(data.apps.find(function (row) { return row.appId === event.appId; }))) return self.finish('Selected app is missing, disabled, or has no launcher entry');
            // Record the attempt before sending it; a service restart must not steal focus a second time.
            self.session.handled = true;
            self.saveSession();
            return self.launch(event.appId, function () {
                if (!self.idle(event) || !self.ready()) return false;
                // Recheck after the root command queue drains, immediately before the launch command.
                return self.readPower().then(function (power) {
                    self.observe(power, self.clock());
                    if (!self.idle(event) || !self.ready()) return false;
                    return self.snapshot(true).then(function (fresh) { return self.idle(event) && self.checkForeground(event, fresh); });
                });
            }).then(function () {
                if (!self.current(event)) return;
                event.stage = 'verifying';
                event.sent = self.now();
                self.lastResult = 'Launch requested';
            }).catch(function (e) {
                if (self.current(event)) self.finish('Launch not completed: ' + e.message);
            });
            });
        });
    }).catch(function (e) {
        self.error = e.message;
        // Keep the last known power state. A failed read must not manufacture a standby/wake cycle.
    }).finally(function () { self.busy = false; });
};

module.exports = {StartupApp: StartupApp, eligible: eligible, validId: validId, SETTLE_MS: SETTLE_MS, EVENT_MS: EVENT_MS};
