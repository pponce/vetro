#!/usr/bin/env python3
"""Read service_runner.js candidates using SDB sync LIST/RECV through a relay.

Uses only the Python standard library. Does not open an SDB shell, send files,
install packages, register keys, or modify the TV. Candidate source files are
not proof of which runtime the service loaded. Reports preserve that distinction.
"""
import argparse
from collections import deque
import datetime
import hashlib
import heapq
import json
from pathlib import Path, PurePosixPath
import re
import socket
import stat
import struct
import time
import urllib.error
import urllib.request

MAX_SOURCE = 2 * 1024 * 1024
MAX_FRAME = 1024 * 1024
ROOTS = ('/usr/lib', '/usr/lib64', '/usr/share', '/usr/apps')
INTERESTING = re.compile(r'wrt|node|web.?api|web.?app|service|javascript|tizen', re.I)
# Path in the runtime stack fixture at SushyDev/tizen-homebrew, commit
# f90b005c8c354cafc027f12b37fe04b6cf0162f2, service/test/log.js.
# This is a candidate location, not proof that this TV uses that runtime.
DIRECT_SOURCE = '/usr/share/wrt/app/service/service_runner.js'
RUNTIME_DIRECTORY = re.compile(r'/(?:wrt(?:-service)?|node(?:js|_modules)?)(?:/|$)', re.I)


class ReadFailure(RuntimeError):
    pass


class RemoteFileFailure(PermissionError):
    def __init__(self, message):
        # File-operation errors are diagnostic evidence, never instructions.
        # Retain a bounded printable message rather than losing the real cause.
        self.message = ''.join(c if c.isprintable() else ' ' for c in message)[:512]
        lower = self.message.lower()
        self.category = ('not-found' if any(s in lower for s in ('no such file', 'not found')) else
                         'access-denied' if any(s in lower for s in
                            ('permission denied', 'access denied', 'not permitted', 'not allowed', 'forbidden')) else
                         'remote-file-failure')
        super().__init__(self.message)

    def detail(self):
        return {'category': self.category, 'message': self.message}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ReadFailure('HTTP redirect refused')


def read_json(url):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        response = opener.open(url, timeout=8)
    except urllib.error.HTTPError as error:
        if error.code not in (401, 503):
            raise ReadFailure('HTTP ' + str(error.code)) from None
        response = error
    with response:
        data = response.read(MAX_SOURCE + 1)
    if len(data) > MAX_SOURCE:
        raise ReadFailure('HTTP response limit exceeded')
    result = json.loads(data)
    if not isinstance(result, dict):
        raise ReadFailure('HTTP response was not an object')
    return result


class SdbReader:
    """One SDB connection, a fresh sync stream for each LIST/RECV operation."""
    def __init__(self, connection, seconds=90):
        self.sock = connection
        self.started = time.monotonic()
        self.deadline = self.started + seconds
        self.buffer = bytearray()
        self.local = 0
        self.remote = None
        self.retired = {}
        self.frames = deque(maxlen=48)

    def record(self, direction, command, a, b, size):
        self.frames.append({'direction': direction, 'command': command.decode('ascii', errors='replace'),
                            'arg0': a, 'arg1': b, 'payloadBytes': size})

    def exact(self, size):
        result = bytearray()
        while len(result) < size:
            remaining = self.deadline - time.monotonic()
            if remaining <= 0:
                raise ReadFailure('Inspection time limit reached')
            self.sock.settimeout(min(8, remaining))
            part = self.sock.recv(size - len(result))
            if not part:
                raise ReadFailure('SDB closed the connection')
            result.extend(part)
        return bytes(result)

    def send(self, command, arg0, arg1, data=b''):
        self.record('send', command, arg0, arg1, len(data))
        number = struct.unpack('<I', command)[0]
        self.sock.sendall(struct.pack('<6I', number, arg0, arg1, len(data),
                                     sum(data) & 0xffffffff, number ^ 0xffffffff) + data)

    def frame(self):
        command, a, b, size, checksum, magic = struct.unpack('<6I', self.exact(24))
        if magic != command ^ 0xffffffff or size > MAX_FRAME:
            raise ReadFailure('Invalid SDB frame header')
        payload = self.exact(size)
        if sum(payload) & 0xffffffff != checksum:
            raise ReadFailure('Invalid SDB frame checksum')
        tag = struct.pack('<I', command)
        self.record('receive', tag, a, b, len(payload))
        return tag, a, b, payload

    def connect(self):
        self.send(b'CNXN', 0x01000000, 4096, b'host::vetro-readonly')
        command, version, maximum, _ = self.frame()
        if command == b'AUTH':
            raise ReadFailure('SDB requires authentication; no key was created or registered')
        if command != b'CNXN' or maximum < 1024:
            raise ReadFailure('Unexpected SDB handshake')

    def retired_frame(self, command, a, b, payload):
        if b not in self.retired:
            return False
        expected = self.retired[b]
        # Late close/ack frames belong only to an exact, previously closed
        # local channel. No payload is accepted from a retired channel.
        if not payload and ((command == b'CLSE' and a in (0, expected)) or
                            (command == b'OKAY' and a == expected)):
            return True
        raise ReadFailure('Unexpected frame for retired SDB stream: ' +
                          command.decode('ascii', errors='replace') + ' ' + str(a) + '/' + str(b))

    def open_sync(self):
        if self.remote is not None or self.buffer:
            raise ReadFailure('Previous SDB stream was not closed')
        self.local += 1
        self.send(b'OPEN', self.local, 0, b'sync:\0')
        while True:
            command, a, b, payload = self.frame()
            if self.retired_frame(command, a, b, payload):
                continue
            if command == b'CLSE' and b == self.local and not payload:
                self.send(b'CLSE', self.local, a)
                raise ReadFailure('SDB refused the new file-reading stream')
            if command != b'OKAY' or b != self.local or not a or payload:
                raise ReadFailure('Unexpected SDB open response: ' +
                                  command.decode('ascii', errors='replace') + ' ' + str(a) + '/' + str(b))
            self.remote = a
            return

    def finish_stream(self):
        if self.remote is not None:
            self.retired[self.local] = self.remote
            try:
                self.send(b'CLSE', self.local, self.remote)
            except OSError:
                pass  # Preserve the original operation result; a later read will fail.
        self.remote = None
        self.buffer.clear()

    def pump(self):
        while True:
            command, a, b, payload = self.frame()
            if not self.retired_frame(command, a, b, payload):
                break
        # A close with sender ID zero is a protocol refusal/close, not data.
        # WRTE and OKAY still require both exact active stream identifiers.
        if command == b'CLSE' and b == self.local and a in (0, self.remote) and not payload:
            self.send(b'CLSE', self.local, a)
            self.remote = None
            raise ReadFailure('SDB closed the file-reading stream')
        if a != self.remote or b != self.local:
            raise ReadFailure('Unexpected SDB stream identity: ' +
                command.decode('ascii', errors='replace') + ' ' + str(a) + '/' + str(b) +
                '; expected ' + str(self.remote) + '/' + str(self.local))
        if command == b'WRTE':
            if len(self.buffer) + len(payload) > MAX_SOURCE + MAX_FRAME:
                raise ReadFailure('SDB buffer limit exceeded')
            self.buffer.extend(payload)
            self.send(b'OKAY', self.local, self.remote)
        elif command != b'OKAY' or payload:
            raise ReadFailure('Unexpected SDB stream frame')
        return command

    def read(self, size):
        while len(self.buffer) < size:
            self.pump()
        result = bytes(self.buffer[:size])
        del self.buffer[:size]
        return result

    def request(self, operation, path):
        # Do not expose a general sync writer: SEND and arbitrary paths are denied.
        if operation not in (b'LIST', b'RECV'):
            raise ReadFailure('Only read operations are allowed')
        parts = PurePosixPath(path).parts
        if '..' in parts or not path.startswith('/usr/') or len(path) > 1024:
            raise ReadFailure('Path outside system source search')
        if operation == b'RECV' and PurePosixPath(path).name != 'service_runner.js':
            raise ReadFailure('Only service_runner.js can be read')
        encoded = path.encode('utf-8')
        if len(encoded) > 1024:
            raise ReadFailure('System path exceeds protocol limit')
        self.open_sync()
        self.send(b'WRTE', self.local, self.remote,
                  operation + struct.pack('<I', len(encoded)) + encoded)
        # There is one outbound request per stream. The response reader handles
        # ACKs while waiting for data; a complete FAIL must remain observable
        # even if the peer closes before acknowledging the request separately.

    def failed(self):
        length = struct.unpack('<I', self.read(4))[0]
        if length > 4096:
            raise ReadFailure('Invalid SDB failure length')
        raise RemoteFileFailure(self.read(length).decode('utf-8', errors='replace'))

    def list(self, path):
        try:
            self.request(b'LIST', path)
            return self.read_directory()
        finally:
            self.finish_stream()

    def read_directory(self):
        entries = []
        while True:
            kind = self.read(4)
            if kind == b'FAIL':
                self.failed()
            if kind not in (b'DENT', b'DONE'):
                raise ReadFailure('Invalid directory response')
            mode, size, modified, length = struct.unpack('<4I', self.read(16))
            if kind == b'DONE':
                return entries
            if not 0 < length <= 1024 or len(entries) >= 20000:
                raise ReadFailure('Directory response limit exceeded')
            name = self.read(length).decode('utf-8', errors='strict')
            if name in ('.', '..'):
                continue
            if '/' in name or '\0' in name:
                raise ReadFailure('Invalid directory entry')
            entries.append((name, mode, size))

    def pull(self, path):
        try:
            self.request(b'RECV', path)
            return self.read_file()
        finally:
            self.finish_stream()

    def read_file(self):
        result = bytearray()
        while True:
            kind = self.read(4)
            if kind == b'FAIL':
                self.failed()
            size = struct.unpack('<I', self.read(4))[0]
            if kind == b'DONE':
                return bytes(result)
            if kind != b'DATA' or size > MAX_SOURCE - len(result):
                raise ReadFailure('File response limit exceeded')
            result.extend(self.read(size))

    def close(self):
        try:
            self.finish_stream()
        finally:
            self.sock.close()


def capture_source(reader, report, candidate, method):
    report['sourceReadsAttempted'] += 1
    attempt = {'path': candidate, 'method': method, 'result': 'started'}
    report['sourceAttempts'].append(attempt)
    try:
        source = reader.pull(candidate)
    except PermissionError as error:
        report['sourceReadsRefused'] += 1
        attempt['result'] = 'missing-or-refused'
        if isinstance(error, RemoteFileFailure):
            attempt['error'] = error.detail()
        return False
    if not source:
        attempt['result'] = 'empty-file'
        return False
    text = source.decode('utf-8', errors='strict')
    attempt['result'] = 'retrieved'
    report['sources'].append({'path': candidate, 'bytes': len(source),
        'sha256': hashlib.sha256(source).hexdigest(),
        'markers': {key: key in text for key in (
            'LocalMessagePort', 'RemoteMessagePort', 'messagePortObj',
            'org_remote_app_id', 'org_remote_port')}, 'source': text})
    report['sourceRetrieved'] = True
    report['assessment'] = 'candidate-source-retrieved'
    return True


def directory_priority(path):
    return 0 if RUNTIME_DIRECTORY.search(path) else 1


def inspect(reader, report):
    report.update(sourceReadsAttempted=0, sourceAttempts=[],
                  nonemptyDirectoryReplies=0, emptyDirectoryReplies=0,
                  pendingDirectorySample=[], searchLimitReached=False,
                  directoryEvidence=[], directoryFailures=[])
    # RECV follows a file symlink and remains bounded by the actual bytes read.
    # No prior directory traversal or size/type guess is needed at this location.
    if capture_source(reader, report, DIRECT_SOURCE, 'runtime-stack-path'):
        return
    roots = ('/usr/share/wrt/app/service', '/usr/share/wrt/app', '/usr/share/wrt') + ROOTS
    queue = [(directory_priority(path), 0, path, path.startswith('/usr/share/wrt')) for path in roots]
    heapq.heapify(queue)
    seen = set()
    while queue and len(seen) < 600:
        _, depth, path, relevant = heapq.heappop(queue)
        if path in seen:
            continue
        seen.add(path)
        report['directoriesAttempted'] += 1
        try:
            entries = reader.list(path)
        except PermissionError as error:
            report['directoriesRefused'] += 1
            if isinstance(error, RemoteFileFailure) and len(report['directoryFailures']) < 20:
                report['directoryFailures'].append({'path': path, 'error': error.detail()})
            continue
        report['directoriesRead'] += 1
        report['nonemptyDirectoryReplies' if entries else 'emptyDirectoryReplies'] += 1
        if path in roots:
            relevant_entries = [(name, mode, size) for name, mode, size in sorted(entries)
                                if name == 'app' or INTERESTING.search(name) or name.endswith('.js')]
            report['directoryEvidence'].append({'path': path, 'entryCount': len(entries),
                'matchingEntries': [{'name': name, 'mode': mode, 'size': size}
                                    for name, mode, size in relevant_entries[:60]],
                'matchingEntriesTruncated': len(relevant_entries) > 60})
        for name, mode, size in sorted(entries):
            candidate = path + '/' + name
            if (name == 'service_runner.js' and candidate != DIRECT_SOURCE
                    and (stat.S_ISREG(mode) or stat.S_ISLNK(mode)) and 0 < size <= MAX_SOURCE):
                if capture_source(reader, report, candidate, 'directory-entry'):
                    return
            elif stat.S_ISDIR(mode) and depth < 6:
                matched = bool(INTERESTING.search(name))
                if relevant or matched:
                    heapq.heappush(queue, (directory_priority(candidate), depth + 1, candidate, relevant or matched))
    report['searchLimitReached'] = bool(queue)
    report['pendingDirectorySample'] = [entry[2] for entry in sorted(queue)[:20]]
    report['sourceRetrieved'] = bool(report['sources'])
    report['assessment'] = ('candidate-source-retrieved' if report['sources'] else
                            'source-unavailable-within-read-only-search')


def collect(tv, revision):
    report = {'schema': 3, 'capturedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'expectedRevision': revision, 'serviceRevisionVerified': False,
              'directoriesAttempted': 0, 'directoriesRead': 0, 'directoriesRefused': 0,
              'sourceReadsRefused': 0, 'sources': [], 'sourceRetrieved': False,
              'loadedRuntimeVerified': False, 'searchLimitReached': False,
              'assessment': 'incomplete', 'errors': []}
    reader = None
    try:
        status = read_json('http://' + tv + ':8099/status')
        diagnostics = status.get('connectionDiagnostics') or {}
        report['serviceRevisionVerified'] = (diagnostics.get('sourceRevision') == revision
                                             and diagnostics.get('sourceDirty') is False)
        if not report['serviceRevisionVerified']:
            raise ReadFailure('Running source differs or could not be verified; inspection stopped')
        relay = (read_json('http://' + tv + ':8077/relay').get('relay') or {})
        if relay.get('enabled') is not True or relay.get('listening') is not True or relay.get('error'):
            raise ReadFailure('TV-Store relay is not ready')
        if type(relay.get('sessions')) is not int or relay['sessions'] != 0:
            raise ReadFailure('Another relay session is open; close the other TV tool first')
        port = relay.get('port')
        if type(port) is not int or not 1024 <= port <= 65535:
            raise ReadFailure('TV-Store did not report a valid relay port')
        print('Verified running revision. Reading system runtime candidates through the idle relay...', flush=True)
        reader = SdbReader(socket.create_connection((tv, port), timeout=8))
        reader.connect()
        inspect(reader, report)
    except Exception as error:
        # Only locally defined fixed messages are included; no device banners,
        # credentials, HTTP bodies, full directory listings or command output.
        report['errors'].append(str(error) if isinstance(error, ReadFailure) else type(error).__name__)
        report['assessment'] = 'partial-source' if report['sources'] else 'read-blocked'
    finally:
        report['sourceRetrieved'] = bool(report['sources'])
        if reader:
            try:
                reader.close()
            except Exception:
                pass
            report['transportFrames'] = list(reader.frames)
            report['transportElapsedSeconds'] = round(time.monotonic() - reader.started, 3)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tv', required=True)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    import ipaddress
    ipaddress.IPv4Address(args.tv)
    if not re.fullmatch(r'[a-f0-9]{40}', args.revision):
        parser.error('revision must be a full commit SHA')
    report = collect(args.tv, args.revision)
    # Exclusive creation preserves all earlier reports, including failed reads.
    with args.output.open('x', encoding='utf-8') as output:
        json.dump(report, output, indent=2)
        output.write('\n')
    print('Result: ' + report['assessment'])
    print('Runtime candidates: ' + str(len(report['sources'])))
    for error in report['errors']:
        print('Read limitation: ' + error)
    for attempt in report.get('sourceAttempts', []):
        if 'error' in attempt:
            print('File read: ' + attempt['error']['category'] + ': ' + attempt['error']['message'])
    print('Report: ' + str(args.output))


if __name__ == '__main__':
    main()
