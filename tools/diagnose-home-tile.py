#!/usr/bin/env python3
"""Read launcher evidence while the owner operates the Samsung Home tile."""
import argparse
import base64
import datetime
import ipaddress
import json
import os
from pathlib import Path
import shlex
import sys
import urllib.error

from vetro_owner import OwnerClient

HOME_IDS = {'com.samsung.tv.csfs', 'com.samsung.tv.coba.newhome',
            'com.samsung.tv.home.sidebar', 'com.samsung.tv.home.media'}
STATE_KEYS = ('enabled', 'customApp', 'customHomeDisabled', 'homeShortcut',
              'doubleHome', 'autorunWas', 'noMotion', 'since')

# Fixed, read-only commands. Do not launch apps, signal processes, write the
# launcher FIFO, change registry flags, or query unrelated service logs.
STATE_COMMAND = 'head -c 16384 /opt/usr/home/owner/share/vetro-dock.json'
EVIDENCE_COMMAND = r'''
printf 'TV_CLOCK\n'; date -u
printf 'ARCHITECTURE\n'; uname -m
printf 'UPTIME\n'; cat /proc/uptime
printf 'HOME_TILE_ROWS\n'
for f in /opt/usr/home/owner/share/vetro-dock-apps.tsv /opt/usr/home/owner/share/vetro-dock-custom.tsv; do
    if [ -f "$f" ]; then
        printf '%s\n' "$f"
        awk -F '\t' '$1 == "samsunghome" || $1 == "customhome" {print $1 "\t" $2 "\t" $3 "\t" $4}' "$f" | head -c 4096
    fi
done
printf '\nNATIVE_LAUNCHER_HASH\n'
for f in /usr/apps/vetrotvapp/res/wgt/native/dock/tvlauncher-dotnet.dll /opt/usr/apps/vetrotvapp/res/wgt/native/dock/tvlauncher-dotnet.dll; do
    if [ -f "$f" ]; then sha256sum "$f"; fi
done
printf 'LAUNCHER_PID_FILE\n'; head -c 32 /home/owner/tvlauncher.pid 2>/dev/null
printf '\nRELEVANT_PROCESSES\n'
for p in /proc/[0-9]*; do
    [ -r "$p/comm" ] || continue
    read -r name < "$p/comm" || continue
    case "$name" in dotnet|app_launcher|*csfs*|*home*|*coba*|*wrt*) ;; *) continue ;; esac
    cmd=$(tr '\000' ' ' < "$p/cmdline" 2>/dev/null)
    case "$cmd" in
        *tvlauncher-dotnet.dll*|*com.samsung.tv.csfs*|*com.samsung.tv.coba.newhome*|*com.samsung.tv.home.sidebar*|*com.samsung.tv.home.media*)
            printf 'pid=%s ' "${p##*/}"
            printf '%s' "$cmd" | head -c 1024
            printf '\n'
            awk '/^(Name|State|PPid|Threads):/' "$p/status" 2>/dev/null
            printf 'wchan='; head -c 128 "$p/wchan" 2>/dev/null; printf '\n'
            ;;
    esac
done
printf 'LAUNCHER_LOG\n'
tail -n 180 /home/owner/tvlauncher.log 2>/dev/null | tail -c 49152
printf '\nCAPTURE_FINISHED\n'
'''


def timestamp():
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')


def selected(value, keys):
    return {k: value[k] for k in keys if k in value} if isinstance(value, dict) else {}


def safe_error(error):
    # Exception bodies and request objects can contain credentials. Report only
    # the failure class, plus HTTP status where available.
    if isinstance(error, urllib.error.HTTPError):
        return 'HTTP ' + str(error.code)
    return type(error).__name__


def remote(owner, source):
    command = 'printf %s ' + base64.b64encode(source.encode()).decode() + ' | base64 -d | sh'
    reply = owner.request('/exec', {'cmd': command}, timeout=45)
    if not isinstance(reply, dict):
        raise ValueError('Unexpected execution response')
    output = str(reply.get('output', ''))
    # The root agent's legacy protocol can leave line endings escaped.
    if '\n' not in output:
        output = output.replace('\\n', '\n').replace('\\r', '\r')
    return {'exit_code': reply.get('exit_code'), 'timed_out': reply.get('timed_out', False),
            'output': output[:100000], 'truncated': len(output) > 100000}


def capture(owner, label):
    print('Capturing ' + label + '...', flush=True)
    snapshot = {'label': label, 'at': timestamp(), 'errors': {}}

    def attempt(name, operation):
        try:
            snapshot[name] = operation()
        except Exception as error:
            snapshot['errors'][name] = safe_error(error)
            print('  ' + name + ': ' + safe_error(error), flush=True)

    # Logs first so slower registry reads cannot displace the relevant lines.
    attempt('launcherEvidence', lambda: remote(owner, EVIDENCE_COMMAND))

    def state():
        value = remote(owner, STATE_COMMAND)
        if value['exit_code'] != 0 or value['timed_out']:
            return {'readFailed': True, 'exit_code': value['exit_code'], 'timed_out': value['timed_out']}
        return selected(json.loads(value['output']), STATE_KEYS)

    def service():
        value = owner.request('/status')
        return {'app': selected(value.get('app'), ('version', 'sourceRevision', 'builtAt')),
                'agent': selected(value.get('agent'), ('connected',)),
                **selected(value, ('mode', 'running', 'prepared'))}

    def inventory():
        value = owner.request('/apps?refresh=1')
        return {**selected(value, ('registryError', 'source', 'at')),
                'homeApps': [selected(row, ('appId', 'packageId', 'name', 'disabled', 'show', 'system', 'launchRisk'))
                             for row in value.get('apps', []) if row.get('appId') in HOME_IDS]}

    def input_state():
        value = owner.request('/input').get('status', {})
        return {'policy': selected(value.get('policy'), ('mode', 'connected')),
                'preference': selected(value.get('preference'), ('enabled',))}

    attempt('savedLauncherState', state)
    attempt('service', service)
    attempt('samsungHomeRegistry', inventory)
    attempt('remoteInput', input_state)
    return snapshot


def write_report(path, report):
    # Every run has a unique filename; a rerun cannot overwrite earlier evidence.
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW
    fd = os.open(path, flags, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(report, stream, indent=2)
        stream.write('\n')


def run(args, prompt=input, owner=None):
    project = Path(args.project_root).expanduser().resolve()
    if not project.is_dir():
        print('The existing samsung-tv-tools project folder was not found.')
        return 1
    work = project / 'vetro-install' / 'home-suite-20261108-r1'
    work.mkdir(parents=True, exist_ok=True)
    report_path = work / ('home-tile-' + timestamp() + '.json')
    report = {'diagnostic': 'home-tile-r1', 'started': timestamp(), 'complete': False,
              'tvChanges': 'None issued by this collector; the owner operates the remote.', 'snapshots': []}
    result = 1
    try:
        owner = owner or OwnerClient('http://' + str(ipaddress.IPv4Address(args.tv)) + ':8099',
                                     project / 'vetro-install' / 'combined-updates')
        if not owner.request('/exec').get('connected'):
            print('Vetro root is not connected. Open Vetro and let its checks finish before rerunning.')
            report['failure'] = 'root_not_connected'
            return 1
        print('Leave the launcher and Remapper settings as they are. You will operate the remote twice.')
        report['snapshots'].append(capture(owner, 'before'))
        write_report(report_path, report)
        print('\nTEST 1: Press Home once, then select the Samsung Home tile as usual.')
        print('Wait two seconds. Return here and describe what happened: opened, stayed closed, or briefly appeared.')
        outcome = prompt('Result: ').strip()[:240]
        snapshot = capture(owner, 'normal_selection')
        snapshot['observation'] = outcome
        report['snapshots'].append(snapshot)
        write_report(report_path, report)
        print('\nTEST 2: Press Home once to show the Vetro launcher.')
        print('Highlight Samsung Home, wait FOUR seconds, then briefly press and release OK once.')
        print('Wait two seconds, then return here and describe what happened.')
        outcome = prompt('Result: ').strip()[:240]
        snapshot = capture(owner, 'selection_after_four_seconds')
        snapshot['observation'] = outcome
        report['snapshots'].append(snapshot)
        report['complete'] = True
        result = 0
        if any(s['errors'] for s in report['snapshots']):
            print('Both attempts were captured; some optional checks failed. Return the report as it is.')
        else:
            print('Both attempts were captured. Return the report for review.')
    except (KeyboardInterrupt, EOFError):
        report['failure'] = 'interrupted'
        print('\nCapture stopped; the evidence collected so far will be saved.')
    except Exception as error:
        report['failure'] = safe_error(error)
        print('Capture stopped: ' + safe_error(error) + '. Return the report; no install was attempted.')
    finally:
        report['finished'] = timestamp()
        write_report(report_path, report)
        print('Report: ' + str(report_path))
        if args.report_host:
            print('Run on your Mac:')
            print('rsync -P ' + shlex.quote(args.report_host + ':' + str(report_path)) + ' ~/Downloads/')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project-root', required=True)
    parser.add_argument('--tv', required=True)
    parser.add_argument('--report-host')
    args = parser.parse_args()
    print('=== Vetro Samsung Home capture START ===', flush=True)
    result = 1
    try:
        result = run(args)
    except Exception as error:
        print('Could not save the capture: ' + safe_error(error))
    finally:
        print('=== Vetro Samsung Home capture END: ' + ('complete' if result == 0 else 'incomplete') + ' ===', flush=True)
    return result


if __name__ == '__main__':
    sys.exit(main())
