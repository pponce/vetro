"""Bounded, read-only process/socket evidence for Vetro input diagnostics."""
import base64
import re


def command(service_pid):
    if not isinstance(service_pid, int) or isinstance(service_pid, bool) or not 1 <= service_pid <= 2147483647:
        raise ValueError('A valid current service PID is required')
    return _shell_envelope(_script(service_pid))


def _shell_envelope(script):
    # Older native agents double backslashes when constructing ProcessStartInfo
    # arguments. Send an ASCII payload without backslashes, then decode it for
    # sh so awk/tr/printf receive the intended bytes. No TV file is written.
    encoded = base64.b64encode(script.encode('utf-8')).decode('ascii')
    return "printf '%s' '" + encoded + "' | base64 -d | /bin/sh"


def _script(service_pid):
    return r'''printf 'VETRO_INPUT_AUDIT|1\nSERVICE|__SERVICE_PID__\n'
probe_seen=0
probe_ids=':__SERVICE_PID__:'
probe_helpers=''
for probe_dir in /proc/[0-9]*; do
    probe_seen=$((probe_seen+1))
    if [ "$probe_seen" -gt 1024 ]; then printf 'LIMIT|identity\n'; break; fi
    probe_pid=${probe_dir##*/}
    probe_comm=''
    IFS= read -r probe_comm < "$probe_dir/comm" 2>/dev/null || continue
    case "$probe_comm" in
        dotnet|SamsungTvRemote*|tvlauncher*|TvLauncher*)
            probe_identity=$(tr '\000' '\n' < "$probe_dir/cmdline" 2>/dev/null | awk -v pid="$probe_pid" '
                function base(value,n,parts){n=split(value,parts,"/");return parts[n]}
                base($0)=="SamsungTvRemoteInputAgent.dll" {helper=NR}
                base($0)=="tvlauncher-dotnet.dll" {launcher=NR}
                helper && NR==helper+1 {loopback=($0=="127.0.0.1")}
                helper && NR==helper+2 && $0 ~ /^[0-9]+$/ && $0>0 && $0<65536 {port=$0}
                helper && NR==helper+4 {node=$0;sub(/^.*@/,"",node);if(index(node,"/dev/input/event")!=1 || substr(node,17)!~/^[0-9]+$/)node="-"}
                helper && NR==helper+7 {mode=($0=="filter" || $0=="observe")?$0:"-"}
                launcher && $0=="--mapped-home" {mapped=1}
                launcher && $0=="--hidden" {hidden=1}
                launcher && wantcode && $0~/^[0-9]+$/ && $0<=767 {homecode=$0;wantcode=0}
                launcher && $0=="--home-code" {wantcode=1}
                END {if(helper)printf "HELPER|%s|%s|%s|%s|%d\n",pid,port?port:"-",node?node:"-",mode?mode:"-",loopback;
                    if(launcher)printf "LAUNCHER|%s|%d|%s|%d\n",pid,mapped,homecode!=""?homecode:"-",hidden}')
            if [ -n "$probe_identity" ]; then
                printf '%s\n' "$probe_identity"
                probe_ids="$probe_ids$probe_pid:"
                probe_helpers="$probe_helpers
$probe_identity"
            fi
            ;;
    esac
done
probe_ports=':'
for probe_port in $(printf '%s\n' "$probe_helpers" | awk -F '|' '$1=="HELPER" && $6=="1" && $3~/^[0-9]+$/ {print $3}'); do
    probe_hex=$(printf '%04X' "$probe_port")
    probe_ports="$probe_ports$probe_hex:"
done
probe_tcp=$(awk -v ports="$probe_ports" '
    FNR==1 {next}
    NF>=10 && $10~/^[0-9]+$/ {
        split($2,local,":");split($3,remote,":");
        loopback=(local[1]=="0100007F" && remote[1]=="0100007F");
        if(($4=="0A" && (local[2]=="1FA3" || index(ports,":"local[2]":"))) || (loopback && (index(ports,":"local[2]":") || index(ports,":"remote[2]":")))) {
            if(++count>128){print "LIMIT|tcp";exit}
            printf "TCP|%s|%s|%s|%s|%d\n",$10,local[2],remote[2],$4,loopback;
        }
    }' /proc/net/tcp /proc/net/tcp6 2>/dev/null)
printf '%s\n' "$probe_tcp"
probe_inodes=$(printf '%s\n' "$probe_tcp" | awk -F '|' '$1=="TCP" {printf ":%s:",$2}')
probe_seen=0
probe_matched=0
for probe_dir in /proc/[0-9]*; do
    probe_seen=$((probe_seen+1))
    if [ "$probe_seen" -gt 1024 ]; then printf 'LIMIT|processes\n'; break; fi
    probe_pid=${probe_dir##*/}
    probe_fds=$(ls -l "$probe_dir/fd" 2>/dev/null | awk -v pid="$probe_pid" -v wanted="$probe_inodes" '
        NF>=3 && $(NF-1)=="->" && $(NF-2)~/^[0-9]+$/ {
            if(++count>512){printf "LIMIT|fd|%s\n",pid;exit}
            target=$NF;fd=$(NF-2);
            if((index(target,"/dev/input/event")==1 && substr(target,17)~/^[0-9]+$/) || target=="/dev/uinput" || target=="/dev/input/uinput")
                printf "FD|%s|%s|input|%s\n",pid,fd,target;
            else if(substr(target,1,8)=="socket:[" && substr(target,length(target),1)=="]") {
                inode=substr(target,9,length(target)-9);
                if(inode~/^[0-9]+$/ && index(wanted,":"inode":"))printf "FD|%s|%s|socket|%s\n",pid,fd,inode;
            }
        }')
    case "$probe_ids" in *:"$probe_pid":*) probe_include=1;; *) probe_include=0;; esac
    if [ -n "$probe_fds" ] || [ "$probe_include" = 1 ]; then
        probe_matched=$((probe_matched+1))
        if [ "$probe_matched" -gt 64 ]; then printf 'LIMIT|matched-processes\n'; break; fi
        probe_comm=$(tr -cd 'A-Za-z0-9_. -' < "$probe_dir/comm" 2>/dev/null | cut -c 1-40)
        probe_exe=$(readlink "$probe_dir/exe" 2>/dev/null)
        probe_exe=$(printf '%s' "${probe_exe##*/}" | tr -cd 'A-Za-z0-9_. -' | cut -c 1-64)
        probe_parent=$(awk '$1=="PPid:" && $2~/^[0-9]+$/ {print $2}' "$probe_dir/status" 2>/dev/null)
        probe_uid=$(awk '$1=="Uid:" && $2~/^[0-9]+$/ {print $2}' "$probe_dir/status" 2>/dev/null)
        probe_start=$(awk '{sub(/^.*[)] /,"");split($0,fields," ");if(fields[20]~/^[0-9]+$/)print fields[20]}' "$probe_dir/stat" 2>/dev/null)
        printf 'PROCESS|%s|%s|%s|%s|%s|%s\n' "$probe_pid" "$probe_parent" "$probe_uid" "$probe_comm" "$probe_exe" "$probe_start"
        printf '%s\n' "$probe_fds"
    fi
done
printf 'END|%s|%s\n' "$probe_seen" "$probe_matched"
'''.replace('__SERVICE_PID__', str(service_pid))


def _number(value, maximum=2147483647):
    return int(value) if isinstance(value, str) and re.fullmatch(r'[0-9]{1,20}', value) and int(value) <= maximum else None


def summarize(result):
    """Never retain raw stdout/stderr, command lines, addresses or token paths."""
    data = result if isinstance(result, dict) else {}
    text = data.get('output', '')
    out = {'complete': False, 'coverage': 'best-effort-non-atomic', 'currentServicePid': None, 'processes': [], 'helpers': [], 'launchers': [], 'tcp': [], 'limits': [],
           'execExitCode': data.get('exit_code') if type(data.get('exit_code')) is int else None,
           'timedOut': data.get('timed_out') is True, 'stderrPresent': bool(data.get('stderr')),
           'limitation': 'Complete means the bounded collection finished, not that every process was readable. Exited or unreadable /proc entries may be absent. Open input file descriptors do not prove which process holds an exclusive EVIOCGRAB; absent socket ownership is not proof that no connection exists.'}
    if not isinstance(text, str) or len(text.encode('utf-8')) > 65536:
        out['limits'].append('output-unavailable-or-too-large')
        return out
    processes = {}
    valid_header = False
    ended = False
    for line in text.splitlines()[:4096]:
        fields = line.split('|')
        kind = fields[0]
        if fields == ['VETRO_INPUT_AUDIT', '1']:
            valid_header = True
        elif kind == 'SERVICE' and len(fields) == 2:
            out['currentServicePid'] = _number(fields[1])
        elif kind == 'LIMIT':
            if len(out['limits']) < 16 and len(fields) >= 2 and fields[1] in ('identity', 'tcp', 'processes', 'fd', 'matched-processes'):
                out['limits'].append(fields[1])
        elif kind == 'PROCESS' and len(fields) == 7 and len(processes) < 64:
            pid = _number(fields[1])
            if pid and re.fullmatch(r'[A-Za-z0-9_. -]{0,40}', fields[4]) and re.fullmatch(r'[A-Za-z0-9_. -]{0,64}', fields[5]):
                processes[pid] = {'pid': pid, 'ppid': _number(fields[2]), 'uid': _number(fields[3]), 'comm': fields[4], 'executable': fields[5],
                                  'startTicks': _number(fields[6], 2**64-1), 'fds': []}
        elif kind == 'FD' and len(fields) == 5:
            process = processes.get(_number(fields[1]))
            fd = _number(fields[2], 1048576)
            if process and fd is not None and len(process['fds']) < 128:
                if fields[3] == 'input' and re.fullmatch(r'/dev/(?:input/event[0-9]{1,6}|uinput|input/uinput)', fields[4]):
                    process['fds'].append({'fd': fd, 'kind': 'input', 'node': fields[4]})
                elif fields[3] == 'socket' and _number(fields[4], 2**64-1) is not None:
                    process['fds'].append({'fd': fd, 'kind': 'socket', 'inode': int(fields[4])})
        elif kind == 'HELPER' and len(fields) == 6 and len(out['helpers']) < 32:
            pid = _number(fields[1])
            if pid:
                out['helpers'].append({'pid': pid, 'callbackPort': _number(fields[2], 65535), 'loopback': fields[5] == '1',
                                       'node': fields[3] if re.fullmatch(r'/dev/input/event[0-9]{1,6}', fields[3]) else None,
                                       'mode': fields[4] if fields[4] in ('filter', 'observe') else None})
        elif kind == 'LAUNCHER' and len(fields) == 5 and len(out['launchers']) < 16:
            pid = _number(fields[1])
            if pid:
                out['launchers'].append({'pid': pid, 'mappedHome': fields[2] == '1', 'homeCode': _number(fields[3], 767), 'hidden': fields[4] == '1'})
        elif kind == 'TCP' and len(fields) == 6 and len(out['tcp']) < 128:
            inode = _number(fields[1], 2**64-1)
            if inode is not None and all(re.fullmatch(r'[0-9A-F]{4}', value) for value in fields[2:4]) and re.fullmatch(r'[0-9A-F]{2}', fields[4]):
                out['tcp'].append({'inode': inode, 'localPort': int(fields[2], 16), 'remotePort': int(fields[3], 16), 'state': fields[4], 'loopback': fields[5] == '1'})
        elif kind == 'END' and len(fields) == 3 and _number(fields[1]) is not None and _number(fields[2]) is not None:
            ended = True
    out['processes'] = list(processes.values())
    for socket in out['tcp']:
        socket['ownerPids'] = sorted(process['pid'] for process in out['processes'] if any(fd.get('inode') == socket['inode'] for fd in process['fds']))
    for helper in out['helpers']:
        callback = [socket for socket in out['tcp'] if socket['localPort'] == helper['callbackPort']]
        helper['callbackListenerPids'] = sorted({pid for socket in callback if socket['state'] == '0A' for pid in socket['ownerPids']})
        helper['callbackConnectionPids'] = sorted({pid for socket in callback if socket['state'] == '01' and socket['loopback'] for pid in socket['ownerPids']})
        helper['currentServiceConnectionObserved'] = out['currentServicePid'] in helper['callbackConnectionPids']
    out['complete'] = valid_header and ended and data.get('exit_code') == 0 and data.get('timed_out') is not True and not out['limits']
    if not ended:
        out['limits'].append('collection-incomplete')
    return out
