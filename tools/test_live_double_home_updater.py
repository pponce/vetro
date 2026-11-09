import copy
import importlib.util
import io
from pathlib import Path
import unittest
from unittest.mock import Mock, patch
from types import SimpleNamespace
import urllib.error

HERE = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location('live_installer', HERE / 'update-vetro-live-double-home.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
SUITE = MODULE.updater_module()


class Owner:
    def __init__(self, enabled=True, custom=None):
        self.dock = {'enabled': enabled, 'customApp': custom, 'running': bool(enabled or custom), 'pid': 123 if enabled or custom else None,
                     'doubleHome': {'enabled': True, 'mode': 'app', 'appId': 'GlassHome1.Home'}, 'homeShortcut': None}
        self.actions = []
        self.fail = None
        self.change_pid_on_save = False

    def request(self, route, body=None, timeout=None):
        assert route == '/dock'
        if body:
            action = body['action']
            self.actions.append(action)
            if action in ('disable', 'disableCustom'):
                self.dock.update(enabled=False, customApp=None, running=False, pid=None)
            elif action == 'enable':
                self.dock.update(enabled=True, running=True, pid=456)
            elif action == 'enableCustom':
                self.dock.update(customApp=body['appId'], running=True, pid=456)
            elif action == 'doubleHome':
                assert body['value'] == self.dock['doubleHome']
                if self.change_pid_on_save:
                    self.dock['pid'] += 1
            else:
                raise AssertionError(action)
            if self.fail == action:
                self.fail = None
                raise TimeoutError('response lost after action')
        return copy.deepcopy(self.dock)


def fixture(enabled=True, custom=None):
    updater = object.__new__(SUITE.Updater)
    updater.owner = Owner(enabled, custom)
    updater.save = lambda: None
    return updater, {}


class InstallerTests(unittest.TestCase):
    def test_pinned_build(self):
        spec = SUITE.APPS[0]
        self.assertEqual(len(SUITE.APPS), 1)
        self.assertEqual(spec['revision'], '1768e251784adb14dc007052c5b9a45e567e2777')
        self.assertEqual(spec['artifact'], 13644104863)
        self.assertIn('payload/SamsungTvRemoteInputAgent.dll', spec['required'])

    def test_preserve_and_verify_same_process(self):
        updater, record = fixture()
        before = copy.deepcopy(updater.owner.dock['doubleHome'])
        self.assertTrue(updater.refresh_native(record))
        self.assertEqual(updater.owner.actions, ['disable', 'enable', 'doubleHome'])
        self.assertEqual(updater.owner.dock['doubleHome'], before)
        self.assertTrue(record['liveDoubleHome']['savedAndApplied'])
        self.assertTrue(updater.refresh_native(record))
        self.assertEqual(updater.owner.actions, ['disable', 'enable', 'doubleHome', 'doubleHome'])

    def test_rerun_honors_later_settings(self):
        updater, record = fixture()
        updater.refresh_native(record)
        updater.owner.dock['doubleHome']['appId'] = 'Other.Home'
        self.assertTrue(updater.refresh_native(record))
        self.assertEqual(updater.owner.actions.count('enable'), 1)

    def test_resume_lost_stop_response(self):
        updater, record = fixture()
        updater.owner.fail = 'disable'
        with self.assertRaises(TimeoutError):
            updater.refresh_native(record)
        self.assertFalse(updater.owner.dock['enabled'])
        self.assertTrue(updater.refresh_native(record))
        self.assertEqual(updater.owner.actions, ['disable', 'enable', 'doubleHome'])

    def test_resume_lost_start_response(self):
        updater, record = fixture()
        updater.owner.fail = 'enable'
        with self.assertRaises(TimeoutError):
            updater.refresh_native(record)
        self.assertTrue(updater.refresh_native(record))
        self.assertEqual(updater.owner.actions, ['disable', 'enable', 'doubleHome'])

    def test_unconfirmed_stop_is_not_repeated(self):
        updater, record = fixture()
        record.update(nativeRefreshPlan=copy.deepcopy(updater.owner.dock), nativeStopSubmitted=True)
        with self.assertRaises(SUITE.Stop):
            updater.refresh_native(record)
        self.assertEqual(updater.owner.actions, [])

    def test_unconfirmed_start_is_not_repeated(self):
        updater, record = fixture()
        record.update(nativeRefreshPlan=copy.deepcopy(updater.owner.dock), nativeStopSubmitted=True,
                      nativeStopConfirmed=True, nativeStartSubmitted=True)
        updater.owner.dock.update(enabled=False, running=False, pid=None)
        with self.assertRaises(SUITE.Stop):
            updater.refresh_native(record)
        self.assertEqual(updater.owner.actions, [])

    def test_off_and_custom_modes(self):
        updater, record = fixture(False)
        self.assertTrue(updater.refresh_native(record))
        self.assertEqual(updater.owner.actions, [])
        updater, record = fixture(False, 'Custom.Home')
        self.assertTrue(updater.refresh_native(record))
        self.assertEqual(updater.owner.actions, ['disableCustom', 'enableCustom'])
        self.assertEqual(updater.owner.dock['customApp'], 'Custom.Home')

    def test_restart_during_live_save_is_rejected(self):
        updater, record = fixture()
        updater.owner.change_pid_on_save = True
        with self.assertRaises(SUITE.Stop):
            updater.refresh_native(record)
        self.assertFalse(record['liveDoubleHome']['savedAndApplied'])

    def test_busy_launcher_is_untouched(self):
        updater, record = fixture()
        updater.owner.dock['busy'] = True
        with self.assertRaises(SUITE.Stop):
            updater.refresh_native(record)
        self.assertEqual(updater.owner.actions, [])

    def test_runtime_failure_is_not_retried_as_reconnection(self):
        updater, record = fixture()
        status = {'app': {'sourceRevision': SUITE.APPS[0]['revision']}, 'agent': {'connected': True}}
        updater.owner.request = Mock(return_value=status)
        updater.refresh_native = Mock(side_effect=SUITE.Stop('EACCES actual failure'))
        with patch.object(SUITE.time, 'sleep') as sleep:
            with self.assertRaisesRegex(SUITE.Stop, 'EACCES actual failure'):
                updater.refresh_runtime(SUITE.APPS[0], record)
        updater.refresh_native.assert_called_once_with(record)
        sleep.assert_not_called()

    def test_transient_service_read_still_waits_for_connection(self):
        updater, record = fixture()
        status = {'app': {'sourceRevision': SUITE.APPS[0]['revision']}, 'agent': {'connected': True}}
        updater.owner.request = Mock(side_effect=[{}, TimeoutError(), status])
        updater.refresh_native = Mock(return_value=True)
        with patch.object(SUITE.time, 'sleep') as sleep:
            self.assertTrue(updater.refresh_runtime(SUITE.APPS[0], record))
        updater.refresh_native.assert_called_once_with(record)
        sleep.assert_called_once_with(2)

    def test_live_save_http_error_is_recorded_and_reported(self):
        updater, record = fixture()
        original = updater.owner.request
        def request(route, body=None, timeout=None):
            if body and body['action'] == 'doubleHome':
                raise urllib.error.HTTPError('http://test/dock', 409, 'Conflict', {},
                    io.BytesIO(b'{"error":"Could not apply setting: EACCES"}'))
            return original(route, body, timeout)
        updater.owner.request = request
        with self.assertRaisesRegex(SUITE.Stop, 'HTTP 409: Could not apply setting: EACCES'):
            updater.refresh_native(record)
        self.assertFalse(record['liveDoubleHome']['savedAndApplied'])
        self.assertIn('EACCES', record['liveDoubleHome']['error'])

    def test_runtime_failure_keeps_successful_install_evidence(self):
        updater, record = fixture()
        record.update(submitted=True, verified=True, runtimeVerified=True)
        updater.state = {'apps': {'vetro': record}}
        updater.report = {'apps': {}, 'complete': False}
        updater.args = SimpleNamespace(check_only=False)
        updater.preflight = Mock()
        updater.verify = Mock(return_value=True)
        updater.refresh_runtime = Mock(side_effect=SUITE.Stop('save failed'))
        with self.assertRaisesRegex(SUITE.Stop, 'save failed'):
            updater.execute()
        self.assertEqual(updater.report['stage'], 'verify-runtime-vetro')
        self.assertTrue(updater.report['apps']['Vetro']['installedFilesVerified'])
        self.assertFalse(updater.report['apps']['Vetro']['runtimeVerified'])
        self.assertFalse(record['runtimeVerified'])


if __name__ == '__main__':
    unittest.main()
