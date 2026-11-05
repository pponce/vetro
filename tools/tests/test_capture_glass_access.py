import base64
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import struct
import sys
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location('capture_glass_access', ROOT / 'capture-glass-access.py')
capture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture)


def frame(value, opcode=1, final=True):
    data = json.dumps(value).encode() if isinstance(value, dict) else value
    length = len(data)
    prefix = bytes([(128 if final else 0) | opcode, length if length < 126 else 126])
    return prefix + (struct.pack('!H', length) if length >= 126 else b'') + data


class Wire:
    def __init__(self):
        self.data = bytearray()
        self.writes = []

    def write(self, data):
        self.writes.append(data)
        if data.startswith(b'GET '):
            key = data.split(b'Sec-WebSocket-Key: ')[1].split(b'\r\n')[0]
            answer = base64.b64encode(hashlib.sha1(key + b'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest())
            self.data.extend(b'HTTP/1.1 101 Switching Protocols\r\nSec-WebSocket-Accept: ' + answer + b'\r\n\r\n')

    def read(self, n):
        if len(self.data) < n:
            raise RuntimeError('short fake wire')
        data = bytes(self.data[:n])
        del self.data[:n]
        return data

    def until(self, end, maximum=32768):
        pos = self.data.index(end) + len(end)
        return self.read(pos)


class InspectorTests(unittest.TestCase):
    def make(self):
        wire = Wire()
        return capture.Inspector(wire, 45678, '/devtools/page/1'), wire

    def test_rpc_processes_events_and_matches_result(self):
        client, wire = self.make()
        events = []
        client.handler = lambda method, params: events.append(method)
        wire.data.extend(frame({'method': 'Network.loadingFinished', 'params': {'requestId': '1'}}))
        wire.data.extend(frame({'id': 1, 'result': {'value': 42}}))
        self.assertEqual(client.call('Runtime.enable'), {'value': 42})
        self.assertEqual(events, ['Network.loadingFinished'])
        self.assertTrue(wire.writes[-1][1] & 128, 'Client frames must be masked')

    def test_fragmented_text_and_ping(self):
        client, wire = self.make()
        wire.data.extend(frame(b'{"id":', final=False))
        wire.data.extend(frame(b'ping', opcode=9))
        wire.data.extend(frame(b'1}', opcode=0))
        self.assertEqual(client.receive(), {'id': 1})
        self.assertEqual(wire.writes[-1][0] & 15, 10)

    def test_extended_length(self):
        client, wire = self.make()
        expected = {'value': 'x' * 1000}
        wire.data.extend(frame(expected))
        self.assertEqual(client.receive(), expected)

    def test_rejects_oversized_frame_before_body(self):
        client, wire = self.make()
        wire.data.extend(bytes([129, 127]) + struct.pack('!Q', capture.LIMIT + 1))
        with self.assertRaises(capture.CaptureError):
            client.receive()

    def test_rejects_masked_server_frame(self):
        client, wire = self.make()
        wire.data.extend(bytes([129, 128]))
        with self.assertRaises(capture.CaptureError):
            client.receive()

    def test_protocol_error_omits_remote_text(self):
        client, wire = self.make()
        wire.data.extend(frame({'id': 1, 'error': {'message': 'private-user-data'}}))
        with self.assertRaises(capture.CaptureError) as failure:
            client.call('Network.enable')
        self.assertNotIn('private-user-data', str(failure.exception))

    def test_invalid_upgrade_rejected(self):
        wire = Wire()
        wire.write = lambda data: wire.data.extend(b'HTTP/1.1 101 Switching\r\nSec-WebSocket-Accept: wrong\r\n\r\n')
        with self.assertRaises(capture.CaptureError):
            capture.Inspector(wire, 45678, '/devtools/page/1')


def sdb_frame(command, a, b, data=b''):
    code = struct.unpack('<I', command)[0]
    return struct.pack('<6I', code, a, b, len(data), sum(data), code ^ 0xffffffff) + data


class SdbSocket:
    def __init__(self):
        self.incoming = bytearray()
        self.sent = []
        self.closed = False

    def settimeout(self, timeout):
        pass

    def sendall(self, data):
        code, a, b, size, checksum, magic = struct.unpack('<6I', data[:24])
        command = struct.pack('<I', code)
        self.sent.append((command, a, b, data[24:]))
        if command == b'CNXN':
            self.incoming.extend(sdb_frame(b'CNXN', 0x1000000, 4096))
        elif command == b'OPEN':
            self.incoming.extend(sdb_frame(b'OKAY', 73, a))
        elif command == b'WRTE':
            # A peer may deliver response bytes before acknowledging the write.
            self.incoming.extend(sdb_frame(b'WRTE', 73, a, b'response'))
            self.incoming.extend(sdb_frame(b'OKAY', 73, a))

    def recv(self, maximum):
        size = min(maximum, len(self.incoming), 3)
        data = bytes(self.incoming[:size])
        del self.incoming[:size]
        return data

    def close(self):
        self.closed = True


class ClosedSocket(SdbSocket):
    def sendall(self, data):
        super().sendall(data)
        self.incoming.clear()


class Clock:
    def __init__(self):
        self.now = 0

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


class SdbTests(unittest.TestCase):
    def test_fragmented_frames_and_data_before_ack(self):
        sock = SdbSocket()
        stream = capture.Stream(sock)
        stream.connect()
        stream.open_service('tcp:45678')
        stream.write(b'GET /json/list HTTP/1.1\r\n\r\n')
        self.assertEqual(stream.read(8), b'response')
        stream.close()
        self.assertTrue(sock.closed)
        self.assertIn((b'OPEN', 1, 0, b'tcp:45678\0'), sock.sent)

    def test_stream_refuses_other_shell_commands(self):
        stream = capture.Stream(SdbSocket())
        with self.assertRaises(capture.CaptureError):
            stream.open_service('shell:echo unintended')

    def test_stream_rejects_wrong_socket_identity(self):
        sock = SdbSocket()
        stream = capture.Stream(sock)
        stream.connect()
        stream.open_service('tcp:45678')
        sock.incoming.extend(sdb_frame(b'WRTE', 74, 1, b'wrong stream'))
        with self.assertRaises(capture.transport.ReadFailure):
            stream.read(1)

    def test_dropped_handshake_retries_before_opening_inspector_stream(self):
        dropped, accepted, result = ClosedSocket(), SdbSocket(), report()
        with patch.object(capture.socket, 'create_connection', side_effect=[dropped, accepted]), \
             patch.object(capture.time, 'sleep') as sleep:
            stream = capture.connect('192.168.84.19', 26201, 'tcp:45678', report=result,
                                     purpose='inspector-websocket')
        self.assertTrue(dropped.closed)
        self.assertFalse(accepted.closed)
        self.assertEqual([c for c, a, b, payload in dropped.sent], [b'CNXN'])
        self.assertEqual([c for c, a, b, payload in accepted.sent], [b'CNXN', b'OPEN'])
        sleep.assert_called_once_with(0.4)
        self.assertEqual([a['connected'] for a in result['transportAttempts']], [False, True])
        self.assertEqual(result['transportAttempts'][0]['retryDelaySeconds'], 0.4)
        stream.close()

    def test_authentication_is_not_retried(self):
        class AuthSocket(SdbSocket):
            def sendall(self, data):
                super().sendall(data)
                self.incoming = bytearray(sdb_frame(b'AUTH', 1, 0, b'private-challenge'))
        sock, result = AuthSocket(), report()
        with patch.object(capture.socket, 'create_connection', return_value=sock) as create, \
             patch.object(capture.time, 'sleep') as sleep:
            with self.assertRaises(capture.transport.ReadFailure):
                capture.connect('192.168.84.19', 26201, report=result)
        create.assert_called_once()
        sleep.assert_not_called()
        self.assertTrue(sock.closed)
        self.assertNotIn('private-challenge', json.dumps(result))

    def test_service_open_failure_does_not_repeat_a_debug_launch(self):
        class RefusedSocket(SdbSocket):
            def sendall(self, data):
                super().sendall(data)
                if self.sent[-1][0] == b'OPEN':
                    self.incoming = bytearray(sdb_frame(b'CLSE', 0, self.sent[-1][1]))
        sock, result = RefusedSocket(), report()
        with patch.object(capture.socket, 'create_connection', return_value=sock) as create, \
             patch.object(capture.time, 'sleep') as sleep:
            with self.assertRaises(capture.CaptureError):
                capture.connect('192.168.84.19', 26201, 'shell:0 debug ' + capture.APP, report=result)
        create.assert_called_once()
        sleep.assert_not_called()
        self.assertEqual([c for c, a, b, payload in sock.sent], [b'CNXN', b'OPEN'])
        self.assertEqual(result['transportAttempts'][0]['stage'], 'service-open')


class StartupTests(unittest.TestCase):
    def test_inspector_page_may_take_more_than_six_seconds(self):
        clock, result = Clock(), report()
        def pages(*args, **kwargs):
            if clock.now < 15:
                return []
            return [{'title': 'Glass Home', 'webSocketDebuggerUrl': 'ws://127.0.0.1:45678/devtools/page/1'}]
        with patch.object(capture, 'inspector_pages', side_effect=pages), \
             patch.object(capture.time, 'monotonic', clock.monotonic), patch.object(capture.time, 'sleep', clock.sleep):
            path = capture.wait_for_inspector_page('192.168.84.19', 26201, 45678, result)
        self.assertEqual(path, '/devtools/page/1')
        self.assertEqual(result['pageWaitSeconds'], 15)

    def test_missing_inspector_page_stops_at_deadline(self):
        clock, result = Clock(), report()
        with patch.object(capture, 'inspector_pages', return_value=[]), \
             patch.object(capture.time, 'monotonic', clock.monotonic), patch.object(capture.time, 'sleep', clock.sleep):
            with self.assertRaises(capture.CaptureError):
                capture.wait_for_inspector_page('192.168.84.19', 26201, 45678, result, seconds=5)
        self.assertEqual(clock.now, 5)

    def test_page_wait_does_not_retry_persistent_sdb_failure(self):
        with patch.object(capture, 'inspector_pages', side_effect=capture.transport.ReadFailure('SDB closed the connection')) as pages, \
             patch.object(capture.time, 'sleep') as sleep:
            with self.assertRaises(capture.transport.ReadFailure):
                capture.wait_for_inspector_page('192.168.84.19', 26201, 45678, report())
        pages.assert_called_once()
        sleep.assert_not_called()

    def test_widget_waits_for_visibility_and_app_check(self):
        clock, result = Clock(), report()
        client = Mock()
        def call(method, params):
            return {'result': {'value': {'present': True, 'adapter': True, 'documentReady': True,
                'appsPresent': True, 'visible': clock.now >= 10, 'appsLoading': clock.now < 20}}}
        client.call.side_effect = call
        with patch.object(capture.time, 'monotonic', clock.monotonic), patch.object(capture.time, 'sleep', clock.sleep):
            value = capture.wait_for_widget(client, result)
        self.assertTrue(result['widgetReady'])
        self.assertEqual(result['startupWaitSeconds'], 20)
        self.assertFalse(value['appsLoading'])
        self.assertTrue(value['visible'])

    def test_hidden_widget_does_not_start_capture(self):
        clock, result = Clock(), report()
        client = Mock()
        client.call.return_value = {'result': {'value': {'present': True, 'adapter': True,
            'documentReady': True, 'appsPresent': True, 'visible': False}}}
        with patch.object(capture.time, 'monotonic', clock.monotonic), patch.object(capture.time, 'sleep', clock.sleep):
            with self.assertRaises(capture.CaptureError):
                capture.wait_for_widget(client, result, seconds=5)
        self.assertEqual(clock.now, 5)
        self.assertNotIn('widgetReady', result)


class EvidenceTests(unittest.TestCase):
    def test_known_sdb_error_survives_without_arbitrary_transport_text(self):
        self.assertEqual(capture.error_detail(capture.transport.ReadFailure('SDB closed the connection')),
                         'SDB connection closed before the response completed')
        self.assertEqual(capture.error_detail(capture.transport.ReadFailure('Unexpected SDB stream identity: private-text')),
                         'SDB response belonged to a different stream')
        self.assertEqual(capture.error_detail(capture.transport.ReadFailure('private-device-response')),
                         'Other SDB protocol failure')

    def test_transport_and_relay_evidence_omit_banners_and_peer_addresses(self):
        stream = Mock(frames=[{'direction': 'receive', 'command': 'AUTH', 'arg0': 1,
            'arg1': 2, 'payloadBytes': 64, 'payload': 'private-token'}])
        relay = capture.relay_summary({'relay': {'enabled': True, 'listening': True,
            'failures': 10, 'lastFailure': {'at': '2026-11-04T20:01:06.123Z',
            'code': 'SDBD_DROPPED', 'client': 'private-address', 'reason': 'private-device-text'}}})
        self.assertEqual(relay['lastFailureCode'], 'SDBD_DROPPED')
        self.assertEqual(relay['failures'], 10)
        serialized = json.dumps([capture.stream_evidence(stream), relay])
        self.assertNotIn('private', serialized)

    def test_poll_observation_excludes_key_id_and_mac(self):
        evidence = capture.NetworkEvidence()
        ident = 'a' * 64
        evidence.event('Network.requestWillBeSent', {'requestId': 'secret-request-id', 'request': {
            'method': 'GET', 'url': 'http://127.0.0.1:8090/local/vetro/replies/' + ident + '?k=private-local-key'}})
        evidence.event('Network.responseReceived', {'requestId': 'secret-request-id', 'response': {'status': 200}})
        evidence.event('Network.loadingFinished', {'requestId': 'secret-request-id'})
        response = {'status': 200, 'body': {'body': json.dumps({'ok': False,
            'id': 'secret-id', 'error': {'code': 'not_allowed', 'message': 'private-error-text'}}), 'mac': 'private-mac'}}
        class Reader:
            def call(self, method, params):
                return {'body': json.dumps(response), 'base64Encoded': False}
        evidence.drain(Reader())
        result = evidence.snapshot()
        self.assertEqual(result['pollsStarted'], 1)
        self.assertEqual(result['replyObservations'][0]['code'], 'not_allowed')
        serialized = json.dumps(result)
        for value in (ident, 'private-local-key', 'secret-request-id', 'secret-id', 'private-error-text', 'private-mac'):
            self.assertNotIn(value, serialized)

    def test_other_traffic_and_logs_ignored(self):
        evidence = capture.NetworkEvidence()
        evidence.event('Network.requestWillBeSent', {'requestId': '1', 'request': {
            'method': 'GET', 'url': 'https://example.com/private?k=secret'}})
        evidence.event('Network.responseReceived', {'requestId': '1', 'response': {'status': 200}})
        evidence.event('Runtime.consoleAPICalled', {'args': [{'value': 'private-token'}]})
        self.assertEqual(evidence.started, 0)
        self.assertEqual(evidence.http, {})
        self.assertNotIn('private-token', json.dumps(evidence.snapshot()))

    def test_snapshot_and_access_are_allowlisted(self):
        state = capture.sanitize_snapshot({'present': True, 'state': 'private-data',
            'scopes': ['apps.read', 'private-scope'], 'extra': 'private-token'})
        self.assertEqual(state['state'], 'other')
        self.assertEqual(state['scopes'], ['apps.read'])
        access = capture.summarize_access({'events': [{'appId': capture.APP, 'method': 'access.request', 'outcome': 'pending'},
            {'appId': 'private-app', 'method': 'private-method', 'outcome': 'private-error'}]})
        self.assertEqual(access['events'][0]['app'], 'glass-ui')
        self.assertNotIn('private', json.dumps([state, access]))

    def test_no_reply_and_processing_are_distinct(self):
        self.assertEqual(capture.reply_summary({'status': 404, 'body': None}), {'status': 404})
        self.assertEqual(capture.reply_summary({'status': 202, 'body': None}), {'status': 202})
        self.assertTrue(capture.reply_summary([])['parseError'])


class Owner:
    def __init__(self, revision=capture.REVISION):
        self.revision = revision
        self.calls = []
        self.base = 'http://192.0.2.10:8099'
        self.started_at = '2026-11-05T01:02:03.456Z'
        self.opener = Mock()
        self.opener.open.side_effect = self.diagnostic_response

    def receiver_status(self):
        return {'connectionDiagnostics': {'sourceRevision': self.revision, 'sourceDirty': False,
                    'startedAt': self.started_at, 'lifecycle': {'starts': 1, 'requests': 1, 'stops': 0},
                    'appPort': {'available': True, 'error': None},
                    'appRequests': {'enabled': True, 'counts': {}, 'events': []}}}

    def diagnostic_response(self, request, timeout):
        assert not request.has_header('Authorization')
        raise capture.urllib.error.HTTPError(request.full_url, 401, 'Unauthorized', {},
            io.BytesIO(json.dumps(self.receiver_status()).encode()))

    def raw(self, path, body=None, timeout=8):
        self.calls.append((path, body))
        if path == '/status':
            return {'app': {'sourceRevision': self.revision, 'sourceDirty': False}, 'agent': {'connected': True}}
        if path == '/app-access':
            return {'enabled': True, 'available': True, 'pending': [], 'grants': [], 'events': []}
        if path == '/exec':
            return {'exit_code': 0, 'output': '', 'timed_out': False}
        raise AssertionError(path)


def report():
    return {'errors': [], 'captureComplete': False, 'inspectorAttached': False}


def json_read(url):
    if url.endswith('/relay'):
        return {'relay': {'enabled': True, 'listening': True, 'sessions': 0, 'port': 26201}}
    return {'ok': True, 'name': 'Glass Home', 'vetroPermissions': 2}


class LifecycleTests(unittest.TestCase):
    def setUp(self):
        patcher = patch.object(capture, 'verify_vetro', return_value={'file': True})
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_successful_capture_records_user_busy_and_restores_normal_ui(self):
        owner, result = Owner(), report()
        class Debug:
            remote = 1
            def __init__(self):
                self.buffer = bytearray()
            def open_service(self, service):
                pass
            def pump(self):
                self.buffer.extend(b'port: 45678\n')
            def close(self):
                pass
        clock = Clock()
        class Client:
            def __init__(self, *args):
                self.evaluations = 0
            def call(self, method, params=None):
                if method == 'Runtime.evaluate':
                    self.evaluations += 1
                    return {'result': {'value': {'present': True, 'adapter': clock.now >= 7,
                        'documentReady': clock.now >= 5, 'visible': clock.now >= 12,
                        'appsPresent': clock.now >= 8, 'appsLoading': clock.now < 20,
                        'state': 'timeout' if clock.now >= 22 else 'unknown',
                        'busy': 20 < clock.now < 22}}}
                return {}
        with patch.object(capture, 'read_json', side_effect=json_read), patch.object(capture, 'verify_glass', return_value={'file': True}), \
             patch.object(capture, 'connect', side_effect=lambda *a, **k: Debug()) as connect, \
             patch.object(capture, 'inspector_pages', return_value=[{'title': 'Glass Home', 'type': 'page', 'webSocketDebuggerUrl': 'ws://127.0.0.1:45678/devtools/page/1'}]), \
             patch.object(capture, 'Inspector', Client), patch.object(capture.time, 'monotonic', clock.monotonic), patch.object(capture.time, 'sleep', clock.sleep):
            capture.collect(owner, '192.168.84.19', 3, result)
        self.assertTrue(result['captureComplete'])
        self.assertEqual(result['startupWaitSeconds'], 20)
        self.assertEqual(result['captureSeconds'], 3)
        self.assertEqual(result['captureWindowSeconds'], 3)
        self.assertTrue(result['connectBusyObserved'])
        self.assertEqual(result['samples'][-1]['widget']['state'], 'timeout')
        self.assertTrue(result['normalRelaunchCommandCompleted'])
        self.assertFalse(result['receiverRestartObserved'])
        self.assertEqual(result['receiverBefore']['requests']['counts'], {})
        self.assertEqual(result['receiverAfter']['requests']['counts'], {})
        self.assertFalse(result['nativeSendReturnInferred'], 'no network event was observed by this fixture')
        self.assertEqual(connect.call_count, 2)

    def test_revision_mismatch_does_not_launch_or_repair(self):
        owner = Owner('b' * 40)
        result = report()
        capture.collect(owner, '192.168.84.19', 1, result)
        self.assertFalse(result['captureComplete'])
        self.assertTrue(all(body is None for path, body in owner.calls))

    def test_file_mismatch_does_not_launch(self):
        owner, result = Owner(), report()
        with patch.object(capture, 'read_json', side_effect=json_read), patch.object(capture, 'verify_glass', return_value={'file': False}):
            capture.collect(owner, '192.168.84.19', 1, result)
        self.assertFalse(result['captureComplete'])
        self.assertFalse(any(path == '/exec' for path, body in owner.calls))

    def test_receiver_file_mismatch_does_not_launch(self):
        owner, result = Owner(), report()
        with patch.object(capture, 'read_json', side_effect=json_read), patch.object(capture, 'verify_glass', return_value={'file': True}), \
             patch.object(capture, 'verify_vetro', return_value={'file': False}), patch.object(capture, 'connect') as connect:
            capture.collect(owner, '192.168.84.19', 1, result)
        connect.assert_not_called()
        self.assertEqual(result['failedPhase'], 'vetro-file-verification')
        self.assertFalse(result['captureComplete'])

    def test_missing_receiver_telemetry_does_not_launch(self):
        owner, result = Owner(), report()
        with patch.object(capture, 'read_json', side_effect=json_read), patch.object(capture, 'verify_glass', return_value={'file': True}), \
             patch.object(capture, 'receiver_state', side_effect=capture.CaptureError('Expected native request diagnostics are unavailable')), \
             patch.object(capture, 'connect') as connect:
            capture.collect(owner, '192.168.84.19', 1, result)
        connect.assert_not_called()
        self.assertEqual(result['failedPhase'], 'receiver-preflight')

    def test_debug_failure_restores_ui_once_without_service_or_permission_writes(self):
        owner, result = Owner(), report()
        debug = Mock(frames=[])
        debug.open_service.side_effect = capture.transport.ReadFailure('SDB closed the connection')
        with patch.object(capture, 'read_json', side_effect=json_read), patch.object(capture, 'verify_glass', return_value={'file': True}), \
             patch.object(capture, 'connect', return_value=debug) as connect:
            capture.collect(owner, '192.168.84.19', 1, result)
        self.assertEqual(connect.call_count, 1)
        self.assertEqual(result['failedPhase'], 'debug-service-open')
        self.assertIn('SDB connection closed before the response completed', result['errors'])
        commands = [base64.b64decode(body['cmd'].split()[2]).decode() for path, body in owner.calls if path == '/exec']
        self.assertEqual(len(commands), 2)
        self.assertTrue(all('GlassHome1.Photos' not in c and 'vetrotvapp' not in c for c in commands))
        self.assertIn('/usr/bin/app_launcher -s ' + capture.APP, commands[-1])
        self.assertTrue(result['normalRelaunchCommandCompleted'])
        self.assertNotIn('sensitive', json.dumps(result))
        self.assertTrue(all(body is None for path, body in owner.calls if path != '/exec'))

    def test_preflight_failure_leaves_ui_running_and_preserves_handshake_evidence(self):
        owner, result = Owner(), report()
        sockets = [ClosedSocket() for _ in range(3)]
        with patch.object(capture, 'read_json', side_effect=json_read), patch.object(capture, 'verify_glass', return_value={'file': True}), \
             patch.object(capture.socket, 'create_connection', side_effect=sockets) as connect, \
             patch.object(capture.time, 'sleep'):
            capture.collect(owner, '192.168.84.19', 1, result)
        self.assertEqual(result['failedPhase'], 'sdb-preflight')
        self.assertIn('SDB connection closed before the response completed', result['errors'])
        self.assertTrue(all(sock.closed for sock in sockets))
        self.assertEqual(connect.call_count, 3)
        self.assertEqual(len(result['transportAttempts']), 3)
        self.assertFalse(any(path == '/exec' for path, body in owner.calls))
        attempt = result['transportAttempts'][0]
        self.assertEqual(attempt['stage'], 'sdb-handshake')
        self.assertEqual([f['command'] for f in attempt['frames']], ['CNXN'])
        self.assertNotIn('normalRelaunchCommandCompleted', result)

    def test_preflight_does_not_open_any_sdb_service(self):
        sock, result = SdbSocket(), report()
        with patch.object(capture.socket, 'create_connection', return_value=sock):
            stream = capture.connect('192.168.84.19', 26201, report=result, purpose='debug-session')
        self.assertEqual([command for command, a, b, payload in sock.sent], [b'CNXN'])
        self.assertTrue(result['transportAttempts'][0]['connected'])
        stream.close()

    def test_existing_relay_session_is_not_interrupted(self):
        owner, result = Owner(), report()
        relay = json_read('/relay')
        relay['relay']['sessions'] = 1
        with patch.object(capture, 'read_json', return_value=relay), patch.object(capture, 'connect') as connect:
            capture.collect(owner, '192.168.84.19', 1, result)
        connect.assert_not_called()
        self.assertFalse(any(path == '/exec' for path, body in owner.calls))


class ReceiverTests(unittest.TestCase):
    def test_native_lookup_reports_shape_without_sending_or_exporting_identity(self):
        inspector = Mock()
        inspector.call.return_value = {'result': {'value': {'returned': True, 'expectedApp': True,
            'expectedPort': True, 'trustedIsBoolean': True, 'regular': True, 'canSend': True,
            'extra': 'private-identity'}}}
        result = capture.port_lookup(inspector)
        self.assertTrue(result['expectedApp'])
        self.assertNotIn('private', json.dumps(result))
        expression = inspector.call.call_args.args[1]['expression']
        self.assertNotIn('.sendMessage(', expression)
        self.assertNotIn('requestLocalMessagePort(', expression)
        inspector.call.return_value = {'result': {'value': {'returned': False, 'error': 'NotFoundError'}}}
        self.assertEqual(capture.port_lookup(inspector)['error'], 'NotFoundError')

    def test_service_restart_is_recorded_even_if_counts_reset(self):
        owner, result = Owner(), report()
        first = owner.receiver_status()
        result['receiverBefore'] = capture.receiver_state(first)
        capture.observe_receiver(owner, result, 0)
        owner.started_at = '2026-11-05T01:03:00.000Z'
        capture.observe_receiver(owner, result, 3)
        self.assertTrue(result['receiverRestartObserved'])
        self.assertEqual(len(result['receiverSamples']), 2)

    def test_receiver_observation_excludes_other_status_and_validates_revision(self):
        status = Owner().receiver_status()
        status['unrelated'] = 'private-user-data'
        status['connectionDiagnostics']['screen'] = {'token': 'private-screen-data'}
        result = capture.receiver_state(status)
        self.assertNotIn('private', json.dumps(result))
        status['connectionDiagnostics']['sourceRevision'] = 'b' * 40
        with self.assertRaises(capture.CaptureError):
            capture.receiver_state(status)

    def test_receiver_envelope_is_read_without_owner_credentials(self):
        owner = Owner()
        self.assertEqual(capture.read_receiver(owner)['requests']['counts'], {})
        self.assertEqual(owner.calls, [], 'authenticated status is not a diagnostic envelope')
        owner.opener.open.side_effect = capture.urllib.error.HTTPError(owner.base + '/status', 404, 'Missing', {}, io.BytesIO(b'{}'))
        with self.assertRaises(capture.urllib.error.HTTPError):
            capture.read_receiver(owner)

    def test_file_verification_only_reads_expected_package_files(self):
        owner = Owner()
        for package, expected in [('vetrotvapp', capture.VETRO_FILES), ('GlassHome1', capture.GLASS_FILES)]:
            hashes = '\n'.join(digest + '  ' + path for path, digest in expected.items())
            with patch.object(capture, 'remote', return_value=hashes) as remote:
                self.assertTrue(all(capture.verify_files(owner, package, expected).values()))
            command = remote.call_args.args[1]
            self.assertIn('/opt/usr/apps/' + package + '/res/wgt', command)
            self.assertNotIn('app_launcher', command)
            self.assertNotIn('kill', command)
        with self.assertRaises(capture.CaptureError):
            capture.verify_files(owner, 'unexpected', {})


if __name__ == '__main__':
    unittest.main()
