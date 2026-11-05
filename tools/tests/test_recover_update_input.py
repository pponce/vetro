import copy
import importlib.util
import io
import json
from pathlib import Path
import sys
import unittest
import urllib.error
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location('recover_update_input', ROOT / 'recover-update-input.py')
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)


def journal():
    return {'schema': 1, 'targetRevision': recovery.REVISION, 'required': True,
            'before': {'mode': 'filter', 'connected': True, 'savedEnabled': True, 'homeReady': True},
            'observationConfirmed': True, 'oldFilterExited': True, 'observationRequested': True}


class Owner:
    def __init__(self, mode='off', error=None, ready_at=None, recovering=False, helpers=False):
        self.mode, self.error, self.ready_at = mode, error, ready_at
        self.recovering, self.helpers = recovering, helpers
        self.clock = 0
        self.calls = []
        self.resumed = False
        self.revision = recovery.REVISION
        self.enabled = True

    def raw(self, route, body=None, **kwargs):
        self.calls.append((route, body))
        if route == '/status':
            return {'app': {'sourceRevision': self.revision, 'sourceDirty': False},
                    'self': {'pid': 123}, 'agent': {'connected': True}}
        if route == '/screen?live=1':
            return {'input': {'recovering': self.recovering}}
        if route == '/input' and body is None:
            connected = (self.mode == 'filter' and not self.recovering) or self.resumed or (self.ready_at is not None and self.clock >= self.ready_at)
            return {'status': {'policy': {'mode': 'filter' if connected else self.mode,
                'connected': connected, 'node': '/dev/input/event20'}, 'preference': {'enabled': self.enabled}},
                'home': {'ready': connected}}
        if route == '/input' and body == {'mode': 'resume'}:
            self.resumed = True
            if self.error:
                raise urllib.error.HTTPError('http://192.0.2.1/input', self.error[0], 'error', {},
                    io.BytesIO(json.dumps({'error': self.error[1]}).encode()))
            return {'ok': True}
        if route == '/exec':
            extra = 'HELPER|456|41000|/dev/input/event20|filter|1\n' if self.helpers else ''
            return {'exit_code': 0, 'output': 'VETRO_INPUT_AUDIT|1\nSERVICE|123\n' + extra + 'END|10|1\n'}
        raise AssertionError((route, body))

    def pause(self, seconds):
        self.clock += seconds


class Tests(unittest.TestCase):
    def run_recovery(self, owner, record=None, report=None):
        record = journal() if record is None else record
        report = {} if report is None else report
        saved = []
        with patch('builtins.print'):
            recovery.recover(owner, record, report, lambda r: saved.append(copy.deepcopy(r)),
                clock=lambda: owner.clock, pause=owner.pause)
        return report, saved

    def test_healthy_input_is_not_disturbed(self):
        owner = Owner(mode='filter')
        report, saved = self.run_recovery(owner)
        self.assertTrue(report['verified'])
        self.assertFalse(report['resumeSubmitted'])
        self.assertFalse(any(body is not None for _, body in owner.calls))
        self.assertFalse(saved[-1]['observationRequested'])

    def test_waits_for_auto_restore_while_mode_is_off(self):
        owner = Owner(ready_at=15, recovering=True)
        report, _ = self.run_recovery(owner)
        self.assertTrue(report['verified'])
        self.assertEqual(owner.clock, 15)
        self.assertFalse(report['resumeSubmitted'])

    def test_one_resume_after_quiet_period_and_process_check(self):
        owner = Owner()
        report, _ = self.run_recovery(owner)
        self.assertTrue(report['verified'])
        self.assertGreaterEqual(owner.clock, 30)
        self.assertEqual([body for route, body in owner.calls if route == '/input' and body], [{'mode': 'resume'}])
        self.assertTrue(any(route == '/exec' for route, _ in owner.calls))

    def test_resume_http_failure_is_recorded_then_verified_without_replay(self):
        owner = Owner(error=(503, 'input request cancelled'))
        report, _ = self.run_recovery(owner)
        self.assertTrue(report['verified'])
        self.assertEqual(report['resumeReply']['httpStatus'], 503)
        self.assertEqual(report['resumeReply']['reason'], 'input request cancelled')
        self.assertEqual(sum(body == {'mode': 'resume'} for _, body in owner.calls), 1)

    def test_unknown_error_content_never_leaves_parser(self):
        secret = 'private-value-' + 'a'*64
        error = urllib.error.HTTPError('http://192.0.2.1/input', 503, secret, {},
            io.BytesIO(json.dumps({'error': secret}).encode()))
        detail = recovery.error_detail(error)
        self.assertEqual(detail['httpStatus'], 503)
        self.assertNotIn(secret, json.dumps(detail))

    def test_failed_resume_stays_unverified_and_is_never_replayed(self):
        class Failed(Owner):
            def raw(self, route, body=None, **kwargs):
                try:
                    return super().raw(route, body, **kwargs)
                except urllib.error.HTTPError:
                    self.resumed = False
                    raise
        owner = Failed(error=(503, 'native input helper did not connect'))
        report = {}
        with self.assertRaises(RuntimeError):
            self.run_recovery(owner, report=report)
        self.assertFalse(report['verified'])
        self.assertEqual(report['resumeReply']['httpStatus'], 503)
        self.assertEqual(sum(body == {'mode': 'resume'} for _, body in owner.calls), 1)

    def test_active_or_foreign_helper_prevents_resume(self):
        for owner in (Owner(mode='filter', recovering=True), Owner(recovering=True), Owner(helpers=True)):
            with self.assertRaises(RuntimeError):
                self.run_recovery(owner)
            self.assertFalse(any(body == {'mode': 'resume'} for _, body in owner.calls))

    def test_journal_revision_and_saved_preference_guards(self):
        invalid = journal()
        invalid['oldFilterExited'] = False
        with self.assertRaises(RuntimeError):
            self.run_recovery(Owner(), invalid)
        for field, value in (('revision', 'a'*40), ('enabled', False)):
            owner = Owner()
            setattr(owner, field, value)
            with self.assertRaises(RuntimeError):
                self.run_recovery(owner)
            self.assertFalse(any(body == {'mode': 'resume'} for _, body in owner.calls))

    def test_owner_refusal_does_not_pair_or_resume(self):
        class Refused(Owner):
            def raw(self, route, body=None, **kwargs):
                self.calls.append((route, body))
                raise urllib.error.HTTPError('http://192.0.2.1/status', 401, 'error', {},
                    io.BytesIO(b'{"error":"Pair this device in the Vetro dashboard first"}'))
        owner = Refused()
        report = {}
        with self.assertRaises(RuntimeError):
            self.run_recovery(owner, report=report)
        self.assertEqual(report['requestErrors'][0]['httpStatus'], 401)
        self.assertEqual(owner.calls, [('/status', None)])


if __name__ == '__main__':
    unittest.main()
