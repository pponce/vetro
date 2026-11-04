{
printf '%s\n' '=== Glass Home connection check START ==='
python3 - <<'PYGLASS'
from pathlib import Path
import hashlib, subprocess, urllib.request

project = Path('/home/pedro/devProjects/samsung-tv-tools')
revision = 'f3ba2c7d68698540e7b9d30d15f0fee0327f03de'
directory = project / 'vetro-install/bin/glass-request-f3ba2c7d6869'
expected = {
    'capture-glass-access.py': '9fb606099f33fd0c57671c9f289d61613f61c5eb204a3b3357f2b3d150880b31',
    'inspect-messageport-runtime.py': 'c4828bd5612b8d21cde7c6a23c8b9f3286d9269bf56fb011d33f922370b042b6',
    'vetro_owner.py': '56c6a1de5b079216e72029aabdf1482ebbd508e034eecda40ae2e13b0f1e3f00'
}

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError('Unexpected download redirect')

try:
    if not project.is_dir():
        raise RuntimeError('Existing samsung-tv-tools folder was not found')
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
        '--project-root', str(project), '--tv', '192.168.84.19',
        '--seconds', '60', '--report-host', 'pedro@192.168.84.2'], check=True)
except (Exception, KeyboardInterrupt) as error:
    print('STOPPED: ' + (str(error) or type(error).__name__))
PYGLASS
printf '%s\n' '=== Glass Home connection check END ==='
}
