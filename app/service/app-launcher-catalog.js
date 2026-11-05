'use strict';
// Consumer app metadata from Samsung Apps, independent of Home-row membership.
// Metadata only supplies labels/order; app-api applies the live launch policy.
var Home = require('./home-order.js');
var crypto = require('crypto');
var ID = /^[A-Za-z0-9_.-]{1,120}$/;
var MAX = 2000;
var BASE = '/opt/usr/home/owner/apps_rw/';
var DIRS = [BASE + 'com.samsung.tv.csfs/data', BASE + 'com.samsung.tv.home.media/data'];

function script() {
    return [
        'echo CATALOG1',
        'D=' + DIRS[0],
        'for d in ' + DIRS.join(' ') + '; do if [ -f "$d/.appLayerCache.1" ] || [ -f "$d/.appLayerCache.2" ]; then D=$d; break; fi; done',
        'for n in 1 2; do if [ -r "$D/.appLayerCache.$n" ]; then sed "s/^/H$n|/" "$D/.appLayerCache.$n" || exit 1; fi; done',
        'sqlite3 -readonly /opt/dbspace/.webappservice.db "SELECT \'R|\'||hex(id)||\'|\'||hex(title)||\'|\'||hex(tizen_id)||\'|\'||coalesce(is_hidden,\'unknown\') FROM widgetinfo;" || exit 1',
        'echo COMPLETE'
    ].join('\n');
}
function command() { return 'echo ' + Buffer.from(script()).toString('base64') + ' | base64 -d | sh'; }
function unhex(value) {
    if (!/^(?:[a-fA-F0-9]{2})*$/.test(value)) throw Error('Invalid catalog field');
    return Buffer.from(value, 'hex').toString('utf8');
}
function label(value) { return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0,120); }
function parse(text) {
    if (typeof text !== 'string' || Buffer.byteLength(text) > 2*1024*1024) throw Error('App catalog unavailable');
    var lines = text.trim().split('\n'), homes = [[],[]], entries = [];
    if (lines.shift() !== 'CATALOG1' || lines.pop() !== 'COMPLETE') throw Error('Incomplete app catalog');
    lines.forEach(function (line) {
        line = line.replace(/\r$/, '');
        var f = line.split('|');
        if (f[0] === 'H1' || f[0] === 'H2') homes[f[0] === 'H1' ? 0 : 1].push(line.slice(3));
        else if (f[0] === 'R' && f.length === 5) {
            if (entries.length >= MAX) throw Error('App catalog is too large');
            entries.push({id:unhex(f[1]),name:label(unhex(f[2])),appId:unhex(f[3]),visible:f[4] === '0'});
        } else throw Error('Invalid app catalog record');
    });
    var order = null;
    homes.some(function (lines) {
        try { order = Home.parse(lines.join('\n') + '\n').entries; return true; } catch (e) { return false; }
    });
    if (!order) throw Error('Samsung Home order unavailable');
    return {entries:entries,order:order};
}
function build(metadata, allowed) {
    var installed = Object.create(null), selected = Object.create(null), order = Object.create(null);
    allowed.forEach(function (r) { if (r.disabled === false) installed[r.appId] = true; });
    metadata.order.forEach(function (item, i) { if (order[item] === undefined) order[item] = i; });
    function add(appId,name,homeOrder) {
        if (!ID.test(appId) || !installed[appId] || !name) return;
        var prior = selected[appId];
        if (!prior || homeOrder !== null && (prior.homeOrder === null || homeOrder < prior.homeOrder))
            selected[appId] = {appId:appId,name:name,disabled:false,homeOrder:homeOrder};
    }
    metadata.entries.slice().sort(function (a,b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }).forEach(function (r) {
        if (!r.visible) return;
        var index = order['d/webapp@' + r.id];
        add(r.appId,r.name,index === undefined ? null : index);
    });
    // TV Plus is a live-source Home tile. Launch its verified app, not the TV viewer.
    if (order['s/livetv@TVPLUS'] !== undefined)
        add('com.samsung.tv.tvPlusDeeplinker','Samsung TV Plus',order['s/livetv@TVPLUS']);
    var apps = Object.keys(selected).map(function (id) { return selected[id]; });
    apps.sort(function (a,b) {
        if (a.homeOrder !== b.homeOrder) {
            if (a.homeOrder === null) return 1;
            if (b.homeOrder === null) return -1;
            return a.homeOrder - b.homeOrder;
        }
        var x=a.name.toLowerCase(),y=b.name.toLowerCase();
        return x<y?-1:x>y?1:a.appId<b.appId?-1:a.appId>b.appId?1:0;
    });
    if (apps.length > MAX) throw Error('App catalog is too large');
    return {apps:apps,revision:crypto.createHash('sha256').update(JSON.stringify(apps)).digest('hex')};
}
function createReader(execute) {
    var pending = null, cached = null, at = 0;
    return function read(refresh) {
        if (pending) return pending;
        if (!refresh && cached && Date.now()-at < 120000) return Promise.resolve(cached);
        pending = Promise.resolve().then(function () { return execute(command(),6000); }).then(function (r) {
            if (!r || r.exit_code !== 0 || r.timed_out) throw Error('Samsung app catalog unavailable');
            cached = parse(r.stdout); at = Date.now(); pending = null; return cached;
        }).catch(function (e) { pending = null; throw e; });
        return pending;
    };
}
module.exports = {createReader:createReader,parse:parse,build:build,script:script,MAX:MAX};
