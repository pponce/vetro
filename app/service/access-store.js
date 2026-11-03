'use strict';
// Security state belongs to Vetro's private package data, never shared storage.
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

function Store(validate) { this.validate = validate; this.file = null; this.error = 'Private storage is not ready'; }
Store.prototype.configure = function (file, initial) {
    this.file = file;
    try {
        var value;
        try {
            var info = fs.lstatSync(file);
            if (!info.isFile() || info.isSymbolicLink() || info.size > 262144) throw Error('Invalid security store');
            value = JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch (e) { if (e.code !== 'ENOENT') throw e; value = initial; }
        this.validate(value);
        this.error = null;
        return value;
    } catch (e) { this.error = 'Security settings could not be read. Access is blocked.'; throw Error(this.error); }
};
Store.prototype.save = function (value) {
    if (!this.file || this.error) throw Error(this.error || 'Private storage is not ready');
    var tmp = this.file + '.tmp-' + crypto.randomBytes(8).toString('hex'), fd;
    try {
        this.validate(value);
        fd = fs.openSync(tmp, 'wx', 384);
        fs.writeFileSync(fd, JSON.stringify(value));
        fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
        fs.renameSync(tmp, this.file);
        fd=fs.openSync(path.dirname(this.file),'r');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
        // The file is committed before in-memory permissions change.
    } catch (e) {
        if (fd !== undefined) try { fs.closeSync(fd); } catch (_) {}
        try { fs.unlinkSync(tmp); } catch (_) {}
        this.error = 'Security settings could not be saved. Access is blocked until storage is repaired and Vetro restarts.';
        throw Error(this.error);
    }
};
function privateDirectory(tizen, done) {
    try {
        if (!tizen || !tizen.filesystem || typeof tizen.filesystem.resolve !== 'function') throw Error('Private package storage is unavailable');
        tizen.filesystem.resolve('wgt-private', function (dir) {
            try {
                var uri = dir.toURI();
                if (typeof uri !== 'string' || !/^file:\/\//.test(uri)) throw Error('Private package storage is unavailable');
                var location = decodeURIComponent(uri.slice(7));
                if (location[0] !== '/' || /[\0\r\n]/.test(location) || location.split('/').indexOf('..') >= 0) throw Error('Invalid private storage location');
                done(null, path.normalize(location));
            } catch (e) { done(e); }
        }, function () { done(Error('Private package storage is unavailable')); }, 'rw');
    } catch (e) { done(e); }
}
module.exports = {Store: Store, privateDirectory: privateDirectory};
