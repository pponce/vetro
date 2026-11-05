{
printf '%s\n' '=== Vetro saved input recovery START ==='
python3 - "$@" <<'PYVETRO'
from pathlib import Path
import hashlib, ipaddress, re, subprocess, sys, urllib.request

expected = {
    'recover-update-input.py': 'c1282fd5ae93dcf6aab5a55de95966bfab52c6bb5b4fb6a2a374ec47ee2e1d18',
    'vetro_owner.py': '56c6a1de5b079216e72029aabdf1482ebbd508e034eecda40ae2e13b0f1e3f00',
    'input_update_handoff.py': '477ec7780063390869299b8cda1890db4c1bd246e271313a57e17f078a2db167',
    'app_access_input_audit.py': 'b19794ead5a556b8a9840cebabe756f29ac5efc77225925f19389654cfe6428c',
}
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError('Unexpected download redirect')
try:
    if len(sys.argv) != 5:
        raise RuntimeError('Usage: bash run-input-recovery.sh PROJECT_ROOT TV_IP REPORT_USER@REPORT_HOST SOURCE_REVISION')
    project = Path(sys.argv[1]).expanduser()
    tv = str(ipaddress.IPv4Address(sys.argv[2]))
    report_host, revision = sys.argv[3:5]
    if not project.is_dir() or not re.fullmatch(r'[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+', report_host) or not re.fullmatch(r'[a-f0-9]{40}', revision):
        raise RuntimeError('Use the existing project folder, user@host and pinned full source revision')
    directory = project / 'vetro-install/bin' / ('input-recovery-' + revision[:12])
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    for name, digest in expected.items():
        target = directory / name
        if target.is_file():
            source = target.read_bytes()
        else:
            with opener.open('https://raw.githubusercontent.com/pponce/vetro/' + revision + '/tools/' + name, timeout=30) as response:
                source = response.read(200000)
        if hashlib.sha256(source).hexdigest() != digest:
            raise RuntimeError('Helper checksum mismatch: ' + name)
        if not target.is_file():
            directory.mkdir(parents=True, exist_ok=True)
            target.write_bytes(source)
    subprocess.run(['python3', '-u', str(directory / 'recover-update-input.py'),
        '--project-root', str(project), '--tv', tv, '--report-host', report_host], check=True)
except (Exception, KeyboardInterrupt) as error:
    print('STOPPED: ' + (str(error) or type(error).__name__))
PYVETRO
printf '%s\n' '=== Vetro saved input recovery END ==='
}
