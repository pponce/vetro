'use strict';
// Live authorization facts only. Display names from the public probe never
// supply package identity, flags or eligibility, and every package sibling is
// retained for the app-access policy's protected-component checks.
var fields = require('./app-registry.js').fields;
var validId = require('./app-identity.js').validId;
var protectedApp = require('./debloat.js').isProtected;
var MAX_OUTPUT = 2 * 1024 * 1024;
function flag(value) { return value === 'true' ? true : value === 'false' ? false : null; }
function query(file, sql) { return 'sqlite3 -readonly "' + file + '" "' + sql + '"'; }
function load(execute, probe) {
    return Promise.resolve().then(function () {
        var ownerUid = typeof process.getuid === 'function' ? process.getuid() : 5001;
        if (!Number.isInteger(ownerUid) || ownerUid < 0) throw Error('TV owner identity unavailable');
        var ownerFile = '/opt/dbspace/user/' + ownerUid + '/.pkgmgr_parser.db';
        var base = "SELECT hex('base'),hex(a.app_id),hex(a.package),hex(a.app_type),hex(a.app_component)," +
            'hex(COALESCE(u.is_disabled,a.app_disable)),hex(a.app_removable),hex(p.package_version),' +
            'hex(p.package_system),hex(p.package_preload),hex(a.app_nodisplay) ' +
            'FROM package_app_info a LEFT JOIN package_info p ON p.package=a.package ' +
            'LEFT JOIN package_app_info_for_uid u ON u.app_id=a.app_id AND u.uid=' + ownerUid + ';';
        var override = "SELECT hex('owner'),hex(app_id),hex(is_disabled) FROM package_app_info_for_uid WHERE uid=" + ownerUid + ';';
        // One queue slot and no writes. A missing optional owner DB has no
        // overrides; an existing but unreadable/unsupported DB fails closed.
        // The trailing marker also detects truncated output that might omit a
        // protected sibling. It is emitted only after both reads succeed.
        var command = query('/opt/dbspace/.pkgmgr_parser.db', base) + ' && { if [ -e "' + ownerFile +
            '" ] || [ -L "' + ownerFile + '" ]; then ' + query(ownerFile, override) +
            '; fi; } && printf \'%s\\n\' 636f6d706c657465';
        return execute(command, 4000).then(function (result) {
            if (!result || result.exit_code !== 0 || result.timed_out || typeof result.stdout !== 'string' ||
                Buffer.byteLength(result.stdout, 'utf8') > MAX_OUTPUT) throw Error('App permission registry unavailable');
            var records = fields(result.stdout), last = records.pop();
            if (!last || last.length !== 1 || last[0] !== 'complete') throw Error('Incomplete app permission registry');
            var byId = Object.create(null), overrides = Object.create(null), rows = [], names = Object.create(null);
            (probe && Array.isArray(probe.apps) ? probe.apps : []).forEach(function (app) {
                if (app && validId(app.id) && typeof app.name === 'string') names[app.id] = app.name.slice(0, 120);
            });
            records.forEach(function (f) {
                if (f[0] === 'base') {
                    if (f.length !== 11 || !validId(f[1]) || !validId(f[2]) || byId[f[1]]) throw Error('Invalid app permission registry');
                    var hidden = flag(f[10]);
                    var row = {appId:f[1],packageId:f[2],type:f[3],component:f[4],disabled:flag(f[5]),
                        removable:flag(f[6]),version:f[7],system:flag(f[8]),preload:flag(f[9]),
                        show:hidden === null ? null : !hidden,protected:protectedApp(f[1]) || protectedApp(f[2]),
                        registryVerified:true,name:names[f[1]] || f[1]};
                    byId[row.appId] = row; rows.push(row);
                } else if (f[0] === 'owner') {
                    if (f.length !== 3 || !validId(f[1]) || Object.prototype.hasOwnProperty.call(overrides, f[1])) throw Error('Invalid owner app permission registry');
                    overrides[f[1]] = flag(f[2]);
                } else throw Error('Invalid app permission registry');
            });
            Object.keys(overrides).forEach(function (id) { if (byId[id]) byId[id].disabled = overrides[id]; });
            rows.sort(function (a, b) { return a.appId < b.appId ? -1 : a.appId > b.appId ? 1 : 0; });
            return {apps:rows,source:'live package registry',collectedAt:new Date().toISOString()};
        });
    });
}
module.exports = {load:load};
