import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch
import urllib.error

spec = importlib.util.spec_from_file_location('connection_report', Path(__file__).resolve().parents[1] / 'collect-connection-report.py')
report = importlib.util.module_from_spec(spec)
spec.loader.exec_module(report)
REVISION = '1' * 40

def status(revision=REVISION, running=False, matrix=True):
    return {'error': 'Pair this device in the Vetro dashboard first', 'connectionDiagnostics': {
        'sourceRevision': revision, 'sourceDirty': False,
        'screen': {'sourceRevision': revision, 'runningChecks': running, 'sessionReceived': False},
        'widget': {'replyDiagnostics': {'schema': 2, 'phase': 'complete' if matrix else 'waiting-for-screen'}}
    }}

class ConnectionReportTests(unittest.TestCase):
    def run_capture(self, values, wait=10):
        clock = [0]
        def fetch(url):
            value = values.pop(0) if len(values) > 1 else values[0]
            if isinstance(value, Exception):
                raise value
            return value
        def pause(seconds):
            clock[0] += seconds
        return report.collect('http://fixture/status', REVISION, wait, fetch, lambda: clock[0], pause, lambda _: None)

    def test_waits_for_matching_screen_and_finished_matrix(self):
        result = self.run_capture([status('2' * 40), status(running=True), status(matrix=False), status()])
        self.assertTrue(result['capture']['complete'])
        self.assertEqual(result['capture']['waitedSeconds'], 9)

    def test_old_or_dirty_revision_is_not_verified(self):
        for value in [status('2' * 40), status()]:
            value['connectionDiagnostics']['sourceDirty'] = True
            result = self.run_capture([value], wait=3)
            self.assertFalse(result['capture']['complete'])
            self.assertFalse(result['capture']['runningServiceVerified'])

    def test_timeout_preserves_partial_report_and_read_errors(self):
        result = self.run_capture([TimeoutError('PRIVATE_TEXT'), status(running=True)], wait=3)
        self.assertFalse(result['capture']['complete'])
        self.assertEqual(result['capture']['readErrors'], ['TimeoutError'])
        self.assertNotIn('PRIVATE_TEXT', json.dumps(result))

    def test_working_session_finishes_without_reproduced_error(self):
        value = status(matrix=False)
        value['connectionDiagnostics']['screen']['sessionReceived'] = True
        self.assertTrue(self.run_capture([value])['capture']['complete'])

    def test_denied_status_body_is_read_without_credentials(self):
        value = status()
        class Opener:
            def open(self, request, timeout):
                self.request = request
                raise urllib.error.HTTPError(request.full_url, 401, 'Pair first', {}, io.BytesIO(json.dumps(value).encode()))
        opener = Opener()
        with patch.object(report.urllib.request, 'build_opener', return_value=opener):
            self.assertEqual(report.read_status('http://fixture/status'), value)
        self.assertEqual(opener.request.get_method(), 'GET')
        self.assertEqual(opener.request.header_items(), [('Accept', 'application/json')])

    def test_rejects_invalid_revision(self):
        with self.assertRaises(ValueError):
            report.collect('unused', 'not-a-revision', fetch=lambda _: {})
