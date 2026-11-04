# Input lifecycle correction — 2026-11-04

## Objective and current state

Restore Glass Home app permissions, reliable remote/Home routing, power-on selection and return behavior.

- Vetro: https://github.com/pponce/vetro, candidate branch `combined/runtime-wrapper-observation-20261103`. Installed revision still `fc0b236878a2249906edf774888f5a39f46842c0` in both latest captures. The authoritative `combined/permissions-startup-return` branch remains unchanged.
- Glass Home: https://github.com/pponce/glass-home-samsung-tv, branch `combined/vetro-permissions`, verified installed/running `30c490194f1748d523262a1ac8985fe45f735729`. No further Glass installation is needed for this correction.
- Evidence: `connection-report-20261104-093815-780719.json` explicitly records `installSubmittedByThisRun:false` because CI was incomplete. The before/after reports (`app-access-20261104-173801-348901.json`, `app-access-20261104-173816-079662.json`) both show unchanged service PID 10516 and clean installed source. This attempt did not install the marker candidate.
- Corrected registry collection succeeds: 586 base rows, no duplicate/invalid IDs, zero owner overrides, Glass Home found as enabled/removable/non-system visible web UI app, two package siblings. No pending requests/grants at collection. This verifies registry facts, not the permission flow on the new candidate.
- Input reports disconnected although native helper PID 28508 has event7/uinput open and its callback port 45191 matches an established connection owned by the same service. A second helper PID 23352 appears transiently on another port. A native log contains EVIOCGRAB errno16 on event7. Home reportedly still works. Socket/FD evidence is non-atomic and does not prove exclusive grab ownership or the unique historical trigger.

## Completed changes and validation

Candidate `ce92708f55211738f3866756e287b5fb634c0b23` includes the permission/startup completion-marker corrections and live screen-status work, plus input lifecycle corrections:

- Service stop/exit releases owned input sockets and gates restoration, input events and manual requests. Start/request resumes the saved policy once. Preferences are not cleared.
- A cancelled input attempt cannot launch from the root command queue, accept/authenticate a late peer, dispatch old events, or alter a replacement attempt. Listener/socket ownership stays with its attempt.
- Stale action, restoration, observer and HTTP request completions cannot stop or overwrite the current input generation. Request bodies arriving after stop/restart are rejected before mutation.
- Updater `4b91e1cf62fd07b630ce4dade9fde8287bc1a207` on host-tools branch `combined/runtime-wrapper-inspection-20261103` now returns failure on blocked/partial updates. Success requires matching running service/screen and authenticated screen. The enclosing block stops rather than continuing into a misleading post-update stage.

Focused physical-input, input lifecycle/persistence, service lifecycle and Home tests pass. Eight updater tests pass, covering the CI gate, preserved attempt records, uncertain-install refusal, and authenticated verification. All four candidate jobs passed: https://github.com/pponce/vetro/actions/runs/41888326443 . Host-tool CI also passed: https://github.com/pponce/vetro/actions/runs/41888169120 . These establish source/model validation, not hardware acceptance.

## Decisions, limits and exact next steps

No remembered PID is terminated and no settings are reset. These changes repair confirmed source races/lifecycle gaps; the snapshot does not identify which gap uniquely produced the current state. Old sockets already orphaned in an earlier context cannot be retroactively closed by new JavaScript references. After verified installation, a single cold boot is the safe way to clear that retained state if the remote still fails; do not use recurring reboots as the permanent fix.

The general native command-argument quoting defect remains outside this candidate; the affected permission/startup readers use fixed ASCII completion markers and the diagnostic safely preserves its command bytes. Identity, signer, explicit approval and protected-app checks remain enforced.

Run the block below once; it verifies CI, performs a single Vetro update, verifies authenticated running source, and collects current permission/input state. If the existing remote failure persists, cold boot once and reopen Vetro. Test Home and app approval again. Rerunning this same block against its already installed clean target collects/validates without submitting another installation, including after a cold boot. Return both reports. Then test app-list refresh, one intentional app launch, revoke/denial, cold boot/wake startup, return behavior, and saved settings.

## Full update block

```bash
{
printf '%s\n' '=== Vetro input lifecycle update START ==='
python3 - <<'PYVETRO'
from pathlib import Path
import hashlib, shlex, subprocess, urllib.request

project = Path('/home/pedro/devProjects/samsung-tv-tools')
revision = 'ce92708f55211738f3866756e287b5fb634c0b23'

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError('Unexpected download redirect')

opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

def reports():
    return set(project.glob('vetro-install/access-diagnostics/app-access-*.json')) | set(
        project.glob('vetro-install/beta-recovery/connection-report-*.json'))

previous_reports = reports()
phase = 'preparing verified helpers'
try:
    if not project.is_dir():
        raise RuntimeError('Existing samsung-tv-tools project was not found')
    directory = project / 'vetro-install/bin/input-lifecycle-ce92708f5521'
    files = {
        'update-connection-diagnostics.py': ('4b91e1cf62fd07b630ce4dade9fde8287bc1a207',
            '6a9e111df31d8ed21d45ed2d2f37396c69f50152ff6b196ac47f4b5b1285cd6b'),
        'vetro_owner.py': ('fc0b236878a2249906edf774888f5a39f46842c0',
            '56c6a1de5b079216e72029aabdf1482ebbd508e034eecda40ae2e13b0f1e3f00'),
        'diagnose-app-access.py': ('c266f526893eb0b355b3d49aef6d872a7f6ea4a9',
            '02becf7066f7ed61b38eecf6b09a8d42650145031da90ac701d50075b0b57b88'),
        'app_access_input_audit.py': ('c266f526893eb0b355b3d49aef6d872a7f6ea4a9',
            'b19794ead5a556b8a9840cebabe756f29ac5efc77225925f19389654cfe6428c')
    }
    for name, (source_revision, digest) in files.items():
        target = directory / name
        if target.is_file():
            source = target.read_bytes()
        else:
            url = 'https://raw.githubusercontent.com/pponce/vetro/' + source_revision + '/tools/' + name
            with opener.open(url, timeout=30) as response:
                source = response.read(200000)
        if hashlib.sha256(source).hexdigest() != digest:
            raise RuntimeError('Helper checksum mismatch: ' + name)
        if not target.is_file():
            directory.mkdir(parents=True, exist_ok=True)
            target.write_bytes(source)

    phase = 'updating and verifying Vetro'
    subprocess.run(['python3', '-u', str(directory / 'update-connection-diagnostics.py'),
        '--project-root', str(project), '--tv', '192.168.84.19',
        '--local-ip', '192.168.84.2', '--revision', revision,
        '--expected-before', 'fc0b236878a2249906edf774888f5a39f46842c0',
        '--ci-run', '41888326443', '--report-host', 'pedro@192.168.84.2'], check=True)

    phase = 'collecting verified-build input and permission state'
    print('Running revision verified. Collecting input and permission state...', flush=True)
    subprocess.run(['python3', '-u', str(directory / 'diagnose-app-access.py'),
        '--project-root', str(project), '--tv', '192.168.84.19',
        '--report-host', 'pedro@192.168.84.2'], check=True)
except Exception as error:
    print('STOPPED while ' + phase + ': ' + str(error))
finally:
    for report in sorted(reports() - previous_reports):
        print('Run this on your Mac to retrieve the report:')
        print('rsync -P ' + shlex.quote('pedro@192.168.84.2:' + str(report)) + ' ~/Downloads/')
PYVETRO
printf '%s\n' '=== Vetro input lifecycle update END ==='
}
```
