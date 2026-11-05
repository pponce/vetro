# Permission registry markers and input evidence — 2026-11-04

Current checkpoint: the attempted marker update was blocked by CI and did not install. Corrected reports now identify retained input-helper state. Continue with [the input lifecycle handoff](input-lifecycle-handoff.md), whose combined candidate includes these marker fixes and has passed all four CI jobs. The block below is retained as a record.

## Objective and verified state

Restore approved Glass Home app-list/launch access, reliable input routing, power-on selection and return behavior.

- Vetro repository: https://github.com/pponce/vetro. Installed clean service revision remains `fc0b236878a2249906edf774888f5a39f46842c0`, UID 5001, PID 10516 at collection, root connected.
- Glass Home repository: https://github.com/pponce/glass-home-samsung-tv, branch `combined/vetro-permissions`. Revision `30c490194f1748d523262a1ac8985fe45f735729` is now verified installed by file hashes and running with scoped integration version 2. Do not reinstall Glass Home for this step.
- Uploaded evidence: `app-access-20261104-172147-727987.json` and `glass-home-permissions-20261104-092158-840610.txt`. The permission/input report was collected BEFORE that successful Glass update. It does not establish the newly installed Glass client's approval result.
- Permissions were enabled/available with no store error, no grants or pending requests, and repeated prior `access.request: unavailable` outcomes.
- Current input bridge was off/disconnected, saved selection enabled, Home not ready. Native log contains `EVIOCGRAB /dev/input/event7 failed with errno 16`. This proves a busy exclusive grab at the logged attempt, not the holder's identity or whether the log event is still current. Home reportedly still opens the launcher.

## Cause, correction and boundaries

The installed native root-agent source builds `ProcessStartInfo.Arguments` using a function that doubles every backslash. .NET's Unix argument parser retains ordinary backslashes. Shell newline and NUL escapes are consequently changed before execution. Matching source: `rooting/tools/samsung-tv-root-master/payloads/common/SamsungTvRootAgent.cs`, lines 341–343 and 601–604 at installed revision. Parser reference: dotnet/runtime v6.0.0 `src/libraries/System.Diagnostics.Process/src/System/Diagnostics/Process.Unix.cs`, `GetNextArgument`.

The diagnostic used escaped newlines as record markers. A real-shell regression with the installed argument parsing model and 586 SQL fixture rows reproduces exactly 587 unexpected rows, no invalid hex, no recognized base rows, and missing markers. Thus the uploaded report's zero rows and query-failed labels are NOT evidence of empty or failed SQL queries. The process report's empty lists likewise do not establish no helper/process exists.

Production permission and narrow startup eligibility readers use the same affected completion-marker construction. Candidate `aee9b38a8284a695f74600c01e430b8bf9c4fd22` on `combined/runtime-wrapper-observation-20261103` emits the unchanged constant markers with standard fixed-word `echo`. All query, identity, signer, grant, protected-sibling, completeness, duplicate, flag and timing checks remain. The candidate also includes the previously prepared live screen-status correction from `3d6a431`; no native helper or input policy change is included.

The general native argument-quoting defect remains outside this targeted candidate. A future native rebuild should use the documented `ProcessStartInfo.ArgumentList` API and validate affected callers. Do not claim that this candidate fixes every command using backslashes.

Corrected host tools at `c266f526893eb0b355b3d49aef6d872a7f6ea4a9` on `combined/runtime-wrapper-inspection-20261103` use actual LF delimiters for registry collection and ASCII base64 transport decoded in memory for the read-only process audit. They do not write TV files, kill processes or change settings. Reports remain filtered and bounded. Descriptor ownership does not prove exclusive grab ownership; the process snapshot is non-atomic.

## Validation and next steps

Real shell/SQLite regression: old marker gives `unavailable` and pending zero; corrected marker creates a pending request, denies app listing before approval, and allows it after approval. Launchable-registry tests reproduce and correct the same parsing defect. Registry, app-access, startup and return tests pass. Nine host collector/audit tests and five bootstrap tests pass. Host tests now use immutable installed-source facts rather than depending on application files absent from the host branch.

Candidate CI: https://github.com/pponce/vetro/actions/runs/41878400617 . The jobs were queued at preparation; require all four jobs to pass before installation. Hardware success is still unverified. A full local app-suite attempt stopped because this partial workspace lacks `dock/res`; the focused regression suites above passed. CI uses the full checkout and remains the installation gate.

Exact next steps: collect corrected input/registry evidence before updating; install Vetro candidate once with existing signing and attempt records; verify running service/screen revisions; collect after updating. Then in Glass Home choose Connect to Vetro, approve app-list/app-launch scopes in Vetro, refresh apps and perform one intentional launch. Return all generated reports. Identify the input grab holder from process/socket evidence before selecting a recovery action. After permissions/input are working, test power-on and return with saved settings retained.

The authoritative `combined/permissions-startup-return` branch remains unchanged. No bypass of authentication, acceptance of payload identity, blind PID termination, or SDB policy change is authorized by this correction.

## Full update block

Run after the candidate's four CI jobs pass, in the existing Mint SSH session. Keep TV-Store's relay available and close Apps2Samsung on the Mac. If prompted, open Vetro to read its maintenance pairing code. The diagnostic runs before and after the Vetro update; Glass Home is already installed.

```bash
{
printf '%s\n' '=== Vetro registry marker update START ==='
python3 - <<'PYVETRO'
from pathlib import Path
import hashlib, shlex, subprocess, urllib.request

project = Path('/home/pedro/devProjects/samsung-tv-tools')
revision = 'aee9b38a8284a695f74600c01e430b8bf9c4fd22'
tool_revision = 'c266f526893eb0b355b3d49aef6d872a7f6ea4a9'

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
    directory = project / 'vetro-install/bin/marker-fix-aee9b38a8284'
    files = {
        'update-connection-diagnostics.py': ('6dbf1971d0694edfd9e58973c54c58f751219d90',
            'f0f8d63aff380764b53c54437cc09d16b3794a1f36d0602db82259954ece3555'),
        'vetro_owner.py': ('fc0b236878a2249906edf774888f5a39f46842c0',
            '56c6a1de5b079216e72029aabdf1482ebbd508e034eecda40ae2e13b0f1e3f00'),
        'diagnose-app-access.py': (tool_revision,
            '02becf7066f7ed61b38eecf6b09a8d42650145031da90ac701d50075b0b57b88'),
        'app_access_input_audit.py': (tool_revision,
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

    diagnostic = ['python3', '-u', str(directory / 'diagnose-app-access.py'),
        '--project-root', str(project), '--tv', '192.168.84.19',
        '--report-host', 'pedro@192.168.84.2']
    phase = 'collecting the current state'
    print('Collecting read-only evidence before updating Vetro...', flush=True)
    subprocess.run(diagnostic, check=True)

    phase = 'updating Vetro'
    subprocess.run(['python3', '-u', str(directory / 'update-connection-diagnostics.py'),
        '--project-root', str(project), '--tv', '192.168.84.19',
        '--local-ip', '192.168.84.2', '--revision', revision,
        '--expected-before', 'fc0b236878a2249906edf774888f5a39f46842c0',
        '--ci-run', '41878400617', '--report-host', 'pedro@192.168.84.2'], check=True)

    phase = 'collecting the resulting state'
    subprocess.run(diagnostic, check=True)
except Exception as error:
    print('STOPPED while ' + phase + ': ' + str(error))
finally:
    for report in sorted(reports() - previous_reports):
        print('Run this on your Mac to retrieve the report:')
        print('rsync -P ' + shlex.quote('pedro@192.168.84.2:' + str(report)) + ' ~/Downloads/')
PYVETRO
printf '%s\n' '=== Vetro registry marker update END ==='
}
```
