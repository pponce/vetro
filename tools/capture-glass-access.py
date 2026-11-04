#!/usr/bin/env python3
"""Observe Glass Home's Vetro request through its Web Inspector.

Temporarily relaunches only the Glass Home UI in debug mode. No packages,
permissions, saved preferences, service code or input policies are changed.
Uses the existing paired owner client and TV-Store relay; Python stdlib only.
"""
import argparse
import base64
import datetime
import hashlib
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import socket
import struct
import time
import urllib.parse
import urllib.request

from vetro_owner import OwnerClient, NoRedirect

spec = importlib.util.spec_from_file_location('glass_sdb_transport',
    Path(__file__).with_name('inspect-messageport-runtime.py'))
transport = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transport)
APP = 'GlassHome1.GlassHome'
REVISION = 'ce92708f55211738f3866756e287b5fb634c0b23'
GLASS_REVISION = '30c490194f1748d523262a1ac8985fe45f735729'
GLASS_FILES = {
    'js/vetro-access-client.js': '53a2eb9043415cd86571b443d6744fcbc0970d004ea2602eea9d2bbf7eb8f80b',
    'js/vetro-permissions.js': '9e868bd4dabcef72ab5221e1222a7bd64f994805746405f0677db77527f83061',
    'js/data.js': 'd73838e27678743b1e9025b20ec0143b025fdca097ce48d2002a1f31cf998fab',
    'js/home.js': '7422f667033814cb60abe95cecd6fd8c3f3a63833152bf7ab8f107bd9c00c2d2',
    'index.html': '137ad0a3ca647ef5a3450548a9494f477c5faa649384d4c0352455dff5c2435c',
    'service/server.js': '19cb3c550b99169a09611f77803b5289b63b9095d3d647fdbc2f94be0f9a60f1',
    'service/vetro-replies.js': '8962632a29ea065b290db1ccca72b5517f3cbaae77ba6b24da1a36f909549c02',
}
LIMIT = 1024 * 1024
STATES = {'unknown', 'legacy', 'pending', 'approved', 'unapproved', 'disabled',
    'permission_denied', 'unavailable', 'identity_changed', 'timeout',
    'invalid_reply', 'reply_unavailable', 'not_allowed', 'busy', 'closed'}
ERRORS = {'Error', 'TypeError', 'SyntaxError', 'SecurityError', 'NotFoundError',
    'InvalidAccessError', 'InvalidValuesError', 'TypeMismatchError',
    'QuotaExceededError', 'NotSupportedError', 'UnknownError', 'IOError'}


class CaptureError(RuntimeError):
    """Only fixed messages created by this helper may reach the report."""


def error_detail(error):
    if isinstance(error, CaptureError):
        return str(error)
    if isinstance(error, transport.ReadFailure):
        # Retain known local protocol reasons without exporting TV response text.
        reasons = {
            'Inspection time limit reached': 'SDB operation time limit reached',
            'SDB closed the connection': 'SDB connection closed before the response completed',
            'Invalid SDB frame header': 'Invalid SDB frame header',
            'Invalid SDB frame checksum': 'Invalid SDB frame checksum',
            'SDB requires authentication; no key was created or registered': 'SDB requires authentication; no key was created or registered',
            'Unexpected SDB handshake': 'Unexpected SDB handshake',
            'SDB closed the file-reading stream': 'SDB stream closed',
            'SDB buffer limit exceeded': 'SDB response exceeded its size limit',
            'Unexpected SDB stream frame': 'Unexpected SDB stream frame',
        }
        detail = str(error)
        if detail in reasons:
            return reasons[detail]
        if detail.startswith('Unexpected SDB stream identity: '):
            return 'SDB response belonged to a different stream'
        if detail.startswith('Unexpected frame for retired SDB stream: '):
            return 'Unexpected response on a retired SDB stream'
        return 'Other SDB protocol failure'
    return type(error).__name__


def stream_evidence(stream):
    if stream is None:
        return []
    result = []
    for frame in list(getattr(stream, 'frames', []))[-48:]:
        result.append({
            'direction': frame.get('direction') if frame.get('direction') in ('send', 'receive') else 'other',
            'command': frame.get('command') if frame.get('command') in ('CNXN', 'AUTH', 'OPEN', 'OKAY', 'WRTE', 'CLSE') else 'other',
            **{k: frame.get(k) if type(frame.get(k)) is int and 0 <= frame[k] <= 0xffffffff else None
               for k in ('arg0', 'arg1', 'payloadBytes')},
        })
    return result


def relay_summary(value):
    relay = value.get('relay') if isinstance(value, dict) else None
    relay = relay if isinstance(relay, dict) else {}
    failure = relay.get('lastFailure') if isinstance(relay.get('lastFailure'), dict) else {}
    stamp = failure.get('at')
    return {
        'enabled': relay.get('enabled') is True, 'listening': relay.get('listening') is True,
        'hasError': bool(relay.get('error')),
        **{key: relay.get(key) if type(relay.get(key)) is int and relay[key] >= 0 else None
           for key in ('sessions', 'served', 'failures')},
        'lastFailureAt': stamp if isinstance(stamp, str) and re.fullmatch(r'[0-9TZ:.+\-]{20,40}', stamp) else None,
        'lastFailureCode': failure.get('code') if failure.get('code') in ('SDBD_DROPPED', 'SDBD_CLOSED', 'SDBD_CONNECT_FAILED') else 'other' if failure else None,
    }


class Stream(transport.SdbReader):
    def open_service(self, service):
        if service != 'shell:0 debug ' + APP and not re.fullmatch(r'tcp:[0-9]{1,5}', service):
            raise CaptureError('Unexpected inspector service')
        self.local += 1
        self.send(b'OPEN', self.local, 0, service.encode('ascii') + b'\0')
        command, a, b, payload = self.frame()
        if command != b'OKAY' or not a or b != self.local or payload:
            raise CaptureError('TV did not open the inspector stream')
        self.remote = a

    def write(self, value):
        for offset in range(0, len(value), 4096):
            self.send(b'WRTE', self.local, self.remote, value[offset:offset + 4096])
            while self.pump() != b'OKAY':
                pass

    def until(self, suffix, maximum=32768):
        result = bytearray()
        while not result.endswith(suffix):
            if len(result) >= maximum:
                raise CaptureError('Inspector header limit exceeded')
            result.extend(self.read(1))
        return bytes(result)


def connect(tv, relay_port, service=None, seconds=30, report=None, purpose='inspector'):
    deadline = time.monotonic() + seconds
    for number in range(1, 4):
        stream = None
        started = time.monotonic()
        remaining = deadline - started
        if remaining <= 0:
            raise CaptureError('SDB connection time limit reached')
        attempt = {'purpose': purpose, 'attempt': number, 'stage': 'tcp-connect', 'connected': False}
        if report is not None:
            report.setdefault('transportAttempts', []).append(attempt)
        try:
            sock = socket.create_connection((tv, relay_port), timeout=min(8, remaining))
            stream = Stream(sock, seconds=max(0, deadline - time.monotonic()))
            attempt['stage'] = 'sdb-handshake'
            stream.connect()
            if service is not None:
                attempt['stage'] = 'service-open'
                stream.open_service(service)
            attempt['connected'] = True
            attempt['stage'] = 'ready'
            return stream
        except BaseException as error:
            attempt['error'] = error_detail(error)
            attempt['frames'] = stream_evidence(stream)
            if stream:
                try:
                    stream.close()
                except Exception:
                    pass
            # A fresh SDB connection can be dropped immediately after teardown.
            # Retry only the handshake, before any shell/debug command was sent.
            dropped = (isinstance(error, transport.ReadFailure) and
                       str(error) == 'SDB closed the connection') or isinstance(error, (ConnectionResetError, BrokenPipeError))
            delay = 0.4 * number
            if number == 3 or attempt['stage'] != 'sdb-handshake' or not dropped or time.monotonic() + delay >= deadline:
                raise
            attempt['retryDelaySeconds'] = delay
            print('SDB dropped a fresh connection; waiting before retry ' + str(number) + '/2...', flush=True)
        finally:
            attempt['seconds'] = round(time.monotonic() - started, 3)
            if 'frames' not in attempt:
                attempt['frames'] = stream_evidence(stream)
        time.sleep(delay)


def headers(stream):
    raw = stream.until(b'\r\n\r\n').decode('iso-8859-1')
    lines = raw.split('\r\n')
    match = re.fullmatch(r'HTTP/1\.[01] ([0-9]{3})(?: .*)?', lines[0])
    if not match:
        raise CaptureError('Invalid inspector HTTP response')
    values = {}
    for line in lines[1:]:
        if ':' in line:
            key, value = line.split(':', 1)
            values[key.strip().lower()] = value.strip()
    return int(match[1]), values


def inspector_pages(tv, relay_port, port, report=None, seconds=30):
    stream = connect(tv, relay_port, 'tcp:' + str(port), seconds=seconds, report=report, purpose='inspector-page-list')
    try:
        stream.write(('GET /json/list HTTP/1.1\r\nHost: 127.0.0.1:' + str(port) +
                      '\r\nConnection: close\r\n\r\n').encode('ascii'))
        status, fields = headers(stream)
        if status != 200:
            raise CaptureError('Inspector page list is unavailable')
        if fields.get('transfer-encoding', '').lower() == 'chunked':
            body = bytearray()
            while True:
                count = int(stream.until(b'\r\n', 128).split(b';', 1)[0], 16)
                if count < 0 or len(body) + count > LIMIT:
                    raise CaptureError('Inspector page list limit exceeded')
                if not count:
                    break
                body.extend(stream.read(count))
                if stream.read(2) != b'\r\n':
                    raise CaptureError('Invalid inspector chunk')
        elif 'content-length' in fields:
            count = int(fields.get('content-length', '-1'))
            if not 0 <= count <= LIMIT:
                raise CaptureError('Inspector page list size unavailable')
            body = stream.read(count)
        else:
            body = bytearray(stream.buffer)
            stream.buffer.clear()
            while True:
                try:
                    stream.pump()
                except transport.ReadFailure:
                    if stream.remote is not None:
                        raise
                    break
                body.extend(stream.buffer)
                stream.buffer.clear()
                if len(body) > LIMIT:
                    raise CaptureError('Inspector page list limit exceeded')
        result = json.loads(body)
        if not isinstance(result, list):
            raise CaptureError('Invalid inspector page list')
        return result
    finally:
        if report is not None:
            report['pageListFrames'] = stream_evidence(stream)
        stream.close()


def wait_for_inspector_page(tv, relay_port, port, report, seconds=60):
    print('Waiting for the Glass Home inspector page (up to ' + str(seconds) + ' seconds)...', flush=True)
    started = time.monotonic()
    notice = 10
    report['pageWaitAttempts'] = 0
    while time.monotonic() - started < seconds:
        report['pageWaitAttempts'] += 1
        remaining = seconds - (time.monotonic() - started)
        try:
            pages = inspector_pages(tv, relay_port, port, report=report, seconds=min(15, remaining))
        except (CaptureError, TimeoutError) as error:
            # A page/server may not exist yet. Authentication and malformed SDB
            # frames are not startup delays and must still stop the capture.
            if isinstance(error, CaptureError) and str(error) not in (
                    'TV did not open the inspector stream', 'Inspector page list is unavailable'):
                raise
            pages = []
            report['pageWaitLastError'] = error_detail(error)
        candidates = [p for p in pages if isinstance(p, dict) and
            p.get('type', 'page') == 'page' and isinstance(p.get('webSocketDebuggerUrl'), str) and
            (APP.split('.')[0] in str(p.get('url', '')) or p.get('title') == 'Glass Home')]
        elapsed = time.monotonic() - started
        report['pageWaitSeconds'] = round(elapsed, 1)
        if len(candidates) > 1:
            raise CaptureError('Could not identify exactly one Glass Home page')
        if candidates:
            address = urllib.parse.urlsplit(candidates[0]['webSocketDebuggerUrl'])
            if address.scheme != 'ws' or address.query or address.fragment or not re.fullmatch(r'/devtools/page/[A-Za-z0-9_.-]+', address.path):
                raise CaptureError('Unexpected Glass Home inspector endpoint')
            return address.path
        if elapsed >= notice:
            print('Still waiting for the Glass Home inspector page (' + str(round(elapsed)) + 's)...', flush=True)
            notice = elapsed + 10
        time.sleep(max(0, min(1, seconds - elapsed)))
    raise CaptureError('Glass Home inspector page did not become ready within the startup wait')


class Inspector:
    def __init__(self, stream, port, path):
        self.stream = stream
        self.sequence = 0
        self.handler = lambda method, params: None
        self.fragment = bytearray()
        self.fragmenting = False
        key = base64.b64encode(secrets.token_bytes(16)).decode('ascii')
        stream.write(('GET ' + path + ' HTTP/1.1\r\nHost: 127.0.0.1:' + str(port) +
            '\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13' +
            '\r\nSec-WebSocket-Key: ' + key + '\r\n\r\n').encode('ascii'))
        status, fields = headers(stream)
        accept = base64.b64encode(hashlib.sha1((key +
            '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode('ascii')).digest()).decode('ascii')
        if status != 101 or fields.get('sec-websocket-accept') != accept:
            raise CaptureError('Inspector WebSocket was not authenticated')

    def send(self, payload, opcode=1):
        if len(payload) > LIMIT:
            raise CaptureError('Inspector frame limit exceeded')
        mask = secrets.token_bytes(4)
        size = len(payload)
        head = bytes([0x80 | opcode, 0x80 | (size if size < 126 else 126 if size < 65536 else 127)])
        if size >= 126:
            head += struct.pack('!H' if size < 65536 else '!Q', size)
        self.stream.write(head + mask + bytes(v ^ mask[i % 4] for i, v in enumerate(payload)))

    def receive(self):
        while True:
            a, b = self.stream.read(2)
            final, opcode = bool(a & 128), a & 15
            if a & 112 or b & 128:
                raise CaptureError('Invalid inspector WebSocket flags')
            size = b & 127
            if size in (126, 127):
                size = struct.unpack('!H' if size == 126 else '!Q', self.stream.read(2 if size == 126 else 8))[0]
            if size > LIMIT or len(self.fragment) + size > LIMIT:
                raise CaptureError('Inspector frame limit exceeded')
            if opcode >= 8 and (not final or size > 125):
                raise CaptureError('Invalid inspector control frame')
            data = self.stream.read(size)
            if opcode == 8:
                raise CaptureError('Glass Home inspector closed')
            if opcode == 9:
                self.send(data, 10)
                continue
            if opcode == 10:
                continue
            if opcode == 1 and not self.fragmenting:
                self.fragment = bytearray(data)
            elif opcode == 0 and self.fragmenting:
                self.fragment.extend(data)
            else:
                raise CaptureError('Invalid inspector message sequence')
            self.fragmenting = not final
            if final:
                result = json.loads(self.fragment)
                self.fragment.clear()
                if not isinstance(result, dict):
                    raise CaptureError('Invalid inspector protocol message')
                return result

    def call(self, method, params=None):
        self.sequence += 1
        request_id = self.sequence
        self.send(json.dumps({'id': request_id, 'method': method, 'params': params or {}}).encode())
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            message = self.receive()
            if message.get('id') == request_id:
                if 'error' in message:
                    raise CaptureError('Inspector rejected ' + method)
                return message.get('result') or {}
            if isinstance(message.get('method'), str):
                self.handler(message['method'], message.get('params') or {})
        raise CaptureError('Inspector command timed out')


SNAPSHOT = r'''(function(){
var g=window.GH,p=g&&g.vetroPermissions, d=document.getElementById('panel-diag'),
 s=document.getElementById('panel-app-status'), t=window.tizen, v=g&&g.vetro;
return {present:!!g,adapter:!!p,state:p&&p.state,busy:!!(p&&p.busy),
 scopes:p&&p.scopes,visible:document.visibilityState==='visible',
 documentReady:document.readyState==='complete',appsPresent:!!v,appsLoading:!!(v&&v.loading),
 messagePort:!!(t&&t.messageport),crypto:!!(window.crypto&&window.crypto.getRandomValues),
 hash:!!(window.sha256&&window.sha256.hmac),
 timeoutShown:!!(s&&/did not respond|did not reply|timed out/i.test(s.textContent||'')),
 pendingShown:!!(d&&/waiting for approval/i.test(d.textContent||''))};
}())'''


def sanitize_snapshot(value):
    if not isinstance(value, dict):
        raise CaptureError('Glass Home widget snapshot unavailable')
    result = {k: value.get(k) is True for k in ('present', 'adapter', 'busy', 'visible',
        'documentReady', 'appsPresent', 'appsLoading',
        'messagePort', 'crypto', 'hash', 'timeoutShown', 'pendingShown')}
    result['state'] = value.get('state') if value.get('state') in STATES else 'other'
    result['scopes'] = [x for x in value.get('scopes', []) if x in ('apps.read', 'apps.launch')] if isinstance(value.get('scopes'), list) else []
    return result


def widget_snapshot(inspector):
    result = inspector.call('Runtime.evaluate', {'expression': SNAPSHOT, 'returnByValue': True})
    return sanitize_snapshot((result.get('result') or {}).get('value'))


def wait_for_widget(inspector, report, seconds=60):
    print('Waiting up to ' + str(seconds) + ' seconds for Glass Home to be visible and finish its app check...', flush=True)
    print('Wait for CAPTURING before choosing Connect to Vetro.', flush=True)
    started = time.monotonic()
    report['startupSamples'] = []
    last = None
    notice = 0
    while time.monotonic() - started < seconds:
        value = widget_snapshot(inspector)
        elapsed = round(time.monotonic() - started, 1)
        report['startupWaitSeconds'] = elapsed
        if value != last and len(report['startupSamples']) < 80:
            report['startupSamples'].append({'seconds': elapsed, 'widget': value})
            last = value
        if all(value[k] for k in ('present', 'adapter', 'documentReady', 'visible', 'appsPresent')) and not value['appsLoading']:
            report['widgetReady'] = True
            return value
        if elapsed >= notice:
            print('Startup ' + str(round(elapsed)) + 's: visible=' + str(value['visible']).lower() +
                  ', controls loaded=' + str(value['adapter']).lower() +
                  ', checking apps=' + str(value['appsLoading']).lower(), flush=True)
            notice = elapsed + 10
        time.sleep(1)
    raise CaptureError('Glass Home did not become visible and finish loading within the startup wait')


def summarize_access(value):
    events = value.get('events') or []
    return {'enabled': value.get('enabled') is True, 'available': value.get('available') is True,
        'hasError': bool(value.get('error')),
        'pendingCount': len(value.get('pending') or []), 'grantCount': len(value.get('grants') or []),
        'events': [{'app': 'glass-ui' if e.get('appId') == APP else 'glass-service' if e.get('appId') == 'GlassHome1.Photos' else 'other',
                    'method': e.get('method') if e.get('method') in ('access.request', 'access.status', 'access.approve', 'apps.list', 'apps.launch') else 'other',
                    'outcome': e.get('outcome') if e.get('outcome') in STATES | {'completed', 'saved', 'identity_unverified', 'invalid_request', 'limit', 'not_confirmed'} else 'other'}
                   for e in events[:20] if isinstance(e, dict)]}


def reply_summary(value):
    if not isinstance(value, dict):
        return {'status': None, 'parseError': True}
    result = {'status': value.get('status') if value.get('status') in (200, 202, 404) else None}
    frame = value.get('body')
    if result['status'] == 200 and isinstance(frame, dict) and isinstance(frame.get('body'), str):
        try:
            reply = json.loads(frame['body'])
            result['ok'] = reply.get('ok') is True
            error = reply.get('error') or {}
            result['code'] = error.get('code') if error.get('code') in STATES | {'identity_unverified', 'invalid_request', 'limit', 'not_confirmed'} else None
            answer = reply.get('result') or {}
            result['state'] = answer.get('state') if answer.get('state') in STATES else None
        except (ValueError, TypeError, AttributeError):
            result['parseError'] = True
    # Observation does not know the HMAC key. Only the widget can authenticate this frame.
    return result


class NetworkEvidence:
    def __init__(self, tv=None):
        self.hosts = {'127.0.0.1', '::1', tv}
        self.tracked = {}
        self.ready = []
        self.started = 0
        self.http = {}
        self.inner = {}
        self.failures = 0
        self.errors = {}
        self.read_failures = 0

    def event(self, method, params):
        request_id = params.get('requestId')
        if method == 'Network.requestWillBeSent':
            request = params.get('request') or {}
            address = urllib.parse.urlsplit(request.get('url') or '')
            if (address.scheme == 'http' and address.hostname in self.hosts and address.port == 8090 and
                    re.fullmatch(r'/local/vetro/replies/[a-f0-9]{64}', address.path) and request.get('method') == 'GET'):
                self.started += 1
                if len(self.tracked) < 300:
                    self.tracked[request_id] = True
        elif request_id in self.tracked:
            if method == 'Network.responseReceived':
                status = (params.get('response') or {}).get('status')
                status = str(int(status)) if type(status) in (int, float) and 100 <= status <= 599 else 'other'
                self.http[status] = self.http.get(status, 0) + 1
            elif method == 'Network.loadingFinished':
                self.ready.append(request_id)
                self.tracked.pop(request_id, None)
            elif method == 'Network.loadingFailed':
                self.failures += 1
                self.tracked.pop(request_id, None)
        if method == 'Runtime.exceptionThrown':
            name = ((params.get('exceptionDetails') or {}).get('exception') or {}).get('className')
            name = name if name in ERRORS else 'OtherError'
            self.errors[name] = self.errors.get(name, 0) + 1

    def drain(self, inspector):
        for _ in range(min(len(self.ready), 8)):
            request_id = self.ready.pop(0)
            try:
                response = inspector.call('Network.getResponseBody', {'requestId': request_id})
                body = response.get('body')
                if not isinstance(body, str) or len(body) > 100000:
                    raise ValueError('body')
                if response.get('base64Encoded') is True:
                    body = base64.b64decode(body, validate=True).decode('utf-8')
                value = json.loads(body)
                key = json.dumps(reply_summary(value), sort_keys=True)
                self.inner[key] = self.inner.get(key, 0) + 1
            except Exception:
                self.read_failures += 1
                break

    def snapshot(self):
        return {'pollsStarted': self.started, 'outerHttpStatuses': self.http,
            'replyObservations': [dict(json.loads(k), count=v) for k, v in self.inner.items()],
            'networkFailures': self.failures, 'bodyReadFailures': self.read_failures,
            'exceptionClasses': self.errors,
            'limitation': 'Reply bodies are observed, not authenticated by this collector. URLs, keys, IDs, MACs and raw text are omitted.'}


def remote(owner, command):
    encoded = base64.b64encode(command.encode('utf-8')).decode('ascii')
    value = owner.raw('/exec', {'cmd': 'printf %s ' + encoded + ' | base64 -d | sh'}, timeout=40)
    if value.get('exit_code') != 0 or value.get('timed_out'):
        raise CaptureError('TV command did not complete')
    return value.get('output', '')


def read_json(url):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(url, timeout=6) as response:
        data = response.read(LIMIT + 1)
    if len(data) > LIMIT:
        raise CaptureError('HTTP response limit exceeded')
    return json.loads(data)


def verify_glass(owner):
    commands = ['for glass_capture_root in /opt/usr/apps/GlassHome1/res/wgt /usr/apps/GlassHome1/res/wgt; do',
                'if [ -f "$glass_capture_root/js/vetro-permissions.js" ]; then',
                'cd "$glass_capture_root" || break']
    commands.extend('sha256sum ' + shlex.quote(path) for path in GLASS_FILES)
    commands.extend(['break', 'fi', 'done'])
    output = remote(owner, '\n'.join(commands))
    found = {}
    for line in output.splitlines():
        match = re.fullmatch(r'([a-f0-9]{64})  (.+)', line)
        if match and match[2] in GLASS_FILES:
            found[match[2]] = match[1]
    return {path: found.get(path) == digest for path, digest in GLASS_FILES.items()}


def collect(owner, tv, duration, report):
    stream = None
    debug = None
    relaunch = False
    relay_checked = False
    phase = 'service-preflight'
    evidence = NetworkEvidence(tv)
    try:
        status = owner.raw('/status', timeout=8)
        build = status.get('app') or {}
        report['service'] = {'sourceRevision': build.get('sourceRevision') if re.fullmatch(r'[a-f0-9]{40}', str(build.get('sourceRevision', ''))) else None,
            'sourceDirty': build.get('sourceDirty'), 'rootConnected': (status.get('agent') or {}).get('connected') is True}
        if report['service']['sourceRevision'] != REVISION or report['service']['sourceDirty'] is not False or not report['service']['rootConnected']:
            raise CaptureError('Expected clean Vetro revision with root access was not verified')
        phase = 'relay-preflight'
        relay_data = read_json('http://' + tv + ':8077/relay')
        report['relayBefore'] = relay_summary(relay_data)
        relay_checked = True
        relay = relay_data.get('relay') or {}
        relay_port = relay.get('port')
        if relay.get('enabled') is not True or relay.get('listening') is not True or relay.get('error') or type(relay.get('sessions')) is not int or relay['sessions'] != 0:
            raise CaptureError('TV-Store relay must be ready with no other debug sessions')
        if type(relay_port) is not int or not 1024 <= relay_port <= 65535:
            raise CaptureError('Invalid TV-Store relay port')
        phase = 'glass-health'
        health = read_json('http://' + tv + ':8090/health')
        report['glassService'] = {k: health.get(k) for k in ('ok', 'version', 'vetroApps', 'vetroLaunch', 'vetroPermissions', 'dockPreferences') if type(health.get(k)) in (int, bool, str)}
        if health.get('name') != 'Glass Home' or health.get('vetroPermissions') != 2:
            raise CaptureError('Open Glass Home normally once; its version 2 service is required')
        phase = 'glass-file-verification'
        report['glassFilesMatch'] = verify_glass(owner)
        if not all(report['glassFilesMatch'].values()):
            raise CaptureError('Installed Glass Home files differ from the expected candidate; no debug launch was attempted')
        report['before'] = summarize_access(owner.raw('/app-access', timeout=8))
        phase = 'sdb-preflight'
        print('Checking the SDB connection before closing Glass Home...', flush=True)
        debug = connect(tv, relay_port, seconds=70, report=report, purpose='debug-session')
        report['sdbPreflightPassed'] = True
        print('Reopening only the Glass Home screen in Web Inspector mode...', flush=True)
        phase = 'glass-ui-stop'
        relaunch = True
        remote(owner, '/usr/bin/app_launcher -k ' + APP + ' >/dev/null 2>&1\n:')
        try:
            phase = 'debug-service-open'
            debug.open_service('shell:0 debug ' + APP)
            phase = 'debug-port-response'
            output = bytearray()
            deadline = time.monotonic() + 25
            while time.monotonic() < deadline:
                try:
                    debug.pump()
                except transport.ReadFailure:
                    if debug.remote is not None:
                        raise
                    break
                output.extend(debug.buffer)
                debug.buffer.clear()
                if len(output) > 32768:
                    raise CaptureError('Debug launch response limit exceeded')
                if re.search(rb'port:\s*[0-9]+\s', output):
                    break
            match = re.search(rb'port:\s*([0-9]{1,5})(?:\s|$)', output)
            if not match or not 1024 <= int(match[1]) <= 65535:
                raise CaptureError('TV did not return a Glass Home inspector port; no launch was retried')
            port = int(match[1])
            report['debugPortReceived'] = True
        finally:
            report['debugFrames'] = stream_evidence(debug)
            debug.close()
            debug = None
        phase = 'inspector-page-list'
        path = wait_for_inspector_page(tv, relay_port, port, report)
        phase = 'inspector-connection'
        stream = connect(tv, relay_port, 'tcp:' + str(port), seconds=duration + 100, report=report, purpose='inspector-websocket')
        phase = 'inspector-upgrade'
        inspector = Inspector(stream, port, path)
        report['inspectorAttached'] = True
        inspector.handler = evidence.event
        phase = 'inspector-runtime-enable'
        inspector.call('Runtime.enable')
        phase = 'inspector-network-enable'
        inspector.call('Network.enable')
        phase = 'widget-startup'
        value = wait_for_widget(inspector, report)
        report['samples'] = [{'seconds': 0, 'widget': value}]
        report['connectBusyObserved'] = value['busy']
        report['captureWindowSeconds'] = duration
        report['pollsAtCaptureStart'] = evidence.started
        print('CAPTURING: in Glass Home open +, wait for Checking apps to finish, then choose Connect to Vetro ONCE.', flush=True)
        print('Leave Glass Home visible for ' + str(duration) + ' seconds. No access is granted by this script.', flush=True)
        started = time.monotonic()
        last = value
        notice = 0
        phase = 'request-observation'
        while time.monotonic() - started < duration:
            value = widget_snapshot(inspector)
            report['connectBusyObserved'] = report['connectBusyObserved'] or value['busy']
            elapsed = round(time.monotonic() - started, 1)
            if value != last and len(report['samples']) < 100:
                report['samples'].append({'seconds': elapsed, 'widget': value})
                last = value
            evidence.drain(inspector)
            if elapsed >= notice:
                print(str(round(elapsed)) + 's: permission state ' + value['state'] + '; reply polls ' + str(evidence.started), flush=True)
                notice = elapsed + 10
            time.sleep(1)
        evidence.drain(inspector)
        report['captureSeconds'] = round(time.monotonic() - started, 1)
        report['captureComplete'] = True
    except Exception as error:
        report['failedPhase'] = phase
        report['errors'].append(error_detail(error))
        print('CAPTURE LIMIT [' + phase + ']: ' + error_detail(error), flush=True)
    finally:
        report['network'] = evidence.snapshot()
        if debug:
            report['debugFrames'] = stream_evidence(debug)
            try:
                debug.close()
            except Exception:
                pass
        if stream:
            report['inspectorFrames'] = stream_evidence(stream)
            try:
                stream.close()
            except Exception:
                pass
        if relay_checked:
            try:
                report['relayAfter'] = relay_summary(read_json('http://' + tv + ':8077/relay'))
            except Exception as error:
                report['relayReadError'] = error_detail(error)
        try:
            report['after'] = summarize_access(owner.raw('/app-access', timeout=8))
        except Exception as error:
            report['errors'].append('Final access read: ' + error_detail(error))
        if relaunch:
            print('Reopening Glass Home in normal mode...', flush=True)
            try:
                remote(owner, '/usr/bin/app_launcher -k ' + APP + ' >/dev/null 2>&1\n/usr/bin/app_launcher -s ' + APP)
                report['normalRelaunchCommandCompleted'] = True
            except Exception as error:
                report['normalRelaunchCommandCompleted'] = False
                report['errors'].append('Normal reopen: ' + error_detail(error))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project-root', type=Path, required=True)
    parser.add_argument('--tv', default='192.168.84.19')
    parser.add_argument('--seconds', type=int, default=60)
    parser.add_argument('--report-host', default='pedro@192.168.84.2')
    args = parser.parse_args()
    tv = str(ipaddress.IPv4Address(args.tv))
    if not args.project_root.is_dir() or not 30 <= args.seconds <= 120 or not re.fullmatch(r'[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+', args.report_host):
        parser.error('Use the existing project folder, 30–120 seconds and a user@host report destination')
    os.umask(0o077)
    directory = args.project_root.resolve() / 'vetro-install'
    output = directory / 'access-diagnostics' / ('glass-request-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S-%f') + '.json')
    report = {'schema': 1, 'capturedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'expectedVetroRevision': REVISION, 'expectedGlassRevision': GLASS_REVISION,
        'inspectorAttached': False, 'captureComplete': False, 'errors': [],
        'changes': 'Glass Home UI debug relaunch and normal relaunch only; no install, permission change or input change.',
        'limitation': 'Debug mode can change timing. Native receiver rejection before Access.call is not instrumented in this Vetro revision.'}
    print('=== Glass Home request capture START ===', flush=True)
    try:
        owner = OwnerClient('http://' + tv + ':8099', directory / 'combined-updates')
        if not owner.token:
            raise CaptureError('Existing Mint owner pairing is required; no pairing was started')
        collect(owner, tv, args.seconds, report)
    except Exception as error:
        report['errors'].append(error_detail(error))
        print('CAPTURE LIMIT: ' + error_detail(error), flush=True)
    finally:
        try:
            output.parent.mkdir(parents=True, exist_ok=True)
            with output.open('x', encoding='utf-8') as target:
                json.dump(report, target, indent=2)
                target.write('\n')
            print('Report: ' + str(output))
            print('Run this on your Mac to retrieve the report:')
            print('rsync -P ' + shlex.quote(args.report_host + ':' + str(output)) + ' ~/Downloads/')
        finally:
            print('=== Glass Home request capture END ===', flush=True)


if __name__ == '__main__':
    main()
