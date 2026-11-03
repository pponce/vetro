'use strict';
// Navigation intent is transient. It never changes the saved return destination.
var validId = require('./startup-app.js').validId;
var nativeKey = require('./control.js').nativeKey;
var WAIT_MS = 30000;
var FILE = '/home/owner/tvlauncher.navigation';
// The resident launcher publishes before dispatch. Ignore files from a dead process.
var COMMAND = "printf '\\nVETRO_NATIVE_PID='; p=$(cat /home/owner/tvlauncher.pid 2>/dev/null); " +
    "case \"$p\" in ''|*[!0-9]*) printf '0\\n';; *) " +
    "if tr '\\0' ' ' < /proc/$p/cmdline 2>/dev/null | grep -q tvlauncher-dotnet.dll; then " +
    "printf '%s\\n' \"$p\"; head -c 512 " + FILE + " 2>/dev/null; else printf '0\\n'; fi;; esac; true";
function parse(text) {
    var pid = /^VETRO_NATIVE_PID=(\d+)$/m.exec(text), lines = String(text).split(/\r?\n/);
    var frames = lines.filter(function (line) { return line.indexOf('VETRO_NAV_V1\t') === 0; });
    if (!pid || pid[1] === '0' || frames.length !== 1) return null;
    var f = frames[0].split('\t');
    if (f.length !== 9 || f[1] !== pid[1] || !/^[a-f0-9]{32}$/.test(f[2]) || !/^\d{1,12}$/.test(f[3]) ||
        !/^\d{1,16}$/.test(f[4]) || !/^[01]$/.test(f[5]) || !/^(none|app|home|input|launcher|system)$/.test(f[6]) ||
        f[7] !== '-' && (!f[7] || !validId(f[7])) || !/^(?:-|\d{1,3})$/.test(f[8])) return null;
    return {token:f[2] + ':' + f[3], at:Number(f[4]), visible:f[5] === '1', kind:f[6],
        appId:f[7] === '-' ? null : f[7], sourceType:f[8] === '-' ? null : Number(f[8])};
}
function actionIntent(action) {
    if (action.type === 'launch') return {kind:action.appId === 'com.samsung.tv.csfs' ? 'home' : action.appId === 'org.tizen.tv-viewer' ? 'input' : 'app', appId:action.appId};
    if (action.type === 'launcher') return {kind:'launcher'};
    var key = action.type === 'key' && nativeKey(action.key);
    if (key === 'XF86Home') return {kind:'home'};
    if (key === 'XF86DiscretSourceTV') return {kind:'input', sourceType:0};
    if (/^(XF86Menu|XF86Info|XF86ChannelList|XF86ChannelGuide)$/.test(key)) return {kind:'system'};
    return null;
}
function Navigation(now) { this.now = now; this.intent = null; this.nativeToken = null; }
Navigation.prototype.note = function (intent) {
    this.intent = Object.assign({}, intent, {started:this.now()});
};
Navigation.prototype.reset = function () { this.intent = null; this.nativeToken = null; };
Navigation.prototype.observe = function (state) {
    this.discardBaseline = true;
    var n = state.navigation, now = this.now();
    if (n && n.token !== this.nativeToken) {
        this.nativeToken = n.token;
        // A previous launcher session or an old selection must not be replayed.
        if (n.kind !== 'none' && now >= n.at && now - n.at < WAIT_MS && (!this.intent || n.at >= this.intent.started)) {
            this.note(n); this.intent.started = n.at;
        }
    }
    if (n && n.visible) return true;
    var intent = this.intent;
    if (!intent) return false;
    var expired = now < intent.started || now - intent.started >= WAIT_MS, done = expired;
    if (intent.kind === 'app') done = done || state.full === intent.appId || state.partial === intent.appId;
    if (intent.kind === 'home') done = done || state.full === 'com.samsung.tv.csfs' || state.partial === 'com.samsung.tv.csfs';
    if (intent.kind === 'input') done = done || state.full === 'org.tizen.tv-viewer' && (!state.partial || state.partial === state.full) && (intent.sourceType == null || state.sourceType === intent.sourceType);
    if (intent.kind === 'system') done = done || !!state.partial;
    if (intent.kind === 'launcher') done = done || !!(n && intent.token === n.token && !n.visible);
    // Even completion/expiry discards this sample's exit. Only a later observed
    // ordinary app can establish the next exit; expiry never launches anything.
    if (done) { this.intent = null; this.discardBaseline = expired; }
    return true;
};
module.exports = {Navigation:Navigation, actionIntent:actionIntent, parse:parse, COMMAND:COMMAND};
