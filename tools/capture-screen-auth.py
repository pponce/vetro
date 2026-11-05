#!/usr/bin/env python3
"""Inspect Vetro screen authentication and finish a recorded input handoff.

Uses an existing owner pairing and preserves the running screen by default.
An explicit --inspect-screen relaunches only the screen for Web Inspector.
No install, service restart, pairing reset, or permission change is performed.
Private widget credentials remain on the TV. Network/header capture is disabled.
"""
import argparse
import copy
import datetime
import fcntl
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import re
import shlex
import tempfile
import time
import urllib.parse

from input_update_handoff import InputHandoff, input_summary
from vetro_owner import OwnerClient

spec = importlib.util.spec_from_file_location('screen_capture_transport',
    Path(__file__).with_name('capture-glass-access.py'))
wire = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wire)
Error = wire.CaptureError
APP = 'vetrotvapp.app'
REVISION = '542fd3da54fafc2bb01a6b3eb5665869beda9f0f'
FILES = {
    'service/widget-bootstrap-client.js': 'eaf716a31ad34dc24814b9cc395f99676230eef9e7a373b72aab63059349465c',
    'service/widget-bootstrap.js': '826cd8e37a03c26208f68c5355ad9dbd27dd3987cfb8dedf3871f9deaae057bc',
    'service/auth.js': '9792b9e48f79cfbf14ba1c1c2f62f05828992bd5e36fb23fec1beae178f9cde7',
}

# Observe timing and flags, never credential values, pairing codes, headers,
# response bodies, console messages, localStorage, or arbitrary page text.
SNAPSHOT = r'''(function(){
function b(n){return window[n]===true;}
function code(v){var m=String(v||'').match(/HTTP (\d{3})/);return m?Number(m[1]):null;}
var counts={status:0,screen:0,pairing:0},latest={status:null,screen:null,pairing:null};
var entries=window.performance&&performance.getEntriesByType?performance.getEntriesByType('resource'):[];
entries.forEach(function(e){
 var key=e.name==='http://127.0.0.1:8099/status'?'status':
  /^http:\/\/127\.0\.0\.1:8099\/screen(?:\?live=1)?$/.test(e.name)?'screen':
  e.name==='http://127.0.0.1:8099/auth/pending'?'pairing':null;
 if(key){counts[key]++;latest[key]=Math.round(e.startTime+e.duration);}
});
var credential=window.widgetCredential,error=window.screenConnectionError,client=window.widgetClient;
return {visible:document.hidden===false,ready:document.readyState==='complete',
 running:b('running'),screenBusy:b('liveScreenBusy'),pairingBusy:b('pairingBusy'),
 summaryReady:b('summaryReady'),authenticated:b('widgetServiceAuthenticated'),
 screenAuthFailure:!!(error&&error.authentication),screenHttp:error&&error.status||null,
 pairingHttp:code(window.pairingError),credentialPresent:!!credential,
 credentialExpiresIn:credential&&typeof credential.expires==='number'?Math.round((credential.expires-Date.now())/1000):null,
 credentialReadPending:!!window.widgetConnecting,clientPresent:!!client,
 diagnosticsPresent:!!(client&&client.diagnostics),screenEpoch:window.screenEpoch,
 retryCodePresent:typeof window.pollScreen==='function'&&String(window.pollScreen).indexOf('needsSummary')>=0,
 requestCounts:counts,lastCompletionMs:latest,
 observedAtMs:window.performance&&performance.now?Math.round(performance.now()):null};
}())'''

# Direct read-only requests use the same local, scoped credential as the screen.
# The diagnostic query marker excludes these requests from automatic-retry counts.
# No credential or response body is returned through the inspector connection.
PROBE = r'''(function(){
var cached=window.widgetCredential;
function valid(d){return d&&typeof d.token==='string'&&/^[a-f0-9]{64}$/.test(d.token);}
function request(token,route){return new Promise(function(resolve){
 var xhr=new XMLHttpRequest(),done=false;
 function finish(kind){if(done)return;done=true;resolve({status:xhr.status||0,result:kind});}
 try{xhr.open('GET','http://127.0.0.1:8099'+route+'?screen_auth_capture=1',true);
 xhr.timeout=4000;xhr.setRequestHeader('X-Vetro-Widget',token);
 xhr.onload=function(){finish('response');};xhr.onerror=function(){finish('network-error');};
 xhr.ontimeout=function(){finish('timeout');};xhr.send(null);
 }catch(_){finish('request-error');}
});}
if(!window.VetroWidgetSession)return Promise.resolve({privateRead:false,readError:'reader-missing'});
return VetroWidgetSession.read(window.tizen,2500).then(function(fresh){
 if(!valid(fresh))return {privateRead:false,readError:'invalid-record'};
 return Promise.all([request(fresh.token,'/status'),request(fresh.token,'/auth/pending'),
  valid(cached)?request(cached.token,'/status'):Promise.resolve(null)]).then(function(values){
  return {privateRead:true,freshExpiresIn:Math.round((fresh.expires-Date.now())/1000),
   cachedPresent:valid(cached)===true,cachedMatchesFresh:valid(cached)?cached.token===fresh.token:null,
   freshStatus:values[0],freshPairing:values[1],cachedStatus:values[2]};
 });
},function(e){var message=String(e&&e.message||'');return {privateRead:false,
 readError:/timed out/.test(message)?'read-timeout':/expired/.test(message)?'unavailable-or-expired':'read-unavailable'};});
}())'''


def number(value, low=0, high=10**12):
    return value if type(value) in (int, float) and low <= value <= high else None


def snapshot(value):
    if not isinstance(value, dict):
        raise Error('Screen state was not returned by the inspector')
    booleans = ('visible', 'ready', 'running', 'screenBusy', 'pairingBusy', 'summaryReady',
        'authenticated', 'screenAuthFailure', 'credentialPresent', 'credentialReadPending',
        'clientPresent', 'diagnosticsPresent', 'retryCodePresent')
    result = {k: value.get(k) is True for k in booleans}
    result.update({k: number(value.get(k), 100, 599) for k in ('screenHttp', 'pairingHttp')})
    result['credentialExpiresIn'] = number(value.get('credentialExpiresIn'), -600, 300)
    for k in ('screenEpoch', 'observedAtMs'):
        result[k] = number(value.get(k))
    for k in ('requestCounts', 'lastCompletionMs'):
        data = value.get(k) if isinstance(value.get(k), dict) else {}
        result[k] = {route: number(data.get(route)) for route in ('status', 'screen', 'pairing')}
    return result


def probe_result(value):
    if not isinstance(value, dict):
        raise Error('Credential probe was not returned by the inspector')
    result = {'privateRead': value.get('privateRead') is True}
    result['readError'] = value.get('readError') if value.get('readError') in (
        'reader-missing', 'invalid-record', 'read-timeout', 'unavailable-or-expired', 'read-unavailable') else None
    result['freshExpiresIn'] = number(value.get('freshExpiresIn'), -600, 300)
    result['cachedPresent'] = value.get('cachedPresent') is True
    result['cachedMatchesFresh'] = value.get('cachedMatchesFresh') if type(value.get('cachedMatchesFresh')) is bool else None
    for key in ('freshStatus', 'freshPairing', 'cachedStatus'):
        item = value.get(key)
        result[key] = ({'status': number(item.get('status'), 0, 599),
            'result': item.get('result') if item.get('result') in ('response', 'network-error', 'timeout', 'request-error') else 'unknown'}
            if isinstance(item, dict) else None)
    return result


def evaluate(inspector, expression, asynchronous=False):
    answer = inspector.call('Runtime.evaluate', {'expression': expression,
        'returnByValue': True, 'awaitPromise': asynchronous})
    if answer.get('exceptionDetails'):
        raise Error('Screen evaluation failed; exception contents were not exported')
    return (answer.get('result') or {}).get('value')


def service_state(tv):
    data = wire.transport.read_json('http://' + tv + ':8099/status')
    diagnostic = data.get('connectionDiagnostics') or {}
    # This endpoint's diagnostic envelope already excludes credentials and codes.
    return {key: diagnostic.get(key) for key in ('sourceRevision', 'sourceDirty',
        'startedAt', 'lifecycle', 'storage', 'widgetBootstrap', 'widget', 'screen')}


def validate_service(owner):
    data = owner.raw('/status', timeout=8)
    build = data.get('app') or {}
    if build.get('sourceRevision') != REVISION or build.get('sourceDirty') is not False or (data.get('agent') or {}).get('connected') is not True:
        raise Error('Expected clean Vetro service with connected root access was not verified')
    return data


def observe_current(owner, tv, directory, report):
    validate_service(owner)
    report['serviceBefore'] = service_state(tv)
    try:
        restore_input(owner, directory, report)
    except Exception as error:
        report['errors'].append('Input verification: ' + wire.error_detail(error))
        print('INPUT NOT VERIFIED: ' + wire.error_detail(error), flush=True)
    report['samples'] = []
    print('Recording the current state for 30 seconds. Leave the screen open without pressing OK.', flush=True)
    started = time.monotonic()
    for index in range(7):
        current = service_state(tv)
        report['samples'].append({'seconds': round(time.monotonic()-started, 1), 'service': current})
        screen = current.get('screen') or {}
        print(str(round(time.monotonic()-started)) + 's: screen authentication recorded=' +
            str(screen.get('serviceAuthenticated')) + '; credential publications=' +
            str((current.get('widgetBootstrap') or {}).get('publications')), flush=True)
        if index < 6:
            time.sleep(max(0, started+(index+1)*5-time.monotonic()))
    report['serviceAfter'] = current
    report['inputAfter'] = input_summary(owner.raw('/input', timeout=15))
    report['serviceRestartObserved'] = report['serviceBefore'].get('startedAt') != current.get('startedAt')
    report['captureComplete'] = True


def restore_input(owner, directory, report):
    path = directory / 'beta-recovery' / ('input-handoff-' + REVISION[:12] + '.json')
    report['inputBefore'] = input_summary(owner.raw('/input', timeout=15))
    if not path.is_file():
        raise Error('Recorded input handoff is unavailable; no input change was attempted')
    record = json.loads(path.read_text())
    if record.get('schema') != 1 or record.get('targetRevision') != REVISION or not isinstance(record.get('before'), dict):
        raise Error('Recorded input handoff does not match this update')
    if record.get('required') and (record.get('observationConfirmed') is not True or record.get('oldFilterExited') is not True):
        raise Error('The previous input helper release was not verified; no input change was attempted')

    def save(current):
        fd, temporary = tempfile.mkstemp(prefix=path.name + '.', suffix='.tmp', dir=path.parent)
        try:
            with os.fdopen(fd, 'w') as out:
                json.dump(current, out, indent=2)
                out.flush()
                os.fsync(out.fileno())
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    try:
        InputHandoff(owner, record, save).restore(REVISION)
    finally:
        report['inputHandoff'] = copy.deepcopy(record)


def open_debug(stream):
    stream.local += 1
    stream.send(b'OPEN', stream.local, 0, ('shell:0 debug ' + APP).encode('ascii') + b'\0')
    command, a, b, payload = stream.frame()
    if command != b'OKAY' or not a or b != stream.local or payload:
        raise Error('TV did not open the Vetro debug stream')
    stream.remote = a
    output = bytearray()
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline:
        try:
            stream.pump()
        except wire.transport.ReadFailure:
            if stream.remote is not None:
                raise
            break
        output.extend(stream.buffer)
        stream.buffer.clear()
        if len(output) > 32768:
            raise Error('Debug launch response exceeded its size limit')
        if re.search(rb'port:\s*[0-9]+\s', output):
            break
    match = re.search(rb'port:\s*([0-9]{1,5})(?:\s|$)', output)
    if not match or not 1024 <= int(match[1]) <= 65535:
        raise Error('No Vetro inspector port was returned; debug launch was not retried')
    return int(match[1])


def page_path(tv, port, report):
    deadline = time.monotonic() + 60
    print('Waiting for the Vetro inspector page (up to 60 seconds)...', flush=True)
    while time.monotonic() < deadline:
        try:
            pages = wire.inspector_pages(tv, 26201, port, report=report, seconds=min(15, deadline-time.monotonic()))
        except (wire.CaptureError, TimeoutError) as error:
            if isinstance(error, wire.CaptureError) and str(error) not in (
                'TV did not open the inspector stream', 'Inspector page list is unavailable'):
                raise
            pages = []
        found = [p for p in pages if isinstance(p, dict) and p.get('type', 'page') == 'page' and
            (p.get('title') == 'Vetro' or 'vetrotvapp' in str(p.get('url', '')))]
        if len(found) > 1:
            raise Error('More than one Vetro inspector page was found')
        if found:
            url = urllib.parse.urlsplit(found[0].get('webSocketDebuggerUrl', ''))
            if url.scheme != 'ws' or url.query or url.fragment or not re.fullmatch(r'/devtools/page/[A-Za-z0-9_.-]+', url.path):
                raise Error('Unexpected Vetro inspector endpoint')
            return url.path
        time.sleep(1)
    raise Error('The Vetro inspector page did not become available')


def capture(owner, tv, directory, report):
    stream = debug = None
    reopen = False
    phase = 'service-check'
    try:
        validate_service(owner)
        report['serviceBefore'] = service_state(tv)
        phase = 'input-restoration'
        restore_input(owner, directory, report)
        phase = 'file-verification'
        report['filesMatch'] = wire.verify_files(owner, 'vetrotvapp', FILES)
        if not all(report['filesMatch'].values()):
            raise Error('Installed authentication files differ from the expected revision')
        phase = 'relay-check'
        relay_data = wire.read_json('http://' + tv + ':8077/relay')
        report['relayBefore'] = wire.relay_summary(relay_data)
        relay = relay_data.get('relay') or {}
        if relay.get('enabled') is not True or relay.get('listening') is not True or relay.get('error') or relay.get('port') != 26201 or type(relay.get('sessions')) is not int or relay['sessions'] != 0:
            raise Error('TV-Store relay must be ready with no other debug sessions')
        phase = 'sdb-check'
        debug = wire.connect(tv, 26201, seconds=50, report=report, purpose='screen-debug')
        print('Reopening only the Vetro screen in Web Inspector mode...', flush=True)
        phase = 'screen-debug-launch'
        reopen = True
        wire.remote(owner, '/usr/bin/app_launcher -k ' + APP + ' >/dev/null 2>&1\n:')
        port = open_debug(debug)
        report['debugFrames'] = wire.stream_evidence(debug)
        debug.close()
        debug = None
        phase = 'inspector-page'
        path = page_path(tv, port, report)
        stream = wire.connect(tv, 26201, 'tcp:' + str(port), seconds=160, report=report, purpose='screen-inspector')
        inspector = wire.Inspector(stream, port, path)
        report['inspectorAttached'] = True
        # Do not enable Network, Runtime console events, or other header/body feeds.
        phase = 'screen-observation'
        report['samples'] = []
        print('CAPTURING: leave Vetro visible for 60 seconds without pressing OK.', flush=True)
        started = time.monotonic()
        for index in range(13):
            value = snapshot(evaluate(inspector, SNAPSHOT))
            elapsed = round(time.monotonic() - started, 1)
            report['samples'].append({'seconds': elapsed, 'screen': value})
            if index % 2 == 0:
                print(str(round(elapsed)) + 's: authenticated=' + str(value['authenticated']) +
                    '; screen HTTP=' + str(value['screenHttp']) + '; pairing HTTP=' + str(value['pairingHttp']) +
                    '; completed screen requests=' + str(value['requestCounts']['screen']), flush=True)
            if index < 12:
                time.sleep(max(0, started + (index+1)*5 - time.monotonic()))
        phase = 'fresh-credential-probe'
        report['credentialProbe'] = probe_result(evaluate(inspector, PROBE, asynchronous=True))
        report['serviceDuringInspector'] = service_state(tv)
        report['captureComplete'] = True
    except Exception as error:
        report['failedPhase'] = phase
        report['errors'].append(wire.error_detail(error))
        print('CHECK STOPPED [' + phase + ']: ' + wire.error_detail(error), flush=True)
    finally:
        for client in (debug, stream):
            if client:
                try:
                    client.close()
                except Exception:
                    pass
        if reopen:
            print('Reopening Vetro in normal mode...', flush=True)
            try:
                wire.remote(owner, '/usr/bin/app_launcher -k ' + APP + ' >/dev/null 2>&1\n/usr/bin/app_launcher -s ' + APP)
                report['normalRelaunchCommandCompleted'] = True
                time.sleep(10)
            except Exception as error:
                report['normalRelaunchCommandCompleted'] = False
                report['errors'].append('Normal reopen: ' + wire.error_detail(error))
        try:
            report['serviceAfter'] = service_state(tv)
            report['inputAfter'] = input_summary(owner.raw('/input', timeout=15))
            before = report.get('serviceBefore') or {}
            report['serviceRestartObserved'] = bool(before.get('startedAt') and
                before.get('startedAt') != report['serviceAfter'].get('startedAt'))
        except Exception as error:
            report['errors'].append('Final state: ' + wire.error_detail(error))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project-root', type=Path, required=True)
    parser.add_argument('--tv', required=True)
    parser.add_argument('--report-host', required=True)
    parser.add_argument('--inspect-screen', action='store_true',
        help='Explicitly relaunch only the TV screen to inspect failed authentication')
    args = parser.parse_args()
    tv = str(ipaddress.IPv4Address(args.tv))
    if not args.project_root.is_dir() or not re.fullmatch(r'[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+', args.report_host):
        parser.error('Use the existing project folder and a user@host report destination')
    os.umask(0o077)
    directory = args.project_root.resolve() / 'vetro-install'
    output = directory / 'access-diagnostics' / ('screen-auth-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S-%f') + '.json')
    report = {'schema': 1, 'expectedRevision': REVISION, 'inspectorAttached': False,
        'mode': 'screen-inspector' if args.inspect_screen else 'current-state',
        'capturedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'captureComplete': False, 'errors': [],
        'changes': 'Finish the recorded input handoff.' + (' Debug and normal relaunch of Vetro screen only.' if args.inspect_screen else ' Preserve the running screen.'),
        'limitation': 'Saved screen telemetry may be absent or stale. Inspector mode changes screen timing. No package, service, pairing or grants are changed. Private credentials and pairing codes stay on the TV.'}
    lock = None
    print('=== Vetro screen authentication check START ===', flush=True)
    try:
        lock = (directory / 'beta-recovery/diagnostic-update.lock').open('a')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        owner = OwnerClient('http://' + tv + ':8099', directory / 'combined-updates')
        if not owner.token:
            raise Error('Existing Mint owner pairing is required; no new pairing was started')
        (capture if args.inspect_screen else observe_current)(owner, tv, directory, report)
    except Exception as error:
        report['errors'].append(wire.error_detail(error))
        print('CHECK STOPPED: ' + wire.error_detail(error), flush=True)
    finally:
        if lock:
            lock.close()
        try:
            output.parent.mkdir(parents=True, exist_ok=True)
            with output.open('x', encoding='utf-8') as target:
                json.dump(report, target, indent=2)
                target.write('\n')
            print('Report: ' + str(output))
            print('Run this on your Mac to retrieve the report:')
            print('rsync -P ' + shlex.quote(args.report_host + ':' + str(output)) + ' ~/Downloads/')
        finally:
            print('=== Vetro screen authentication check END ===', flush=True)


if __name__ == '__main__':
    main()
