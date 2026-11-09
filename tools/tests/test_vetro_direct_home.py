import importlib.util
import io
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
spec = importlib.util.spec_from_file_location('direct_home_wrapper', TOOLS / 'update-vetro-direct-home.py')
wrapper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wrapper)


class ReadinessTests(unittest.TestCase):
    def probe(self, *, enabled=True, running=True, mode='filter', connected=True, fifo='present', custom=None):
        suite = wrapper.updater_module()
        updater = object.__new__(suite.Updater)
        updater.report = {}
        updater.owner = Mock()
        updater.owner.request.side_effect = [
            {'enabled': enabled, 'running': running, 'customApp': custom},
            {'status': {'preference': {'enabled': enabled or bool(custom)},
                        'policy': {'mode': mode, 'connected': connected},
                        'events': [{'private': 'not-for-report'}]}}]
        updater.remote = Mock(return_value=fifo)
        with patch('sys.stdout', io.StringIO()):
            updater.check_direct_home()
        for call in updater.owner.request.call_args_list:
            self.assertEqual(len(call.args), 1)  # GET only; no setting changes.
        self.assertNotIn('events', updater.report['directHome'])
        self.assertFalse(updater.report['directHome']['hardwareTested'])
        return updater.report['directHome']

    def test_connected_filter_and_launcher_are_ready_but_not_hardware_tested(self):
        self.assertTrue(self.probe()['readyForTest'])

    def test_off_listening_disconnected_or_missing_launcher_are_not_ready(self):
        for kwargs in ({'enabled': False}, {'mode': 'observe'}, {'connected': False},
                       {'running': False}, {'fifo': 'absent'}):
            with self.subTest(kwargs=kwargs):
                self.assertFalse(self.probe(**kwargs)['readyForTest'])

    def test_custom_launcher_is_supported(self):
        self.assertTrue(self.probe(enabled=False, custom='Example.app')['readyForTest'])

    def test_probe_failure_preserves_verified_installation(self):
        suite = wrapper.updater_module()
        updater = object.__new__(suite.Updater)
        updater.report = {'complete': True}
        updater.owner = Mock()
        updater.owner.request.side_effect = TimeoutError('private response')
        with patch('sys.stdout', io.StringIO()):
            updater.check_direct_home()
        self.assertTrue(updater.report['complete'])
        self.assertEqual(updater.report['directHome']['probeErrorType'], 'TimeoutError')
        self.assertNotIn('private response', str(updater.report))

    def test_only_vetro_and_complete_remote_helper_payload_required(self):
        suite = wrapper.updater_module()
        self.assertEqual([a['key'] for a in suite.APPS], ['vetro'])
        for extension in ('dll', 'deps.json', 'runtimeconfig.json'):
            self.assertIn('payload/SamsungTvRemoteInputAgent.' + extension, suite.APPS[0]['required'])


if __name__ == '__main__':
    unittest.main()
