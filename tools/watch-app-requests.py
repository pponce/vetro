#!/usr/bin/env python3
"""Read Vetro's app-request diagnostics while Glass Home runs normally."""
import argparse
import datetime
import json
from pathlib import Path
import ipaddress
import re
import shlex
import time
import urllib.error
import urllib.request

from vetro_owner import OwnerClient


def diagnostics(owner, revision):
    request = urllib.request.Request(owner.base + '/status', headers={'Accept': 'application/json'})
    try:
        response = owner.opener.open(request, timeout=8)
    except urllib.error.HTTPError as error:
        if error.code not in (401, 503):
            raise
        response = error
    with response:
        payload = response.read(100001)
    if len(payload) > 100000:
        raise RuntimeError('Diagnostic response exceeded its limit')
    value = json.loads(payload).get('connectionDiagnostics') or {}
    if value.get('sourceRevision') != revision or value.get('sourceDirty') is not False:
        raise RuntimeError('Expected clean diagnostic revision is not running')
    requests = value.get('appRequests') or {}
    if requests.get('enabled') is not True or not isinstance(requests.get('events'), list) or len(requests['events']) > 32:
        raise RuntimeError('Native app-request diagnostics are unavailable')
    # The pinned service constructs this bounded object from fixed labels and
    # booleans; it never retains request/reply data, identities or credentials.
    return {'appPort': value.get('appPort'), 'requests': requests}


def permissions(owner):
    value = owner.raw('/app-access', timeout=8)
    return {'enabled': value.get('enabled') is True, 'available': value.get('available') is True,
            'pendingCount': len(value.get('pending') or []), 'grantCount': len(value.get('grants') or []),
            'glassEvents': [{'method': e.get('method') if e.get('method') in ('access.request', 'access.status', 'apps.list', 'apps.launch') else 'other',
                             'outcome': e.get('outcome') if e.get('outcome') in ('pending', 'completed', 'permission_denied', 'disabled', 'busy', 'identity_changed', 'not_allowed', 'unavailable') else 'other'}
                            for e in value.get('events', []) if isinstance(e, dict) and e.get('appId') == 'GlassHome1.GlassHome'][:20]}


def collect(owner, revision, seconds, report, clock=time.monotonic, pause=time.sleep):
    status = owner.raw('/status', timeout=8)
    build = status.get('app') or {}
    if build.get('sourceRevision') != revision or build.get('sourceDirty') is not False:
        raise RuntimeError('Expected clean Vetro service is not running')
    initial = diagnostics(owner, revision)
    report['before'] = initial
    report['permissionsBefore'] = permissions(owner)
    report['samples'] = []
    print('CAPTURING: open Glass Home normally, open +, let Checking apps finish, then choose Connect to Vetro once.', flush=True)
    print('Keep Glass Home visible. This collector only reads Vetro; it does not reopen apps.', flush=True)
    started, notice, last = clock(), 0, initial
    while clock() - started < seconds:
        current = diagnostics(owner, revision)
        elapsed = round(clock() - started, 1)
        if current != last and len(report['samples']) < 100:
            report['samples'].append({'seconds': elapsed, 'diagnostics': current})
            last = current
        if elapsed >= notice:
            counts = current['requests'].get('counts') or {}
            print(str(round(elapsed)) + 's: received=' + str(counts.get('received', 0)) +
                  ', dispatched=' + str(counts.get('dispatch', 0)), flush=True)
            notice = elapsed + 10
        pause(min(2, max(0, seconds - (clock() - started))))
    report['after'] = diagnostics(owner, revision)
    report['permissionsAfter'] = permissions(owner)
    report['captureSeconds'] = round(clock() - started, 1)
    report['captureComplete'] = True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project-root', type=Path, required=True)
    parser.add_argument('--tv', type=lambda s: str(ipaddress.IPv4Address(s)), required=True)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--report-host', required=True)
    parser.add_argument('--seconds', type=int, default=90)
    args = parser.parse_args()
    if not args.project_root.is_dir() or not re.fullmatch(r'[a-f0-9]{40}', args.revision) or not 30 <= args.seconds <= 180 or not re.fullmatch(r'[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+', args.report_host):
        parser.error('Use an existing project, full revision, 30–180 seconds and user@host')
    directory = args.project_root.resolve() / 'vetro-install'
    output = directory / 'access-diagnostics' / ('native-requests-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S-%f') + '.json')
    report = {'schema': 1, 'expectedRevision': args.revision, 'normalMode': True,
              'readOnly': True, 'captureComplete': False, 'errors': []}
    print('=== Vetro native request watch START ===', flush=True)
    try:
        owner = OwnerClient('http://' + args.tv + ':8099', directory / 'combined-updates')
        if not owner.token:
            raise RuntimeError('Existing owner pairing is required; no pairing was started')
        collect(owner, args.revision, args.seconds, report)
    except (Exception, KeyboardInterrupt) as error:
        report['errors'].append(str(error) if isinstance(error, RuntimeError) else type(error).__name__)
        print('CAPTURE LIMIT: ' + report['errors'][-1], flush=True)
    finally:
        try:
            output.parent.mkdir(parents=True, exist_ok=True)
            with output.open('x', encoding='utf-8') as file:
                json.dump(report, file, indent=2)
                file.write('\n')
            print('Report: ' + str(output))
            print('Run this on your Mac to retrieve the report:')
            print('rsync -P ' + shlex.quote(args.report_host + ':' + str(output)) + ' ~/Downloads/')
        finally:
            print('=== Vetro native request watch END ===', flush=True)


if __name__ == '__main__':
    main()
