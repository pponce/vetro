import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import sys
import unittest
from unittest.mock import patch

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


class EvidenceTests(unittest.TestCase):
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
    def test_successful_capture_records_user_busy_and_restores_normal_ui(self):
        owner, result = Owner(), report()
        class Debug:
            remote = 1
            def __init__(self):
                self.buffer = bytearray()
            def pump(self):
                self.buffer.extend(b'port: 45678\n')
            def close(self):
                pass
        class Clock:
            now = 0
            def monotonic(self):
                self.now += 0.1
                return self.now
            def sleep(self, seconds):
                self.now += seconds
        clock = Clock()
        class Client:
            def __init__(self, *args):
                self.evaluations = 0
            def call(self, method, params=None):
                if method == 'Runtime.evaluate':
                    self.evaluations += 1
                    return {'result': {'value': {'present': True, 'adapter': True,
                        'state': 'timeout' if self.evaluations > 2 else 'unknown',
                        'busy': self.evaluations == 2}}}
                return {}
        with patch.object(capture, 'read_json', side_effect=json_read), patch.object(capture, 'verify_glass', return_value={'file': True}), \
             patch.object(capture, 'connect', side_effect=lambda *a, **k: Debug()) as connect, \
             patch.object(capture, 'inspector_pages', return_value=[{'title': 'Glass Home', 'type': 'page', 'webSocketDebuggerUrl': 'ws://127.0.0.1:45678/devtools/page/1'}]), \
             patch.object(capture, 'Inspector', Client), patch.object(capture.time, 'monotonic', clock.monotonic), patch.object(capture.time, 'sleep', clock.sleep):
            capture.collect(owner, '192.168.84.19', 3, result)
        self.assertTrue(result['captureComplete'])
        self.assertTrue(result['connectBusyObserved'])
        self.assertEqual(result['samples'][-1]['widget']['state'], 'timeout')
        self.assertTrue(result['normalRelaunchCommandCompleted'])
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

    def test_debug_failure_restores_ui_once_without_service_or_permission_writes(self):
        owner, result = Owner(), report()
        with patch.object(capture, 'read_json', side_effect=json_read), patch.object(capture, 'verify_glass', return_value={'file': True}), \
             patch.object(capture, 'connect', side_effect=RuntimeError('sensitive transport output')) as connect:
            capture.collect(owner, '192.168.84.19', 1, result)
        self.assertEqual(connect.call_count, 1)
        commands = [base64.b64decode(body['cmd'].split()[2]).decode() for path, body in owner.calls if path == '/exec']
        self.assertEqual(len(commands), 2)
        self.assertTrue(all('GlassHome1.Photos' not in c and 'vetrotvapp' not in c for c in commands))
        self.assertIn('/usr/bin/app_launcher -s ' + capture.APP, commands[-1])
        self.assertTrue(result['normalRelaunchCommandCompleted'])
        self.assertNotIn('sensitive', json.dumps(result))
        self.assertTrue(all(body is None for path, body in owner.calls if path != '/exec'))

    def test_existing_relay_session_is_not_interrupted(self):
        owner, result = Owner(), report()
        relay = json_read('/relay')
        relay['relay']['sessions'] = 1
        with patch.object(capture, 'read_json', return_value=relay), patch.object(capture, 'connect') as connect:
            capture.collect(owner, '192.168.84.19', 1, result)
        connect.assert_not_called()
        self.assertFalse(any(path == '/exec' for path, body in owner.calls))


if __name__ == '__main__':
    unittest.main()
