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


class ReadFailure(RuntimeError):
    pass


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
    """One SDB connection and one sync stream; only LIST and RECV requests."""
    def __init__(self, connection, seconds=90):
        self.sock = connection
        self.deadline = time.monotonic() + seconds
        self.buffer = bytearray()
        self.local = 1
        self.remote = None

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
        return struct.pack('<I', command), a, b, payload

    def connect(self):
        self.send(b'CNXN', 0x01000000, 4096, b'host::vetro-readonly')
        command, version, maximum, _ = self.frame()
        if command == b'AUTH':
            raise ReadFailure('SDB requires authentication; no key was created or registered')
        if command != b'CNXN' or maximum < 1024:
            raise ReadFailure('Unexpected SDB handshake')
        self.send(b'OPEN', self.local, 0, b'sync:\0')
        command, a, b, _ = self.frame()
        if command != b'OKAY' or b != self.local or not a:
            raise ReadFailure('SDB file-reading stream was refused')
        self.remote = a

    def pump(self):
        command, a, b, payload = self.frame()
        if a != self.remote or b != self.local:
            raise ReadFailure('Unexpected SDB stream identity')
        if command == b'WRTE':
            if len(self.buffer) + len(payload) > MAX_SOURCE + MAX_FRAME:
                raise ReadFailure('SDB buffer limit exceeded')
            self.buffer.extend(payload)
            self.send(b'OKAY', self.local, self.remote)
        elif command == b'CLSE':
            raise ReadFailure('SDB closed the file-reading stream')
        elif command != b'OKAY':
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
        self.send(b'WRTE', self.local, self.remote,
                  operation + struct.pack('<I', len(encoded)) + encoded)
        while self.pump() != b'OKAY':
            pass

    def failed(self):
        length = struct.unpack('<I', self.read(4))[0]
        if length > 4096:
            raise ReadFailure('Invalid SDB failure length')
        # The TV's error text is not needed and is not copied into the report.
        self.read(length)
        raise PermissionError('SDB refused this file operation')

    def list(self, path):
        self.request(b'LIST', path)
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
        self.request(b'RECV', path)
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
            if self.remote:
                self.send(b'CLSE', self.local, self.remote)
        finally:
            self.sock.close()


def inspect(reader, report):
    queue = deque((path, 0, False) for path in ROOTS)
    seen = set()
    while queue and len(seen) < 600 and len(report['sources']) < 4:
        path, depth, relevant = queue.popleft()
        if path in seen:
            continue
        seen.add(path)
        report['directoriesAttempted'] += 1
        try:
            entries = reader.list(path)
        except PermissionError:
            report['directoriesRefused'] += 1
            continue
        report['directoriesRead'] += 1
        for name, mode, size in sorted(entries):
            candidate = path + '/' + name
            if name == 'service_runner.js' and stat.S_ISREG(mode) and 0 < size <= MAX_SOURCE:
                try:
                    source = reader.pull(candidate)
                except PermissionError:
                    report['sourceReadsRefused'] += 1
                    continue
                text = source.decode('utf-8', errors='strict')
                report['sources'].append({'path': candidate, 'bytes': len(source),
                    'sha256': hashlib.sha256(source).hexdigest(),
                    'markers': {key: key in text for key in (
                        'LocalMessagePort', 'RemoteMessagePort', 'messagePortObj',
                        'org_remote_app_id', 'org_remote_port')}, 'source': text})
            elif stat.S_ISDIR(mode) and depth < 6:
                matched = bool(INTERESTING.search(name))
                if relevant or matched:
                    queue.append((candidate, depth + 1, relevant or matched))
    report['searchLimitReached'] = bool(queue)
    report['sourceRetrieved'] = bool(report['sources'])
    report['assessment'] = ('candidate-source-retrieved' if report['sources'] else
                            'source-unavailable-within-read-only-search')


def collect(tv, revision):
    report = {'schema': 1, 'capturedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
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
        # credentials, HTTP bodies, directory listings or command output.
        report['errors'].append(str(error) if isinstance(error, ReadFailure) else type(error).__name__)
        report['assessment'] = 'partial-source' if report['sources'] else 'read-blocked'
    finally:
        report['sourceRetrieved'] = bool(report['sources'])
        if reader:
            try:
                reader.close()
            except Exception:
                pass
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
    print('Report: ' + str(args.output))


if __name__ == '__main__':
    main()
