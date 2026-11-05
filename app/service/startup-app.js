'use strict';
// One foreground choice for standby wake, independent of Tizen's boot flags.
var fs = require('fs');
var Power = require('./power-state.js');
var CONFIG = '/opt/usr/home/owner/share/vetro-startup-app.json';
var SESSION = '/tmp/vetro-startup-app-session.json';
var SETTLE_MS = 1000, WAKE_MS = 20000, SAMPLE_MS = 8000, VERIFY_MS = 15000;
var FALLBACK = /^(org\.tizen\.tv-viewer|com\.samsung\.tv\.csfs)$/;
var RESUME_BLOCKED = /^(com\.samsung\.tv\.coba\.|org\.tizen\.menu|vetrotvapp(?:\.|$)|com\.samsung\.tv\.(screeneffectorapp|multiscreen|quickpanel)|org\.tizen\.(hbbtv|welcome-mode))/;
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
    // Called while the launch guard owns the root-command queue slot. The
    // integration supplies a small direct registry read, never a queued refresh.
    this.lookupApps = options.lookupApps || function () { return Promise.reject(Error('Foreground app validation unavailable')); };
    this.launch = options.launch;
    this.presence = options.presence;
    this.snapshot = options.snapshot;
    this.activity = options.activity || function () { return {ready:false}; };
    this.powerSession = options.powerSession || function () { return null; };
    this.config = emptyConfig();
    this.session = null;
    this.busy = false;
    this.pending = null;
    this.error = null;
    this.power = null;
    this.lastResult = null;
    this.lastResultAt = null;
    this.lastResultSession = null;
    this.eventInfo = null;
    this.lastSample = null;
    this.lastActivity = null;
    this.navigationSequence = 0; this.observedNavigation = 0;
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
        pending: !!this.pending, lastResult: this.lastResult, lastResultAt:this.lastResultAt,
        lastResultSession:this.lastResultSession, powerSession:this.powerSession(),
        event:this.eventInfo, error: this.error};
};
StartupApp.prototype.result = function (message, event) {
    this.lastResult = message;
    this.lastResultAt = message === null ? null : this.now();
    this.lastResultSession = message === null ? null : event && event.powerSession || this.powerSession();
};
StartupApp.prototype.saveSession = function () { writeJson(this.fs, this.sessionFile, this.session); };
StartupApp.prototype.noteNavigation = function () {
    this.navigationSequence++;
    this.lastSample = null;
    if (this.pending && this.pending.stage === 'waiting') this.pending.cancelled = true;
};
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
    this.result(null); this.eventInfo = null; this.lastSample = null;
    return Object.assign(this.status(), {verified: true, previousAppId: previous});
};
StartupApp.prototype.observe = function (power, clock) {
    if (!clock.bootId) throw Error('TV boot identity unavailable');
    var activity = this.activity(), previousActivity = this.lastActivity;
    this.lastActivity = activity;
    var navigationChanged = this.observedNavigation !== this.navigationSequence;
    this.observedNavigation = this.navigationSequence;
    var old = this.session, freshBoot = !old || old.bootId !== clock.bootId;
    var resumed = !freshBoot && typeof old.suspendOffset === 'number' && typeof clock.suspendOffset === 'number' && clock.suspendOffset - old.suspendOffset > 1;
    var waking = !freshBoot && old.power === 'standby' && power === 'on';
    if (freshBoot) {
        old = this.session = {bootId: clock.bootId, power: null, suspendOffset: clock.suspendOffset,
            handled: true};
        this.pending = null;
        this.lastSample = null;
        this.eventInfo = null;
        this.result('Skipped: cold boot; opens only after standby wake');
    }
    var enteringStandby = power === 'standby' && old.power !== 'standby';
    if (enteringStandby) {
        this.session.standbySequence = activity.sequence;
        this.session.standbyNavigation = this.navigationSequence;
    }
    if (enteringStandby || resumed && !waking && power === 'on') {
        // Freeze only a recent pre-standby sample; never infer resume evidence
        // from the first app seen after wake. Suspend time is excluded from age.
        var sample = this.lastSample, age = sample ? this.now() - sample.at : Infinity;
        if (sample && resumed && typeof sample.clock.suspendOffset === 'number') age -= (clock.suspendOffset - sample.clock.suspendOffset) * 1000;
        this.session.resume = sample && sample.clock.bootId === clock.bootId && age >= -1000 && age <= SAMPLE_MS &&
            sample.sequence === activity.sequence ? sample.state : null;
        this.lastSample = null;
    }
    if (power === 'standby') { this.pending = null; this.session.handled = false; }
    if (waking || resumed) { this.pending = null; this.session.handled = false; }
    var changed = freshBoot || old.power !== power || resumed;
    this.session.power = power;
    this.session.suspendOffset = clock.suspendOffset;
    this.power = power;
    if (changed) this.saveSession();
    if (power === 'on' && !this.session.handled && !this.pending) {
        var isWake = waking || resumed;
        // An initial on-state, root recovery or a persisted unhandled session
        // is not evidence of standby wake. Never launch on cold boot.
        if (!isWake) {
            this.session.handled = true;
            this.saveSession();
            this.result('Skipped: standby wake was not observed');
            return;
        }
        var baseline = this.session.resume;
        var started = this.now(), limit = WAKE_MS;
        this.pending = {appId: this.config.appId, revision: this.config.revision, bootId: clock.bootId,
            started:started, deadline:started + limit, stage:'waiting', activity:activity, foreground:null,
            resume:baseline, readySince:activity.ready ? this.now() : null, powerSession:this.powerSession(), checks:{}};
        this.eventInfo = {kind:'wake', startedAt:started, deadlineAt:started + limit,
            phase:'waiting', monitoringReadyAt:this.pending.readySince, resumedAppId:baseline && baseline.full || null,
            checks:this.pending.checks};
        this.result(null);
        // A service restart abandons this attempt instead of restarting its
        // deadline. Persist before any asynchronous readiness or registry work.
        this.session.handled = true;
        this.saveSession();
        if (!previousActivity) this.finish('Skipped: wake observation was interrupted by a service restart');
        else if (navigationChanged || waking && this.session.standbyNavigation !== this.navigationSequence) this.finish('Skipped: deliberate navigation at power-on');
        else if (previousActivity && previousActivity.sequence !== activity.sequence ||
            waking && this.session.standbySequence !== activity.sequence ||
            activity.lastAt && activity.lastAt >= this.now() - 2000) this.finish('Skipped: remote activity at power-on');
    }
};
StartupApp.prototype.current = function (event) {
    return this.pending === event && this.config.appId === event.appId && this.config.revision === event.revision &&
        this.power === 'on' && this.session.bootId === event.bootId;
};
StartupApp.prototype.finish = function (result) {
    this.session.handled = true;
    this.saveSession();
    this.result(result, this.pending);
    this.pending = null;
    if (this.eventInfo) this.eventInfo.phase = 'finished';
};
StartupApp.prototype.beginCheck = function (event, name) {
    event.checks[name] = {startedAt:this.now(),finishedAt:null,durationMs:null,outcome:'pending'};
    if (this.current(event)) this.eventInfo.phase = name;
};
StartupApp.prototype.endCheck = function (event, name, outcome) {
    var check=event.checks[name];
    if (!check || check.finishedAt !== null) return;
    check.finishedAt=this.now();check.durationMs=Math.max(0,check.finishedAt-check.startedAt);check.outcome=outcome;
};
StartupApp.prototype.measure = function (event, name, task) {
    var self=this;this.beginCheck(event,name);
    return Promise.resolve().then(task).then(function(value){self.endCheck(event,name,'complete');return value;},function(error){self.endCheck(event,name,'error');throw error;});
};
StartupApp.prototype.idle = function (event) {
    if (!this.current(event)) return false;
    if (event.cancelled) { this.finish('Skipped: deliberate navigation'); return false; }
    if (this.now() < event.started || this.now() >= event.deadline) {
        var reason = !this.activity().ready ? 'remote activity monitoring was not ready' : !this.ready() ? 'root connection was not ready' : 'readiness checks did not finish';
        this.finish('Skipped: power-on launch expired; ' + reason); return false;
    }
    var activity = this.activity();
    if (activity.sequence !== event.activity.sequence) { this.finish('Skipped: you started using the TV'); return false; }
    if (!activity.ready || activity.generation !== event.activity.generation) {
        if (event.dispatching) { this.finish('Skipped: remote activity monitoring was interrupted before dispatch'); return false; }
        event.readySince = null;
        event.activity = activity;
        this.eventInfo.monitoringReadyAt = null;
    }
    if (!activity.ready) { this.eventInfo.phase = 'waiting-for-monitor'; return false; }
    if (event.readySince === null) event.readySince = this.now();
    this.eventInfo.monitoringReadyAt = event.readySince;
    if (this.now() - event.readySince < SETTLE_MS) { this.eventInfo.phase = 'settling'; return false; }
    return true;
};
StartupApp.prototype.checkForeground = function (event, state) {
    var native = state.navigation, before = event.resume && event.resume.navigation;
    if (native && (native.visible || native.kind !== 'none' && native.at >= event.started && (!before || before.token !== native.token))) {
        this.finish('Skipped: deliberate launcher navigation'); return false;
    }
    if (state.full === event.appId || state.partial === event.appId) { this.finish('App already onscreen'); return false; }
    var sameResume = event.resume && state.full === event.resume.full && !RESUME_BLOCKED.test(state.full) && event.resumeEligible !== false;
    var overlay = state.partial && !FALLBACK.test(state.partial) && !(sameResume && state.partial === state.full);
    if ((!FALLBACK.test(state.full) && !sameResume) || overlay ||
        event.resume && event.resume.partial && event.resume.partial !== event.resume.full && !FALLBACK.test(event.resume.partial) ||
        event.resume && event.resume.sourceType !== state.sourceType || event.foreground && event.foreground.sourceType !== state.sourceType) {
        this.finish('Skipped: another app, menu or input is active'); return false;
    }
    event.foreground = state;
    return true;
};
StartupApp.prototype.sample = function (clock) {
    var self = this, activity = this.activity();
    if (this.power !== 'on' || this.pending || !this.ready() || !activity.ready) return Promise.resolve();
    return this.snapshot(false).then(function (state) {
        var after = self.clock(), current = self.activity();
        if (self.power === 'on' && !self.pending && self.ready() && current.ready && current.sequence === activity.sequence &&
            current.generation === activity.generation && after.bootId === clock.bootId &&
            !(typeof clock.suspendOffset === 'number' && after.suspendOffset - clock.suspendOffset > 1)) {
            self.lastSample = {state:state, clock:after, at:self.now(), sequence:current.sequence};
        } else self.lastSample = null;
    }).catch(function () { self.lastSample = null; });
};
StartupApp.prototype.tick = function () {
    if (this.busy || !this.config.appId) return Promise.resolve();
    var self = this;
    this.busy = true;
    return Promise.resolve().then(function () { return self.readPower(); }).then(function (power) {
        var clock = self.clock();
        self.observe(power, clock);
        self.error = null;
        var event = self.pending;
        if (!event || !self.current(event)) return self.sample(clock);
        if (event.stage === 'verifying') {
            return self.presence().then(function (state) {
                if (!self.current(event)) return;
                if (state.foreground && state.foreground.appId === event.appId) self.finish('App confirmed onscreen');
                else if (self.now() - event.sent >= VERIFY_MS) self.finish('Launch requested; onscreen state was not confirmed');
            }).catch(function () {
                if (self.current(event) && self.now() - event.sent >= VERIFY_MS) self.finish('Launch requested; onscreen state was not confirmed');
            });
        }
        if (!self.idle(event)) return;
        if (!self.ready()) { self.eventInfo.phase = 'waiting-for-root'; return; }
        return self.measure(event,'foreground',function(){return self.snapshot(false);}).then(function (state) {
            if (!self.idle(event) || !self.checkForeground(event, state) || self.now() - event.started < SETTLE_MS) return;
            // Record the attempt before sending it; a service restart must not steal focus a second time.
            self.session.handled = true;
            self.saveSession();
            event.dispatching = true;
            var preparationFailed = false;
            self.beginCheck(event,'queue');
            return self.launch(event.appId, function () {
                self.endCheck(event,'queue','complete');
                if (!self.idle(event) || !self.ready()) return false;
                // Recheck current app flags after the root queue drains. A
                // complete inventory is unnecessary, and cached flags cannot
                // establish whether the destination was disabled while queued.
                return self.measure(event,'power',function(){return self.readPower();}).then(function (power) {
                    self.observe(power, self.clock());
                    if (!self.idle(event) || !self.ready()) return false;
                    var ids=[event.appId];
                    if(event.resume && typeof event.resume.full==='string' && event.resume.full!==event.appId && validId(event.resume.full))ids.push(event.resume.full);
                    return self.measure(event,'eligibility',function(){
                        return self.lookupApps(ids,Math.min(4000,event.deadline-self.now()));
                    }).then(function(data){
                        if(!self.idle(event)||!self.ready())return false;
                        if(!data||data.registryError||!Array.isArray(data.apps))throw Error('App registry unavailable');
                        if(!eligible(data.apps.find(function(row){return row.appId===event.appId;}))){self.finish('Selected app is missing, disabled, or has no launcher entry');return false;}
                        event.resumeEligible=!!event.resume&&eligible(data.apps.find(function(row){return row.appId===event.resume.full;}));
                        if(event.foreground&&!FALLBACK.test(event.foreground.full)&&!event.resumeEligible){self.finish('Skipped: resumed foreground is not an enabled launcher app');return false;}
                        return self.measure(event,'dispatchForeground',function(){return self.snapshot(true);}).then(function(fresh){
                            if(!self.idle(event)||!self.ready()||!self.checkForeground(event,fresh))return false;
                            self.beginCheck(event,'launch');return true;
                        });
                    });
                }).catch(function(e){preparationFailed=true;throw e;});
            }).then(function () {
                self.endCheck(event,'launch','complete');
                if (!self.current(event)) return;
                event.stage = 'verifying';
                event.sent = self.now();
                self.eventInfo.phase = 'verifying';
                self.result('Launch requested', event);
            }).catch(function (e) {
                self.endCheck(event,'queue','error');self.endCheck(event,'launch','error');
                if (!self.current(event)) return;
                if (preparationFailed) {
                    // The guard rejected before a launch command was sent. A
                    // transient read may retry, with the same deadline and
                    // activity/foreground baseline; a sent launch never does.
                    self.error=e.message;
                    if(self.idle(event)){event.dispatching=false;self.eventInfo.phase='waiting-for-readiness';}
                } else self.finish('Launch not completed: ' + e.message);
            });
        });
    }).catch(function (e) {
        self.error = e.message;
        // Keep the last known power state. A failed read must not manufacture a standby/wake cycle.
    }).finally(function () { self.busy = false; });
};

module.exports = {StartupApp: StartupApp, eligible: eligible, validId: validId, SETTLE_MS: SETTLE_MS, WAKE_MS:WAKE_MS};

