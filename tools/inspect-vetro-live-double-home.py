#!/usr/bin/env python3
"""Capture one live application of the currently saved double-press setting."""
import argparse
import base64
import datetime
import fcntl
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import shlex

from vetro_owner import OwnerClient

REVISION = '1768e251784adb14dc007052c5b9a45e567e2777'
RUN_DIR = '/home/owner'
SETTINGS_FILE = RUN_DIR + '/tvlauncher-double-home.tsv'
ROOTS = ['/opt/usr/apps/vetrotvapp/res/wgt', '/usr/apps/vetrotvapp/res/wgt']
DOCK_KEYS = ('enabled', 'customApp', 'running', 'pid', 'busy', 'doubleHome', 'homeShortcut', 'error', 'probeError')


class Stop(RuntimeError):
    pass


def shell(source):
    return 'printf %s ' + base64.b64encode(source.encode()).decode() + ' | base64 -d | sh'


def execute(owner, command):
    result = owner.request('/exec', {'cmd': command}, timeout=45)
    if not isinstance(result, dict):
        raise Stop('The root command did not return an object.')
    return {key: result.get(key) for key in ('ok', 'exit_code', 'timed_out', 'output', 'stderr', 'error')}


def snapshot(owner, pid):
    # Only fixed launcher paths and the validated native PID are inspected.
    source = '''
printf 'ACK64='
ack=/home/owner/tvlauncher-double-home.tsv.applied
if [ -f "$ack" ] && [ "$(wc -c < "$ack")" -le 256 ]; then base64 "$ack" | tr -d '\\n'; fi
printf '\\nPIDFILE='
if [ -f /home/owner/tvlauncher.pid ]; then head -c 32 /home/owner/tvlauncher.pid; fi
printf '\\nCMDLINE64='
if [ -f /proc/PID/cmdline ]; then head -c 4096 /proc/PID/cmdline | base64 | tr -d '\\n'; fi
printf '\\nIPC_METADATA\\n'
ls -ld /home/owner /home/owner/tvlauncher.fifo /home/owner/tvlauncher-double-home.tsv.applied 2>/dev/null
printf 'LAUNCHER_EVENTS\\n'
if [ -f /home/owner/tvlauncher.log ]; then
  tail -n 120 /home/owner/tvlauncher.log | grep -E 'double Home setting applied|double-press|start pid=|reload-double-home' | tail -n 24
fi
printf 'INSPECTION_DONE\\n'
'''.replace('/proc/PID/', '/proc/' + str(pid) + '/')
    value = execute(owner, shell(source))
    if value.get('exit_code') != 0 or value.get('timed_out'):
        raise Stop('The launcher inspection did not complete.')
    output = str(value.get('output') or '')
    if len(output) > 20000:
        raise Stop('The launcher inspection exceeded its output limit.')
    # Preserve the original response as evidence; normalize escaped line endings
    # only for extraction, matching the existing host maintenance client.
    normalized = output.replace('\\n', '\n').replace('\\r', '\r')
    match = re.search(r'^ACK64=([A-Za-z0-9+/=]*)$', normalized, re.M)
    ack = base64.b64decode(match[1], validate=True).decode('ascii') if match else None
    return {'inspection': value, 'acknowledgement': ack}


def dock_status(owner):
    value = owner.request('/dock', timeout=30)
    return {key: value.get(key) for key in DOCK_KEYS}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project-root', required=True)
    parser.add_argument('--tv', required=True, type=lambda value: str(ipaddress.IPv4Address(value)))
    parser.add_argument('--report-host', required=True)
    args = parser.parse_args()
    os.umask(0o077)
    report = {'diagnostic': 'live-double-home-reply-r1', 'complete': False, 'requestSubmitted': False}
    report_path = None
    lock = None
    result = 1
    print('=== Vetro live-save reply check START ===', flush=True)
    try:
        project = Path(args.project_root).expanduser().resolve()
        if not project.is_dir():
            raise Stop('The existing project folder was not found.')
        folder = project / 'vetro-install' / 'live-double-home-reply-r1'
        folder.mkdir(parents=True, exist_ok=True)
        lock = (folder / 'inspection.lock').open('a')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        report_path = folder / ('reply-' + stamp + '.json')
        owner = OwnerClient('http://' + args.tv + ':8099', project / 'vetro-install/combined-updates')
        status = owner.request('/status', timeout=10)
        report['sourceRevision'] = status.get('app', {}).get('sourceRevision')
        if report['sourceRevision'] != REVISION or not status.get('agent', {}).get('connected'):
            raise Stop('The expected r2 build and its root connection must be running.')
        before = dock_status(owner)
        report['before'] = before
        pid = before.get('pid')
        if (before.get('busy') or before.get('enabled') is not True or before.get('customApp')
                or before.get('running') is not True or type(pid) is not int or pid <= 0):
            raise Stop('The Vetro overlay must be running and idle; current settings were left untouched.')
        setting = before.get('doubleHome')
        if (not isinstance(setting, dict) or type(setting.get('enabled')) is not bool
                or setting.get('mode') not in ('app', 'shortcut')
                or (setting['mode'] == 'app' and not re.fullmatch(r'[A-Za-z0-9_.-]{1,120}', str(setting.get('appId', ''))))):
            raise Stop('The saved double-press setting could not be validated.')
        located = execute(owner, shell('for d in ' + ' '.join(map(shlex.quote, ROOTS)) + '; do\n'
            'if [ -f "$d/native/dock/tvlauncher-dotnet.dll" ]; then printf "%s" "$d"; break; fi\ndone'))
        root = str(located.get('output') or '').strip()
        if located.get('exit_code') != 0 or located.get('timed_out') or root not in ROOTS:
            raise Stop('The installed launcher package path was not confirmed.')
        report['beforeInspection'] = snapshot(owner, pid)
        current = dock_status(owner)
        if any(current.get(key) != before.get(key) for key in ('enabled', 'customApp', 'doubleHome', 'homeShortcut', 'pid', 'running')) or current.get('busy'):
            raise Stop('The launcher or settings changed during inspection; no live request was sent.')
        nonce = secrets.token_hex(16)
        mode = setting['mode'] if setting['enabled'] else 'off'
        request = '\t'.join(['v1', nonce, str(pid), mode, setting['appId'] if mode == 'app' else '']) + '\n'
        command = '/usr/bin/dotnet ' + shlex.quote(root + '/native/dock/tvlauncher-dotnet.dll')
        command += ' --apply-double-home ' + shlex.quote(base64.b64encode(request.encode()).decode())
        command += ' --dir ' + shlex.quote(RUN_DIR) + ' --double-home-settings ' + shlex.quote(SETTINGS_FILE)
        report['request'] = request
        report['requestSubmitted'] = True
        report_path.write_text(json.dumps(report, indent=2) + '\n')
        print('Applying the already-saved double-press setting once and recording the exact helper reply...', flush=True)
        helper = execute(owner, command)
        # The invoked helper handles only a non-secret settings request. Bound its
        # diagnostic output and retain exact text, including extra line endings.
        for key in ('output', 'stderr', 'error'):
            if isinstance(helper.get(key), str):
                helper[key] = helper[key][:8192]
        report['helper'] = helper
        report['afterInspection'] = snapshot(owner, pid)
        after = dock_status(owner)
        report['after'] = after
        expected = 'double-home-applied ' + nonce
        output = str(helper.get('output') or '')
        report['checks'] = {
            'helperSucceeded': helper.get('exit_code') == 0 and not helper.get('timed_out'),
            'exactReply': output.strip() == expected,
            'exactReplyLine': expected in output.splitlines(),
            'acknowledgementMatches': report['afterInspection']['acknowledgement'] == request,
            'sameLauncher': after.get('running') is True and after.get('pid') == pid,
            'savedSettingsUnchanged': all(after.get(key) == before.get(key) for key in ('enabled', 'customApp', 'doubleHome', 'homeShortcut')),
        }
        for key, value in report['checks'].items():
            print(key + ': ' + str(value), flush=True)
        report['complete'] = True
        result = 0
        print('Reply evidence captured. This does not mark the dashboard issue as fixed.', flush=True)
    except (Exception, KeyboardInterrupt) as error:
        report['error'] = str(error) if isinstance(error, Stop) else type(error).__name__
        print('STOPPED: ' + report['error'], flush=True)
    finally:
        if report_path:
            try:
                report_path.write_text(json.dumps(report, indent=2) + '\n')
                print('Report: ' + str(report_path), flush=True)
                print('Run this in a terminal on your Mac:', flush=True)
                print('rsync -P ' + shlex.quote(args.report_host + ':' + str(report_path)) + ' ~/Downloads/', flush=True)
            except Exception:
                result = 1
                print('Report could not be saved; retain the terminal output.', flush=True)
        if lock:
            lock.close()
        print('=== Vetro live-save reply check END: ' + ('CAPTURED' if result == 0 else 'STOPPED') + ' ===', flush=True)
    return result


if __name__ == '__main__':
    raise SystemExit(main())
