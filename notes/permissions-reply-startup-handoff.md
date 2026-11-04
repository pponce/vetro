# Permissions reply and startup handoff — 2026-11-04

## Objective and hardware state

Restore Glass Home's approved app-list and launch access, then verify power-on and return behavior. Installed Vetro is now `fc0b236878a2249906edf774888f5a39f46842c0`: report `connection-report-20261104-001344-292474.json` verifies its clean service, matching screen and authenticated screen summary. Browser pairing, root and TV APIs have worked. Glass Home revision `30c490194f1748d523262a1ac8985fe45f735729` has passed CI but is not yet verified installed.

After revocation, Glass Home's `access.request` reaches Vetro and returns `unavailable` without creating a pending approval. The latest owner snapshot reports permissions enabled and available, no storage error, service UID 5001, and root connected. Thus permission-store readiness is not the present blocker; native identity resolution and the live eligibility registry still need hardware evidence.

The same snapshot reports the actual input bridge off/disconnected, with an enabled preference for `Smart Control 2016` at saved `/dev/input/event4`. Home still opens the launcher. A stale screen warning alone cannot explain this state. The read-only collector below correlates current service/helper sockets and launcher/input file descriptors before any installation; descriptor ownership does not establish exclusive grab ownership. Do not kill an old remembered PID or reset settings.

The first Glass Home update stopped in its preflight, before starting the installer: diagnostic Vetro returns safe revision evidence inside HTTP 401, and the original bootstrap raised before reading that body. The corrected preflight accepts only bounded 200/401 diagnostic evidence, verifies exact source and authenticated screen, and leaves owner authentication to the maintenance client. Other errors and redirects still stop the update.

The last startup hardware evidence predates this installed candidate: a standby wake had monitoring ready after 168 ms but expired during its 20-second readiness window. The new startup timings and narrower eligibility read still need hardware acceptance.

## Source and changes

- Vetro candidate branch: `combined/runtime-wrapper-observation-20261103`, based on installed revision `95098ef5a6f472f49a542d8737d291fd65d6168b`.
- Authoritative combined branch remains `combined/permissions-startup-return`; do not reset or merge it during hardware acceptance.
- Glass Home companion branch: `combined/vetro-permissions`, based on `195e499e76ad4e9297c9962ce4347ad16bdb20be`.
- Version 2 app requests retain native MessagePort identity, installation/signer checks and explicit grants. Each request carries independent native-random reply ID/key values. HTTP retrieves only an ID-selected, HMAC-authenticated result; no operation or claimed identity is accepted over HTTP.
- Glass Home proxies only the reply ID through its authenticated local service. The widget verifies the exact reply body using bundled MIT js-sha256 v0.11.1. Native replies cannot complete a version 2 request, and polling never resubmits an operation.
- Reply records, replay records, polling, request sizes and concurrency are bounded. Permission-store revisions invalidate pending authorization and cached results, including a disable/re-enable cycle. Post-dispatch uncertainty never permits a duplicate fallback launch.
- Permission calls use a small live registry read retaining authorization fields and all package siblings. Startup reads only selected/resumed eligibility inside its dispatch guard. Neither relies on a stale registry cache. Startup retains its deadline, user cancellation and final source/foreground checks, with bounded stage timings.
- Glass installation verification requires capability version 2 and hashes the proxy, client and vendor files. Existing settings, signing material and attempt records are retained.

## Validation and remaining acceptance

Focused local tests cover actual HTTP routing, native request metadata, permission revocation, exact-body MACs, replay/expiry/resource limits, SDK browser compatibility, Glass service integration and installer resume behavior. The Glass integration test completes approval, app listing and launch with native reply delivery unavailable; native TV APIs are modeled. Full repository CI is required for the exact candidate commits before installation.

The corrected bootstrap has four real-HTTP/shell tests. The collector has five tests covering exact production SQL, failures, UID selection and report filtering; the input audit has two tests, including its shell running against simulated process/socket data. These are host-tool checks, not proof of a hardware correction.

Hardware app reply delivery through the new path, approval, full inventory, power-on launch and return remain unverified. Do not treat green CI, signed package installation, or a successful HTTP poll as hardware acceptance by themselves. Vetro candidate `3d6a431727687cbd1e3ec5fe01d01471e79a151f` also passed four CI jobs and improves live screen status, but it is not installed and does not repair this currently disconnected bridge.

## Exact next steps

1. Keep installed Vetro `fc0b236878a2249906edf774888f5a39f46842c0`; its successful update is complete. Preserve earlier records.
2. Collect `tools/diagnose-app-access.py` through owner-paired HTTP. It records read-only registry stage results and input process/socket evidence without reinstalling Vetro. Its registry execution budget is 30 seconds versus production's 4 seconds; a diagnostic success alone does not establish production timing.
3. Run the corrected Glass Home block below with the pinned installer and companion revision. Require installed hashes and `/health` capability `vetroPermissions:2`. Return the diagnostic JSON and installer report; use their evidence to select the remaining permissions/input correction.
4. Reapprove Glass Home if its installation identity changes. Verify actual app-list refresh and one intentional app launch. Revoke access and verify denial without a legacy launch.
5. Test cold boot and standby wake with no remote activity, then cancellation on remote activity. If skipped, collect the startup stage timings. Verify return behavior and saved selections afterward.

No undocumented firmware object conversion, no-source credential acceptance, owner-token sharing, or SDB security-policy change is part of this correction.

## Pinned update candidates

- Vetro: `fc0b236878a2249906edf774888f5a39f46842c0`; [all four CI jobs passed](https://github.com/pponce/vetro/actions/runs/41797038955).
- Glass Home: `30c490194f1748d523262a1ac8985fe45f735729`; [full CI passed](https://github.com/pponce/glass-home-samsung-tv/actions/runs/41796862889), including service API and both browser suites.
- Vetro updater source: `6dbf1971d0694edfd9e58973c54c58f751219d90`; SHA-256 `f0f8d63aff380764b53c54437cc09d16b3794a1f36d0602db82259954ece3555`.

Run only the Glass Home block in the existing Mint SSH session at the current checkpoint. The completed Vetro block is retained as an installation record. The helpers retain prior records and use existing signing material; an unresolved prior installation prevents another attempt. Each helper prints its report path and a Mac `rsync` command.

### 1. Completed Vetro update — retained record

```bash
{
printf '%s\n' '=== Vetro permissions reply update START ==='
python3 - <<'PYVETRO'
from pathlib import Path
import hashlib, subprocess, urllib.request
project = Path('/home/pedro/devProjects/samsung-tv-tools')
try:
    if not project.is_dir():
        raise RuntimeError('Existing samsung-tv-tools project was not found')
    helper = project / 'vetro-install/bin/update-connection-diagnostics-6dbf1971d069.py'
    expected = 'f0f8d63aff380764b53c54437cc09d16b3794a1f36d0602db82259954ece3555'
    if helper.is_file():
        source = helper.read_bytes()
    else:
        with urllib.request.urlopen('https://raw.githubusercontent.com/pponce/vetro/6dbf1971d0694edfd9e58973c54c58f751219d90/tools/update-connection-diagnostics.py', timeout=30) as reply:
            source = reply.read(200000)
    if hashlib.sha256(source).hexdigest() != expected:
        raise RuntimeError('Updater checksum mismatch; nothing was installed')
    if not helper.is_file():
        helper.parent.mkdir(parents=True, exist_ok=True)
        helper.write_bytes(source)
    subprocess.run(['python3', str(helper), '--project-root', str(project),
        '--tv', '192.168.84.19', '--local-ip', '192.168.84.2',
        '--revision', 'fc0b236878a2249906edf774888f5a39f46842c0',
        '--expected-before', '95098ef5a6f472f49a542d8737d291fd65d6168b',
        '--ci-run', '41797038955', '--report-host', 'pedro@192.168.84.2'], check=True)
except Exception as error:
    print('STOPPED:', error)
PYVETRO
printf '%s\n' '=== Vetro permissions reply update END ==='
}
```

Before continuing, require the Vetro report's `capture.runningServiceVerified`, `capture.screenBuildVerified`, and `capture.screenServiceAuthenticated` to be true. If any is false, retain and return that report; do not submit another install. Root must be connected. The Glass helper checks root before changing the TV.

### 2. Update Glass Home

```bash
{
printf '%s\n' '=== Glass Home authenticated reply update START ==='
python3 - <<'PYGLASS'
from pathlib import Path
import hashlib, json, subprocess, urllib.error, urllib.request
project = Path('/home/pedro/devProjects/samsung-tv-tools')
revision = '30c490194f1748d523262a1ac8985fe45f735729'

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError('Unexpected redirect; update stopped')

opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

def read_json(url, allow_diagnostic_401=False):
    request = urllib.request.Request(url, headers={'Accept': 'application/json'})
    try:
        response = opener.open(request, timeout=30)
    except urllib.error.HTTPError as error:
        if not allow_diagnostic_401 or error.code != 401:
            raise
        response = error
    with response:
        if response.getcode() not in ((200, 401) if allow_diagnostic_401 else (200,)):
            raise RuntimeError('Unexpected HTTP status ' + str(response.getcode()))
        raw = response.read(2097153)
    if len(raw) > 2097152:
        raise RuntimeError('Response exceeded its size limit')
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise RuntimeError('Expected a JSON object')
    return value

def verify_vetro_status(url):
    # A diagnostic build includes safe revision evidence in its 401 response.
    # This read supplies no owner access; the installer pairs separately.
    status = read_json(url, allow_diagnostic_401=True)
    diagnostic = status.get('connectionDiagnostics')
    screen = diagnostic.get('screen') if isinstance(diagnostic, dict) else None
    expected = 'fc0b236878a2249906edf774888f5a39f46842c0'
    if (not isinstance(screen, dict) or diagnostic.get('sourceRevision') != expected or
            diagnostic.get('sourceDirty') is not False or screen.get('sourceRevision') != expected or
            screen.get('serviceAuthenticated') is not True):
        raise RuntimeError('The matching Vetro service and authenticated screen are not verified')

phase = 'checking the project folder'
try:
    if not project.is_dir():
        raise RuntimeError('Existing samsung-tv-tools project was not found')
    phase = 'checking the pinned Glass Home CI run'
    ci = read_json('https://api.github.com/repos/pponce/glass-home-samsung-tv/actions/runs/41796862889')
    if ci.get('head_sha') != revision or ci.get('status') != 'completed' or ci.get('conclusion') != 'success':
        raise RuntimeError('The pinned Glass Home CI run has not passed')
    phase = 'checking the installed Vetro revision'
    verify_vetro_status('http://192.168.84.19:8099/status')
    phase = 'verifying the installer files'
    directory = project / 'vetro-install/bin/permissions-fc0b236878a2'
    files = {
        'install-glass-permissions.py': 'fbf392b5122143f5cdc1ad62caaed63c6ada994bdd651575d22cf33d14e70d12',
        'vetro_owner.py': '56c6a1de5b079216e72029aabdf1482ebbd508e034eecda40ae2e13b0f1e3f00'
    }
    for name, digest in files.items():
        target = directory / name
        if target.is_file():
            source = target.read_bytes()
        else:
            url = 'https://raw.githubusercontent.com/pponce/vetro/fc0b236878a2249906edf774888f5a39f46842c0/tools/' + name
            with opener.open(url, timeout=30) as reply:
                source = reply.read(200000)
        if hashlib.sha256(source).hexdigest() != digest:
            raise RuntimeError('Helper checksum mismatch; nothing was installed')
        if not target.is_file():
            directory.mkdir(parents=True, exist_ok=True)
            target.write_bytes(source)
    phase = 'running the owner-paired Glass Home installer'
    subprocess.run(['python3', str(directory / 'install-glass-permissions.py'),
        '--tv', '192.168.84.19', '--mint', '192.168.84.2', '--project-root', str(project),
        '--expected-commit', revision, '--report-host', 'pedro@192.168.84.2'], check=True)
except Exception as error:
    print('STOPPED while ' + phase + ': ' + str(error))
PYGLASS
printf '%s\n' '=== Glass Home authenticated reply update END ==='
}
```

After both running builds are verified, reconnect/reapprove Glass Home if requested, refresh its app list, and perform one intentional launch. Successful installed-file verification is not a substitute for those checks.
