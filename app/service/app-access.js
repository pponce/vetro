'use strict';
var crypto = require('crypto');
var Store = require('./access-store.js').Store;
var validId = require('./app-identity.js').validId;
var protectedApp = require('./debloat.js').isProtected;
var SCOPES = [
    {id:'apps.read', label:'List TV apps', description:'Read names, IDs and app icons of visible TV apps, including preinstalled apps.'},
    {id:'apps.launch', label:'Open TV apps', description:'Open enabled, visible TV apps, including preinstalled apps.'},
    {id:'tasks.read', label:'View running user apps', description:'Read running state and memory totals for eligible user apps.'},
    {id:'tasks.stop', label:'Close user apps', description:'Stop eligible user apps. Unsaved progress may be lost.'},
    {id:'picture.brightness', label:'Adjust panel brightness', description:'Read and change panel brightness, with value checks and readback.'},
    {id:'remote.audio', label:'Control volume', description:'Raise or lower volume and toggle mute.'},
    {id:'remote.playback', label:'Control playback', description:'Send play, pause, stop, seek, previous and next commands.'},
    {id:'power.off', label:'Turn off the TV', description:'Put the TV in standby.'}
];
var METHODS = {'apps.list':'apps.read','apps.catalog':'apps.read','apps.icon':'apps.read','apps.launch':'apps.launch','tasks.list':'tasks.read','tasks.stop':'tasks.stop',
    'brightness.read':'picture.brightness','brightness.set':'picture.brightness','audio.key':'remote.audio',
    'playback.key':'remote.playback','power.off':'power.off'};
function fault(code, message) { var e = Error(message); e.code = code; return e; }
function scopes(value) {
    if (!Array.isArray(value) || value.length > SCOPES.length || value.some(function (s) {
        return typeof s !== 'string' || !SCOPES.some(function (x) { return x.id === s; });
    })) throw fault('invalid_request', 'Unknown permission');
    return value.filter(function (s,i) { return value.indexOf(s) === i; }).sort();
}
function identityValid(i) {
    return i && validId(i.appId) && validId(i.packageId) && typeof i.name === 'string' && i.name.length <= 120 &&
        typeof i.version === 'string' && i.version.length <= 100 && Number.isInteger(i.installedAt) && i.installedAt > 0 &&
        /^[a-f0-9]{64}$/.test(i.signer || '') && /^[a-f0-9]{64}$/.test(i.installation || '');
}
function validateState(s) {
    if (!s || s.schema !== 1 || typeof s.enabled !== 'boolean' || !Number.isInteger(s.revision) || s.revision < 0 ||
        !Array.isArray(s.grants) || s.grants.length > 40) throw Error('Invalid permissions store');
    var seen = Object.create(null);
    s.grants.forEach(function (g) {
        if (!/^[a-f0-9]{32}$/.test(g.generation||'') || !identityValid(g.identity) || seen[g.identity.appId] || !Number.isInteger(g.updatedAt) || typeof g.enabled !== 'boolean') throw Error('Invalid app grant');
        seen[g.identity.appId] = true; scopes(g.scopes);
    });
}
// Positive registry evidence only. A friendly name/category is never authority.
function launchableApp(row, rows) {
    if (!row || !validId(row.appId) || !validId(row.packageId) || row.registryVerified !== true ||
        typeof row.system !== 'boolean' || typeof row.preload !== 'boolean' || typeof row.removable !== 'boolean' ||
        row.show !== true || row.component !== 'uiapp' || row.protected !== false ||
        /^vetrotvapp(?:\.|$)/.test(row.appId) || row.packageId === 'vetrotvapp' ||
        protectedApp(row.appId) || protectedApp(row.packageId)) return false;
    return !(rows || []).some(function (s) { return s.packageId === row.packageId &&
        (s.registryVerified !== true || s.protected !== false || protectedApp(s.appId) || protectedApp(s.packageId)); });
}
function userApp(row, rows) {
    if (!row || !validId(row.appId) || !validId(row.packageId) || row.registryVerified !== true ||
        row.system !== false || row.preload !== false || row.removable !== true || row.show !== true ||
        row.component !== 'uiapp' || row.protected !== false || /^vetrotvapp(?:\.|$)/.test(row.appId) || row.packageId === 'vetrotvapp' ||
        protectedApp(row.appId) || protectedApp(row.packageId)) return false;
    return !(rows || []).some(function (s) { return s.packageId === row.packageId &&
        (s.registryVerified !== true || s.system !== false || s.preload !== false || s.protected !== false ||
         protectedApp(s.appId) || protectedApp(s.packageId)); });
}
function Access(options) {
    this.options = options; this.state = {schema:1,enabled:false,revision:0,grants:[]};
    this.store = new Store(validateState); this.pending = []; this.events = []; this.buckets = Object.create(null);
    this.inFlight = Object.create(null); this.active = 0; this.now = options.now || Date.now;
    this.packageWatching = false; this.packageContinuity = Object.create(null);
    this.transport = {available:false,error:'App communication is not ready'};
    if (options.file) this.configure(options.file);
}
Access.prototype.configure = function (file) { try { this.state = this.store.configure(file, this.state); } catch (_) {} };
Access.prototype.event = function (appId, method, outcome) {
    this.events.unshift({at:this.now(),appId:validId(appId)?appId:null,method:String(method).slice(0,60),outcome:outcome});
    this.events = this.events.slice(0,100);
};
Access.prototype.commit = function (next) { next.revision = this.state.revision + 1; this.store.save(next); this.state = next; };
// Continuity is established only while native package notifications are active.
// A changed installation found after a restart is never treated as an update.
Access.prototype.startPackageWatch = function () {
    var self=this;
    this.packageWatching=true; this.packageContinuity=Object.create(null);
    this.state.grants.forEach(function(g){
        try {
            if(self.options.identity.read(g.identity.appId).installation===g.identity.installation)
                self.packageContinuity[g.identity.appId]=g.identity.installation;
        } catch(_) {}
    });
};
Access.prototype.stopPackageWatch = function () {
    this.packageWatching=false; this.packageContinuity=Object.create(null);
};
Access.prototype.packageChanged = function (packageId, kind, info) {
    if(!validId(packageId))return;
    this.options.identity.changed(packageId);
    this.pending=this.pending.filter(function(p){return p.identity.packageId!==packageId;});
    if(!this.state.grants.some(function(g){return g.identity.packageId===packageId;}))return;
    var self=this,previous=this.state,next=JSON.parse(JSON.stringify(previous)),retained=[];
    next.grants=next.grants.filter(function(g){
        if(g.identity.packageId!==packageId)return true;
        var old=g.identity,current=null,continuous=self.packageWatching&&self.packageContinuity[old.appId]===old.installation;
        delete self.packageContinuity[old.appId];
        // Only the native update callback can retain a grant. Match its package
        // metadata to fresh native identity, including the verified author signer.
        if(kind==='updated'&&continuous)try{
            var candidate=self.options.identity.read(old.appId);
            if(identityValid(candidate)&&candidate.appId===old.appId&&candidate.packageId===old.packageId&&candidate.signer===old.signer&&
                info&&info.id===candidate.packageId&&info.version===candidate.version&&
                info.lastModified&&info.lastModified.getTime()===candidate.installedAt&&
                Array.isArray(info.appIds)&&info.appIds.indexOf(candidate.appId)>=0)current=candidate;
        }catch(_){}
        if(!current||!self.packageWatching)return false;
        g.identity=current;g.generation=crypto.randomBytes(16).toString('hex');g.updatedAt=self.now();
        retained.push(g);return true;
    });
    // A reentrant state change must win over this package notification.
    if(this.state!==previous)return;
    try{
        this.commit(next);
        retained.forEach(function(g){self.packageContinuity[g.identity.appId]=g.identity.installation;});
        previous.grants.filter(function(g){return g.identity.packageId===packageId;}).forEach(function(g){
            var kept=retained.some(function(current){return current.identity.appId===g.identity.appId;});
            self.event(g.identity.appId,'package.'+(kind==='updated'?'updated':'changed'),kept?'approval_retained':'approval_revoked');
        });
    }catch(_){/* A write failure blocks all app access. */}
};
Access.prototype.ready = function () {
    if (this.store.error) throw fault('unavailable',this.store.error);
    if (!this.transport.available) throw fault('unavailable',this.transport.error || 'App identity verification is unavailable');
    if (!this.state.enabled) throw fault('disabled','App access is turned off in Vetro');
};
Access.prototype.snapshot = function () {
    var self = this; this.pending = this.pending.filter(function (p) { return p.expires > self.now(); });
    return {enabled:this.state.enabled,revision:this.state.revision,available:!this.store.error && this.transport.available,
        error:this.store.error || this.transport.error || null,scopes:SCOPES,pending:this.pending,
        grants:this.state.grants.map(function (g) {
            var current=false; try { current = self.options.identity.read(g.identity.appId).installation === g.identity.installation; } catch (_) {}
            return Object.assign({},g,{current:current});
        }),events:this.events};
};
Access.prototype.admin = function (p) {
    var self = this;
    if (!p || p.expectedRevision !== this.state.revision) return Promise.reject(fault('conflict','Settings changed. Refresh before saving.'));
    var next = JSON.parse(JSON.stringify(this.state));
    if (p.action === 'enable') {
        if (typeof p.enabled !== 'boolean') return Promise.reject(fault('invalid_request','Choose on or off'));
        if (p.enabled && !this.transport.available) return Promise.reject(fault('unavailable',this.transport.error || 'Identity checks are unavailable'));
        next.enabled=p.enabled; this.commit(next); this.event(null,'access.enable',p.enabled?'enabled':'disabled');
        if (!p.enabled) this.pending=[];
        return Promise.resolve(this.snapshot());
    }
    if (p.action === 'revoke' || p.action === 'update') {
        var g=next.grants.find(function (g) { return g.identity.appId === p.appId; });
        if (!g) return Promise.reject(fault('not_found','App approval was not found'));
        if (p.action === 'revoke') next.grants=next.grants.filter(function (g) { return g.identity.appId !== p.appId; });
        else {
            var changed=scopes(p.scopes);
            if (changed.some(function (s) { return g.scopes.indexOf(s)<0; })) return Promise.reject(fault('invalid_request','New permissions require a request from the app'));
            if (typeof p.enabled !== 'boolean') return Promise.reject(fault('invalid_request','Choose on or off'));
            g.scopes=changed; g.enabled=p.enabled; g.generation=crypto.randomBytes(16).toString('hex'); g.updatedAt=this.now();
        }
        this.commit(next); if(p.action==='revoke'){
            this.pending=this.pending.filter(function(r){return r.identity.appId!==p.appId;});
            delete this.packageContinuity[p.appId];
        } this.event(p.appId,'access.'+p.action,'saved');
        return Promise.resolve(this.snapshot());
    }
    var pending=this.pending.find(function (r) { return r.id===p.requestId && r.expires>self.now(); });
    if (!pending) return Promise.reject(fault('not_found','This request expired. Ask the app to connect again.'));
    if (p.action === 'deny') {
        this.pending=this.pending.filter(function (r) { return r!==pending; });
        this.event(pending.identity.appId,'access.request','denied'); return Promise.resolve(this.snapshot());
    }
    if (p.action !== 'approve') return Promise.reject(fault('invalid_request','Unknown permission action'));
    this.ready(); var selected=scopes(p.scopes);
    if (!selected.length || selected.some(function (s) { return pending.scopes.indexOf(s)<0; })) return Promise.reject(fault('invalid_request','Select permissions requested by this app'));
    return this.options.inventory().then(function (d) {
        var identity=self.options.identity.read(pending.identity.appId);
        if (d.registryError || !userApp(d.apps.find(function (a) { return a.appId===identity.appId && a.packageId===identity.packageId && a.version===identity.version; }),d.apps)) throw fault('unavailable','The TV has not verified this as a user app');
        if (identity.installation!==pending.identity.installation) throw fault('identity_changed','App changed. Ask it to connect again.');
        if (self.state.revision!==p.expectedRevision || !self.state.enabled || self.pending.indexOf(pending)<0 || pending.expires<=self.now()) throw fault('conflict','Request changed. Refresh before approving.');
        next.grants=next.grants.filter(function (g) { return g.identity.appId!==identity.appId; });
        if (next.grants.length>=40) throw fault('limit','Revoke an app before approving another');
        next.grants.push({generation:crypto.randomBytes(16).toString('hex'),identity:identity,scopes:selected,enabled:true,updatedAt:self.now()});
        self.commit(next); self.pending=self.pending.filter(function (r) { return r!==pending; });
        if(self.packageWatching)self.packageContinuity[identity.appId]=identity.installation;
        self.event(identity.appId,'access.approve','saved'); return self.snapshot();
    });
};
Access.prototype.limit = function (appId) {
    var now=this.now(),b=this.buckets[appId];
    if (!b || now-b.at>=10000) {
        if (!b && Object.keys(this.buckets).length>=100) {
            var self=this; Object.keys(this.buckets).forEach(function (id) { if(now-self.buckets[id].at>=10000)delete self.buckets[id]; });
            if(Object.keys(this.buckets).length>=100)throw fault('busy','Too many app requests');
        }
        b=this.buckets[appId]={at:now,count:0};
    }
    if (++b.count>20 || this.inFlight[appId] || this.active>=4) throw fault('busy','Wait for the current request to finish');
};
Access.prototype.call = function (appId, method, params) {
    var self=this,identity,grant,revision,owned=false,submitted=false,required=Object.prototype.hasOwnProperty.call(METHODS,method)?METHODS[method]:null;
    return Promise.resolve().then(function () {
        if (!validId(appId)) throw fault('identity_unverified','App identity cannot be verified');
        self.limit(appId); self.inFlight[appId]=true; self.active++; owned=true;
        self.ready();
        revision=self.state.revision;
        if (method!=='access.request' && method!=='access.status' && !required) throw fault('not_allowed','This operation is not available to apps');
        identity=self.options.identity.read(appId);
        return self.options.inventory();
    }).then(function (d) {
        self.ready();
        if(self.state.revision!==revision)throw fault('permission_denied','Permissions changed. Read the current approval before retrying.');
        if (self.options.identity.read(appId).installation!==identity.installation) throw fault('identity_changed','App changed. Request approval again.');
        if (d.registryError || !userApp(d.apps.find(function (a) { return a.appId===appId && a.packageId===identity.packageId && a.version===identity.version; }),d.apps)) throw fault('not_allowed','Only verified user apps can connect');
        grant=self.state.grants.find(function (g) { return g.identity.appId===appId && g.identity.installation===identity.installation; });
        if (method==='access.status') return {state:grant&&grant.enabled?'approved':'unapproved',scopes:grant&&grant.enabled?grant.scopes:[]};
        if (method==='access.request') {
            var wanted=scopes(params.scopes);
            if (!wanted.length) throw fault('invalid_request','Request at least one permission');
            if (grant && grant.enabled && wanted.every(function (s) { return grant.scopes.indexOf(s)>=0; })) return {state:'approved',scopes:grant.scopes};
            var same=self.pending.find(function (r) { return r.identity.installation===identity.installation && r.expires>self.now() && JSON.stringify(r.scopes)===JSON.stringify(wanted); });
            if (!same) {
                self.pending=self.pending.filter(function (r) { return r.identity.appId!==appId && r.expires>self.now(); });
                if (self.pending.length>=20) throw fault('limit','Too many pending requests');
                same={id:crypto.randomBytes(16).toString('hex'),identity:identity,scopes:wanted,created:self.now(),expires:self.now()+600000};
                self.pending.push(same); self.event(appId,method,'pending');
            }
            return {state:'pending',requestId:same.id,expires:same.expires};
        }
        function check() {
            self.ready();
            if(self.state.revision!==revision)throw fault('permission_denied','Permissions changed. Read the current approval before retrying.');
            var current=self.state.grants.find(function (g) { return g.identity.appId===appId && g.identity.installation===identity.installation; });
            if (!current || !grant || current.generation!==grant.generation || !current.enabled || current.scopes.indexOf(required)<0) throw fault('permission_denied','This permission has not been granted');
            if (self.options.identity.read(appId).installation!==identity.installation) throw fault('identity_changed','App changed. Request approval again.');
            return true;
        }
        // Recheck at actual dispatch as well as before entering an async queue.
        check.onDispatch=function(){check();submitted=true;};
        check();
        return self.options.perform(method,params,d.apps,check).then(function (value) { check(); self.event(appId,method,'completed'); return value; });
    }).catch(function (e) {
        e=e.code?e:fault('unavailable','The TV operation is unavailable');
        if(submitted)e=fault('not_confirmed','A command was dispatched but its result was not confirmed. Check the TV before trying again.');
        e.submitted=submitted;self.event(appId,method,e.code);throw e;
    })
    .finally(function () { if (owned) { delete self.inFlight[appId]; self.active=Math.max(0,self.active-1); } });
};
module.exports = {Access:Access,SCOPES:SCOPES,METHODS:METHODS,userApp:userApp,launchableApp:launchableApp,scopes:scopes,fault:fault};
