#!/usr/bin/env python3
"""Update three existing TV apps from pinned, checksum-verified CI packages.

Requires the saved Apps2Samsung CLI and Partner certificate. Reads installed
configuration through owner-paired Vetro before installing through its SDB
access or TV-Store's relay. Package data is retained; removal and certificate creation are not
requested. A saved install attempt is verified, never automatically repeated.
"""
import argparse
import base64
import datetime
import fcntl
import hashlib
import io
import ipaddress
import json
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import shutil
import stat
import subprocess
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

from vetro_owner import OwnerClient, NoRedirect

CLI_VERSION = '3.2.0-beta+48a04324a1981b0712690729b2f3d58755db8395'
SUITE = 'home-suite-20261108-r1'
# Clients first: their preparation and verification need the running Vetro.
APPS = [
    dict(name='Glass Home', key='glass', repo='pponce/glass-home-samsung-tv',
         revision='06621f448c956ca582abf1f5fc0b2aab6cec1ae4', run=42509712172,
         artifact=13628544795, digest='a79c477987fddfbff102d9b6187740fa4da645ac05ffaac5ad0bf7884e1210f5',
         package='GlassHome1', app='GlassHome1.GlassHome', service='GlassHome1.Photos',
         preserve=['js/config.js', 'js/local-key.js'],
         required=['js/vetro-stock.js', 'service/vetro.js', 'service/server.js']),
    dict(name='Garage Home', key='garage', repo='pponce/garage-home',
         revision='66f6a378c60cc94dcbb1fc3c3a19fd7c4bcbdbc3', run=42508972819,
         artifact=13628697593, digest='287c7112bee6727eaebbd38d04d81a04ab515bf00a501d255612fbfad45f8073',
         package='GarageHome', app='GarageHome.launcher', service='GarageHome.Controls',
         preserve=['garage-config.js', 'local-key.js'],
         required=['service/vetro-stock.js', 'vetro-controls.js', 'tv-sources.js']),
    dict(name='Vetro', key='vetro', repo='pponce/vetro',
         revision='eb2227342f66cb9a0eb9a855c62fe2f105619793', run=42508536173,
         artifact=13627979773, digest='ad21576148c40e1f2ecb48e7b9959317348d242b5bdf2d91433321f21a0066ba',
         package='vetrotvapp', app='vetrotvapp.app', service='vetrotvapp.svc', preserve=[],
         required=['service/main.js', 'service/root-agent.js', 'service/home-double-press.js',
                   'service/plugin-launcher.js', 'payload/SamsungTvRootAgent.dll',
                   'native/TvState.dll', 'native/dock/tvlauncher-dotnet.dll'])
]
LIMIT = 32 * 1024 * 1024


class Stop(RuntimeError):
    pass


class HttpsRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urllib.parse.urlsplit(newurl).scheme != 'https':
            raise Stop('Download redirected outside HTTPS.')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value):
    temporary = path.with_suffix('.tmp')
    with temporary.open('w') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def read_url(url, limit=LIMIT, timeout=45):
    handlers = [urllib.request.ProxyHandler({}), HttpsRedirect() if url.startswith('https:') else NoRedirect()]
    request = urllib.request.Request(url, headers={'User-Agent': 'home-suite-updater/1'})
    with urllib.request.build_opener(*handlers).open(request, timeout=timeout) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise Stop('Response exceeded the download limit.')
    return data


def json_url(url):
    return json.loads(read_url(url, 4 * 1024 * 1024))


def archive_files(data):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        infos = archive.infolist()
        names = [i.filename for i in infos]
        if len(names) != len(set(names)) or sum(i.file_size for i in infos) > 64 * 1024 * 1024:
            raise Stop('Duplicate entries or oversized ZIP contents.')
        for info in infos:
            path = PurePosixPath(info.filename)
            if (path.is_absolute() or '..' in path.parts or '\\' in info.filename
                    or any(ord(c) < 32 or ord(c) == 127 for c in info.filename)
                    or stat.S_ISLNK(info.external_attr >> 16)):
                raise Stop('Unsafe ZIP entry.')
        return {i.filename: archive.read(i) for i in infos if not i.is_dir()}


def validate_payload(spec, contents):
    required = ['config.xml', 'index.html'] + spec['required'] + spec['preserve']
    if not all(name in contents for name in required):
        raise Stop(spec['name'] + ': incomplete package.')
    config = ET.fromstring(contents['config.xml'])
    app = config.find('{http://tizen.org/ns/widgets}application')
    if app is None or app.get('id') != spec['app'] or app.get('package') != spec['package']:
        raise Stop(spec['name'] + ': package identity does not match the installed app.')
    if spec['key'] == 'vetro':
        info = contents.get('service/build-info.js', b'')
        if spec['revision'].encode() not in info or b'0.5.0' not in info:
            raise Stop('Vetro package build information does not match the pinned revision.')


def author_fingerprint(signature):
    node = ET.fromstring(signature).find('.//{http://www.w3.org/2000/09/xmldsig#}X509Certificate')
    if node is None or not node.text:
        raise Stop('Installed author signature has no certificate.')
    return sha(base64.b64decode(''.join(node.text.split()), validate=True))


def partner_profile(result):
    duid = result.get('tvDuid')
    if result.get('ok') is not True or not isinstance(duid, str) or not re.fullmatch(r'[A-Za-z0-9]{10,64}', duid):
        raise Stop('The TV identity could not be verified through the relay.')
    profiles = [p for p in result.get('profiles', []) if p.get('level') == 'Partner'
                and p.get('exists') is True and p.get('usable') is True
                and duid.lower() in [str(d).lower() for d in p.get('duids', [])]]
    if len(profiles) != 1 or not profiles[0].get('path'):
        raise Stop('No unique existing usable Partner certificate covers this TV.')
    return duid, Path(profiles[0]['path'])


def install_command(cli, package, spec, args, duid):
    # --allow-remove, --remove-first, --new-id and --force-login are deliberately absent.
    return [str(cli), 'install', str(package), '--partner', '--duids', duid,
            '--own-id', '--tv', args.tv, '--local-ip', args.local_ip,
            '--yes', '--json', '--no-browser', '--launch']


class Updater:
    def __init__(self, args):
        self.args = args
        self.project = Path(args.project_root).expanduser().resolve()
        if not self.project.is_dir():
            raise Stop('The existing samsung-tv-tools folder was not found.')
        self.work = self.project / 'vetro-install' / SUITE
        self.work.mkdir(parents=True, exist_ok=True)
        self.lock = (self.work / 'update.lock').open('a')
        fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        self.report_path = self.work / ('report-' + stamp + '.json')
        self.report = {'suite': SUITE, 'started': stamp, 'apps': {}, 'complete': False}
        self.state_path = self.work / ('state-' + sha(args.tv.encode())[:12] + '.json')
        self.state = json.loads(self.state_path.read_text()) if self.state_path.exists() else {'suite': SUITE, 'apps': {}}
        if self.state.get('suite') != SUITE:
            raise Stop('Unexpected update state; left unchanged.')
        self.owner = OwnerClient('http://' + args.tv + ':8099', self.project / 'vetro-install/combined-updates')
        self.cli = None

    def save(self):
        write_json(self.state_path, self.state)

    def run(self, command, timeout=90, data=None):
        try:
            result = subprocess.run([str(x) for x in command], input=data, capture_output=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            raise Stop(Path(command[0]).name + ' timed out; output withheld.') from None
        if result.returncode:
            raise Stop(Path(command[0]).name + ' failed (code ' + str(result.returncode) + '); output withheld.')
        return result.stdout

    def remote(self, command):
        value = self.owner.request('/exec', {'cmd': command}, timeout=45)
        if value.get('exit_code') != 0 or value.get('timed_out'):
            raise Stop('TV file check or app restart failed; command output withheld.')
        return str(value.get('output', '')).strip().replace('\\n', '\n').replace('\\r', '\r')

    def script(self, source):
        return self.remote('printf %s ' + base64.b64encode(source.encode()).decode() + ' | base64 -d | sh')

    def root(self, spec):
        roots = ['/opt/usr/apps/' + spec['package'] + '/res/wgt', '/usr/apps/' + spec['package'] + '/res/wgt']
        root = self.remote('for d in ' + ' '.join(roots) + '; do if [ -f "$d/config.xml" ]; then printf "%s" "$d"; break; fi; done')
        if root not in roots:
            raise Stop(spec['name'] + ' is not installed under its expected package ID.')
        return root

    def read_tv(self, path):
        value = self.remote('base64 ' + shlex.quote(path))
        return base64.b64decode(''.join(value.split()), validate=True)

    def idle_relay(self):
        # Stock Vetro can own 26201 itself. Its shared SDB connection is a valid
        # installation transport even when TV-Store cannot bind that same port.
        for attempt in range(13):
            try:
                access = self.owner.request('/sdb-access', timeout=5)
                if not isinstance(access, dict):
                    access = {}
                self.report['vetroSdbAccess'] = {k: access.get(k) for k in ('available', 'enabled', 'active', 'port')}
            except Exception as error:
                access = {}
                self.report['vetroSdbAccess'] = {'readError': type(error).__name__}
            if (access.get('available') is True and access.get('enabled') is True
                    and access.get('active') is True and access.get('port') == 26201):
                self.report['transport'] = 'vetro-sdb'
                print('CONNECTION: Vetro SDB access is ready on port 26201.', flush=True)
                return
            try:
                response = json_url('http://' + self.args.tv + ':8077/relay')
                relay = response.get('relay', response) if isinstance(response, dict) else {}
                if not isinstance(relay, dict):
                    relay = {}
                self.report['tvStoreRelay'] = {k: relay.get(k) for k in ('enabled', 'listening', 'port', 'sessions', 'error')}
            except Exception as error:
                relay = {}
                self.report['tvStoreRelay'] = {'readError': type(error).__name__}
            if access.get('available') is True and access.get('active') is not True:
                raise Stop('In the Vetro dashboard, open Quick settings and enable "Allow SDB from the local network", '
                           'then confirm "Enable LAN access". Keep Host PC IP at 127.0.0.1 and rerun this block.')
            if (relay.get('enabled') is not True or relay.get('listening') is not True
                    or relay.get('error') or relay.get('port') != 26201):
                raise Stop('No ready SDB connection on port 26201. The report includes Vetro and TV-Store connection states.')
            if type(relay.get('sessions')) is int and relay['sessions'] == 0:
                self.report['transport'] = 'tv-store-relay'
                print('CONNECTION: TV-Store relay is ready on port 26201.', flush=True)
                return
            if attempt < 12:
                time.sleep(1)
        raise Stop('Close other TV installers and debug windows: a relay session is still open.')

    def check_profile(self):
        current = {name: sha((self.profile / name).read_bytes()) for name in self.profile_hashes}
        if current != self.profile_hashes:
            raise Stop('The existing signing profile changed; no further installation was submitted.')

    def preflight(self):
        self.report['stage'] = 'owner-and-root-check'
        print('Checking Vetro owner access and root connection...', flush=True)
        if not self.owner.request('/exec').get('connected'):
            raise Stop('Vetro root is not connected. Open Vetro and let its checks finish.')
        print('VERIFIED: owner access and Vetro root connection.', flush=True)
        if not shutil.which('openssl'):
            raise Stop('OpenSSL is required to compare the installed signing identities.')
        locator = self.project / 'vetro-install/bin/apps2samsung-beta.path'
        self.cli = Path(locator.read_text().strip()).expanduser()
        if not self.cli.is_file() or not os.access(self.cli, os.X_OK):
            raise Stop('The saved Apps2Samsung CLI was not found.')
        if CLI_VERSION not in self.run([self.cli, '--version'], timeout=20).decode():
            raise Stop('The saved Apps2Samsung CLI is not the reviewed version.')
        self.report['stage'] = 'sdb-connection-check'
        self.idle_relay()
        self.report['stage'] = 'certificate-check'
        cert = json.loads(self.run([self.cli, 'cert', '--partner', '--tv', self.args.tv,
                                    '--local-ip', self.args.local_ip, '--json']))
        self.duid, self.profile = partner_profile(cert)
        self.profile_hashes = {name: sha((self.profile / name).read_bytes())
                               for name in ('author.p12', 'distributor.p12', 'password.txt')}
        certificate_command = ['openssl', 'pkcs12', '-in', self.profile / 'author.p12',
                               '-passin', 'file:' + str(self.profile / 'password.txt'), '-clcerts', '-nokeys']
        try:
            pem = self.run(certificate_command)
        except Stop:
            pem = self.run(certificate_command + ['-legacy'])
        self.fingerprint = sha(self.run(['openssl', 'x509', '-outform', 'DER'], data=pem))
        self.hash_command = None
        for command in ('sha256sum', 'openssl dgst -sha256'):
            try:
                if sha(b'') in self.remote(command + ' /dev/null'):
                    self.hash_command = command
                    break
            except Exception:
                pass
        if not self.hash_command:
            raise Stop('The TV has no working SHA-256 checker.')
        for spec in APPS:
            root = self.root(spec)
            if author_fingerprint(self.read_tv(root + '/author-signature.xml')) != self.fingerprint:
                raise Stop(spec['name'] + ': the saved certificate differs from its installed author identity.')
        print('VERIFIED: all three installed apps match the existing Partner author certificate.', flush=True)

    def download(self, spec):
        api = 'https://api.github.com/repos/' + spec['repo']
        run = json_url(api + '/actions/runs/' + str(spec['run']))
        if run.get('head_sha') != spec['revision'] or run.get('status') != 'completed' or run.get('conclusion') != 'success':
            raise Stop(spec['name'] + ': the pinned CI run is not successful.')
        path = self.work / (spec['key'] + '-artifact.zip')
        if path.exists():
            data = path.read_bytes()
        else:
            artifact = json_url(api + '/actions/artifacts/' + str(spec['artifact']))
            if (artifact.get('expired') is not False or artifact.get('digest') != 'sha256:' + spec['digest']
                    or artifact.get('workflow_run', {}).get('head_sha') != spec['revision']):
                raise Stop(spec['name'] + ': the pinned CI artifact is unavailable or changed.')
            print('Downloading the tested ' + spec['name'] + ' package...', flush=True)
            data = read_url('https://nightly.link/' + spec['repo'] + '/actions/artifacts/' + str(spec['artifact']) + '.zip', timeout=120)
        if sha(data) != spec['digest']:
            raise Stop(spec['name'] + ': artifact checksum mismatch. Nothing was installed.')
        if not path.exists():
            path.write_bytes(data)
        outer = archive_files(data)
        wgts = [name for name in outer if name.endswith('.wgt')]
        if len(wgts) != 1:
            raise Stop('Expected exactly one widget in the CI artifact.')
        contents = archive_files(outer[wgts[0]])
        contents = {name: value for name, value in contents.items()
                    if not re.fullmatch(r'(author-signature|signature\d+)\.xml', name)}
        validate_payload(spec, contents)
        if spec['key'] == 'vetro':
            if outer.get('SOURCE_COMMIT.txt', b'').decode().strip() != spec['revision']:
                raise Stop('Vetro source manifest mismatch.')
            if outer.get('LAUNCHER_SHA256.txt', b'').decode().strip() != sha(contents['native/dock/tvlauncher-dotnet.dll']):
                raise Stop('Vetro native launcher checksum mismatch.')
        return contents

    def prepare(self, spec):
        contents = self.download(spec)
        root = self.root(spec)
        for name in spec['preserve']:
            value = self.read_tv(root + '/' + name)
            if not value or len(value) > 128 * 1024:
                raise Stop(spec['name'] + ': installed settings file is missing or too large.')
            marker = {'js/config.js': b'GH.config', 'js/local-key.js': b'GH_LOCAL_KEY',
                      'garage-config.js': b'GARAGE_CONFIG', 'local-key.js': b'GARAGE_LOCAL_KEY'}[name]
            if marker not in value:
                raise Stop(spec['name'] + ': installed settings file is not recognized.')
            contents[name] = value
        path = self.work / (spec['key'] + '-prepared.wgt')
        with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as archive:
            for name, value in sorted(contents.items()):
                archive.writestr(name, value)
        path.chmod(0o600)
        record = {'revision': spec['revision'], 'submitted': False, 'verified': False,
                  'hashes': {name: sha(value) for name, value in contents.items()},
                  'packageSha256': sha(path.read_bytes())}
        self.state['apps'][spec['key']] = record
        self.save()
        print('PREPARED: ' + spec['name'] + ' (' + spec['revision'][:12] + ').', flush=True)
        return path

    def verify(self, spec, record, attempts=12):
        hashes = record.get('hashes')
        if (record.get('revision') != spec['revision'] or not isinstance(hashes, dict)
                or not all(name in hashes for name in ['config.xml'] + spec['required'] + spec['preserve'])
                or not all(name and '..' not in PurePosixPath(name).parts and '\\' not in name
                           and all(ord(c) >= 32 and ord(c) != 127 for c in name)
                           and not name.startswith('/') and isinstance(value, str) and re.fullmatch(r'[a-f0-9]{64}', value)
                           for name, value in hashes.items())):
            raise Stop('Invalid saved package verification record.')
        for attempt in range(attempts):
            try:
                root = self.root(spec)
                names = sorted(hashes)
                # Keep each root-agent command below its response and command limits.
                matches = True
                for offset in range(0, len(names), 25):
                    batch = names[offset:offset + 25]
                    source = '\n'.join(self.hash_command + ' ' + shlex.quote(root + '/' + name) +
                                       ' 2>/dev/null || printf "MISSING\\n"' for name in batch) + '\n:'
                    output = self.script(source)
                    actual = re.findall(r'\b[0-9a-fA-F]{64}\b', output)
                    if 'MISSING' in output or [s.lower() for s in actual] != [hashes[name] for name in batch]:
                        matches = False
                        break
                if matches and author_fingerprint(self.read_tv(root + '/author-signature.xml')) == self.fingerprint:
                    record['verified'] = True
                    self.save()
                    return True
            except Exception:
                pass
            if attempt + 1 < attempts:
                time.sleep(2)
        return False

    def refresh_runtime(self, spec, record):
        if spec['key'] == 'vetro':
            try:
                status = self.owner.request('/status', timeout=5)
            except Exception:
                status = {}
            if (status.get('app', {}).get('version') == '0.5.0'
                    and status.get('app', {}).get('sourceRevision') != spec['revision']
                    and not record.get('restartSubmitted')):
                print('Restarting Vetro to load the installed revision...', flush=True)
                record['restartSubmitted'] = True
                self.save()
                try:
                    self.script('/usr/bin/app_launcher -k vetrotvapp.app >/dev/null 2>&1\n'
                                '/usr/bin/app_launcher -k vetrotvapp.svc')
                except Exception:
                    pass  # Stopping the service can end its own response.
                self.idle_relay()
                try:
                    result = json.loads(self.run([self.cli, 'launch', spec['app'], '--tv', self.args.tv,
                                                  '--local-ip', self.args.local_ip, '--json'], timeout=60))
                    record['restartLaunchConfirmed'] = result.get('ok') is True
                except Exception:
                    record['restartLaunchConfirmed'] = False
                self.save()
            # The CLI launch starts the newly installed screen. Allow root reconnection.
            for attempt in range(40):
                try:
                    status = self.owner.request('/status', timeout=3)
                    if status.get('app', {}).get('sourceRevision') == spec['revision'] and status.get('agent', {}).get('connected'):
                        return self.refresh_native(record)
                except Exception:
                    pass
                if attempt in (9, 24):
                    print('Waiting for the updated Vetro service and root connection...', flush=True)
                time.sleep(2)
            return False
        self.script('/usr/bin/app_launcher -k ' + spec['app'] + ' >/dev/null 2>&1\n'
                    '/usr/bin/app_launcher -k ' + spec['service'] + ' >/dev/null 2>&1\n'
                    '/usr/bin/app_launcher -s ' + spec['app'])
        for attempt in range(20):
            try:
                if spec['key'] == 'glass':
                    health = json_url('http://' + self.args.tv + ':8090/health')
                    if health.get('vetroApps') == 4 and health.get('vetroStock') == 1:
                        return True
                else:
                    root = self.root(spec)
                    health = json.loads(self.script("key=$(grep -oE '[a-f0-9]{64}' " + shlex.quote(root + '/local-key.js') + ")\n"
                                                   'curl -fsS --max-time 3 -H "X-Garage-Key: $key" http://127.0.0.1:8092/health'))
                    if health.get('ok') is True and health.get('protocol') == 1:
                        return True
            except Exception:
                pass
            time.sleep(1)
        return False

    def refresh_native(self, record):
        dock = self.owner.request('/dock', timeout=30)
        if not dock.get('enabled') and not dock.get('customApp'):
            record['nativeRefresh'] = 'not-active'
            return True
        if record.get('nativeRefreshSubmitted'):
            return record.get('nativeRefreshVerified') is True
        record['nativeRefreshSubmitted'] = True
        self.save()
        print('Reloading the active Home launcher with the updated native binary...', flush=True)
        after = self.owner.request('/dock', {'action': 'refresh'}, timeout=60)
        record['nativeRefreshVerified'] = (after.get('running') is True and
                                          after.get('enabled') == dock.get('enabled') and
                                          after.get('customApp') == dock.get('customApp'))
        self.save()
        return record['nativeRefreshVerified']

    def install(self, spec, path):
        self.report['stage'] = 'install-' + spec['key']
        record = self.state['apps'][spec['key']]
        if record.get('submitted'):
            raise Stop('Refusing to repeat an existing installation attempt.')
        if sha(path.read_bytes()) != record['packageSha256']:
            raise Stop('Prepared widget changed before installation.')
        self.check_profile()
        self.idle_relay()
        record['submitted'] = True
        self.save()  # Durable before the installer can touch the TV.
        print('Installing ' + spec['name'] + ' once; this may take a few minutes...', flush=True)
        if spec['key'] == 'vetro':
            print('Vetro may close while its service updates. If it closes, reopen it once with the remote and let its checks finish.', flush=True)
        try:
            result = json.loads(self.run(install_command(self.cli, path, spec, self.args, self.duid), timeout=300))
            record['cliConfirmed'] = (result.get('ok') is True and result.get('appId') == spec['app']
                                      and result.get('packageId') == spec['package'])
            record['launchConfirmed'] = result.get('launched') is True
        except (Exception, KeyboardInterrupt) as error:
            record['cliConfirmed'] = False
            record['cliErrorType'] = type(error).__name__
            print('The installer reply is unresolved. Checking installed files without repeating the install.', flush=True)
        self.save()
        self.check_profile()
        if not self.verify(spec, record, attempts=35 if spec['key'] == 'vetro' else 12):
            raise Stop(spec['name'] + ': installation is not yet verified. Rerun only to check it; no second install will be sent.')
        print('VERIFIED: every packaged ' + spec['name'] + ' file and author identity match.', flush=True)

    def execute(self):
        self.preflight()
        prepared = {}
        for spec in APPS:
            record = self.state['apps'].get(spec['key'], {})
            if record.get('submitted'):
                print('Checking the saved ' + spec['name'] + ' attempt; no reinstall...', flush=True)
                if not self.verify(spec, record):
                    raise Stop(spec['name'] + ': the saved attempt is still unverified. Return this report.')
            else:
                prepared[spec['key']] = self.prepare(spec)
        if self.args.check_only:
            self.report['preparedOnly'] = True
            print('PREPARED: all packages checked; no installations submitted.', flush=True)
            return
        print('All three packages and signing identities are ready.', flush=True)
        for spec in APPS:
            record = self.state['apps'][spec['key']]
            if not record.get('submitted'):
                self.install(spec, prepared[spec['key']])
            running = self.refresh_runtime(spec, record)
            record['runtimeVerified'] = running
            self.save()
            self.report['apps'][spec['name']] = {
                'revision': spec['revision'], 'installedFilesVerified': record.get('verified', False),
                'runtimeVerified': running}
            if not running:
                raise Stop(spec['name'] + ' files are installed, but its updated runtime is not confirmed. Return this report before further changes.')
            print('RUNNING: ' + spec['name'] + '.', flush=True)
        self.report['complete'] = True
        print('DONE: Glass Home, Garage Home and Vetro are updated and their services are running.', flush=True)
        print('Test the Home actions, Glass app list, and Garage Sources/controls with the remote.', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project-root', default=str(Path.home() / 'devProjects/samsung-tv-tools'))
    parser.add_argument('--tv', required=True, type=lambda x: str(ipaddress.IPv4Address(x)))
    parser.add_argument('--local-ip', required=True, type=lambda x: str(ipaddress.IPv4Address(x)))
    parser.add_argument('--report-host', required=True, help='SSH user@host for the report copy command')
    parser.add_argument('--check-only', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    updater = None
    result = 1
    print('=== Vetro + Glass Home + Garage Home update START ===', flush=True)
    try:
        updater = Updater(args)
        updater.execute()
        result = 0
    except (Exception, KeyboardInterrupt) as error:
        # Remote/CLI output, certificate paths, DUIDs and local app keys stay out of reports.
        detail = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        print('STOPPED: ' + detail, flush=True)
        if updater:
            updater.report['error'] = detail
    finally:
        if updater:
            updater.report['state'] = {key: {k: v for k, v in record.items() if k not in ('hashes',)}
                                       for key, record in updater.state['apps'].items()}
            try:
                write_json(updater.report_path, updater.report)
                print('Report: ' + str(updater.report_path))
                print('Copy it from a terminal on your Mac:')
                print('rsync -P ' + shlex.quote(args.report_host + ':' + str(updater.report_path)) + ' ~/Downloads/')
            except Exception:
                result = 1
                print('The report could not be written. Retain this terminal output.', flush=True)
            finally:
                updater.lock.close()
        print('=== Vetro + Glass Home + Garage Home update END: ' + ('OK' if result == 0 else 'STOPPED') + ' ===', flush=True)
    return result


if __name__ == '__main__':
    raise SystemExit(main())
