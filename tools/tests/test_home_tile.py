import argparse
import base64
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
spec = importlib.util.spec_from_file_location('home_tile', TOOLS / 'diagnose-home-tile.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class FakeOwner:
    def __init__(self, connected=True):
        self.connected = connected
        self.calls = []

    def request(self, route, body=None, timeout=40):
        self.calls.append((route, body))
        if body is not None:
            assert route == '/exec'
            source = base64.b64decode(body['cmd'].split()[2]).decode()
            assert source in (m.STATE_COMMAND, m.EVIDENCE_COMMAND)
            output = json.dumps({'enabled': True, 'secret': 'do-not-include'}) if source == m.STATE_COMMAND else 'guard: close finished\n'
            return {'exit_code': 0, 'output': output}
        return {
            '/exec': {'connected': self.connected},
            '/status': {'app': {'sourceRevision': 'abc'}, 'secret': 'do-not-include'},
            '/apps?refresh=1': {'apps': [{'appId': 'com.samsung.tv.csfs', 'disabled': False},
                                       {'appId': 'private-app', 'name': 'do-not-include'}]},
            '/input': {'status': {'policy': {'mode': 'off', 'device': 'do-not-include'},
                                  'preference': {'enabled': False}, 'events': ['do-not-include']}}
        }[route]


class HomeTileTests(unittest.TestCase):
    def run_capture(self, project, owner, prompt):
        args = argparse.Namespace(project_root=project, tv='192.0.2.1', report_host='user@192.0.2.2')
        out = io.StringIO()
        with patch('sys.stdout', out):
            result = m.run(args, prompt=prompt, owner=owner)
        files = list(Path(project).rglob('home-tile-*.json'))
        self.assertEqual(len(files), 1)
        self.assertEqual(files[0].stat().st_mode & 0o777, 0o600)
        self.assertIn('rsync -P user@192.0.2.2:', out.getvalue())
        return result, json.loads(files[0].read_text())

    def test_two_attempts_no_tv_mutations_and_filtered_report(self):
        with tempfile.TemporaryDirectory() as work:
            result, report = self.run_capture(work, FakeOwner(), lambda _: 'stayed closed')
        self.assertEqual(result, 0)
        self.assertTrue(report['complete'])
        self.assertEqual(len(report['snapshots']), 3)
        self.assertNotIn('do-not-include', json.dumps(report))
        self.assertFalse(report['snapshots'][0]['samsungHomeRegistry']['homeApps'][0]['disabled'])

    def test_interrupt_retains_baseline(self):
        def interrupt(_):
            raise KeyboardInterrupt()
        with tempfile.TemporaryDirectory() as work:
            result, report = self.run_capture(work, FakeOwner(), interrupt)
        self.assertEqual(result, 1)
        self.assertEqual(len(report['snapshots']), 1)
        self.assertEqual(report['failure'], 'interrupted')

    def test_disconnected_root_stops_before_commands(self):
        owner = FakeOwner(False)
        with tempfile.TemporaryDirectory() as work:
            result, report = self.run_capture(work, owner, lambda _: self.fail('Must not prompt'))
        self.assertEqual(result, 1)
        self.assertEqual(owner.calls, [('/exec', None)])
        self.assertEqual(report['failure'], 'root_not_connected')

    def test_one_optional_check_failure_keeps_other_evidence(self):
        owner = FakeOwner()
        request = owner.request
        def failing(route, body=None, timeout=40):
            if route == '/apps?refresh=1':
                raise RuntimeError('do-not-include')
            return request(route, body, timeout)
        owner.request = failing
        with tempfile.TemporaryDirectory() as work:
            result, report = self.run_capture(work, owner, lambda _: 'stayed closed')
        self.assertEqual(result, 0)
        self.assertEqual(len(report['snapshots']), 3)
        self.assertNotIn('do-not-include', json.dumps(report))
        self.assertEqual(report['snapshots'][0]['errors']['samsungHomeRegistry'], 'RuntimeError')

    def test_remote_shell_syntax(self):
        result = subprocess.run(['sh', '-n'], input=m.EVIDENCE_COMMAND.encode(), capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()
