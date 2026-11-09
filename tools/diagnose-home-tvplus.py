#!/usr/bin/env python3
"""Record physical Home routing and Samsung TV Plus transitions during remote tests."""
import argparse
import base64
import datetime
import ipaddress
import json
import os
from pathlib import Path
import shlex
import urllib.error

from vetro_owner import OwnerClient


EVIDENCE = r'''
printf 'TV_CLOCK\n'
date -u
printf 'CURRENT_PRESENTATION\n'
for key in memory/system/source_type memory/appfw/current_fullscreen_appid memory/appfw/current_partial_appid db/menu/smart_hub/ontvsetting/auto_start; do
    vconftool get "$key" 2>&1
done
printf 'HOME_FIFO_METADATA\n'
stat -c '%F mode=%a uid=%u inode=%i' /home/owner/tvlauncher-home.fifo 2>/dev/null
printf 'RUNNING_HOME_APPS\n'
app_launcher -S 2>/dev/null | awk 'tolower($0) ~ /apple|tvplus|com.samsung.tv.home|coba|csfs|vetro/ {print}' | head -c 4096
printf '\nNATIVE_PROCESSES\n'
for p in /proc/[0-9]*; do
    [ -r "$p/comm" ] || continue
    read -r name < "$p/comm" || continue
    [ "$name" = dotnet ] || continue
    commandline=$(tr '\000' ' ' < "$p/cmdline" 2>/dev/null)
    case "$commandline" in
        *SamsungTvRemoteInputAgent.dll*) printf 'remote-input-helper pid=%s\n' "${p##*/}" ;;
        *tvlauncher-dotnet.dll*) printf 'native-launcher pid=%s\n' "${p##*/}" ;;
    esac
done
printf 'INPUT_ERROR_CLASSES\n'
if [ -r /tmp/vetro-input.log ]; then
    tail -c 8192 /tmp/vetro-input.log | grep -oE '[A-Za-z.]+Exception|Permission denied|Device or resource busy|No such file or directory' | sort -u
fi
printf 'LAUNCHER_EVENTS\n'
tail -n 240 /home/owner/tvlauncher.log 2>/dev/null | awk '/Home|guard:|launch |start pid=|fifo|FIFO|home key/' | tail -c 32768
printf '\nCAPTURE_FINISHED\n'
:
'''

STATIC_EVIDENCE = r'''
printf 'ARCHITECTURE\n'
uname -m
printf 'INSTALLED_NATIVE_HASHES\n'
for root in /usr/apps/vetrotvapp/res/wgt /opt/usr/apps/vetrotvapp/res/wgt; do
    for name in payload/SamsungTvRemoteInputAgent.dll native/dock/tvlauncher-dotnet.dll; do
        if [ -f "$root/$name" ]; then sha256sum "$root/$name"; fi
    done
done
printf 'STATX_SYMBOL\n'
if command -v readelf >/dev/null 2>&1; then
    for name in /lib/libc.so.6 /usr/lib/libc.so.6; do
        if [ -f "$name" ]; then readelf -Ws "$name" 2>/dev/null | awk '$8 ~ /^statx(@|$)/ {print $8}'; fi
    done
else
    printf 'readelf unavailable\n'
fi
:
'''


def stamp():
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')


def pick(value, keys):
    return {k: value[k] for k in keys if k in value} if isinstance(value, dict) else {}


def error_name(error):
    return 'HTTP ' + str(error.code) if isinstance(error, urllib.error.HTTPError) else type(error).__name__


def remote(owner, source):
    encoded = base64.b64encode(source.encode()).decode()
    value = owner.request('/exec', {'cmd': 'printf %s ' + encoded + ' | base64 -d | sh'}, timeout=45)
    output = str(value.get('output', ''))
    if '\n' not in output:
        output = output.replace('\\n', '\n').replace('\\r', '\r')
    return {'exit_code': value.get('exit_code'), 'timed_out': value.get('timed_out', False),
            'output': output[:65536], 'truncated': len(output) > 65536}


def input_summary(value):
    status = value.get('status', {})
    return {
        'policy': pick(status.get('policy'), ('mode', 'connected', 'node', 'blocked')),
        'preference': pick(status.get('preference'), ('enabled', 'node')),
        'errorPresent': bool(value.get('error') or status.get('error')),
        'devices': [pick(d, ('node', 'selectable', 'unique')) for d in value.get('devices', [])],
        'homeEvents': [pick(e, ('sequence', 'node', 'code', 'value', 'action', 'decision',
                                'time_seconds', 'time_microseconds', 'tv_source', 'tv_source_type',
                                'tv_fullscreen_appid', 'tv_partial_appid'))
                       for e in status.get('events', []) if e.get('code') == 63][-20:]}


def capture(owner, label, observation=''):
    print('Capturing ' + label + '...', flush=True)
    result = {'label': label, 'at': stamp(), 'observation': observation, 'errors': {}}
    # Preserve the small input ring and launch log before doing slower state reads.
    checks = (
        ('input', lambda: input_summary(owner.request('/input', timeout=20))),
        ('evidence', lambda: remote(owner, EVIDENCE)),
        ('dock', lambda: pick(owner.request('/dock', timeout=30),
                             ('enabled', 'customApp', 'running', 'homeShortcut', 'doubleHome'))))
    for name, operation in checks:
        try:
            result[name] = operation()
        except Exception as error:
            result['errors'][name] = error_name(error)
            print('  ' + name + ': ' + error_name(error), flush=True)
    return result


def save(path, report):
    with path.open('w') as stream:
        json.dump(report, stream, indent=2)
        stream.write('\n')


def run(args, prompt=input, owner=None):
    os.umask(0o077)
    project = Path(args.project_root).expanduser().resolve()
    if not project.is_dir():
        raise RuntimeError('The existing samsung-tv-tools project folder was not found.')
    work = project / 'vetro-install' / 'home-tvplus-diagnostic-r1'
    work.mkdir(parents=True, exist_ok=True)
    path = work / ('home-tvplus-' + stamp() + '.json')
    report = {'diagnostic': 'home-tvplus-r1', 'complete': False, 'snapshots': [],
              'scope': 'Read-only evidence. The owner operates the remote; no settings, app launches, or interception changes are issued by the collector.'}
    outcome = 1
    try:
        owner = owner or OwnerClient('http://' + args.tv + ':8099', project / 'vetro-install/combined-updates')
        status = owner.request('/status', timeout=15)
        report['service'] = {'app': pick(status.get('app'), ('version', 'sourceRevision')),
                             'agent': pick(status.get('agent'), ('connected',))}
        if not report['service']['agent'].get('connected'):
            raise RuntimeError('Root is not connected. Open Vetro and let its checks finish before rerunning.')
        report['staticEvidence'] = remote(owner, STATIC_EVIDENCE)
        state = remote(owner, 'head -c 16384 /opt/usr/home/owner/share/vetro-dock.json')
        if state['exit_code'] == 0 and not state['timed_out']:
            report['savedLauncher'] = pick(json.loads(state['output']),
                ('enabled', 'customApp', 'customHomeDisabled', 'homeShortcut', 'doubleHome', 'autorunWas'))
        print('Leave Launcher, Remapper, and TV startup settings as they are for this capture.', flush=True)
        print('Use the same physical remote that showed the problem. Avoid double presses.', flush=True)
        prompt('Open Apple TV, close any overlay with Back, then press Enter here: ')
        report['snapshots'].append(capture(owner, 'apple_tv_before_home'))
        current = report['snapshots'][-1].get('input', {})
        policy = current.get('policy', {})
        print('Current input: mode=' + str(policy.get('mode', 'unknown')) +
              ', connected=' + str(policy.get('connected', False)) +
              ', saved interception=' + str(current.get('preference', {}).get('enabled', False)), flush=True)
        save(path, report)
        steps = (
            ('home_from_apple_tv',
             'Press Home ONCE from Apple TV. Wait 4 seconds without pressing another remote button. Describe any Samsung flash/loading icon and what remains visible: '),
            ('samsung_home_tile',
             'Open the Vetro overlay if needed, select its Samsung Home tile, then wait 4 seconds. Describe the visible screen and whether TV Plus started: '),
            ('home_from_samsung_home',
             'If Samsung Home is visible, press Home ONCE, then wait 4 seconds without other remote input. Describe the launcher and any TV Plus takeover. If Samsung Home was not visible, type skipped and do not press Home: '))
        for label, instruction in steps:
            observation = prompt('\n' + instruction).strip()[:400]
            report['snapshots'].append(capture(owner, label, observation))
            save(path, report)
        report['complete'] = True
        outcome = 0
        print('Captured. Return the report before changing startup settings or reinstalling.', flush=True)
    except (EOFError, KeyboardInterrupt):
        report['failure'] = 'interrupted'
        print('\nStopped; saving the evidence collected so far.', flush=True)
    except Exception as error:
        report['failure'] = error_name(error)
        print('Capture stopped: ' + error_name(error) + '. Return the report.', flush=True)
    finally:
        report['finished'] = stamp()
        save(path, report)
        print('Report: ' + str(path), flush=True)
        print('Run on your Mac:', flush=True)
        print('rsync -P ' + shlex.quote(args.report_host + ':' + str(path)) + ' ~/Downloads/', flush=True)
    return outcome


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project-root', default=str(Path.home() / 'devProjects/samsung-tv-tools'))
    parser.add_argument('--tv', required=True, type=lambda x: str(ipaddress.IPv4Address(x)))
    parser.add_argument('--report-host', required=True)
    args = parser.parse_args()
    result = 1
    print('=== Vetro Home / TV Plus capture START ===', flush=True)
    try:
        result = run(args)
    except Exception as error:
        print('Capture stopped: ' + error_name(error), flush=True)
    finally:
        print('=== Vetro Home / TV Plus capture END: ' + ('OK' if result == 0 else 'STOPPED') + ' ===', flush=True)
    return result


if __name__ == '__main__':
    raise SystemExit(main())
