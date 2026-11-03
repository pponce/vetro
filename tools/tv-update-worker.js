'use strict';
// Runs from /tmp, outside the package being replaced. Uses only loopback SDB.
var fs = require('fs'), path = require('path'), crypto = require('crypto'), child = require('child_process');
var staged = fs.existsSync(path.join(__dirname, 'compat.js'));
require(staged ? './compat.js' : '../app/service/compat.js').install();
var sdb = require(staged ? './sdb.js' : '../rooting/service/sdb.js');
var LOCK = '/tmp/vetro-combined-update.lock';
var STAGE = /^\/tmp\/vetro-update-[a-f0-9]{16}$/;
var SHA = /^[a-f0-9]{64}$/, REVISION = /^[a-f0-9]{40}$/;

function hash(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
function authorFingerprint(xml) {
    var match = /<(?:[\w.-]+:)?X509Certificate\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?X509Certificate>/.exec(xml);
    if (!match) throw Error('Installed author certificate could not be read');
    return hash(Buffer.from(match[1].replace(/\s/g, ''), 'base64'));
}
function create(options) {
    options = options || {};
    var io = options.fs || fs, transport = options.sdb || sdb, executeFile = options.execFile || child.execFile;
    var directory = options.directory || __dirname, lock = options.lock || LOCK;
    var uid = options.uid || function () { return process.getuid(); };
    var roots = options.roots || ['/opt/usr/apps/vetrotvapp', '/opt/usr/home/owner/apps_rw/vetrotvapp', '/home/owner/apps_rw/vetrotvapp'].reduce(function (all, base) {
        return all.concat([base + '/res/wgt', base + '/wgt', base]);
    }, []);
    function installed() {
        var root = roots.filter(function (r) { return io.existsSync(path.join(r, 'author-signature.xml')); })[0];
        if (!root) throw Error('Installed Vetro author certificate was not found');
        var info = io.readFileSync(path.join(root, 'service/build-info.js'), 'utf8');
        var revision = /["']?sourceRevision["']?\s*:\s*["']([a-f0-9]{40})["']/.exec(info);
        return {authorFingerprint: authorFingerprint(io.readFileSync(path.join(root, 'author-signature.xml'), 'utf8')),
            sourceRevision: revision ? revision[1] : null,
            launcherSha256: hash(io.readFileSync(path.join(root, 'native/dock/tvlauncher-dotnet.dll')))};
    }
    function command(text, timeout) {
        return transport.connect({host: '127.0.0.1', port: 26101, timeout: 8000}).then(function (client) {
            return transport.exec(client, text, {timeout: timeout}).finally(function () { transport.close(client); });
        });
    }
    function readDuid() {
        return command('shell:0 getduid', 8000).then(function (output) {
            var value = String(output).trim().split(/\r?\n/)[0].trim();
            if (!/^[A-Za-z0-9+\/=._:#-]{16,256}$/.test(value)) throw Error('Loopback SDB did not return a usable TV DUID');
            return value;
        });
    }
    function probe() {
        if (uid() !== 0) return Promise.reject(Error('Updater must be started through Vetro root'));
        var info = installed();
        return readDuid().then(function (duid) {
            info.duid = duid; info.uid = uid(); info.node = process.version; info.updateLocked = io.existsSync(lock);
            return info;
        });
    }
    function validate(job) {
        if (!STAGE.test(directory) || !job || !REVISION.test(job.revision) ||
            !SHA.test(job.sha256) || !SHA.test(job.authorFingerprint) || !SHA.test(job.duidFingerprint) || !SHA.test(job.launcherSha256) ||
            !Number.isInteger(job.size) || job.size < 1 || job.size > 32 * 1024 * 1024 ||
            job.previousRevision !== null && !REVISION.test(job.previousRevision)) throw Error('Invalid update job');
        var bytes = io.readFileSync(path.join(directory, 'vetro.wgt'));
        if (bytes.length !== job.size || hash(bytes) !== job.sha256) throw Error('Transferred package does not match its checksum');
    }
    function state(value) {
        var temporary = path.join(directory, 'state.json.tmp'), file = path.join(directory, 'state.json');
        io.writeFileSync(temporary, JSON.stringify(value) + '\n', {mode: 420});
        io.renameSync(temporary, file);
    }
    function unlock() {
        if (io.readFileSync(path.join(lock, 'owner'), 'utf8') !== directory) throw Error('Update lock belongs to another attempt');
        io.unlinkSync(path.join(lock, 'owner')); io.rmdirSync(lock);
    }
    function launch() {
        return new Promise(function (resolve) {
            executeFile('/usr/bin/app_launcher', ['-s', 'vetrotvapp.app'], {timeout: 10000}, function (error) {
                resolve(error ? 'Open Vetro on the TV to finish verification' : 'Vetro launch requested');
            });
        });
    }
    function install(job) {
        var record = {revision: job && job.revision, submitted: false, phase: 'checking'};
        var ownedLock = false;
        try {
            validate(job);
            // One invocation per staged attempt, even if the host loses its acknowledgement.
            io.mkdirSync(path.join(directory, 'attempt-started'), 448);
        } catch (error) {
            if (error.code === 'EEXIST') {
                try { return Promise.resolve(JSON.parse(io.readFileSync(path.join(directory, 'state.json'), 'utf8'))); }
                catch (ignored) { return Promise.resolve({phase: 'already-started', submitted: null}); }
            }
            if (!STAGE.test(directory)) return Promise.reject(error);
            record.phase = 'not-submitted'; record.error = error.message; state(record);
            return Promise.resolve(record);
        }
        return Promise.resolve().then(function () {
            return probe();
        }).then(function (info) {
            if (info.updateLocked) throw Error('Another Vetro update is pending; do not submit a second install');
            if (info.authorFingerprint !== job.authorFingerprint) throw Error('Author certificate differs from installed Vetro');
            if (hash(info.duid.toLowerCase()) !== job.duidFingerprint) throw Error('TV identity changed since preflight');
            if (info.sourceRevision !== job.previousRevision) throw Error('Installed Vetro changed since preflight');
            io.mkdirSync(lock, 448);
            ownedLock = true;
            io.writeFileSync(path.join(lock, 'owner'), directory, {mode: 384});
            record.phase = 'connecting'; state(record);
            return transport.connect({host: '127.0.0.1', port: 26101, timeout: 8000});
        }).then(function (client) {
            // Once dispatched, never automatically submit it a second time, even if SDB disconnects.
            record.submitted = true; record.phase = 'installing'; state(record);
            return transport.exec(client, 'shell:0 vd_appinstall vetrotvapp ' + directory + '/vetro.wgt', {timeout: 120000})
                .then(function (output) { record.phase = 'install-returned'; record.output = String(output).slice(-8192); })
                .catch(function (error) { record.phase = 'install-uncertain'; record.error = error.message; })
                .finally(function () { transport.close(client); });
        }).catch(function (error) {
            record.phase = record.submitted ? 'install-uncertain' : 'not-submitted'; record.error = error.message;
            if (!record.submitted && ownedLock) {
                try { if (io.readFileSync(path.join(lock, 'owner'), 'utf8') === directory) unlock(); } catch (ignored) {}
            }
        }).then(function () {
            state(record);
            if (!record.submitted) return record;
            return launch().then(function (message) { record.launch = message; state(record); return record; });
        });
    }
    function finish(job) {
        if (!STAGE.test(directory)) throw Error('Invalid update directory');
        var info = installed();
        if (info.sourceRevision !== job.revision || info.launcherSha256 !== job.launcherSha256) throw Error('Installed package has not been verified');
        if (io.existsSync(lock)) unlock();
        return {verified: true, revision: job.revision};
    }
    return {probe: probe, install: install, installed: installed, finish: finish};
}
module.exports = {create: create, hash: hash, authorFingerprint: authorFingerprint};
if (require.main === module) {
    var worker = create(), mode = process.argv[2];
    function print(result) { process.stdout.write(JSON.stringify(result) + '\n'); }
    function fail(error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
    if (mode === 'probe') worker.probe().then(print, fail);
    else if (mode === 'installed') { try { print(worker.installed()); } catch (error) { fail(error); } }
    else if (mode === 'install' || mode === 'finish') {
        try {
            var job = JSON.parse(fs.readFileSync(path.join(__dirname, 'job.json'), 'utf8'));
            if (mode === 'finish') print(worker.finish(job));
            else setTimeout(function () { worker.install(job).then(print, fail); }, 3000);
        } catch (error) { fail(error); }
    } else fail(Error('Use probe, installed, install, or finish'));
}
