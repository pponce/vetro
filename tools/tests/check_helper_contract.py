"""Decode the actual C# serializer's synthetic probe from its complete test log."""
import importlib.util
from pathlib import Path
import sys

spec = importlib.util.spec_from_file_location('installer', Path(__file__).parents[1] / 'install-combined.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)
result = installer.worker_response(Path(sys.argv[1]).read_text(), 'probe')
assert result['duid'] == 'TESTTV1234567'
assert result['uid'] == 0
assert result['sourceRevision'] == 'b' * 40
assert result['authorFingerprint'] == installer.digest(b'author')
assert result['launcherSha256'] == installer.digest(b'native')
assert result['updateLocked'] is False
print('PASS actual C# result decoded by Python with surrounding runtime/test messages')
