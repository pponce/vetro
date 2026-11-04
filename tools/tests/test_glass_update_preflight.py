"""Run the shipped SSH block's HTTP preflight against an actual local server."""
import ast
import contextlib
import http.server
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import threading
import tempfile
import unittest
from unittest import mock
import urllib.error

NOTE = Path(__file__).parents[2] / 'notes/permissions-reply-startup-handoff.md'
BLOCK = re.search(r'### 2\. Update Glass Home.*?```bash\n(.*?)\n```', NOTE.read_text(), re.S).group(1)
SOURCE = re.search(r"python3 - <<'PYGLASS'\n(.*?)\nPYGLASS", BLOCK, re.S).group(1)
NODES = ast.parse(SOURCE).body
SELECTED = [n for n in NODES if isinstance(n, (ast.Import, ast.ImportFrom, ast.ClassDef, ast.FunctionDef)) or
            isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'opener' for t in n.targets)]
ENV = {}
exec(compile(ast.Module(body=SELECTED, type_ignores=[]), str(NOTE), 'exec'), ENV)
REVISION = 'fc0b236878a2249906edf774888f5a39f46842c0'


@contextlib.contextmanager
def endpoint(status, body):
    requests = []
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            requests.append(dict(self.headers))
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            if status == 302:
                self.send_header('Location', '/elsewhere')
            self.end_headers()
            self.wfile.write(body if isinstance(body, bytes) else json.dumps(body).encode())
        def log_message(self, *_):
            pass
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield 'http://127.0.0.1:' + str(server.server_port) + '/status', requests
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


class PreflightTests(unittest.TestCase):
    def evidence(self):
        return {'error': 'Pair this device first', 'connectionDiagnostics': {
            'sourceRevision': REVISION, 'sourceDirty': False,
            'screen': {'sourceRevision': REVISION, 'serviceAuthenticated': True}}}

    def test_diagnostic_401_is_evidence_not_owner_authorization(self):
        for status in (200, 401):
            with self.subTest(status=status), endpoint(status, self.evidence()) as (url, requests):
                ENV['verify_vetro_status'](url)
                self.assertEqual(len(requests), 1)
                self.assertNotIn('Authorization', requests[0])
        with endpoint(401, self.evidence()) as (url, _):
            with self.assertRaises(urllib.error.HTTPError):
                ENV['read_json'](url)  # GitHub and other reads never accept 401.

    def test_other_status_and_redirect_do_not_pass(self):
        for status in (202, 302, 403, 503):
            with self.subTest(status=status), endpoint(status, self.evidence()) as (url, requests):
                with self.assertRaises((RuntimeError, urllib.error.HTTPError)):
                    ENV['verify_vetro_status'](url)
                self.assertEqual(len(requests), 1)

    def test_bad_or_unverified_evidence_does_not_pass(self):
        variants = [{}, [], {'connectionDiagnostics': []}, {'connectionDiagnostics': {'screen': []}}]
        for field, value in [('sourceRevision', '0' * 40), ('sourceDirty', True), ('sourceDirty', 0)]:
            item = self.evidence(); item['connectionDiagnostics'][field] = value; variants.append(item)
        for field, value in [('sourceRevision', '0' * 40), ('serviceAuthenticated', False), ('serviceAuthenticated', 1)]:
            item = self.evidence(); item['connectionDiagnostics']['screen'][field] = value; variants.append(item)
        for body in variants + [b'not json', b' ' * 2097153]:
            with self.subTest(body=str(body)[:80]), endpoint(401, body) as (url, _):
                with self.assertRaises((RuntimeError, ValueError)):
                    ENV['verify_vetro_status'](url)

    def test_complete_shell_block_keeps_ssh_session_and_report_arguments(self):
        result = subprocess.run(['bash', '-n'], input=BLOCK, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(BLOCK.startswith('{\n'))
        self.assertTrue(BLOCK.endswith('\n}'))
        self.assertNotRegex(BLOCK, r'\bexit\b|set -e')
        self.assertIn('--report-host', BLOCK)
        self.assertIn('pedro@192.168.84.2', BLOCK)
        self.assertGreater(BLOCK.index('=== Glass Home authenticated reply update END ==='), BLOCK.index('\nPYGLASS'))

    def test_full_block_collects_before_install_and_refuses_changed_helper(self):
        # Run the shipped Python with external effects and artifact inputs
        # replaced. Historical pinned files are independent of this branch's
        # current sources; real SHA-256 checks still reject changed fixture bytes.
        names = ('install-glass-permissions.py', 'vetro_owner.py', 'diagnose-app-access.py', 'app_access_input_audit.py')
        sources = {name: ('# controlled test artifact: ' + name + '\n').encode() for name in names}
        file_assignment = next(n for n in ast.walk(ast.parse(SOURCE)) if isinstance(n, ast.Assign)
                               and any(isinstance(t, ast.Name) and t.id == 'files' for t in n.targets))
        self.assertEqual({key.value for key in file_assignment.value.keys}, set(names))
        for value in file_assignment.value.values:
            self.assertRegex(value.elts[1].value, r'^[a-f0-9]{64}$')
        fixture_files = {name: ('f' * 40, hashlib.sha256(source).hexdigest()) for name, source in sources.items()}
        class ArtifactInputs(ast.NodeTransformer):
            def visit_Assign(self, node):
                if any(isinstance(t, ast.Name) and t.id == 'files' for t in node.targets):
                    node.value = ast.copy_location(ast.Name(id='fixture_files', ctx=ast.Load()), node.value)
                return node
        nodes = [n for n in ast.parse(SOURCE).body if not (
            isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'project' for t in n.targets))]
        module = ArtifactInputs().visit(ast.Module(body=nodes, type_ignores=[]))
        code = compile(ast.fix_missing_locations(module), str(NOTE), 'exec')
        for tampered in (False, True):
            with self.subTest(tampered=tampered), tempfile.TemporaryDirectory() as temporary:
                project = Path(temporary)
                directory = project / 'vetro-install/bin/permissions-recovery-160d3b7f8921'
                directory.mkdir(parents=True)
                for name, source in sources.items():
                    (directory / name).write_bytes(source)
                if tampered:
                    (directory / 'vetro_owner.py').write_text('changed')
                calls = []
                def request(req, timeout):
                    if req.full_url.endswith('/status'):
                        raise urllib.error.HTTPError(req.full_url, 401, 'Unauthorized', {}, io.BytesIO(json.dumps(self.evidence()).encode()))
                    self.assertTrue(req.full_url.endswith('/41796862889'))
                    response = io.BytesIO(json.dumps({'head_sha': '30c490194f1748d523262a1ac8985fe45f735729',
                                                      'status': 'completed', 'conclusion': 'success'}).encode())
                    response.getcode = lambda: 200
                    return response
                opener = mock.Mock()
                opener.open.side_effect = request
                def run(args, check):
                    calls.append(args)
                    if any(str(a).endswith('diagnose-app-access.py') for a in args):
                        report = project / 'vetro-install/access-diagnostics/app-access-fixture.json'
                        report.parent.mkdir(parents=True)
                        report.write_text('{}')
                output = io.StringIO()
                with mock.patch('urllib.request.build_opener', return_value=opener), mock.patch('subprocess.run', side_effect=run), contextlib.redirect_stdout(output):
                    exec(code, {'project': project, 'fixture_files': fixture_files})
                if tampered:
                    self.assertEqual(calls, [])
                    self.assertIn('Helper checksum mismatch', output.getvalue())
                else:
                    self.assertEqual(len(calls), 2)
                    self.assertIn(str(directory / 'diagnose-app-access.py'), calls[0])
                    self.assertIn(str(directory / 'install-glass-permissions.py'), calls[1])
                    self.assertIn('rsync -P pedro@192.168.84.2:', output.getvalue())


if __name__ == '__main__':
    unittest.main()
