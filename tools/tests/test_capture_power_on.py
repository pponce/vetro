import importlib.util
import json
from pathlib import Path
import sys
import unittest
import urllib.error

sys.path.insert(0, str(Path(__file__).parents[1]))
spec = importlib.util.spec_from_file_location('capture_power_on', Path(__file__).parents[1] / 'capture-power-on.py')
capture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture)


class CaptureTests(unittest.TestCase):
    def test_expired_credential_never_starts_pairing_or_changes_the_screen(self):
        class Client:
            calls = []
            def raw(self, route, body, timeout):
                self.calls.append((route, body))
                raise urllib.error.HTTPError('url', 401, 'unauthorized', {}, None)
        client = Client()
        report = capture.capture(client)
        self.assertIn('did not start pairing', report['instruction'])
        self.assertTrue(all(body is None for _, body in client.calls))
        self.assertEqual([route for route, _ in client.calls], ['/startup-app', '/return-app'])

    def test_result_sessions_survive_and_unrelated_private_state_is_excluded(self):
        class Client:
            def raw(self, route, body, timeout):
                if route in ('/startup-app', '/return-app'):
                    return {'lastResult': 'confirmed', 'lastResultAt': 123, 'lastResultSession': {'id': 'old'}, 'powerSession': {'id': 'new'}}
                if route == '/status':
                    return {'app': {'sourceRevision': 'a' * 40}, 'agent': {'connected': True}, 'token': 'private-test-value'}
                if route == '/app-access':
                    return {'enabled': True, 'available': True, 'grants': ['private-test-value']}
                if route == '/remap':
                    return {'home': {'ready': True}, 'rules': ['private-test-value']}
                if route == '/input':
                    return {'status': {'policy': {'connected': True}, 'events': ['private-test-value']}}
                if route == '/exec':
                    if body['cmd'].startswith('curl '):
                        return {'exit_code': 0, 'output': json.dumps({'device': {'PowerState': 'on', 'id': 'private-test-value'}})}
                    return {'exit_code': 0, 'output': 'value = media.app\nvalue = \nvalue = 0'}
                raise AssertionError(route)
        report = capture.capture(Client())
        self.assertEqual(report['powerOn']['lastResultSession']['id'], 'old')
        self.assertEqual(report['returnApp']['powerSession']['id'], 'new')
        self.assertEqual(report['samsungPower']['powerState'], 'on')
        self.assertNotIn('private-test-value', json.dumps(report))


if __name__ == '__main__':
    unittest.main()
