{
printf '%s\n' '=== Vetro screen recovery check START ==='
python3 - "$@" <<'PYVETRO'
from pathlib import Path
import hashlib, ipaddress, re, subprocess, sys, urllib.request

expected = {
    'capture-screen-auth.py': 'b39dad7e7eca28d8188f44a7abe74cb013b86a8c24479ccfecc798823d884059',
    'capture-glass-access.py': '5d47d367e04499ed73dcda47a94649449cbad2477df501edad4f7e2dc580ce1d',
    'inspect-messageport-runtime.py': 'c4828bd5612b8d21cde7c6a23c8b9f3286d9269bf56fb011d33f922370b042b6',
    'vetro_owner.py': '56c6a1de5b079216e72029aabdf1482ebbd508e034eecda40ae2e13b0f1e3f00',
    'input_update_handoff.py': '477ec7780063390869299b8cda1890db4c1bd246e271313a57e17f078a2db167',
    'app_access_input_audit.py': 'b19794ead5a556b8a9840cebabe756f29ac5efc77225925f19389654cfe6428c',
}

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError('Unexpected download redirect')

try:
    if len(sys.argv) not in (5, 6) or len(sys.argv) == 6 and sys.argv[5] != '--inspect-screen':
        raise RuntimeError('Usage: bash run-screen-auth-check.sh PROJECT_ROOT TV_IP REPORT_USER@REPORT_HOST SOURCE_REVISION [--inspect-screen]')
    project = Path(sys.argv[1]).expanduser()
    tv = str(ipaddress.IPv4Address(sys.argv[2]))
    report_host, revision = sys.argv[3:5]
    if not project.is_dir() or not re.fullmatch(r'[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+', report_host) or not re.fullmatch(r'[a-f0-9]{40}', revision):
        raise RuntimeError('Use the existing project folder, user@host and pinned full source revision')
    directory = project / 'vetro-install/bin' / ('screen-auth-' + revision[:12])
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    for name, digest in expected.items():
        target = directory / name
        if target.is_file():
            source = target.read_bytes()
        else:
            url = 'https://raw.githubusercontent.com/pponce/vetro/' + revision + '/tools/' + name
            with opener.open(url, timeout=30) as response:
                source = response.read(200000)
        if hashlib.sha256(source).hexdigest() != digest:
            raise RuntimeError('Helper checksum mismatch: ' + name)
        if not target.is_file():
            directory.mkdir(parents=True, exist_ok=True)
            target.write_bytes(source)
    subprocess.run(['python3', '-u', str(directory / 'capture-screen-auth.py'),
        '--project-root', str(project), '--tv', tv, '--report-host', report_host] + sys.argv[5:], check=True)
except (Exception, KeyboardInterrupt) as error:
    print('STOPPED: ' + (str(error) or type(error).__name__))
PYVETRO
printf '%s\n' '=== Vetro screen recovery check END ==='
}
