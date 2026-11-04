"""Exercise read-only SDB transport, limits, and truthful partial reports."""
import importlib.util
from pathlib import Path
import socket
import stat
import struct
import threading
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('inspect_runtime', Path(__file__).parents[1] / 'inspect-messageport-runtime.py')
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)


def frame(command, a, b, payload=b''):
    number = struct.unpack('<I', command)[0]
    return struct.pack('<6I', number, a, b, len(payload), sum(payload), number ^ 0xffffffff) + payload


def dent(name, mode, size=0):
    value = name.encode()
    return b'DENT' + struct.pack('<4I', mode, size, 0, len(value)) + value


class FragmentedSocket:
    def __init__(self, data):
        self.data = bytearray(data)
        self.writes = []

    def recv(self, size):
        value = bytes(self.data[:min(size, 3)])
        del self.data[:len(value)]
        return value

    def sendall(self, data):
        self.writes.append(data)

    def settimeout(self, _):
        pass

    def close(self):
        pass


class InspectRuntimeTests(unittest.TestCase):
    def test_fragmentation_list_pull_and_data_before_ack(self):
        source = b'function RemoteMessagePort(){return "messagePortObj";}'
        listing = dent('service_runner.js', stat.S_IFREG | 0o444, len(source)) + b'DONE' + bytes(16)
        data = (frame(b'CNXN', 0x01000000, 4096) + frame(b'OKAY', 7, 1) +
                frame(b'WRTE', 7, 1, listing[:13]) + frame(b'OKAY', 7, 1) +
                frame(b'WRTE', 7, 1, listing[13:]) + frame(b'OKAY', 7, 1) +
                frame(b'WRTE', 7, 1, b'DATA' + struct.pack('<I', len(source)) + source + b'DONE' + bytes(4)))
        sock = FragmentedSocket(data)
        reader = M.SdbReader(sock)
        reader.connect()
        self.assertEqual(reader.list('/usr/lib/wrt'), [('service_runner.js', stat.S_IFREG | 0o444, len(source))])
        self.assertEqual(reader.pull('/usr/lib/wrt/service_runner.js'), source)
        reader.close()
        requests = [packet[24:] for packet in sock.writes if packet[:4] == b'WRTE']
        self.assertEqual([request[:4] for request in requests], [b'LIST', b'RECV'])
        self.assertTrue(all(b'shell:' not in packet and b'SEND' not in packet for packet in sock.writes))

    def test_real_socket_round_trip(self):
        client, server = socket.socketpair()
        failures = []
        def serve():
            peer = M.SdbReader(server)
            try:
                self.assertEqual(peer.frame()[0], b'CNXN')
                server.sendall(frame(b'CNXN', 0x01000000, 4096))
                self.assertEqual(peer.frame()[3], b'sync:\0')
                server.sendall(frame(b'OKAY', 7, 1))
                request = peer.frame()
                self.assertEqual(request[3][:4], b'LIST')
                server.sendall(frame(b'OKAY', 7, 1))
                server.sendall(frame(b'WRTE', 7, 1, b'DONE' + bytes(16)))
                self.assertEqual(peer.frame()[0], b'OKAY')
                self.assertEqual(peer.frame()[0], b'CLSE')
            except BaseException as error:
                failures.append(error)
            finally:
                server.close()
        thread = threading.Thread(target=serve, daemon=True)
        thread.start()
        reader = M.SdbReader(client)
        try:
            reader.connect()
            self.assertEqual(reader.list('/usr/lib'), [])
        finally:
            reader.close()
        thread.join(2)
        self.assertFalse(thread.is_alive())
        self.assertEqual(failures, [])

    def test_authentication_does_not_register_keys(self):
        sock = FragmentedSocket(frame(b'AUTH', 1, 0, b'not-logged'))
        with self.assertRaisesRegex(M.ReadFailure, 'no key'):
            M.SdbReader(sock).connect()
        self.assertEqual([packet[:4] for packet in sock.writes], [b'CNXN'])

    def test_frame_corruption_wrong_stream_and_limits(self):
        corrupt = bytearray(frame(b'CNXN', 0, 4096, b'test'))
        corrupt[-1] ^= 1
        with self.assertRaisesRegex(M.ReadFailure, 'checksum'):
            M.SdbReader(FragmentedSocket(corrupt)).frame()
        reader = M.SdbReader(FragmentedSocket(frame(b'WRTE', 9, 1, b'x')))
        reader.remote = 7
        with self.assertRaisesRegex(M.ReadFailure, 'stream identity'):
            reader.pump()
        reader = M.SdbReader(FragmentedSocket(frame(b'OKAY', 7, 1) +
            frame(b'WRTE', 7, 1, b'DATA' + struct.pack('<I', M.MAX_SOURCE + 1))))
        reader.remote = 7
        with self.assertRaisesRegex(M.ReadFailure, 'limit'):
            reader.pull('/usr/lib/service_runner.js')

    def test_non_read_operations_and_unrelated_files_refused(self):
        sock = FragmentedSocket(b'')
        reader = M.SdbReader(sock)
        for operation, path in [(b'SEND', '/usr/lib/service_runner.js'),
                                (b'RECV', '/usr/lib/credentials.json'),
                                (b'LIST', '/usr/../home'), (b'LIST', '/home/owner')]:
            with self.assertRaises(M.ReadFailure):
                reader.request(operation, path)
        self.assertEqual(sock.writes, [])

    def test_source_candidate_never_claims_loaded_runtime(self):
        class SourceReader:
            def list(self, path):
                raise AssertionError('A successful direct read must not start a directory walk')
            def pull(self, path):
                assert path == M.DIRECT_SOURCE
                return b'code'
        report = dict(directoriesAttempted=0, directoriesRead=0, directoriesRefused=0,
                      sourceReadsRefused=0, sources=[], loadedRuntimeVerified=False)
        M.inspect(SourceReader(), report)
        self.assertTrue(report['sourceRetrieved'])
        self.assertFalse(report['loadedRuntimeVerified'])
        self.assertEqual(report['assessment'], 'candidate-source-retrieved')
        self.assertEqual(report['sourceReadsAttempted'], 1)
        self.assertEqual(report['directoriesAttempted'], 0)
        self.assertFalse(report['searchLimitReached'])

    def test_runtime_priority_and_symlink_candidate(self):
        visited = []
        class SourceReader:
            def list(self, path):
                visited.append(path)
                if path == '/usr/share/wrt':
                    return [('alternate', stat.S_IFDIR, 0)]
                if path == '/usr/share/wrt/alternate':
                    return [('service_runner.js', stat.S_IFLNK, 32)]
                if path == '/usr/lib':
                    raise AssertionError('Broad directories must not preempt the runtime subtree')
                return []
            def pull(self, path):
                if path == M.DIRECT_SOURCE:
                    raise PermissionError('not found')
                assert path == '/usr/share/wrt/alternate/service_runner.js'
                return b'linked runtime source'
        report = dict(directoriesAttempted=0, directoriesRead=0, directoriesRefused=0,
                      sourceReadsRefused=0, sources=[], loadedRuntimeVerified=False)
        M.inspect(SourceReader(), report)
        self.assertTrue(report['sourceRetrieved'])
        self.assertFalse(report['loadedRuntimeVerified'])
        self.assertEqual(report['sourceReadsRefused'], 1)
        self.assertEqual(report['sourceReadsAttempted'], 2)
        self.assertEqual(report['sources'][0]['source'], 'linked runtime source')

    def test_search_limit_is_not_an_absence_claim(self):
        class SourceReader:
            def list(self, path):
                if path == '/usr/share/wrt':
                    return [('module-' + str(i), stat.S_IFDIR, 0) for i in range(700)]
                return []
            def pull(self, path):
                raise PermissionError('not found')
        report = dict(directoriesAttempted=0, directoriesRead=0, directoriesRefused=0,
                      sourceReadsRefused=0, sources=[], loadedRuntimeVerified=False)
        M.inspect(SourceReader(), report)
        self.assertEqual(report['directoriesAttempted'], 600)
        self.assertFalse(report['sourceRetrieved'])
        self.assertTrue(report['searchLimitReached'])
        self.assertEqual(len(report['pendingDirectorySample']), 20)
        self.assertEqual(report['assessment'], 'source-unavailable-within-read-only-search')

    def test_guards_prevent_connection_and_do_not_export_http_bodies(self):
        revision = 'a' * 40
        status = {'connectionDiagnostics': {'sourceRevision': revision, 'sourceDirty': False}, 'token': 'secret'}
        with patch.object(M, 'read_json', side_effect=[status, {'relay': {'enabled': True,
                'listening': True, 'sessions': 1, 'port': 26201, 'lastFailure': {'reason': 'old'}}}]), \
             patch.object(M.socket, 'create_connection') as connect:
            report = M.collect('192.0.2.1', revision)
        connect.assert_not_called()
        self.assertFalse(report['sourceRetrieved'])
        self.assertNotIn('secret', str(report))
        self.assertNotIn('old', str(report))
        self.assertIn('Another relay session', report['errors'][0])

    def test_failed_read_is_explicit_and_keeps_partial_source(self):
        revision = 'a' * 40
        status = {'connectionDiagnostics': {'sourceRevision': revision, 'sourceDirty': False}}
        relay = {'relay': {'enabled': True, 'listening': True, 'sessions': 0, 'port': 26201}}
        def partial(reader, report):
            report['sources'].append({'source': 'code'})
            raise M.ReadFailure('Inspection time limit reached')
        with patch.object(M, 'read_json', side_effect=[status, relay]), \
             patch.object(M.socket, 'create_connection'), patch.object(M.SdbReader, 'connect'), \
             patch.object(M, 'inspect', side_effect=partial):
            report = M.collect('192.0.2.1', revision)
        self.assertTrue(report['sourceRetrieved'])
        self.assertFalse(report['loadedRuntimeVerified'])
        self.assertEqual(report['assessment'], 'partial-source')


if __name__ == '__main__':
    unittest.main()
