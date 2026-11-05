import base64
import copy
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1]))
import input_update_handoff as handoff

REVISION = 'a' * 40


class Clock:
    now = 0
    def clock(self):
        return self.now
    def pause(self, value):
        self.now += value


class Owner:
    def __init__(self):
        self.mode = 'filter'
        self.connected = True
        self.exited = 'gone'
        self.calls = []
        self.revision = REVISION
        self.preference = {'enabled': True, 'device': 'fixture remote', 'node': '/dev/input/event4'}
    def raw(self, path, body=None, timeout=8):
        self.calls.append((path, body))
        if path == '/status':
            return {'self': {'pid': 101}, 'app': {'sourceRevision': self.revision, 'sourceDirty': False}, 'agent': {'connected': True}}
        if path == '/input':
            if body:
                self.mode = 'observe' if body['mode'] == 'observe' else 'filter'
            return {'ok': True, 'status': {'policy': {'mode': self.mode, 'node': '/dev/input/event4', 'connected': self.connected},
                    'preference': copy.deepcopy(self.preference)}, 'home': {'ready': self.mode == 'filter' and self.connected}}
        if path == '/exec':
            return {'exit_code': 0, 'output': self.exited, 'timed_out': False}
        raise AssertionError(path)


def audit():
    return {'complete': True, 'helpers': [{'pid': 202, 'mode': 'filter', 'node': '/dev/input/event4',
            'currentServiceConnectionObserved': True}], 'processes': [{'pid': 202, 'startTicks': 303}]}


class InputHandoffTests(unittest.TestCase):
    def test_observe_releases_exact_old_helper_and_resume_preserves_preferences(self):
        owner, saved = Owner(), []
        before = copy.deepcopy(owner.preference)
        h = handoff.InputHandoff(owner, save=lambda r: saved.append(copy.deepcopy(r)))
        with patch.object(handoff.audit, 'summarize', return_value=audit()):
            h.begin(REVISION)
        self.assertEqual(owner.mode, 'observe')
        self.assertTrue(h.record['oldFilterExited'])
        self.assertTrue(saved[0]['observationRequested'])
        self.assertFalse(saved[0]['oldFilterExited'])
        h.restore(REVISION)
        self.assertTrue(h.record['verified'])
        self.assertFalse(h.record['observationRequested'])
        self.assertEqual(owner.preference, before)
        writes = [(path, body) for path, body in owner.calls if body and path != '/exec']
        self.assertEqual(writes, [('/input', {'mode': 'observe', 'device': '/dev/input/event4'}), ('/input', {'mode': 'resume'})])

    def test_a_missing_or_foreign_helper_never_changes_input(self):
        for value in [dict(audit(), helpers=[]), dict(audit(), complete=False),
                      dict(audit(), helpers=[dict(audit()['helpers'][0], currentServiceConnectionObserved=False)]),
                      dict(audit(), helpers=audit()['helpers'] * 2)]:
            owner = Owner()
            with patch.object(handoff.audit, 'summarize', return_value=value), self.assertRaises(RuntimeError):
                handoff.InputHandoff(owner).begin(REVISION)
            self.assertFalse(any(path == '/input' and body for path, body in owner.calls))

    def test_live_helper_or_unreadable_process_does_not_authorize_install(self):
        for state in ['alive', 'unreadable', '']:
            owner, clock = Owner(), Clock()
            owner.exited = state
            h = handoff.InputHandoff(owner, clock=clock.clock, pause=clock.pause)
            with patch.object(handoff.audit, 'summarize', return_value=audit()), self.assertRaises(RuntimeError):
                h.begin(REVISION)
            self.assertFalse(h.record['oldFilterExited'])
            self.assertLessEqual(clock.now, 15)

    def test_changed_service_or_failed_resume_is_never_verified(self):
        owner = Owner()
        h = handoff.InputHandoff(owner)
        with patch.object(handoff.audit, 'summarize', return_value=audit()):
            h.begin(REVISION)
        owner.revision = 'b' * 40
        with self.assertRaises(RuntimeError):
            h.restore(REVISION)
        self.assertEqual(owner.mode, 'observe')
        owner.revision = REVISION
        owner.connected = False
        with self.assertRaises(RuntimeError):
            h.restore(REVISION)
        self.assertFalse(h.record['verified'])

    def test_automatic_reconnection_is_verified_without_restarting_filter(self):
        owner = Owner()
        h = handoff.InputHandoff(owner)
        with patch.object(handoff.audit, 'summarize', return_value=audit()):
            h.begin(REVISION)
        owner.mode = 'filter'
        h.restore(REVISION)
        self.assertTrue(h.record['verified'])
        self.assertEqual([body for path, body in owner.calls if path == '/input' and body],
                         [{'mode': 'observe', 'device': '/dev/input/event4'}])

    def test_in_progress_filter_is_not_restarted(self):
        owner, clock = Owner(), Clock()
        record = {'required': True, 'observationRequested': True,
                  'before': {'savedEnabled': True, 'homeReady': True}}
        owner.connected = False
        h = handoff.InputHandoff(owner, record=record, clock=clock.clock, pause=clock.pause)
        with self.assertRaises(RuntimeError):
            h.restore(REVISION)
        self.assertEqual(clock.now, 20)
        self.assertFalse(any(path == '/input' and body for path, body in owner.calls))

    def test_off_setting_does_not_start_a_helper(self):
        owner = Owner()
        owner.mode, owner.connected, owner.preference = 'off', False, {'enabled': False}
        h = handoff.InputHandoff(owner)
        with patch.object(handoff.audit, 'summarize', return_value=dict(audit(), helpers=[])):
            h.begin(REVISION)
        h.restore(REVISION)
        self.assertTrue(h.record['verified'])
        self.assertFalse(any(path == '/input' and body for path, body in owner.calls))

    def test_release_probe_reads_process_identity_without_killing(self):
        with tempfile.TemporaryDirectory() as directory:
            proc = Path(directory) / '123'
            proc.mkdir()
            stat = proc / 'stat'
            stat.write_text('123 (fixture process) S ' + '0 ' * 18 + '456 0\n')
            for expected, state in [(456, 'alive'), (457, 'reused'), (456, 'unreadable'), (456, 'gone')]:
                if state == 'unreadable':
                    stat.unlink()
                if state == 'gone':
                    proc.rmdir()
                command = handoff.release_command(123, expected)
                script = base64.b64decode(command.split()[2]).decode()
                self.assertNotIn('kill', script)
                self.assertNotIn('/dev/input', script)
                script = script.replace('/proc/123', str(proc))
                result = subprocess.run(['sh', '-c', script], check=True, capture_output=True, text=True)
                self.assertEqual(result.stdout, state)
        for pid, started in [(True, 1), (-1, 1), (1, None)]:
            with self.assertRaises(ValueError):
                handoff.release_command(pid, started)


if __name__ == '__main__':
    unittest.main()
