#!/usr/bin/env python3
"""Record or verify the precompiled TV helper without requiring a host SDK."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parent
SOURCES = ('SdbSession.cs', 'VetroUpdate.cs', 'VetroUpdate.csproj', 'bundle.py')
FILES = ('VetroUpdate.dll', 'VetroUpdate.runtimeconfig.json')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify(root=ROOT):
    folder = root / 'compiled'
    manifest = json.loads((folder / 'manifest.json').read_text())
    if set(manifest['sources']) != set(SOURCES) or set(manifest['files']) != set(FILES):
        raise RuntimeError('Invalid updater manifest')
    for section, base in (('sources', root), ('files', folder)):
        for name, expected in manifest[section].items():
            if sha(base / name) != expected:
                raise RuntimeError('Compiled updater does not match its source/manifest: ' + name)
    return {name: (folder / name).read_bytes() for name in FILES}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write', type=Path)
    args = parser.parse_args()
    if args.write:
        folder = ROOT / 'compiled'
        folder.mkdir(exist_ok=True)
        for name in FILES:
            shutil.copyfile(args.write / name, folder / name)
        manifest = {'sources': {name: sha(ROOT / name) for name in SOURCES},
                    'files': {name: sha(folder / name) for name in FILES}}
        (folder / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    verify()
    print('Compiled TV updater source and file hashes verified')
