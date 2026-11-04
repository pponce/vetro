import copy
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1]))
spec = importlib.util.spec_from_file_location('watch_app_requests', Path(__file__).parents[1] / 'watch-app-requests.py')
watch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(watch)


class WatchTests(unittest.TestCase):
    def test_normal_mode_capture_only_reads_and_records_receive_without_dispatch(self):
        class Owner:
            def raw(self, path, body=None, timeout=8):
                assert body is None
                assert path in ('/status', '/app-access')
                return {'app': {'sourceRevision': 'a' * 40, 'sourceDirty': False}}
        class Clock:
            now = 0
            def clock(self): return self.now
            def pause(self, seconds): self.now += seconds
        clock, report = Clock(), {}
        state = {'requests': {'enabled': True, 'counts': {}, 'events': []}}
        def read(owner, revision):
            value = copy.deepcopy(state)
            if clock.now >= 2:
                value['requests']['counts'] = {'received': 1, 'frame-rejected': 1}
            return value
        with patch.object(watch, 'diagnostics', side_effect=read):
            watch.collect(Owner(), 'a' * 40, 4, report, clock.clock, clock.pause)
        self.assertTrue(report['captureComplete'])
        self.assertEqual(report['captureSeconds'], 4)
        self.assertEqual(report['after']['requests']['counts']['frame-rejected'], 1)
        self.assertEqual(report['permissionsAfter']['pendingCount'], 0)

    def test_wrong_revision_stops_before_reading_request_state(self):
        class Owner:
            def raw(self, *args, **kwargs): return {'app': {'sourceRevision': 'b' * 40, 'sourceDirty': False}}
        with patch.object(watch, 'diagnostics') as read, self.assertRaises(RuntimeError):
            watch.collect(Owner(), 'a' * 40, 4, {})
        read.assert_not_called()
