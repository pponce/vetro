#!/usr/bin/env python3
"""Validate the proposed diff in a temporary fixture without editing app sources."""
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PATCH = Path(__file__).with_name('observe-messageport-wrappers.patch')
RELATIVE = Path('app/service/message-reply-diagnostics.js')
SUITES = (
    'app/tests/messageport-wrapper-boundary.test.cjs',
    'app/tests/comprehensive-connection-diagnostics.test.cjs',
    'app/tests/app-ports.test.cjs',
    'app/tests/widget-transport.test.cjs',
)
BOOTSTRAP = """
const fs = require('fs'), Module = require('module');
const target = process.argv[1], source = process.argv[2], suite = process.argv[3];
const candidate = new Module(target);
candidate.filename = target;
candidate.paths = Module._nodeModulePaths(require('path').dirname(target));
candidate._compile(fs.readFileSync(source, 'utf8'), target);
require.cache[target] = candidate;
require(suite);
"""

with tempfile.TemporaryDirectory(prefix='proposal-validation-', dir=PATCH.parent) as temporary:
    fixture = Path(temporary)
    target = fixture / RELATIVE
    target.parent.mkdir(parents=True)
    target.write_bytes((ROOT / RELATIVE).read_bytes())
    subprocess.run(['patch', '--batch', '--directory', str(fixture), '-p1',
                    '--input', str(PATCH)], check=True)
    subprocess.run(['node', str(fixture / 'app/tests/messageport-wrapper-observations.test.cjs')], check=True)
    for suite in SUITES:
        subprocess.run(['node', '-e', BOOTSTRAP, str(ROOT / RELATIVE), str(target), str(ROOT / suite)], check=True)
print('PASS proposal validation; tracked application files were not modified')
