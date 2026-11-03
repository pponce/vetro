'use strict';
var crypto = require('crypto');
function validId(value) { return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,180}$/.test(value); }
function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function Resolver(tizen) { this.tizen = tizen; this.epochs=Object.create(null); }
Resolver.prototype.changed=function(packageId){if(validId(packageId))this.epochs[packageId]=(this.epochs[packageId]||0)+1;};
Resolver.prototype.epoch=function(packageId){return this.epochs[packageId]||0;};
Resolver.prototype.available = function () {
    var t = this.tizen;
    return !!(t && t.application && t.package && typeof t.application.getAppInfo === 'function' &&
        typeof t.application.getAppCerts === 'function' && typeof t.package.getPackageInfo === 'function');
};
// Launch targets need installed package identity; only callers and stop targets
// require an author signer. Some preinstalled media apps have no author signer.
Resolver.prototype.target = function (appId) {
    if (!validId(appId) || !this.available()) throw Error('Installed app identity cannot be verified');
    var t = this.tizen, app = t.application.getAppInfo(appId);
    if (!app || app.id !== appId || !validId(app.packageId)) throw Error('Installed app identity cannot be verified');
    var pkg = t.package.getPackageInfo(app.packageId);
    var modified = pkg && pkg.lastModified && pkg.lastModified.getTime();
    if (!pkg || pkg.id !== app.packageId || !Array.isArray(pkg.appIds) || pkg.appIds.indexOf(appId) < 0 ||
        !Number.isInteger(modified) || modified <= 0 || typeof pkg.version !== 'string' || !pkg.version || pkg.version.length > 100) {
        throw Error('Installed package identity cannot be verified');
    }
    return {appId:appId,packageId:pkg.id,name:String(app.name || pkg.name || appId).slice(0,120),
        version:pkg.version,installedAt:modified,
        installation:digest(JSON.stringify([appId,pkg.id,pkg.version,modified]))};
};
Resolver.prototype.read = function (appId) {
    var identity=this.target(appId);
    var certs = this.tizen.application.getAppCerts(appId);
    var authors = Array.isArray(certs) ? certs.filter(function (c) { return c && c.type === 'AUTHOR_SIGNER'; }) : [];
    if (authors.length !== 1 || typeof authors[0].value !== 'string' || !authors[0].value || authors[0].value.length > 16384) {
        throw Error('App signing certificate cannot be verified');
    }
    var signer = digest(authors[0].value);
    identity.signer=signer;
    identity.installation=digest(JSON.stringify([appId,identity.packageId,identity.version,identity.installedAt,signer]));
    return identity;
};
module.exports = {Resolver: Resolver, validId: validId};
