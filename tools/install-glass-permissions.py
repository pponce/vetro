#!/usr/bin/env python3
import base64, datetime, hashlib, http.server, json, os, re, secrets
import shlex, shutil, subprocess, sys, threading, time, urllib.request, zipfile
from pathlib import Path

import argparse, ipaddress
from vetro_owner import OwnerClient
parser = argparse.ArgumentParser(description='Update the existing Glass Home with scoped Vetro access, preserving its settings.')
parser.add_argument('--tv', required=True, type=lambda v:str(ipaddress.IPv4Address(v)))
parser.add_argument('--mint', required=True, type=lambda v:str(ipaddress.IPv4Address(v)))
parser.add_argument('--project-root', required=True)
parser.add_argument('--expected-commit', required=True)
parser.add_argument('--report-host')
args = parser.parse_args()
if not re.fullmatch(r'[a-f0-9]{40}', args.expected_commit):
    parser.error('Use the full pinned Glass Home commit')
PROJECT = Path(args.project_root).expanduser().resolve()
BASE = PROJECT / 'launcher-playground'
REPO = BASE / 'sources/glass-home-permissions'
BRANCH = 'combined/vetro-permissions'
REVISION = args.expected_commit
VERIFY_FILES = (
    'index.html', 'css/tv.css', 'js/data.js', 'js/platform.js', 'js/home.js',
    'js/vetro-apps.js', 'js/vetro-access-client.js', 'js/vetro-permissions.js',
    'js/vendor/sha256.js', 'js/vendor/sha256.LICENSE.txt', 'service/server.js',
    'service/vetro.js', 'service/vetro-launch.js', 'service/vetro-replies.js',
    'service/dock-prefs.js', 'js/config.js', 'js/local-key.js'
)
TV, MINT = args.tv, args.mint
API = 'http://' + TV + ':8099'
STAMP = datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
REPORT = BASE / 'logs' / ('glass-home-permissions-' + STAMP + '.txt')
ENV = dict(os.environ, TMPDIR=str(BASE / 'tmp'))
HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}))
os.umask(0o077)

def say(message):
    print(message, flush=True)
    if REPORT.parent.is_dir():
        with REPORT.open('a') as f:
            f.write(str(message) + '\n')

def run(args, cwd=None, timeout=240):
    p = subprocess.run(args, cwd=cwd or BASE, env=ENV, capture_output=True, text=True, timeout=timeout)
    if p.returncode:
        raise RuntimeError(Path(args[0]).name + ' failed. ' + (p.stderr or p.stdout)[-1200:])
    return p.stdout.strip()

OWNER = OwnerClient(API, PROJECT / 'vetro-install/combined-updates', say)
LEDGER = BASE / 'logs' / ('glass-permissions-state-' + hashlib.sha256(TV.encode()).hexdigest()[:12] + '.json')

def ledger_write(value):
    temp = LEDGER.with_suffix('.tmp')
    temp.write_text(json.dumps(value, indent=2) + '\n')
    temp.chmod(0o600)
    temp.replace(LEDGER)

def api(route, data=None, timeout=45):
    result = OWNER.request(route, data, timeout)
    if result.get('ok') is False:
        raise RuntimeError('Vetro request failed: ' + str(result.get('error') or result.get('stderr') or route)[:500])
    return result

def remote(cmd):
    r = api('/exec', {'cmd': cmd})
    if r.get('exit_code') != 0 or r.get('timed_out'):
        raise RuntimeError('TV command failed: ' + str(r.get('stderr') or 'no details')[:500])
    return r.get('output', '').strip()

def read_tv(file):
    data = remote('base64 ' + shlex.quote(file)).replace('\\n', '\n').replace('\\r', '\r')
    return base64.b64decode(''.join(data.split()), validate=True)

def remote_script(script):
    encoded = base64.b64encode(script.encode()).decode()
    return remote('printf %s ' + encoded + ' | base64 -d | sh')

def restart_glass():
    say('Reopening Glass Home and its background service...')
    remote_script('/usr/bin/app_launcher -k GlassHome1.GlassHome >/dev/null 2>&1\n'
                  '/usr/bin/app_launcher -k GlassHome1.Photos >/dev/null 2>&1\n'
                  '/usr/bin/app_launcher -s GlassHome1.GlassHome')
    for attempt in range(30):
        try:
            with HTTP.open('http://' + TV + ':8090/health', timeout=2) as response:
                health = json.loads(response.read(4096))
            if health.get('name') == 'Glass Home' and health.get('vetroApps') == 3 and health.get('dockPreferences') == 1 and health.get('vetroLaunch') == 1 and health.get('vetroPermissions') == 2:
                say('RUNNING: Vetro app reader 3, coordinated launch 1 and scoped access integration 2 verified.')
                say('PERSISTENCE READY: confirmed app-selection and hiding storage revision 1 verified.')
                return
        except Exception:
            pass
        if attempt in (9, 19):
            say('Waiting for the updated Glass Home service...')
        time.sleep(1)
    raise RuntimeError('Updated files are installed, but reader 3, preference storage 1, coordinated launch 1 and scoped access integration 2 are not running. Keep the report; do not reinstall automatically.')

def verify_vetro(root):
    try:
        access = api('/app-access')
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
    else:
        say('SCOPED ACCESS: use + > Connect to Vetro, approve List TV apps and Open TV apps in Vetro, then Refresh apps. TV-side approval and launch are still to be tested.')
        return
    say('Checking the app list from the updated TV service...')
    work = '/home/owner/share/tmp/sdk_tools/glass-read-' + secrets.token_hex(8)
    script = r'''key=$(sed -n "s/.*GH_LOCAL_KEY[[:space:]]*=[[:space:]]*['\"]\([A-Za-z0-9_-]*\)['\"].*/\1/p" KEY_FILE | head -n 1)
if [ "${#key}" -ge 20 ]; then
    curl -sS --noproxy '*' --connect-timeout 3 --max-time 29 -H "X-GH-Key: $key" -o body -w '%{http_code}' 'http://127.0.0.1:8090/local/vetro/apps?refresh=1' > status 2> curl-error
    printf '%s' "$?" > result
else
    printf 'missing-local-key' > result
fi
touch done
'''.replace('KEY_FILE', shlex.quote(root + '/js/local-key.js'))
    inline = 'printf %s ' + base64.b64encode(script.encode()).decode() + ' | base64 -d | sh'
    started = remote_script('umask 077\nmkdir -p ' + work + ' && cd ' + work + ' && {\nnohup sh -c ' +
                            shlex.quote(inline) + ' </dev/null > worker-log 2>&1 &\nprintf STARTED\n}')
    if started != 'STARTED':
        raise RuntimeError('The TV app-list check could not start.')
    deadline, progress = time.monotonic() + 45, time.monotonic() + 10
    while time.monotonic() < deadline:
        time.sleep(1)
        output = remote_script('cd ' + work + '\nif [ -f done ]; then\nprintf "DONE:COLON:"\ncat result\nprintf ":COLON:"\ncat status 2>/dev/null\nprintf ":COLON:"\nbase64 body 2>/dev/null\nelse\nprintf WAIT\nfi\n:')
        if output.startswith('DONE:COLON:'):
            _, code, status, raw = output.split(':COLON:', 3)
            say('Glass Vetro request: HTTP ' + (status or 'none') + '; curl ' + code)
            raw = ''.join(raw.replace('\\n', '\n').replace('\\r', '\r').split())
            try:
                result = json.loads(base64.b64decode(raw)) if raw else {}
            except ValueError:
                result = {}
            if not isinstance(result, dict):
                result = {}
            if isinstance(result.get('error'), dict):
                say('VETRO ERROR: ' + json.dumps(result['error'], ensure_ascii=True))
            if result.get('address'):
                say('Vetro read address: ' + str(result['address']))
            apps = result.get('apps')
            if status == '200' and result.get('available') is True and isinstance(apps, list) and apps:
                say('APP LIST OK: Glass Home can read ' + str(len(apps)) + ' Vetro apps.')
            else:
                say('APP LIST FAILED: the update is installed; send this report with the error above.')
            remote_script('rm -f ' + ' '.join(work + '/' + p for p in ('body', 'status', 'result', 'curl-error', 'worker-log', 'done')) + '\nrmdir ' + work)
            return
        if time.monotonic() >= progress:
            say('Waiting for the TV app-list response...')
            progress = time.monotonic() + 10
    say('Probe files retained at: ' + work)
    raise RuntimeError('The app-list check did not complete; the signed update is already installed.')

def tv_hash(file, command):
    values = re.findall(r'\b[0-9a-fA-F]{64}\b', remote(command + ' ' + shlex.quote(file)))
    if len(values) != 1:
        raise RuntimeError('The TV did not return one SHA-256 checksum.')
    return values[0].lower()

def inventory():
    r = api('/apps?refresh=1')
    if r.get('registryError') or not isinstance(r.get('apps'), list):
        raise RuntimeError('Vetro cannot read the installed app registry.')
    return {a['appId']: a for a in r['apps'] if a.get('appId')}

def profile():
    cli = [p for p in (PROJECT / 'vetro-install/bin/v3.1.0').rglob('apps2samsung-cli*')
           if p.is_file() and os.access(p, os.X_OK) and p.suffix not in ('.zip', '.gz')]
    if len(cli) != 1:
        raise RuntimeError('Could not identify the existing Apps2Samsung v3.1.0 executable.')
    explicit = os.environ.get('SAMSUNG_PLAYGROUND_DATA_DIR') or os.environ.get('APPS2SAMSUNG_DATA_DIR')
    stores = [Path(explicit).expanduser()] if explicit else [Path(os.environ.get('XDG_CONFIG_HOME', str(Path.home() / '.config'))) / 'Apps2Samsung']
    if not explicit:
        for root, dirs, files in os.walk(PROJECT / 'vetro-install'):
            dirs[:] = [d for d in dirs if d not in ('.git', 'node_modules', 'cache', 'backup', 'backups')]
            if 'Certificate' in dirs:
                stores.append(Path(root))
                dirs.remove('Certificate')
    found = set()
    for store in dict.fromkeys(p.resolve() for p in stores if (p / 'Certificate').is_dir()):
        p = subprocess.run([str(cli[0]), 'cert', '--partner', '--data-dir', str(store), '--json'],
                           capture_output=True, text=True, env=ENV, timeout=60)
        if p.returncode:
            raise RuntimeError('Could not inspect the existing certificate store.')
        for item in json.loads(p.stdout).get('profiles', []):
            if item.get('level', '').lower() == 'partner' and item.get('exists') and item.get('usable') and item.get('path'):
                directory = Path(item['path'])
                if all((directory / name).is_file() for name in ('author.p12', 'distributor.p12', 'password.txt')):
                    found.add(directory)
    if len(found) != 1:
        raise RuntimeError('Expected one usable existing Partner certificate. No certificate was created.')
    return found.pop()

def main():
    if not PROJECT.is_dir():
        raise RuntimeError('Existing samsung-tv-tools folder was not found.')
    for folder in ('sources', 'packages', 'signed', 'logs', 'tmp'):
        (BASE / folder).mkdir(parents=True, exist_ok=True)
    say('Project: ' + str(BASE))
    say('Keep Developer Mode ON and Host PC IP at 127.0.0.1.')
    if any(shutil.which(x) is None for x in ('git', 'node')):
        raise RuntimeError('Git and Node.js must be installed.')
    if not api('/exec').get('connected'):
        raise RuntimeError('Vetro root agent is not connected. Turn on the TV and let Vetro finish starting.')
    if LEDGER.exists():
        previous = json.loads(LEDGER.read_text())
        if previous.get('sent') and not previous.get('complete') and previous.get('revision') != REVISION:
            raise RuntimeError('An earlier Glass Home update is unresolved. Inspect its report before starting another build.')
        if previous.get('sent') and previous.get('revision') == REVISION:
            say('Verifying the saved Glass Home attempt. No signing or installation will be submitted.')
            if previous.get('hashCommand') not in ('sha256sum', 'openssl dgst -sha256'):
                raise RuntimeError('Invalid saved hash command')
            root = previous['root']
            if root not in ('/opt/usr/apps/GlassHome1/res/wgt', '/usr/apps/GlassHome1/res/wgt'):
                raise RuntimeError('Invalid installed app path in the saved attempt')
            if not isinstance(previous.get('hashes'), dict) or not set(VERIFY_FILES).issubset(previous['hashes']):
                raise RuntimeError('The saved attempt does not cover every required Glass Home file. Keep the report; no second install was sent.')
            if not all(re.fullmatch(r'[A-Za-z0-9_./-]+', name) and '..' not in name.split('/') and
                       tv_hash(root + '/' + name, previous['hashCommand']) == checksum for name, checksum in previous['hashes'].items()):
                raise RuntimeError('The submitted update is not yet verified. Keep the report; no second install was sent.')
            restart_glass()
            previous['complete'] = True
            ledger_write(previous)
            verify_vetro(root)
            say('VERIFIED: the saved Glass Home update is installed and running.')
            return
    if 'GlassHome1.GlassHome' not in inventory():
        raise RuntimeError('The existing Glass Home installation was not found. This block updates it in place.')
    dock = api('/dock', timeout=60)
    if not dock.get('entries'):
        raise RuntimeError('Vetro has no Launcher app list. Open its Launcher page, let the apps load, then rerun.')
    helper = BASE / 'tools/sign-widget.cjs'
    dependencies = BASE / 'sources/garage-home-manual-125f15373a78/tools/signing'
    if not helper.is_file() or not (dependencies / 'node_modules/tizen').is_dir():
        raise RuntimeError('The existing launcher signing tools were not found. No TV update was requested.')
    cert = profile()
    say('Reusing the existing Partner certificate and signing tools.')
    if REPO.exists():
        if not (REPO / '.git').is_dir():
            raise RuntimeError('The source folder exists but is not a Git checkout; left unchanged.')
        origin = run(['git', 'remote', 'get-url', 'origin'], REPO)
        if origin not in ('git@github.com:pponce/glass-home-samsung-tv.git', 'https://github.com/pponce/glass-home-samsung-tv.git'):
            raise RuntimeError('The source folder has an unexpected Git remote; left unchanged.')
        if run(['git', 'status', '--porcelain'], REPO):
            raise RuntimeError('The Glass Home checkout has local edits; left unchanged.')
        if run(['git', 'branch', '--show-current'], REPO) != BRANCH:
            raise RuntimeError('The Glass Home checkout is on another branch; left unchanged.')
        run(['git', 'fetch', 'origin', BRANCH], REPO)
        run(['git', 'merge', '--ff-only', 'origin/' + BRANCH], REPO)
    else:
        say('Cloning your Glass Home feature branch using SSH...')
        run(['git', 'clone', '--single-branch', '--branch', BRANCH,
             'git@github.com:pponce/glass-home-samsung-tv.git', str(REPO)], BASE)
    if run(['git', 'rev-parse', 'HEAD'], REPO) != REVISION:
        raise RuntimeError('The branch has changed since this block was prepared. Get an updated block before installing.')
    say('Source revision: ' + REVISION)
    app_root = remote('for d in /opt/usr/apps/GlassHome1/res/wgt /usr/apps/GlassHome1/res/wgt; do if [ -f "$d/js/config.js" ] && [ -f "$d/js/local-key.js" ]; then printf "%s" "$d"; break; fi; done')
    if app_root not in ('/opt/usr/apps/GlassHome1/res/wgt', '/usr/apps/GlassHome1/res/wgt'):
        raise RuntimeError('Could not locate the installed Glass Home files. No TV update was requested.')
    key = read_tv(app_root + '/js/local-key.js')
    config = read_tv(app_root + '/js/config.js')
    if b'GH_LOCAL_KEY' not in key or b'GH.config' not in config:
        raise RuntimeError('The installed Glass Home configuration could not be verified.')
    # Preserve current settings and photo-service identity. The app detects
    # Vetro automatically; no configuration switch is required.
    parsed = subprocess.run(['node', '-e', "const m=require('./app/service/vetro.js');let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>console.log(JSON.stringify(m.appsFrom(JSON.parse(s),'GlassHome1'))));"],
                            input=json.dumps(dock), capture_output=True, text=True, cwd=REPO, env=ENV, timeout=30)
    if parsed.returncode:
        raise RuntimeError('The Vetro app list could not be validated.')
    apps = json.loads(parsed.stdout)
    if not apps:
        raise RuntimeError('Vetro has no launchable apps for Glass Home.')
    say('Vetro Launcher apps: ' + ', '.join(a['label'] for a in apps))
    say('The list reflects Vetro\'s current Launcher list; refresh it there first if Samsung Home changed.')
    command = None
    for candidate in ('sha256sum', 'openssl dgst -sha256'):
        try:
            if tv_hash('/dev/null', candidate) == hashlib.sha256(b'').hexdigest():
                command = candidate
                break
        except Exception:
            pass
    if command is None:
        raise RuntimeError('No working SHA-256 verification command was found on the TV.')
    unsigned = BASE / 'packages' / ('GlassHome-vetro-' + STAMP + '-unsigned.wgt')
    signed = BASE / 'signed' / ('GlassHome-vetro-' + STAMP + '.wgt')
    contents = {}
    for file in sorted((REPO / 'app').rglob('*')):
        rel = file.relative_to(REPO / 'app')
        if file.is_file() and not any(p.startswith('.') for p in rel.parts) and file.suffix != '.md' and not re.fullmatch(r'(author-signature|signature\d+)\.xml', file.name):
            contents[rel.as_posix()] = file.read_bytes()
    contents['js/local-key.js'] = key
    contents['js/config.js'] = config
    with zipfile.ZipFile(unsigned, 'w', zipfile.ZIP_DEFLATED) as bundle:
        for name, data in contents.items():
            bundle.writestr(name, data)
    unsigned.chmod(0o600)
    run(['node', str(helper), str(dependencies), str(cert), str(unsigned), str(signed)], timeout=180)
    signed.chmod(0o600)
    with zipfile.ZipFile(signed) as bundle:
        if not {'author-signature.xml', 'signature1.xml'}.issubset(bundle.namelist()):
            raise RuntimeError('The package is missing its signatures.')
    if signed.stat().st_size > 32 * 1024 * 1024:
        raise RuntimeError('The package exceeds Vetro\'s install size limit.')
    directory = '/home/owner/share/tmp/sdk_tools/glass-' + secrets.token_hex(8)
    target = directory + '/app.wgt'
    remote('mkdir -p ' + shlex.quote(directory) + ' && chmod 755 ' + shlex.quote(directory))
    submitted, verified = False, False
    server = None
    try:
        token = secrets.token_hex(24)
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                if self.client_address[0] != TV or self.path != '/' + token:
                    self.send_error(404)
                    return
                self.send_response(200)
                self.send_header('Content-Length', str(signed.stat().st_size))
                self.end_headers()
                with signed.open('rb') as f:
                    shutil.copyfileobj(f, self.wfile)
            def log_message(self, *args):
                pass
        say('Transferring the signed Glass Home update...')
        try:
            server = http.server.ThreadingHTTPServer((MINT, 0), Handler)
            threading.Thread(target=server.serve_forever, daemon=True).start()
            url = 'http://' + MINT + ':' + str(server.server_port) + '/' + token
            remote('curl -f -s -S --max-time 25 -o ' + shlex.quote(target) + ' ' + shlex.quote(url))
        except Exception:
            say('Using Vetro transfer instead of the direct download.')
            remote(': > ' + shlex.quote(target))
            with signed.open('rb') as f:
                while True:
                    chunk = f.read(24 * 1024)
                    if not chunk:
                        break
                    remote("printf '%s' " + shlex.quote(base64.b64encode(chunk).decode()) + ' | base64 -d >> ' + shlex.quote(target))
        finally:
            if server:
                server.shutdown()
                server.server_close()
        remote('chmod 644 ' + shlex.quote(target))
        if tv_hash(target, command) != hashlib.sha256(signed.read_bytes()).hexdigest():
            raise RuntimeError('Transferred package checksum mismatch; installation was not requested.')
        say('Package checksum verified. Updating Glass Home through Vetro...')
        ledger = {'revision':REVISION, 'sent':True, 'complete':False, 'root':app_root, 'hashCommand':command,
                  'hashes':{name:hashlib.sha256(contents[name]).hexdigest() for name in VERIFY_FILES}}
        ledger_write(ledger)
        submitted = True
        result = api('/install', {'path': target}, timeout=150)
        if result.get('submitted') is not True:
            raise RuntimeError('Vetro did not confirm installation submission. Do not retry automatically.')
        for attempt in range(12):
            try:
                if 'GlassHome1.GlassHome' in inventory() and all(tv_hash(app_root + '/' + name, command) == hashlib.sha256(contents[name]).hexdigest() for name in VERIFY_FILES):
                    verified = True
                    break
            except Exception:
                pass
            time.sleep(2)
        if not verified:
            raise RuntimeError('The installed files could not be verified. Keep the report; do not reinstall automatically.')
        say('INSTALLED: Glass Home update verified against the installed files.')
        restart_glass()
        ledger['complete'] = True
        ledger_write(ledger)
        try:
            runtime = json.loads(read_tv('/opt/usr/home/owner/apps_rw/GlassHome1/data/glasshome/diagnostics.json'))
            say('TV runtime: ' + json.dumps({k: runtime.get(k) for k in ('node', 'versions', 'lan')}, ensure_ascii=True))
        except Exception:
            say('TV runtime details were not available.')
        verify_vetro(app_root)
        say('Under +, use Choose apps or Refresh apps below New password / Done.')
        say('Existing photos, shortcuts and configuration are retained.')
    finally:
        if verified or not submitted:
            try:
                remote('rm -f ' + shlex.quote(target) + ' && rmdir ' + shlex.quote(directory))
            except Exception:
                say('Temporary TV package remains at: ' + target)
        else:
            say('Install outcome uncertain; TV package retained at: ' + target)

result_code = 0
try:
    main()
except Exception as error:
    result_code = 1
    say('STOPPED: ' + str(error))
    say('No uninstall or automatic retry was requested.')
finally:
    say('Leave Developer Mode ON and Host PC IP at 127.0.0.1.')
    if REPORT.exists():
        print('\nReport: ' + str(REPORT))
        if args.report_host:
            print('Copy the report from your Mac with:')
            print('rsync -P ' + shlex.quote(args.report_host + ':' + str(REPORT)) + ' ~/Downloads/')
sys.exit(result_code)
