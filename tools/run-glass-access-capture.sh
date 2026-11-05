{
printf '%s\n' '=== Glass Home connection check START ==='
python3 - "$@" <<'PYGLASS'
from pathlib import Path
import hashlib, ipaddress, re, subprocess, sys, urllib.request

revision = '6e367907fb337f2e636b2032a31f9e920f64f2e6'
expected = {
    'capture-glass-access.py': '050e18b9dc7752846251b015e9004180d3f2adb21772edd145e367569e4001ec',
    'inspect-messageport-runtime.py': 'c4828bd5612b8d21cde7c6a23c8b9f3286d9269bf56fb011d33f922370b042b6',
    'vetro_owner.py': '56c6a1de5b079216e72029aabdf1482ebbd508e034eecda40ae2e13b0f1e3f00'
}

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError('Unexpected download redirect')

try:
    if len(sys.argv) != 4:
        raise RuntimeError('Usage: bash tools/run-glass-access-capture.sh PROJECT_ROOT TV_IP REPORT_USER@REPORT_HOST')
    project = Path(sys.argv[1]).expanduser()
    tv = str(ipaddress.IPv4Address(sys.argv[2]))
    report_host = sys.argv[3]
    if not re.fullmatch(r'[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+', report_host):
        raise RuntimeError('Use a user@host report destination')
    if not project.is_dir():
        raise RuntimeError('Existing samsung-tv-tools folder was not found')
    directory = project / 'vetro-install/bin/glass-request-6e367907fb33'
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    for name, digest in expected.items():
        target = directory / name
        if target.is_file():
            source = target.read_bytes()
        else:
            url = 'https://raw.githubusercontent.com/pponce/vetro/' + revision + '/tools/' + name
            with opener.open(url, timeout=30) as response:
                source = response.read(100000)
        if hashlib.sha256(source).hexdigest() != digest:
            raise RuntimeError('Helper checksum mismatch: ' + name)
        if not target.is_file():
            directory.mkdir(parents=True, exist_ok=True)
            target.write_bytes(source)
    subprocess.run(['python3', '-u', str(directory / 'capture-glass-access.py'),
        '--project-root', str(project), '--tv', tv,
        '--seconds', '60', '--report-host', report_host], check=True)
except (Exception, KeyboardInterrupt) as error:
    print('STOPPED: ' + (str(error) or type(error).__name__))
PYGLASS
printf '%s\n' '=== Glass Home connection check END ==='
}
