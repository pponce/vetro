#!/usr/bin/env python3
"""Observe normal Vetro exit/reopening without launching or stopping any app."""
import argparse
import base64
import datetime
import ipaddress
import json
import os
from pathlib import Path
import re
import select
import shlex
import time
import urllib.error

from vetro_owner import OwnerClient

REVISION = '6104eeaa7507d10f28edb68f08e37cff4d627aa5'
ROOTS = ('/opt/usr/apps/vetrotvapp', '/usr/apps/vetrotvapp',
    '/opt/usr/home/owner/apps_rw/vetrotvapp')
MARKERS = {'1': 'screen-closed', '2': 'reopen-did-not-show-screen',
    '3': 'screen-visible-with-error', '4': 'screen-green', '5': 'tv-store-opened',
    '6': 'tv-store-closed'}


def shell(pid, roots=ROOTS):
    if type(pid) is not int or not 1 <= pid <= 2147483647:
        raise ValueError('Current service PID required')
    script = r'''printf 'VETRO_LIFECYCLE|1\n'
printf 'CLOCK|'; date +%s
life_seen=0
for life_dir in /proc/[0-9]*; do
 life_seen=$((life_seen+1)); [ "$life_seen" -le 1024 ] || break
 life_pid=${life_dir##*/}
 life_comm=''; IFS= read -r life_comm < "$life_dir/comm" 2>/dev/null || continue
 case "$life_comm:$life_pid" in
  wrt*:*|WebProcess*:*|webprocess*:*|node*:*|vetro*:*|*:__SERVICE_PID__) ;;
  *) continue;;
 esac
 life_role=$(tr '\000' '\n' < "$life_dir/cmdline" 2>/dev/null | awk '
  /vetrotvapp/ {found=1}
  /vetrotvapp[.]app/ {ui=1}
  /vetrotvapp[.]svc|vetrotvapp.*service\/main[.]js/ {svc=1}
  END {if(found)print ui?"screen-candidate":svc?"service-candidate":"package-candidate"}')
 [ "$life_pid" != '__SERVICE_PID__' ] || life_role='current-service'
 [ -n "$life_role" ] || continue
 awk -v pid="$life_pid" -v role="$life_role" '{sub(/^.*[)] /,"");split($0,f," ");
  if(f[2]~/^[0-9]+$/ && f[20]~/^[0-9]+$/ && f[1]~/^[A-Z]$/)
   printf "PROCESS|%s|%s|%s|%s|%s\n",pid,f[2],f[20],f[1],role}' "$life_dir/stat" 2>/dev/null
done
life_paths=$(
 for life_root in __ROOTS__; do
  life_real=$(readlink -f "$life_root" 2>/dev/null)
  [ -d "$life_real" ] || continue
  find "$life_real" -maxdepth 7 -type f -name vetro-widget-session.json 2>/dev/null
 done | sort -u | head -n 3
)
life_count=0
while IFS= read -r life_file; do
 [ -n "$life_file" ] || continue
 [ -f "$life_file" ] && [ ! -L "$life_file" ] || continue
 life_size=$(stat -c %s "$life_file" 2>/dev/null)
 case "$life_size" in ''|*[!0-9]*) continue;; esac
 [ "$life_size" -gt 0 ] && [ "$life_size" -le 512 ] || continue
 life_count=$((life_count+1))
 life_json=$(cat "$life_file" 2>/dev/null)
 life_token=$(printf '%s' "$life_json" | sed -n 's/.*"token":"\([a-f0-9]*\)".*/\1/p')
 life_expires=$(printf '%s' "$life_json" | sed -n 's/.*"expires":\([0-9]*\).*/\1/p')
 case "$life_token" in ''|*[!a-f0-9]*) life_token='';; esac
 [ "${#life_token}" -eq 64 ] || life_token=''
 case "$life_expires" in ''|*[!0-9]*) life_expires='-';; esac
 life_meta=$(stat -c '%Y|%i' "$life_file" 2>/dev/null)
 life_status='-'; life_pairing='-'
 if [ -n "$life_token" ] && command -v curl >/dev/null 2>&1; then
  # Only loopback receives the credential, via curl's standard input. It never
  # appears in argv, stdout, stderr or a report. Response bodies are discarded.
  life_status=$(printf 'header = "X-Vetro-Widget: %s"\nheader = "Origin: null"\n' "$life_token" | curl -q --noproxy '*' --silent --connect-timeout 2 --max-time 3 --output /dev/null --write-out '%{http_code}' --config - 'http://127.0.0.1:8099/status' 2>/dev/null)
  life_pairing=$(printf 'header = "X-Vetro-Widget: %s"\nheader = "Origin: null"\n' "$life_token" | curl -q --noproxy '*' --silent --connect-timeout 2 --max-time 3 --output /dev/null --write-out '%{http_code}' --config - 'http://127.0.0.1:8099/auth/pending' 2>/dev/null)
 fi
 printf 'FILE|%s|%s|%s|%s|%s\n' "$life_file" "$life_expires" "$life_meta" "$life_status" "$life_pairing"
 life_token=''; life_json=''
done <<VETRO_PRIVATE_PATHS
$life_paths
VETRO_PRIVATE_PATHS
printf 'END|%s\n' "$life_count"
'''.replace('__SERVICE_PID__', str(pid)).replace('__ROOTS__', ' '.join(shlex.quote(p) for p in roots))
    return script


def command(pid):
    encoded = base64.b64encode(shell(pid).encode()).decode('ascii')
    return 'printf %s ' + encoded + ' | base64 -d | sh'


def integer(text):
    return int(text) if isinstance(text, str) and re.fullmatch(r'[0-9]{1,20}', text) else None


def evidence(result):
    result = result if isinstance(result, dict) else {}
    output = result.get('output', '')
    out = {'complete': False, 'processes': [], 'credentialFiles': [],
        'execExitCode': result.get('exit_code') if type(result.get('exit_code')) is int else None,
        'timedOut': result.get('timed_out') is True, 'stderrPresent': bool(result.get('stderr'))}
    if not isinstance(output, str) or len(output) > 65536:
        return out
    header = ended = False
    for line in output.splitlines()[:256]:
        fields = line.split('|')
        if fields == ['VETRO_LIFECYCLE', '1']:
            header = True
        elif len(fields) == 2 and fields[0] == 'CLOCK':
            out['tvEpochSeconds'] = integer(fields[1])
        elif len(fields) == 6 and fields[0] == 'PROCESS' and len(out['processes']) < 32:
            if all(integer(v) is not None for v in fields[1:4]) and re.fullmatch('[A-Z]', fields[4]) and fields[5] in (
                'current-service', 'screen-candidate', 'service-candidate', 'package-candidate'):
                out['processes'].append(dict(zip(('pid','parentPid','startTicks','state','role'),
                    [int(fields[1]),int(fields[2]),int(fields[3]),fields[4],fields[5]])))
        elif len(fields) == 7 and fields[0] == 'FILE' and len(out['credentialFiles']) < 3:
            if not re.fullmatch(r'/[A-Za-z0-9_./-]{1,500}/vetro-widget-session[.]json', fields[1]):
                continue
            out['credentialFiles'].append({'path': fields[1], 'expires': integer(fields[2]),
                'modifiedSeconds': integer(fields[3]), 'inode': integer(fields[4]),
                'statusHttp': int(fields[5]) if re.fullmatch(r'[0-5][0-9]{2}', fields[5]) else None,
                'pairingHttp': int(fields[6]) if re.fullmatch(r'[0-5][0-9]{2}', fields[6]) else None})
        elif len(fields) == 2 and fields[0] == 'END' and integer(fields[1]) is not None:
            ended = True
    out['complete'] = header and ended and out['execExitCode'] == 0 and not out['timedOut']
    return out


def public_state(owner):
    try:
        value = owner.raw('/status', timeout=6, authenticated=False)
    except urllib.error.HTTPError as error:
        if error.code not in (401, 503):
            raise
        with error:
            data = error.read(1024*1024+1)
        if len(data)>1024*1024:
            raise ValueError('Diagnostic response too large')
        value = json.loads(data)
    d = value.get('connectionDiagnostics') or {}
    return {k:d.get(k) for k in ('sourceRevision','sourceDirty','startedAt','lifecycle',
        'storage','widgetBootstrap','widget','screen')}


def collect(owner, seconds, report, tty=None):
    start = time.monotonic()
    report['samples'] = []
    report['markers'] = []
    print('CAPTURING: use the TV normally to close Vetro and try reopening it. Do not run another diagnostic script.', flush=True)
    print('Optional terminal markers: 1=closed, 2=would not open, 3=error, 4=green, 5=TV-Store opened, 6=TV-Store closed; type a number and Enter. q ends the capture.', flush=True)
    next_sample = start
    while time.monotonic()-start <= seconds:
        if tty and select.select([tty], [], [], 0)[0]:
            key = tty.readline().strip()
            if key == 'q':
                break
            if key in MARKERS:
                report['markers'].append({'seconds': round(time.monotonic()-start,1), 'event': MARKERS[key]})
        if time.monotonic() < next_sample:
            time.sleep(0.2)
            continue
        row = {'seconds': round(time.monotonic()-start,1)}
        try:
            row['service'] = public_state(owner)
            status = owner.raw('/status', timeout=6)
            build, agent = status.get('app') or {}, status.get('agent') or {}
            if build.get('sourceRevision') != REVISION or build.get('sourceDirty') is not False:
                row['error'] = 'Different running revision; process/credential probe skipped'
            elif agent.get('connected') is not True:
                row['error'] = 'Root connection unavailable; process/credential probe skipped'
            else:
                pid = (status.get('self') or {}).get('pid')
                row['servicePid'] = pid
                row['runtime'] = evidence(owner.raw('/exec', {'cmd': command(pid)}, timeout=40))
        except Exception as error:
            row['error'] = type(error).__name__
        report['samples'].append(row)
        runtime = row.get('runtime') or {}
        codes = [(r['statusHttp'],r['pairingHttp']) for r in runtime.get('credentialFiles',[])]
        print(str(round(row['seconds'])) + 's: service PID=' + str(row.get('servicePid')) +
            '; screen process candidates=' + str(sum(p['role']=='screen-candidate' for p in runtime.get('processes',[]))) +
            '; published credential status/pairing=' + str(codes) + ('; '+row['error'] if row.get('error') else ''), flush=True)
        next_sample = time.monotonic()+5
    report['captureSeconds'] = round(time.monotonic()-start,1)
    report['captureComplete'] = True


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--project-root',type=Path,required=True)
    p.add_argument('--tv',required=True)
    p.add_argument('--report-host',required=True)
    p.add_argument('--seconds',type=int,default=180)
    args=p.parse_args()
    tv=str(ipaddress.IPv4Address(args.tv))
    if not args.project_root.is_dir() or not 30<=args.seconds<=600 or not re.fullmatch(r'[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+',args.report_host):
        p.error('Use the existing project, a user@host report destination and 30–600 seconds')
    os.umask(0o077)
    root=args.project_root.resolve()/'vetro-install'
    output=root/'access-diagnostics'/('screen-lifecycle-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S-%f')+'.json')
    report={'schema':1,'expectedRevision':REVISION,'captureComplete':False,'errors':[],
        'changes':'Read-only observation. No app launch, stop, install, pairing, permission or input change.',
        'limitation':'Process matching and private-file locations are best effort; missing candidates do not prove termination. Local credential probes test the published file, not the screen cache. Telemetry can be stale. Sampling can affect timing.'}
    tty=None
    print('=== Vetro normal exit and authentication capture START ===',flush=True)
    try:
        owner=OwnerClient('http://'+tv+':8099',root/'combined-updates')
        if not owner.token:
            raise RuntimeError('Existing owner pairing required')
        try:
            tty=open('/dev/tty','r')
        except OSError:
            pass
        collect(owner,args.seconds,report,tty)
    except (Exception,KeyboardInterrupt) as error:
        report['errors'].append(type(error).__name__)
        print('CAPTURE STOPPED: '+type(error).__name__,flush=True)
    finally:
        if tty:tty.close()
        try:
            output.parent.mkdir(parents=True,exist_ok=True)
            with output.open('x',encoding='utf-8') as f:
                json.dump(report,f,indent=2)
                f.write('\n')
            print('Report: '+str(output))
            print('Run this on your Mac to retrieve the report:')
            print('rsync -P '+shlex.quote(args.report_host+':'+str(output))+' ~/Downloads/')
        finally:
            print('=== Vetro normal exit and authentication capture END ===',flush=True)


if __name__=='__main__':
    main()
