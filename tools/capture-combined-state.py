#!/usr/bin/env python3
"""Save startup/return observations before either combined test update."""
import argparse
import datetime
import ipaddress
import json
import os
from pathlib import Path
from vetro_owner import OwnerClient

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--tv', required=True, type=lambda v: str(ipaddress.IPv4Address(v)))
parser.add_argument('--project-root', required=True)
parser.add_argument('--report-host')
args = parser.parse_args()
directory = Path(args.project_root).expanduser().resolve() / 'vetro-install/combined-updates'
directory.mkdir(parents=True, exist_ok=True, mode=0o700)
client = OwnerClient('http://' + args.tv + ':8099', directory)
report = {'when': datetime.datetime.now(datetime.timezone.utc).isoformat()}
for name, route in [('powerOn','/startup-app'),('returnApp','/return-app'),('service','/status')]:
    value = client.request(route, timeout=10)
    if not isinstance(value, dict):
        raise RuntimeError('Unexpected status response from ' + route)
    report[name] = {'app':value.get('app'),'rootConnected':value.get('agent',{}).get('connected')} if name=='service' else value
file = directory / ('before-both-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f') + '.json')
fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as stream:
    json.dump(report, stream, indent=2)
print('Saved current startup and return status before either update: ' + str(file))
if args.report_host:
    import shlex
    print('Copy from your Mac: rsync -P ' + shlex.quote(args.report_host + ':' + str(file)) + ' ~/Downloads/')
