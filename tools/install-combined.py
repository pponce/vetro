#!/usr/bin/env python3
"""Sign a pinned Vetro checkout and update the TV through its existing root service."""
import argparse
import base64
import datetime
import hashlib
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import subprocess
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

STAGE = re.compile(r"/tmp/vetro-update-[a-f0-9]{16}\Z")
REVISION = re.compile(r"[a-f0-9]{40}\Z")
CHUNK = 16384
WORKER_PREFIX = 'VETRO_UPDATE_RESULT_V1 '


def digest(value):
    return hashlib.sha256(value).hexdigest()


def worker_response(output, mode):
    """Read only the helper's explicit result, not surrounding runtime output."""
    if mode not in ('probe', 'installed', 'finish'):
        raise ValueError('Invalid updater operation')
    if not isinstance(output, str) or len(output) > 65536:
        raise RuntimeError('TV updater response is missing or exceeds its limit')
    frames = [line[len(WORKER_PREFIX):] for line in output.splitlines()
              if line.startswith(WORKER_PREFIX)]
    if len(frames) != 1:
        raise RuntimeError('Expected one TV updater result for ' + mode
                           + '; received ' + str(len(frames)) + ' marked results')
    try:
        envelope = json.loads(frames[0])
    except ValueError:
        raise RuntimeError('TV updater result for ' + mode + ' is incomplete or invalid JSON') from None
    if (not isinstance(envelope, dict) or type(envelope.get('protocol')) is not int
            or envelope['protocol'] != 1 or envelope.get('mode') != mode
            or not isinstance(envelope.get('result'), dict)):
        raise RuntimeError('TV updater result version, operation, or payload is invalid')
    result = envelope['result']
    def revision(value):
        return isinstance(value, str) and REVISION.fullmatch(value) is not None
    def checksum(value):
        return isinstance(value, str) and re.fullmatch(r'[a-f0-9]{64}', value) is not None
    if mode == 'finish':
        valid = result.get('verified') is True and revision(result.get('revision'))
    else:
        valid = (checksum(result.get('authorFingerprint')) and checksum(result.get('launcherSha256'))
                 and 'sourceRevision' in result
                 and (result['sourceRevision'] is None or revision(result['sourceRevision'])))
        if mode == 'probe':
            valid = (valid and isinstance(result.get('duid'), str)
                     and re.fullmatch(r'[A-Za-z0-9]{10,64}', result['duid']) is not None
                     and type(result.get('uid')) is int and result['uid'] == 0
                     and type(result.get('updateLocked')) is bool
                     and isinstance(result.get('runtime'), str) and 0 < len(result['runtime']) <= 64)
    if not valid:
        # Do not include raw output: the probe contains the TV's private ID.
        raise RuntimeError('TV updater result for ' + mode + ' is missing valid required fields')
    return result


def lower_keys(value):
    if isinstance(value, dict):
        return {k.lower(): lower_keys(v) for k, v in value.items()}
    if isinstance(value, list):
        return [lower_keys(v) for v in value]
    return value


def partner_profile(output, duid):
    decoder = json.JSONDecoder()
    profiles = []
    for position, character in enumerate(output):
        if character != '{':
            continue
        try:
            value, _ = decoder.raw_decode(output[position:])
        except ValueError:
            continue
        value = lower_keys(value)
        if isinstance(value, dict) and isinstance(value.get('profiles'), list):
            profiles = value['profiles']
            break
    matches = [p for p in profiles if p.get('level', '').lower() == 'partner'
               and p.get('exists') is True and p.get('usable') is True
               and duid.lower() in [str(d).lower() for d in p.get('duids', [])]]
    if len(matches) != 1 or not matches[0].get('path'):
        raise RuntimeError('No unique usable cached Partner profile covers this TV. No certificate was created or changed.')
    return Path(matches[0]['path'])


def package_metadata(file, revision, native_hash):
    with zipfile.ZipFile(file) as package:
        names = set(package.namelist())
        required = {'config.xml', 'author-signature.xml', 'signature1.xml', 'service/build-info.js',
                    'service/startup-app.js', 'service/return-app.js', 'payload/SamsungTvRootAgent.dll'}
        if not required.issubset(names):
            raise RuntimeError('Package is missing signing or TV integration files')
        widget = ET.fromstring(package.read('config.xml'))
        app = widget.find('{http://tizen.org/ns/widgets}application')
        if app is None or app.get('id') != 'vetrotvapp.app' or app.get('package') != 'vetrotvapp':
            raise RuntimeError('Package identity is not the existing Vetro app')
        info = package.read('service/build-info.js').decode()
        if f'"sourceRevision":"{revision}"' not in info or '"sourceDirty":false' not in info:
            raise RuntimeError('Package does not identify the pinned clean checkout')
        if digest(package.read('native/dock/tvlauncher-dotnet.dll')) != native_hash:
            raise RuntimeError('Packaged launcher differs from the combined checkout')
        signature = ET.fromstring(package.read('author-signature.xml'))
        certificates = [n.text for n in signature.iter() if n.tag.split('}')[-1] == 'X509Certificate']
        if not certificates:
            raise RuntimeError('Signed author certificate was not found')
        return {'authorFingerprint': digest(base64.b64decode(certificates[0])),
                'sha256': digest(file.read_bytes()), 'size': file.stat().st_size}


def transfer_commands(stage, name, data):
    if not STAGE.fullmatch(stage) or not re.fullmatch(r'[a-zA-Z0-9_.-]+', name):
        raise ValueError('Invalid staging path')
    target = shlex.quote(stage + '/' + name)
    yield f': > {target} && chmod 644 {target}'
    for index, offset in enumerate(range(0, len(data), CHUNK)):
        encoded = base64.b64encode(data[offset:offset + CHUNK]).decode('ascii')
        # A fixed block offset makes a repeated transfer chunk idempotent.
        yield f'printf %s {shlex.quote(encoded)} | base64 -d | dd of={target} bs={CHUNK} seek={index} conv=notrunc 2>/dev/null'


def helper_files(root):
    source = root / 'tools/tv-updater/bundle.py'
    spec = importlib.util.spec_from_file_location('tv_updater_bundle', source)
    bundle = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bundle)
    return bundle.verify(source.parent)


def launch_command(runtime, stage):
    if not STAGE.fullmatch(stage):
        raise ValueError('Invalid staging path')
    return ('nohup setsid ' + ' '.join(map(shlex.quote, [runtime, stage + '/VetroUpdate.dll', 'install']))
            + ' </dev/null >' + shlex.quote(stage + '/worker.log') + ' 2>&1 &\nprintf "updater-started\\n"')


class Installer:
    def __init__(self, args):
        self.args = args
        self.root = Path(__file__).resolve().parents[1]
        self.project = Path(args.project_root).expanduser().resolve()
        self.directory = self.project / 'vetro-install' / 'combined-updates'
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.report = self.directory / ('install-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S') + '-' + str(os.getpid()) + '.log')
        self.logfile = self.report.open('x', encoding='utf-8')
        os.chmod(self.report, 0o600)
        self.ledger_file = self.directory / ('state-' + digest(args.tv.encode())[:12] + '.json')
        self.base = f'http://{args.tv}:{args.port}'
        self.redactions = []
        self.sent = False

    def log(self, message):
        text = str(message)
        for secret in self.redactions:
            if secret:
                text = text.replace(secret, '[redacted]')
        print(text, flush=True)
        self.logfile.write(text + '\n')
        self.logfile.flush()

    def request(self, route, body=None, timeout=40):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.base + route, data=data,
                                     headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return json.load(response)

    def execute(self, command):
        result = self.request('/exec', {'cmd': command})
        if result.get('ok') is not True or result.get('exit_code') != 0 or result.get('timed_out'):
            raise RuntimeError('TV command did not complete: ' + str(result.get('stderr') or result.get('error') or 'unknown outcome')[-1200:])
        return result.get('output', '')

    def command(self, arguments, cwd=None, env=None, quiet=False):
        result = subprocess.run(arguments, cwd=cwd or self.root, env=env,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        if result.returncode:
            if not quiet:
                self.log(result.stdout[-6000:])
            raise RuntimeError(f'{Path(arguments[0]).name} failed (exit {result.returncode})')
        return result.stdout

    def write_ledger(self, ledger):
        temporary = self.ledger_file.with_suffix('.tmp')
        temporary.write_text(json.dumps(ledger, indent=2) + '\n')
        temporary.chmod(0o600)
        temporary.replace(self.ledger_file)

    def worker(self, stage, mode):
        if not STAGE.fullmatch(stage):
            raise RuntimeError('Invalid saved update directory')
        if mode not in ('probe', 'installed', 'finish'):
            raise ValueError('Invalid updater operation')
        output = self.execute(' '.join(map(shlex.quote, ['/usr/bin/dotnet', stage + '/VetroUpdate.dll', mode])))
        return worker_response(output, mode)

    def stage_helper(self):
        files = helper_files(self.root)
        stage = '/tmp/vetro-update-' + secrets.token_hex(8)
        self.execute('test -x /usr/bin/dotnet && command -v base64 >/dev/null && command -v dd >/dev/null '
                     '&& command -v sha256sum >/dev/null && command -v setsid >/dev/null && command -v nohup >/dev/null '
                     '&& mkdir ' + shlex.quote(stage) + ' && chmod 755 ' + shlex.quote(stage))
        for name, data in files.items():
            self.upload(stage, name, data)
            output = self.execute('sha256sum ' + shlex.quote(stage + '/' + name))
            if output.split()[:1] != [digest(data)]:
                raise RuntimeError('Transferred TV updater did not match its checksum: ' + name)
        self.log('Using the TV’s existing .NET runtime; no standalone TV Node runtime or Mint .NET SDK is needed.')
        return stage

    def upload(self, stage, name, data):
        commands = list(transfer_commands(stage, name, data))
        for index, command in enumerate(commands):
            self.execute(command)
            if name == 'vetro.wgt' and index and (index % 32 == 0 or index == len(commands) - 1):
                self.log(f'Transferring signed package: {round(index * 100 / (len(commands) - 1))}%')

    def find_cli(self):
        if self.args.installer:
            candidates = [Path(self.args.installer).expanduser()]
        else:
            folder = self.project / 'vetro-install' / 'bin'
            candidates = [folder / 'v3.1.0' / 'apps2samsung-cli', folder / '3.1.0' / 'apps2samsung-cli']
            if folder.is_dir():
                candidates += sorted(folder.rglob('apps2samsung-cli'))
        for file in candidates:
            if file.is_file() and os.access(file, os.X_OK):
                return file
        raise RuntimeError('Existing Apps2Samsung CLI was not found under vetro-install/bin; use --installer PATH')

    def sign(self, duid, revision, native_hash):
        self.log('Checking the existing cached Partner certificate…')
        raw = self.command([str(self.find_cli()), 'cert', '--partner', '--json'], quiet=True)
        profile = partner_profile(raw, duid)
        for name in ('author.p12', 'distributor.p12', 'password.txt'):
            if not (profile / name).is_file():
                raise RuntimeError('The cached Partner profile is incomplete')
        password = (profile / 'password.txt').read_text().strip()
        self.redactions.append(password)
        self.log('Reusing the existing Partner signing profile; no Samsung login or certificate replacement.')
        self.log('Preparing signing dependencies…')
        self.command(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], cwd=self.root / 'rooting/on-boot-probe')
        output = self.directory / ('vetro-combined-' + revision[:12] + '.wgt')
        env = os.environ.copy()
        env.pop('VETRO_SOURCE_REVISION', None)
        env.update(AUTHOR_P12=str(profile / 'author.p12'), DIST_P12=str(profile / 'distributor.p12'),
                   AUTHOR_PW=password, DIST_PW=password, OUT=str(output), VETRO_PORT=str(self.args.port))
        self.command(['node', 'rooting/build.cjs'], env=env)
        return output, package_metadata(output, revision, native_hash)

    def verify(self, ledger):
        self.sent = True
        revision = ledger['revision']
        self.log('Waiting for the updated Vetro service and root connection. Keep the TV on.')
        self.log('If Vetro does not reopen, open Vetro once with the TV remote; verification will continue.')
        deadline = time.monotonic() + 330
        next_notice = 0
        status = None
        while time.monotonic() < deadline:
            try:
                current = self.request('/status', timeout=8)
                if (current.get('app', {}).get('sourceRevision') == revision
                        and current.get('app', {}).get('sourceDirty') is False
                        and current.get('agent', {}).get('connected') is True):
                    status = current
                    break
            except (OSError, ValueError):
                pass
            if time.monotonic() >= next_notice:
                self.log('Still waiting for the requested source revision and root…')
                try:
                    progress = json.loads(self.execute('cat ' + shlex.quote(ledger['stage'] + '/state.json')))
                except (OSError, ValueError, RuntimeError):
                    progress = {}
                if progress.get('phase') == 'not-submitted' and progress.get('submitted') is False:
                    ledger['sent'] = False
                    self.write_ledger(ledger)
                    self.sent = False
                    raise RuntimeError('Updater stopped before installation: ' + str(progress.get('error', 'preflight failed')))
                next_notice = time.monotonic() + 30
            time.sleep(5)
        if status is None:
            try:
                self.log('Updater state: ' + self.execute('cat ' + shlex.quote(ledger['stage'] + '/state.json')))
            except (OSError, ValueError, RuntimeError):
                pass
            raise RuntimeError('Install outcome is unverified. No second install will be sent. Open Vetro and rerun this block to resume verification.')
        # The replacement service can start before vd_appinstall releases its SDB
        # stream. Do not delete the helper's files while it is still running.
        deadline = time.monotonic() + 150
        while True:
            progress = json.loads(self.execute('cat ' + shlex.quote(ledger['stage'] + '/state.json')))
            if progress.get('finished') is True:
                break
            if time.monotonic() >= deadline:
                raise RuntimeError('New Vetro is running, but the updater has not finished. Rerun this block to resume verification; no second install will be sent.')
            time.sleep(3)
        installed = self.worker(ledger['stage'], 'installed')
        if installed.get('sourceRevision') != revision or installed.get('launcherSha256') != ledger['launcherSha256']:
            raise RuntimeError('Installed files do not match the combined build')
        for endpoint in ('/startup-app', '/return-app'):
            value = self.request(endpoint)
            if 'appId' not in value or not isinstance(value.get('revision'), int):
                raise RuntimeError('The updated app settings could not be read back')
        before = ledger['dock']
        after = self.request('/dock', timeout=40)
        for key in ('fixTizenTube', 'homeShortcut'):
            if key in before and after.get(key) != before[key]:
                raise RuntimeError('Launcher setting changed during update: ' + key)
        was_running = before.get('runtimeEnabled', before.get('enabled'))
        if after.get('runtimeEnabled', after.get('enabled')) != was_running:
            raise RuntimeError('Launcher runtime setting changed during update')
        if was_running:
            self.log('Restarting the enabled launcher with the updated DLL, preserving its settings…')
            self.request('/dock', {'action': 'refresh'}, timeout=120)
            after = self.request('/dock', timeout=40)
            if after.get('runtimeEnabled', after.get('enabled')) is not True or after.get('running') is not True:
                raise RuntimeError('Updated Vetro is installed, but the enabled launcher has not been confirmed running')
            if before.get('pid') and after.get('pid') == before['pid']:
                raise RuntimeError('The old launcher process is still running')
        home = after.get('home') or {}
        if home.get('launcher') and not home.get('device'):
            self.log('Home setup needed: open Launcher, choose Detect Home and enable Vetro, then press Home on the remote.')
        finished = self.worker(ledger['stage'], 'finish')
        if finished.get('verified') is not True or finished.get('revision') != revision:
            raise RuntimeError('TV updater did not confirm completion of the requested revision')
        ledger['complete'] = True
        self.write_ledger(ledger)
        self.log('VERIFIED: combined source revision, launcher DLL, both new settings, and root connection.')
        self.log('Developer Mode and Host PC IP were not changed. Startup and return selections were not changed.')
        # Only remove this attempt's generated files after verification and lock release.
        try:
            self.execute('rm -rf ' + shlex.quote(ledger['stage']))
        except (OSError, ValueError, RuntimeError):
            self.log('Verified install; temporary updater files could not be removed.')

    def run(self):
        revision = self.command(['git', 'rev-parse', 'HEAD']).strip()
        if revision != self.args.expected_commit or not REVISION.fullmatch(revision):
            raise RuntimeError('Checkout does not match the pinned combined commit')
        if self.command(['git', 'status', '--porcelain']).strip():
            raise RuntimeError('Checkout has local changes; they were not overwritten')
        self.log('Combined source: ' + revision)
        status = self.request('/status')
        if status.get('mode') != 'tv-integration' or status.get('agent', {}).get('connected') is not True:
            raise RuntimeError('Open the installed Vetro and wait for root to connect before updating')
        if self.ledger_file.exists():
            ledger = json.loads(self.ledger_file.read_text())
            if ledger.get('sent') and not ledger.get('complete'):
                if ledger.get('revision') != revision:
                    raise RuntimeError('An earlier Vetro update is unresolved; inspect the previous report before starting another build')
                self.log('Resuming verification of the existing attempt; no duplicate install.')
                return self.verify(ledger)
        if status.get('app', {}).get('sourceRevision') == revision and status.get('app', {}).get('sourceDirty') is False:
            self.log('This exact combined build is already running. No reinstall was submitted.')
            return
        dock = self.request('/dock', timeout=40)
        if not isinstance(dock.get('enabled'), bool):
            raise RuntimeError('Current launcher state could not be read')
        stage = self.stage_helper()
        probe = self.worker(stage, 'probe')
        if probe.get('uid') != 0 or probe.get('updateLocked'):
            raise RuntimeError('Root preflight failed or another update is still pending')
        self.redactions.append(probe['duid'])
        self.log('TV identity and loopback SDB verified (' + str(len(probe['duid'])) + '-character DUID).')
        native_hash = digest((self.root / 'app/native/dock/tvlauncher-dotnet.dll').read_bytes())
        output, metadata = self.sign(probe['duid'], revision, native_hash)
        if metadata['authorFingerprint'] != probe['authorFingerprint']:
            raise RuntimeError('Cached signing identity differs from installed Vetro. No app was removed or installed.')
        self.log('Signing identity, TV certificate coverage, package identity, and source revision verified.')
        self.upload(stage, 'vetro.wgt', output.read_bytes())
        job = dict(metadata, revision=revision, previousRevision=probe.get('sourceRevision'),
                   launcherSha256=native_hash, duidFingerprint=digest(probe['duid'].lower().encode()))
        self.upload(stage, 'job.json', (json.dumps(job) + '\n').encode())
        ledger = {'revision': revision, 'stage': stage, 'launcherSha256': native_hash,
                  'dock': {k: dock[k] for k in ('enabled', 'runtimeEnabled', 'fixTizenTube', 'homeShortcut', 'pid') if k in dock},
                  'sent': True, 'complete': False}
        self.write_ledger(ledger)
        self.sent = True
        self.log('Starting one detached update through the TV’s loopback SDB. The dashboard may disconnect temporarily.')
        command = launch_command('/usr/bin/dotnet', stage)
        try:
            self.execute(command)
        except (OSError, ValueError, RuntimeError):
            self.log('Launch acknowledgement was lost; checking the outcome without sending another install.')
        self.verify(ledger)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tv', required=True, type=lambda x: str(ipaddress.IPv4Address(x)))
    parser.add_argument('--port', type=int, default=8099)
    parser.add_argument('--expected-commit', required=True)
    parser.add_argument('--project-root', required=True)
    parser.add_argument('--installer')
    parser.add_argument('--report-host')
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535 or not REVISION.fullmatch(args.expected_commit):
        parser.error('Invalid port or expected commit')
    installer = Installer(args)
    result = 0
    try:
        installer.run()
    except (Exception, KeyboardInterrupt) as error:
        installer.log('STOPPED: ' + str(error))
        installer.log('No automatic reinstall will be attempted.' if installer.sent else 'No Vetro install was submitted.')
        result = 1
    finally:
        installer.log('Report: ' + str(installer.report))
        if args.report_host:
            installer.log('Copy the report from your Mac with:')
            installer.log('rsync -P ' + shlex.quote(args.report_host + ':' + str(installer.report)) + ' ~/Downloads/')
        installer.logfile.close()
    return result


if __name__ == '__main__':
    sys.exit(main())
