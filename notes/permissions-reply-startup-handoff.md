# Permissions reply and startup handoff — 2026-11-04

## Objective and hardware state

Restore Glass Home's approved app-list and launch access, then verify power-on and return behavior. Installed Vetro is `95098ef5a6f472f49a542d8737d291fd65d6168b`. Its package-private screen bootstrap restored browser pairing; the user reports root and TV APIs available. After a cold boot, input policy reports connected with Home filtering active.

Glass Home's approval is saved, but its app list times out. The current hardware cannot reliably deliver service-to-widget MessagePort replies. The latest startup report independently shows a standby wake with monitoring ready after 168 ms, followed by expiration of the 20-second readiness deadline. It does not identify which preparation stage consumed the time.

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

Hardware reply delivery through the new path, performance, full inventory, power-on launch and return remain unverified. Do not treat green CI, signed package installation, or a successful HTTP poll as hardware acceptance by themselves.

## Exact next steps

1. Require Vetro's four jobs and Glass Home's full CI to pass for the pinned candidate commits.
2. Update Vetro once using the existing beta updater, with expected-before `95098ef5a6f472f49a542d8737d291fd65d6168b`. Verify both running revisions and private screen authentication; preserve all earlier attempt records.
3. Update Glass Home using the revised `tools/install-glass-permissions.py` and its pinned companion commit. Require installed hashes and `/health` capability `vetroPermissions:2`.
4. Reapprove Glass Home if its installation identity changes. Verify actual app-list refresh and one intentional app launch. Revoke access and verify denial without a legacy launch.
5. Test cold boot and standby wake with no remote activity, then cancellation on remote activity. If skipped, collect the startup stage timings. Verify return behavior and saved selections afterward.

No undocumented firmware object conversion, no-source credential acceptance, owner-token sharing, or SDB security-policy change is part of this correction.

## Pinned update candidates

- Vetro: `fc0b236878a2249906edf774888f5a39f46842c0`; [all four CI jobs passed](https://github.com/pponce/vetro/actions/runs/41797038955).
- Glass Home: `30c490194f1748d523262a1ac8985fe45f735729`; [full CI passed](https://github.com/pponce/glass-home-samsung-tv/actions/runs/41796862889), including service API and both browser suites.
- Vetro updater source: `6dbf1971d0694edfd9e58973c54c58f751219d90`; SHA-256 `f0f8d63aff380764b53c54437cc09d16b3794a1f36d0602db82259954ece3555`.

Run these blocks in the existing Mint SSH session. They retain prior installation records and use the existing signing material. The updater refuses another installation when an earlier attempt for its target is unresolved. Each helper prints its report path and a Mac `rsync` command.

### 1. Update Vetro

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
import hashlib, json, subprocess, urllib.request
project = Path('/home/pedro/devProjects/samsung-tv-tools')
revision = '30c490194f1748d523262a1ac8985fe45f735729'
try:
    if not project.is_dir():
        raise RuntimeError('Existing samsung-tv-tools project was not found')
    with urllib.request.urlopen('https://api.github.com/repos/pponce/glass-home-samsung-tv/actions/runs/41796862889', timeout=30) as reply:
        ci = json.load(reply)
    if ci.get('head_sha') != revision or ci.get('status') != 'completed' or ci.get('conclusion') != 'success':
        raise RuntimeError('The pinned Glass Home CI run has not passed; nothing was installed')
    with urllib.request.urlopen('http://192.168.84.19:8099/status', timeout=10) as reply:
        status = json.load(reply)
    diagnostic = status.get('connectionDiagnostics') or {}
    screen = diagnostic.get('screen') or {}
    if (diagnostic.get('sourceRevision') != 'fc0b236878a2249906edf774888f5a39f46842c0' or
            diagnostic.get('sourceDirty') is not False or
            screen.get('sourceRevision') != 'fc0b236878a2249906edf774888f5a39f46842c0' or
            screen.get('serviceAuthenticated') is not True):
        raise RuntimeError('The matching Vetro service and authenticated screen are not verified; nothing was installed')
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
            with urllib.request.urlopen(url, timeout=30) as reply:
                source = reply.read(200000)
        if hashlib.sha256(source).hexdigest() != digest:
            raise RuntimeError('Helper checksum mismatch; nothing was installed')
        if not target.is_file():
            directory.mkdir(parents=True, exist_ok=True)
            target.write_bytes(source)
    subprocess.run(['python3', str(directory / 'install-glass-permissions.py'),
        '--tv', '192.168.84.19', '--mint', '192.168.84.2', '--project-root', str(project),
        '--expected-commit', revision, '--report-host', 'pedro@192.168.84.2'], check=True)
except Exception as error:
    print('STOPPED:', error)
PYGLASS
printf '%s\n' '=== Glass Home authenticated reply update END ==='
}
```

After both running builds are verified, reconnect/reapprove Glass Home if requested, refresh its app list, and perform one intentional launch. Successful installed-file verification is not a substitute for those checks.
