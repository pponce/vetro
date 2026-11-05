{
printf '%s\n' '=== Vetro screen lifecycle update START ==='
python3 - "$@" <<'PYVETRO'
from pathlib import Path
import hashlib, ipaddress, re, subprocess, sys, urllib.request

helper_revision = 'fc7b8663a7708e85a1f3427bfb62b001a2442345'
runtime_revision = '488cdccf3f08916addf4d5f2af567eecd5c105c7'
expected_before = '6104eeaa7507d10f28edb68f08e37cff4d627aa5'
ci_run = '42064195199'
expected = {
    'input_update_handoff.py': '477ec7780063390869299b8cda1890db4c1bd246e271313a57e17f078a2db167',
    'update-connection-diagnostics.py': '405b1446c477600a0a042d986d3effb447f2b41a83abb492535dfc0deebbc7a8',
    'app_access_input_audit.py': 'b19794ead5a556b8a9840cebabe756f29ac5efc77225925f19389654cfe6428c',
    'vetro_owner.py': '56c6a1de5b079216e72029aabdf1482ebbd508e034eecda40ae2e13b0f1e3f00'
}

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError('Unexpected download redirect')

try:
    if len(sys.argv) != 5:
        raise RuntimeError('Usage: bash tools/run-screen-lifecycle-update.sh PROJECT_ROOT TV_IP LOCAL_IP REPORT_USER@REPORT_HOST')
    project = Path(sys.argv[1]).expanduser()
    tv, local_ip = (str(ipaddress.IPv4Address(value)) for value in sys.argv[2:4])
    report_host = sys.argv[4]
    if not project.is_dir() or not re.fullmatch(r'[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+', report_host):
        raise RuntimeError('Use the existing project and a user@host report destination')
    directory = project / 'vetro-install/bin/app-request-fc7b8663a770'
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    for name, digest in expected.items():
        target = directory / name
        if target.is_file():
            source = target.read_bytes()
        else:
            url = 'https://raw.githubusercontent.com/pponce/vetro/' + helper_revision + '/tools/' + name
            with opener.open(url, timeout=30) as response:
                source = response.read(200000)
        if hashlib.sha256(source).hexdigest() != digest:
            raise RuntimeError('Helper checksum mismatch: ' + name)
        if not target.is_file():
            directory.mkdir(parents=True, exist_ok=True)
            target.write_bytes(source)
    subprocess.run(['python3', '-u', str(directory / 'update-connection-diagnostics.py'),
        '--project-root', str(project), '--tv', tv, '--local-ip', local_ip,
        '--revision', runtime_revision, '--expected-before', expected_before,
        '--ci-run', ci_run, '--report-host', report_host], check=True)
    print('Screen lifecycle update verified. Test normal Back exit and immediate reopening several times. Glass Home does not need an update.')
except (Exception, KeyboardInterrupt) as error:
    print('STOPPED: ' + (str(error) or type(error).__name__))
PYVETRO
printf '%s\n' '=== Vetro screen lifecycle update END ==='
}
