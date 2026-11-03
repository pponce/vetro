#!/usr/bin/env python3
"""Collect a bounded Vetro connection report using unauthenticated status reads."""
import argparse
import datetime
import json
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

MAX_BYTES = 2 * 1024 * 1024

def read_status(url):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    request = urllib.request.Request(url, headers={'Accept': 'application/json'})
    try:
        response = opener.open(request, timeout=6)
    except urllib.error.HTTPError as error:
        if error.code not in (401, 503):
            raise
        response = error
    with response:
        body = response.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES:
        raise ValueError('Response limit exceeded')
    result = json.loads(body)
    if not isinstance(result, dict):
        raise ValueError('Unexpected response')
    return result

def progress(status, revision):
    diagnostic = status.get('connectionDiagnostics', {}) if isinstance(status, dict) else {}
    if not isinstance(diagnostic, dict):
        diagnostic = {}
    widget = diagnostic.get('widget') or {}
    screen = diagnostic.get('screen') or {}
    detail = widget.get('replyDiagnostics') or {}
    service_ok = diagnostic.get('sourceRevision') == revision and diagnostic.get('sourceDirty') is False
    screen_ok = screen.get('sourceRevision') == revision
    checks_done = screen_ok and screen.get('runningChecks') is False
    matrix_done = detail.get('schema') == 2 and detail.get('phase') == 'complete'
    session_received = screen_ok and screen.get('sessionReceived') is True
    return {
        'runningServiceVerified': service_ok,
        'screenBuildVerified': screen_ok,
        'screenChecksFinished': checks_done,
        'replyMatrixComplete': matrix_done,
        'screenSessionReceived': session_received,
        'complete': service_ok and checks_done and (matrix_done or session_received)
    }

def collect(url, revision, wait=180, fetch=read_status, clock=time.monotonic, pause=time.sleep, announce=print):
    if not re.fullmatch(r'[a-f0-9]{40}', revision):
        raise ValueError('Expected a full source revision')
    started = clock()
    status = None
    errors = set()
    next_notice = 0
    while True:
        try:
            status = fetch(url)
        except Exception as error:
            errors.add(type(error).__name__)
        state = progress(status, revision)
        elapsed = max(0, clock() - started)
        if state['complete'] or elapsed >= wait:
            break
        if elapsed >= next_notice:
            announce('Waiting for Vetro to finish its screen checks (' + str(round(elapsed)) + ' seconds)...')
            next_notice = elapsed + 15
        pause(min(3, wait - elapsed))
    return {
        'capture': dict(schema=1, expectedRevision=revision,
                        capturedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                        waitedSeconds=round(elapsed, 1), readErrors=sorted(errors), **state),
        'status': status
    }

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:8099/status')
    parser.add_argument('--revision', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--wait', type=int, default=180)
    args = parser.parse_args()
    if not 0 <= args.wait <= 300:
        parser.error('--wait must be between 0 and 300 seconds')
    report = collect(args.url, args.revision, args.wait)
    with args.output.open('x', encoding='utf-8') as output:
        json.dump(report, output, indent=2)
        output.write('\n')
    print(('COMPLETE' if report['capture']['complete'] else 'PARTIAL') + ' connection report saved: ' + str(args.output))
    print('Return this JSON file for analysis. It contains no pairing code or browser credential.')

if __name__ == '__main__':
    main()
