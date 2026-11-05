#!/usr/bin/env python3
"""Finish an existing input handoff without installing or relaunching an app."""
import argparse
import copy
import datetime
import fcntl
import ipaddress
import json
import os
from pathlib import Path
import re
import tempfile
import time
import urllib.error

from vetro_owner import OwnerClient
from input_update_handoff import input_summary
import app_access_input_audit as audit

REVISION = '6104eeaa7507d10f28edb68f08e37cff4d627aa5'
KNOWN_ERRORS = frozenset((
    'Remote service is stopped', 'Remote setup cancelled',
    'A remote shortcut change is already in progress',
    'Root service is not ready. Home setup was not completed.',
    'Saved physical remote is unavailable. Detect Home again.',
    'input inventory unavailable', 'select a unique physical remote device',
    'input request cancelled', 'native input helper did not connect',
    'input helper disconnected; original keys released',
    'invalid input authentication', 'unexpected input helper identity',
    'input helper launch failed', 'input listener closed before launch',
    'TV is busy; try again in a few seconds', 'no root agent connected',
    'Launch cancelled because power or the startup choice changed',
    'Remote setting could not be saved to disk',
    'Pair this device in the Vetro dashboard first',
))


def error_detail(error):
    detail = {'type': type(error).__name__}
    if isinstance(error, urllib.error.HTTPError):
        detail['httpStatus'] = error.code
        try:
            with error:
                data = error.read(8193)
            body = json.loads(data) if len(data) <= 8192 else {}
            message = body.get('error') if isinstance(body, dict) else None
            detail['reason'] = message if message in KNOWN_ERRORS else 'unrecognized-response'
        except (ValueError, OSError, TypeError):
            detail['reason'] = 'unreadable-response'
    return detail


def validate_record(record):
    before = record.get('before') or {}
    if record.get('schema') != 1 or record.get('targetRevision') != REVISION:
        raise RuntimeError('Recorded input handoff does not match the installed update')
    if not (record.get('required') is True and before.get('mode') == 'filter'
            and before.get('connected') is True and before.get('savedEnabled') is True
            and record.get('observationConfirmed') is True and record.get('oldFilterExited') is True):
        raise RuntimeError('A verified saved input handoff is required; no input change attempted')


def read_state(owner):
    status = owner.raw('/status', timeout=8)
    build, agent = status.get('app') or {}, status.get('agent') or {}
    if build.get('sourceRevision') != REVISION or build.get('sourceDirty') is not False:
        raise RuntimeError('The running service is not the expected clean revision')
    pid = (status.get('self') or {}).get('pid')
    if type(pid) is not int or pid <= 0:
        raise RuntimeError('Current service PID is unavailable')
    result = {'servicePid': pid, 'rootConnected': agent.get('connected') is True}
    if result['rootConnected']:
        data = owner.raw('/input', timeout=15)
        result['input'] = input_summary(data)
        result['input']['node'] = ((data.get('status') or {}).get('policy') or {}).get('node')
        if not isinstance(result['input']['node'], str) or not re.fullmatch(r'/dev/input/event[0-9]{1,6}', result['input']['node']):
            result['input']['node'] = None
        messages = [data.get('error'), (data.get('status') or {}).get('error')]
        result['inputErrors'] = [m for m in messages if isinstance(m, str) and m in KNOWN_ERRORS]
        result['otherInputError'] = any(isinstance(m, str) and bool(m) and m not in KNOWN_ERRORS for m in messages)
        screen = owner.raw('/screen?live=1', timeout=8)
        result['recovering'] = (screen.get('input') or {}).get('recovering') is True
    return result


def healthy(state, record):
    value = state.get('input') or {}
    return (state.get('rootConnected') is True and value.get('mode') == 'filter'
            and value.get('connected') is True and value.get('savedEnabled') is True
            and (not record['before'].get('homeReady') or value.get('homeReady') is True))


def recover(owner, record, report, save, clock=time.monotonic, pause=time.sleep):
    validate_record(record)
    report.update(samples=[], requestErrors=[], resumeSubmitted=False, verified=False)
    started = clock()

    def observe(seconds):
        deadline = clock() + seconds
        current = None
        while True:
            try:
                current = read_state(owner)
                current['seconds'] = round(clock() - started, 1)
                report['samples'].append(current)
                value = current.get('input') or {}
                print('Input: mode={}; connected={}; Home ready={}; recovering={}'.format(
                    value.get('mode'), value.get('connected'), value.get('homeReady'), current.get('recovering')), flush=True)
                if value and value.get('savedEnabled') is not True:
                    raise RuntimeError('Saved input was disabled; no resume will be attempted')
                if healthy(current, record):
                    return current
            except (urllib.error.URLError, TimeoutError, OSError) as error:
                detail = error_detail(error)
                report['requestErrors'].append(detail)
                print('Input read:', json.dumps(detail), flush=True)
                if detail.get('httpStatus') in (401, 403):
                    raise RuntimeError('Existing owner access was refused; no pairing or input change attempted') from None
                current = None
            if clock() >= deadline:
                return current
            pause(min(5, max(0, deadline - clock())))

    def finish(state):
        record['after'] = {k: v for k, v in state['input'].items() if k != 'node'}
        record['verified'] = True
        record['observationRequested'] = False
        report['verified'] = True
        report['inputHandoff'] = copy.deepcopy(record)
        save(record)
        print('VERIFIED: saved remote input and Home assignment are connected.', flush=True)

    print('Waiting for automatic input restoration before requesting any change...', flush=True)
    current = observe(30)
    if current and healthy(current, record):
        finish(current)
        return
    if not current or not current.get('rootConnected'):
        raise RuntimeError('The service/root connection is not ready; no resume attempted')

    # Read only process/socket facts. Never kill a helper or replace saved settings.
    evidence = audit.summarize(owner.raw('/exec', {'cmd': audit.command(current['servicePid'])}, timeout=40))
    report['processEvidence'] = evidence
    if not evidence.get('complete'):
        raise RuntimeError('Input process evidence is incomplete; no resume attempted')
    current = read_state(owner)
    report['samples'].append(dict(current, seconds=round(clock()-started, 1)))
    if healthy(current, record):
        finish(current)
        return
    if current['servicePid'] != evidence.get('currentServicePid') or not current.get('rootConnected'):
        raise RuntimeError('Service changed during verification; no resume attempted')
    value = current.get('input') or {}
    if value.get('savedEnabled') is not True:
        raise RuntimeError('Saved input was disabled; no resume attempted')
    if current.get('recovering') or value.get('mode') == 'filter':
        raise RuntimeError('Input recovery is already active; no competing resume attempted')
    if value.get('mode') not in ('off', 'observe'):
        raise RuntimeError('Input mode is unavailable; no resume attempted')
    if any(h.get('mode') == 'filter' or h.get('currentServiceConnectionObserved') is not True for h in evidence.get('helpers', [])):
        raise RuntimeError('Another or unverified input helper is present; no resume attempted')

    report['resumeSubmitted'] = True
    record['resumeRequested'] = True
    save(record)
    print('Requesting the saved remote setup once...', flush=True)
    try:
        answer = owner.raw('/input', {'mode': 'resume'}, timeout=40)
        report['resumeReply'] = {'ok': answer.get('ok') is True}
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        detail = error_detail(error)
        report['resumeReply'] = detail
        print('Resume response:', json.dumps(detail), flush=True)
    # A timeout or cancellation may coincide with automatic recovery. Check
    # the resulting state without replaying an uncertain request.
    current = observe(30)
    if current and healthy(current, record):
        finish(current)
        return
    raise RuntimeError('Remote input remains unverified; the report contains the response and resulting state')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project-root', required=True)
    parser.add_argument('--tv', required=True)
    parser.add_argument('--report-host', required=True)
    args = parser.parse_args()
    project = Path(args.project_root).expanduser().resolve()
    tv = str(ipaddress.IPv4Address(args.tv))
    if not project.is_dir() or not re.fullmatch(r'[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+', args.report_host):
        raise RuntimeError('Use the existing project folder and user@host report destination')
    os.umask(0o077)
    directory = project / 'vetro-install/beta-recovery'
    journal = directory / ('input-handoff-' + REVISION[:12] + '.json')
    output = project / 'vetro-install/access-diagnostics'
    output.mkdir(parents=True, exist_ok=True)
    report_path = output / ('input-recovery-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S-%f') + '.json')
    report = {'schema': 1, 'expectedRevision': REVISION, 'changes': 'Finish the recorded saved-input handoff only; no install, app relaunch, pairing or settings changes.'}
    lock = None
    record = None
    print('=== Vetro saved input recovery START ===', flush=True)
    try:
        lock = (directory / 'diagnostic-update.lock').open('a')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        record = json.loads(journal.read_text())
        validate_record(record)
        report['inputHandoffBefore'] = copy.deepcopy(record)
        owner = OwnerClient('http://' + tv + ':8099', project / 'vetro-install/combined-updates')
        if not owner.token:
            raise RuntimeError('Existing owner pairing is required; no pairing started')

        def save(value):
            fd, temporary = tempfile.mkstemp(prefix=journal.name + '.', suffix='.tmp', dir=directory)
            try:
                with os.fdopen(fd, 'w') as out:
                    json.dump(value, out, indent=2)
                    out.flush()
                    os.fsync(out.fileno())
                os.replace(temporary, journal)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)

        recover(owner, record, report, save)
    except (Exception, KeyboardInterrupt) as error:
        report['error'] = str(error) if isinstance(error, RuntimeError) else error_detail(error)
        print('STOPPED:', report['error'], flush=True)
    finally:
        if record is not None:
            report['inputHandoff'] = record
        if lock:
            lock.close()
        with report_path.open('x') as out:
            json.dump(report, out, indent=2)
            out.write('\n')
        print('Report:', report_path)
        print('Run this on your Mac to retrieve the report:')
        print('rsync -P ' + args.report_host + ':' + str(report_path) + ' ~/Downloads/')
        print('=== Vetro saved input recovery END ===', flush=True)
    return report.get('verified') is True


if __name__ == '__main__':
    raise SystemExit(0 if main() else 1)
