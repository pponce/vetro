'use strict';
// Read Samsung's local power status without changing power, source, or app state.
// An unavailable API is unknown, never evidence that the TV entered standby.
var http = require('http');
var fs = require('fs');
var MAX_BYTES = 32768, TIMEOUT_MS = 2000;

function decode(body) {
    var data = JSON.parse(body), value = data && data.device && data.device.PowerState;
    if (value === 'on') return 'on';
    if (value === 'standby' || value === 'off') return 'standby';
    throw Error('The TV does not report a supported power state');
}

function readClock() {
    var bootId = null, suspendOffset = null;
    try { bootId = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(); } catch (e) {}
    try {
        // Linux /proc/uptime includes suspend; CLOCK_MONOTONIC (hrtime) does not.
        var uptime = parseFloat(fs.readFileSync('/proc/uptime', 'utf8'));
        var mono = process.hrtime();
        if (isFinite(uptime)) suspendOffset = uptime - mono[0] - mono[1] / 1e9;
    } catch (e) {}
    return {bootId: bootId, suspendOffset: suspendOffset};
}

function Reader(options) {
    options = options || {};
    this.http = options.http || http;
    this.pending = null;
}
Reader.prototype.read = function () {
    if (this.pending) return this.pending;
    var self = this;
    this.pending = new Promise(function (resolve, reject) {
        var request, timer, finished = false;
        function finish(error, state) {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            if (error) { if (request) request.destroy(); reject(error); }
            else resolve(state);
        }
        timer = setTimeout(function () { finish(Error('TV power status timed out')); }, TIMEOUT_MS);
        request = self.http.get({hostname: '127.0.0.1', port: 8001, path: '/api/v2/', agent: false}, function (response) {
            if (response.statusCode !== 200) { response.resume(); return finish(Error('TV power status unavailable')); }
            var body = '', size = 0;
            response.on('data', function (chunk) {
                size += chunk.length;
                if (size > MAX_BYTES) return finish(Error('TV power response is too large'));
                body += chunk.toString('utf8');
            });
            response.on('end', function () {
                if (finished) return;
                try { finish(null, decode(body)); } catch (e) { finish(e); }
            });
            response.on('error', function () { finish(Error('TV power status unavailable')); });
            response.on('aborted', function () { finish(Error('TV power response interrupted')); });
        });
        request.on('error', function () { finish(Error('TV power status unavailable')); });
    }).finally(function () { self.pending = null; });
    return this.pending;
};

module.exports = {Reader: Reader, decode: decode, readClock: readClock};
