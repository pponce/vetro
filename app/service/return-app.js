'use strict';
// Optional fallback destination after another foreground app returns to Samsung Home/TV.
var fs = require('fs');
var Power = require('./power-state.js');
var Choice = require('./startup-app.js');
var FILE = '/opt/usr/home/owner/share/vetro-return-app.json';
var COMMAND = 'vconftool get memory/appfw/current_fullscreen_appid && ' +
    'vconftool get memory/appfw/current_partial_appid && vconftool get memory/system/source_type';
var TV_SIDE = /^(org\.tizen\.tv-viewer|com\.samsung\.tv\.csfs)$/;
var SYSTEM = /^(com\.samsung\.tv\.coba\.|org\.tizen\.menu|vetrotvapp(?:\.|$)|com\.samsung\.tv\.(screeneffectorapp|multiscreen|quickpanel)|org\.tizen\.(hbbtv|welcome-mode))/;
var SETTLE_MS = 1000, EXPIRE_MS = 10000, GAP_MS = 6000;

function parse(text) {
    var values = [], pattern = /value[ \t]*=[ \t]*([^\r\n]*)/g, match;
    while ((match = pattern.exec(String(text || '')))) values.push(match[1].trim().replace(/^(?:"(.*)"|'(.*)')$/, function (_, a, b) { return a === undefined ? b : a; }));
    if (values[1] === '(null)' || values[1] === 'null') values[1] = '';
    if (values.length !== 3 || !Choice.validId(values[0]) || !values[0] ||
        values[1] && !Choice.validId(values[1]) || !/^\d{1,3}$/.test(values[2])) throw Error('Foreground/source state unavailable');
    return {full: values[0], partial: values[1], sourceType: Number(values[2])};
}
function fallback(state) { return TV_SIDE.test(state.full) && (!state.partial || TV_SIDE.test(state.partial)); }
function ordinary(state, target) {
    return state.full !== target && !TV_SIDE.test(state.full) && !SYSTEM.test(state.full) &&
        (!state.partial || state.partial === state.full);
}
function save(io, file, value) {
    var data = JSON.stringify(value) + '\n', temporary = file + '.tmp';
    try {
        io.writeFileSync(temporary, data, {mode: 384});
        io.renameSync(temporary, file);
        if (io.readFileSync(file, 'utf8') !== data) throw Error('Saved return choice could not be verified');
    } catch (e) { try { io.unlinkSync(temporary); } catch (ignored) {} throw e; }
}
function ReturnApp(options) {
    options = options || {};
    this.fs = options.fs || fs;
    this.file = options.file || FILE;
    this.now = options.now || Date.now;
    this.clock = options.clock || Power.readClock;
    var reader = new Power.Reader();
    this.readPower = options.readPower || reader.read.bind(reader);
    this.ready = options.ready || function () { return false; };
    this.paused = options.paused || function () { return false; };
    this.snapshot = options.snapshot;
    this.inventory = options.inventory;
    this.launch = options.launch;
    this.config = {version: 1, appId: null, revision: 0};
    this.previous = null; this.lastClock = null; this.lastAt = null;
    this.pending = null; this.busy = false; this.error = null; this.lastResult = null;
    try {
        var stored = JSON.parse(this.fs.readFileSync(this.file, 'utf8'));
        if (!stored || stored.version !== 1 || !Choice.validId(stored.appId) || !Number.isInteger(stored.revision) || stored.revision < 0) throw Error('Invalid saved return choice');
        this.config = stored;
    } catch (e) { if (e.code !== 'ENOENT') this.error = 'Return choice could not be read: ' + e.message; }
}
ReturnApp.prototype.status = function () {
    return {appId: this.config.appId, revision: this.config.revision, pending: !!this.pending,
        lastResult: this.lastResult, error: this.error};
};
ReturnApp.prototype.reset = function () { this.previous = null; this.lastClock = null; this.lastAt = null; this.pending = null; };
ReturnApp.prototype.configure = function (id, expected, rows) {
    if (!Choice.validId(id) || !Number.isInteger(expected)) throw Error('Invalid return selection');
    if (expected !== this.config.revision) throw Error('Return choice changed. Refresh and try again.');
    if (id && !Choice.eligible((rows || []).find(function (row) { return row.appId === id; }))) throw Error('Choose an installed, enabled app with a launcher entry');
    var previous = this.config.appId;
    if (previous !== id) {
        var next = {version: 1, appId: id, revision: this.config.revision + 1};
        save(this.fs, this.file, next);
        this.config = next;
        this.reset(); this.error = null; this.lastResult = null;
    }
    return Object.assign(this.status(), {verified: true, previousAppId: previous});
};
ReturnApp.prototype.current = function (event) {
    return this.pending === event && this.config.appId === event.appId && this.config.revision === event.revision && this.ready() && !this.paused();
};
ReturnApp.prototype.finish = function (message) { this.pending = null; this.lastResult = message; };
ReturnApp.prototype.tick = function () {
    var self = this;
    if (this.busy || !this.config.appId) return Promise.resolve();
    if (!this.ready() || this.paused()) { this.reset(); return Promise.resolve(); }
    this.busy = true;
    return this.readPower().then(function (power) {
        if (power !== 'on') { self.reset(); return; }
        return self.snapshot(false).then(function (state) {
            if (!self.ready() || self.paused() || !self.config.appId) { self.reset(); return; }
            var clock = self.clock(), now = self.now(), old = self.previous;
            var discontinuity = !clock.bootId || !self.lastClock || self.lastClock.bootId !== clock.bootId ||
                self.lastAt === null || now - self.lastAt > GAP_MS || now < self.lastAt ||
                typeof clock.suspendOffset === 'number' && typeof self.lastClock.suspendOffset === 'number' && clock.suspendOffset - self.lastClock.suspendOffset > 1;
            if (discontinuity) { old = null; self.pending = null; }
            self.previous = state; self.lastClock = clock; self.lastAt = now; self.error = null;
            var event = self.pending;
            if (event && event.stage === 'verifying') {
                if (state.full === event.appId || state.partial === event.appId) self.finish('Return app confirmed onscreen');
                else if (!fallback(state) || now - event.sent >= EXPIRE_MS) self.finish('Return requested; onscreen state was not confirmed');
                return;
            }
            if (!fallback(state) || event && state.sourceType !== event.sourceType) { self.pending = null; return; }
            if (!event && old && ordinary(old, self.config.appId) && old.sourceType === state.sourceType) {
                event = self.pending = {appId: self.config.appId, revision: self.config.revision,
                    left: old.full, sourceType: state.sourceType, bootId: clock.bootId,
                    suspendOffset: clock.suspendOffset, started: now, stage: 'waiting'};
                self.lastResult = null;
            }
            if (!event || !self.current(event)) return;
            if (now - event.started > EXPIRE_MS) return self.finish('Return expired before the TV was ready');
            if (now - event.started < SETTLE_MS) return;
            return self.inventory().then(function (data) {
                if (!self.current(event)) return;
                if (data.registryError) throw Error('App registry unavailable');
                if (!Choice.eligible(data.apps.find(function (row) { return row.appId === event.appId; }))) return self.finish('Return app is missing, disabled, or has no launcher entry');
                if (!Choice.eligible(data.apps.find(function (row) { return row.appId === event.left; }))) return self.finish('Previous foreground was not an enabled launcher app');
                return self.launch(event.appId, function () {
                    if (!self.current(event) || self.now() - event.started > EXPIRE_MS) return false;
                    return self.readPower().then(function (power) {
                        if (power !== 'on' || !self.current(event)) return false;
                        // This read runs inside the existing command-queue slot, not behind it.
                        return self.snapshot(true).then(function (fresh) {
                            var currentClock = self.clock();
                            return self.current(event) && fallback(fresh) && fresh.sourceType === event.sourceType &&
                                currentClock.bootId === event.bootId && self.now() - event.started <= EXPIRE_MS &&
                                !(typeof currentClock.suspendOffset === 'number' && typeof event.suspendOffset === 'number' && currentClock.suspendOffset - event.suspendOffset > 1);
                        });
                    });
                }).then(function () {
                    if (self.current(event)) { event.stage = 'verifying'; event.sent = self.now(); self.lastResult = 'Return requested'; }
                }).catch(function (e) { if (self.current(event)) self.finish('Return not completed: ' + e.message); });
            });
        });
    }).catch(function (e) { self.reset(); self.error = e.message; })
        .finally(function () { self.busy = false; });
};
module.exports = {ReturnApp: ReturnApp, parse: parse, COMMAND: COMMAND};
