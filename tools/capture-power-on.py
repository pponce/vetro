#!/usr/bin/env python3
"""Capture a completed power-on test without pairing, navigation or settings changes."""
import argparse
import datetime
import ipaddress
import json
import os
from pathlib import Path
import shlex
import urllib.error
from vetro_owner import OwnerClient


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def fields(value, names):
    value = value if isinstance(value, dict) else {}
    return {name: value.get(name) for name in names}


def capture(client):
    def read(route, body=None):
        try:
            # Do not use request(): pairing would open Vetro and disturb the test.
            value = client.raw(route, body, timeout=12)
            if not isinstance(value, dict):
                raise ValueError('Expected a JSON object')
            return value
        except urllib.error.HTTPError as error:
            return {'readError': 'HTTP ' + str(error.code)}
        except Exception as error:
            return {'readError': type(error).__name__}

    report = {'captureVersion': 2, 'started': now()}
    report['powerOn'] = read('/startup-app')
    report['returnApp'] = read('/return-app')
    if report['powerOn'].get('readError') == 'HTTP 401':
        report['instruction'] = 'Pair the maintenance tool before repeating the TV test. This capture did not start pairing.'
        report['finished'] = now()
        return report
    service = read('/status')
    report['service'] = fields(service, ['app', 'running', 'unsupported', 'readError'])
    report['service']['agent'] = fields(service.get('agent'), ['connected', 'pid', 'at'])
    home = read('/remap')
    report['home'] = fields(home.get('home'), ['code', 'launcher', 'ready', 'listening', 'busy', 'error'])
    report['home']['readError'] = home.get('readError')
    permissions = read('/app-access')
    report['appAccess'] = fields(permissions, ['available', 'enabled', 'error', 'readError'])
    if report['service']['agent'].get('connected') is True:
        inputs = read('/input')
        state = inputs.get('status') or {}
        report['input'] = fields(state, ['policy', 'preference', 'error'])
        report['input']['readError'] = inputs.get('readError')
        report['foreground'] = read('/exec', {'cmd':
            'vconftool get memory/appfw/current_fullscreen_appid && '
            'vconftool get memory/appfw/current_partial_appid && '
            'vconftool get memory/system/source_type'})
        power = read('/exec', {'cmd':
            'curl -fsS --connect-timeout 2 --max-time 4 http://127.0.0.1:8001/api/v2/'})
        report['samsungPower'] = fields(power, ['exit_code', 'timed_out', 'readError'])
        try:
            report['samsungPower']['powerState'] = json.loads(power.get('output', '')).get('device', {}).get('PowerState')
        except (ValueError, AttributeError):
            report['samsungPower']['parseError'] = 'No readable Samsung power response'
    report['powerOnAfterCapture'] = read('/startup-app')
    report['returnAppAfterCapture'] = read('/return-app')
    report['finished'] = now()
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tv', required=True, type=lambda value: str(ipaddress.IPv4Address(value)))
    parser.add_argument('--project-root', required=True)
    parser.add_argument('--report-host')
    args = parser.parse_args()
    directory = Path(args.project_root).expanduser().resolve() / 'vetro-install/combined-updates'
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    client = OwnerClient('http://' + args.tv + ':8099', directory)
    print('Reading power-on diagnostics. Keep the TV on and its screen unchanged.', flush=True)
    report = capture(client)
    text = json.dumps(report, indent=2)
    file = directory / ('after-power-on-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f') + '-' + str(os.getpid()) + '.json')
    fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(text + '\n')
    print(text)
    print('Report: ' + str(file))
    if args.report_host:
        print('Copy from your Mac:')
        print('rsync -P ' + shlex.quote(args.report_host + ':' + str(file)) + ' ~/Downloads/')


if __name__ == '__main__':
    main()
