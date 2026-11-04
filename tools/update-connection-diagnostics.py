#!/usr/bin/env python3
"""Build a pinned diagnostic revision, update through TV-Store, and collect its report."""
import argparse
import datetime
import fcntl
import hashlib
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.error
import urllib.request

CLI_VERSION = '3.2.0-beta+48a04324a1981b0712690729b2f3d58755db8395'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError('Unexpected HTTP redirect')


def read_json(url):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    request = urllib.request.Request(url, headers={'Accept': 'application/json', 'User-Agent': 'vetro-diagnostic-updater'})
    try:
        response = opener.open(request, timeout=10)
    except urllib.error.HTTPError as error:
        if error.code not in (401, 503):
            raise
        response = error
    with response:
        content = response.read(2097153)
    if len(content) > 2097152:
        raise RuntimeError('HTTP response exceeded its limit')
    return json.loads(content)


def run(command, cwd=None, env=None, timeout=180):
    return subprocess.run([str(arg) for arg in command], cwd=cwd, env=env,
                          stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=timeout)


def checked(command, **kwargs):
    result = run(command, **kwargs)
    if result.returncode:
        raise RuntimeError(Path(str(command[0])).name + ' failed with exit code ' + str(result.returncode))
    return result.stdout


def decision(status, revision, baseline, attempted):
    diagnostic = status.get('connectionDiagnostics') or {}
    if diagnostic.get('sourceRevision') == revision and diagnostic.get('sourceDirty') is False:
        return 'collect'
    if attempted:
        return 'collect-existing-attempt'
    if diagnostic.get('sourceRevision') != baseline or diagnostic.get('sourceDirty') is not False:
        raise RuntimeError('Running source is not the expected clean baseline; no installation submitted')
    return 'install'


def partner_profile(result):
    duid = result.get('tvDuid')
    if result.get('ok') is not True or not isinstance(duid, str) or not re.fullmatch(r'[A-Za-z0-9]{10,64}', duid):
        raise RuntimeError('The TV did not return a valid signing identity')
    profiles = [p for p in result.get('profiles', []) if p.get('level') == 'Partner'
                and p.get('exists') is True and p.get('usable') is True and duid in p.get('duids', [])]
    if len(profiles) != 1 or not profiles[0].get('path'):
        raise RuntimeError('No unique existing usable Partner certificate covers this TV; no certificate was created')
    return duid, Path(profiles[0]['path'])


def install_command(cli, package, tv, local_ip, duid):
    return [str(cli), 'install', str(package), '--partner', '--duids', duid,
            '--own-id', '--tv', tv, '--local-ip', local_ip, '--launch', '--yes', '--json', '--no-browser']


def idle_relay(tv):
    deadline = time.monotonic() + 12
    while True:
        relay = read_json('http://' + tv + ':8077/relay').get('relay') or {}
        if relay.get('enabled') is not True or relay.get('listening') is not True or relay.get('error'):
            raise RuntimeError('TV-Store relay is not ready')
        if relay.get('port') != 26201:
            raise RuntimeError('TV-Store relay is not on the expected CLI relay port')
        if type(relay.get('sessions')) is int and relay['sessions'] == 0:
            return
        if time.monotonic() >= deadline:
            raise RuntimeError('Another relay client is connected; close Apps2Samsung and its debug window')
        time.sleep(1)


def verify_ci(revision, run_id):
    base = 'https://api.github.com/repos/pponce/vetro/actions/runs/' + str(run_id)
    workflow = read_json(base)
    if workflow.get('head_sha') != revision or workflow.get('status') != 'completed' or workflow.get('conclusion') != 'success':
        raise RuntimeError('The pinned source does not have a successful completed CI run')
    jobs = {job['name']: job.get('conclusion') for job in read_json(base + '/jobs?per_page=100')['jobs']}
    if any(jobs.get(name) != 'success' for name in ('check', 'permissions_ui', 'launcher', 'combined_package')):
        raise RuntimeError('The required source, UI, launcher and package checks have not all passed')


def checkout(project, revision):
    repository = project / 'vetro-combined'
    if not repository.is_dir():
        raise RuntimeError('The established vetro-combined checkout was not found')
    checked(['git', '-C', repository, 'fetch', '--no-tags', 'git@github.com:pponce/vetro.git', revision])
    worktree = project / ('vetro-recovery-' + revision[:12])
    if not worktree.exists():
        checked(['git', '-C', repository, 'worktree', 'add', '--detach', worktree, revision])
    if checked(['git', '-C', worktree, 'rev-parse', 'HEAD']).strip() != revision:
        raise RuntimeError('The diagnostic worktree has a different revision')
    if checked(['git', '-C', worktree, 'status', '--porcelain']).strip():
        raise RuntimeError('The diagnostic worktree has local changes; nothing was overwritten')
    return worktree


BUILD = r"""
const fs=require('fs'),vm=require('vm'),assert=require('assert').strict;
const app=require('./app/build.cjs'),files=require('./rooting/build.cjs').collectIntegration();
const entries=new Map(files.map(f=>[decodeURIComponent(f.uri),f.data]));
for(const name of ['service/startup-app.js','service/return-app.js','service/app-access.js',
    'service/app-ports.js','service/root-agent.js','service/message-reply-diagnostics.js',
    'service/runtime-source-diagnostics.js','payload/SamsungTvRootAgent.dll',
    'native/dock/tvlauncher-dotnet.dll'])assert.ok(entries.has(name),'Missing combined file: '+name);
const context={module:{exports:{}}};vm.runInNewContext(entries.get('service/build-info.js').toString(),context);
assert.equal(context.module.exports.sourceRevision,process.argv[2]);
assert.equal(context.module.exports.sourceDirty,false);
assert.equal(context.module.exports.connectionDiagnostics,true);
assert.ok(entries.get('service/message-reply-diagnostics.js').includes(Buffer.from('lookupObservation')));
assert.ok(entries.get('index.html').includes(Buffer.from('service/connection-debug-client.js')));
const native=entries.get('native/dock/tvlauncher-dotnet.dll');
assert.ok(native.includes(Buffer.from('--mapped-home','utf16le')));
assert.ok(native.includes(Buffer.from('VETRO_NAV_V1','utf16le')));
fs.writeFileSync(process.argv[1],app.zip(files),{flag:'wx'});
"""


def collect(worktree, tv, revision):
    spec = importlib.util.spec_from_file_location('connection_collector', worktree / 'tools/collect-connection-report.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.collect('http://' + tv + ':8099/status', revision, wait=180, fetch=read_json)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('project-root', 'tv', 'local-ip', 'revision', 'expected-before', 'report-host'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--ci-run', required=True, type=int)
    args = parser.parse_args()
    for address in (args.tv, args.local_ip):
        ipaddress.IPv4Address(address)
    for revision in (args.revision, args.expected_before):
        if not re.fullmatch(r'[a-f0-9]{40}', revision):
            raise ValueError('Expected a full source revision')
    project = Path(args.project_root).expanduser().resolve()
    if not project.is_dir():
        raise RuntimeError('The established project directory does not exist')
    os.umask(0o077)
    directory = project / 'vetro-install/beta-recovery'
    directory.mkdir(parents=True, exist_ok=True)
    stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    report_path = directory / ('connection-report-' + stamp + '.json')
    attempt = directory / ('attempt-' + args.revision[:12] + '.json')
    info = {'targetRevision': args.revision, 'expectedBefore': args.expected_before,
            'installSubmittedByThisRun': False, 'errors': []}
    report = {'capture': {'complete': False, 'expectedRevision': args.revision}, 'status': None}
    lock = None
    try:
        lock = (directory / 'diagnostic-update.lock').open('a')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        verify_ci(args.revision, args.ci_run)
        status = read_json('http://' + args.tv + ':8099/status')
        report['status'] = status
        action = decision(status, args.revision, args.expected_before, attempt.exists())
        info['action'] = action
        print('Preparing the pinned source with all four CI jobs passed...', flush=True)
        worktree = checkout(project, args.revision)
        if action == 'install':
            cli = Path((project / 'vetro-install/bin/apps2samsung-beta.path').read_text().strip()).resolve()
            if not cli.is_file() or not os.access(cli, os.X_OK):
                raise RuntimeError('The saved Apps2Samsung CLI is unavailable')
            if CLI_VERSION not in checked([cli, '--version'], timeout=20):
                raise RuntimeError('The saved CLI differs from the verified Apps2Samsung version')
            idle_relay(args.tv)
            print('Checking the existing Partner certificate against the TV...', flush=True)
            certificate = json.loads(checked([cli, 'cert', '--partner', '--tv', args.tv,
                                             '--local-ip', args.local_ip, '--json'], timeout=90))
            duid, profile = partner_profile(certificate)
            author = profile / 'author.p12'
            author_before = hashlib.sha256(author.read_bytes()).hexdigest()
            package = directory / ('vetro-wrapper-' + args.revision[:12] + '-' + stamp + '.wgt')
            env = dict(os.environ, VETRO_CONNECTION_DIAGNOSTICS='1', VETRO_PORT='8099')
            env.pop('VETRO_SOURCE_REVISION', None)
            checked(['node', '-e', BUILD, package, args.revision], cwd=worktree, env=env)
            idle_relay(args.tv)
            ledger = {'schema': 1, 'revision': args.revision, 'stage': 'install-command-starting',
                      'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'report': str(report_path)}
            with attempt.open('x') as output:
                json.dump(ledger, output, indent=2)
                output.flush()
                os.fsync(output.fileno())
            info['installSubmittedByThisRun'] = True
            print('Installing the combined diagnostic build once. Earlier records are retained...', flush=True)
            result = run(install_command(cli, package, args.tv, args.local_ip, duid), timeout=300)
            info['cliExitCode'] = result.returncode
            try:
                answer = json.loads(result.stdout)
            except ValueError:
                answer = {}
            info['cliConfirmedInstall'] = (result.returncode == 0 and answer.get('ok') is True
                and answer.get('appId') == 'vetrotvapp.app' and answer.get('packageId') == 'vetrotvapp')
            info['cliConfirmedLaunch'] = answer.get('launched') is True
            if not info['cliConfirmedInstall']:
                error = str(answer.get('error') or 'CLI did not return a verified installation result')
                error = error.replace(duid, '[device-id]')
                info['errors'].append(re.sub(r'\b[a-fA-F0-9]{24,}\b', '[redacted]', error)[:1200])
                print('Installation result is unresolved; checking the running revision without retrying the install.', flush=True)
            info['authorCertificateUnchanged'] = hashlib.sha256(author.read_bytes()).hexdigest() == author_before
        else:
            print('Collecting only; no installation will be repeated.', flush=True)
        print('If Vetro is not visible, open it once with the TV remote. Leave its checks running.', flush=True)
        report = collect(worktree, args.tv, args.revision)
        if report['capture']['runningServiceVerified'] and report['capture']['screenBuildVerified']:
            print('VERIFIED: service and screen report the new revision.', flush=True)
        else:
            print('PARTIAL: the new service/screen revision could not both be verified.', flush=True)
    except Exception as error:
        info['errors'].append(str(error) if isinstance(error, (RuntimeError, ValueError)) else type(error).__name__)
        print('STOPPED:', info['errors'][-1], flush=True)
    finally:
        report['installation'] = info
        with report_path.open('x', encoding='utf-8') as output:
            json.dump(report, output, indent=2)
            output.write('\n')
        if lock:
            lock.close()
        print('Report:', report_path)
        print('\nRun this on your Mac to retrieve the report:')
        print('rsync -P ' + args.report_host + ':' + str(report_path) + ' ~/Downloads/')


if __name__ == '__main__':
    main()
