import argparse
import base64
import copy
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch, Mock
import zipfile

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
spec = importlib.util.spec_from_file_location('suite', TOOLS / 'update-home-suite.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def zip_bytes(files):
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w') as z:
        for name, value in files.items():
            z.writestr(name, value)
    return out.getvalue()


def payload(app):
    data = {name: b'fixture' for name in app['required'] + app['preserve']}
    data['index.html'] = b'<html></html>'
    data['config.xml'] = ('<widget xmlns:t="http://tizen.org/ns/widgets"><t:application id="' +
                          app['app'] + '" package="' + app['package'] + '"/></widget>').encode()
    if app['key'] == 'vetro':
        data['service/build-info.js'] = ('module.exports={version:"0.5.0",sourceRevision:"' + app['revision'] + '"}').encode()
    return data


class FakeUpdater(m.Updater):
    def __init__(self, work):
        self.work = Path(work)
        self.state = {'suite': m.SUITE, 'apps': {}}
        self.state_path = self.work / 'state.json'
        self.report = {'apps': {}}
        self.args = argparse.Namespace(check_only=False, tv='192.168.84.19', local_ip='192.168.84.2')
        self.events = []

    def preflight(self):
        self.events.append('preflight')

    def prepare(self, app):
        self.events.append('prepare:' + app['key'])
        self.state['apps'][app['key']] = {'revision': app['revision']}
        return self.work / (app['key'] + '.wgt')

    def install(self, app, path):
        self.events.append('install:' + app['key'])
        self.state['apps'][app['key']].update(submitted=True, verified=True)

    def verify(self, app, record, attempts=12):
        self.events.append('verify:' + app['key'])
        return record.get('verified', False)

    def refresh_runtime(self, app, record):
        self.events.append('runtime:' + app['key'])
        return True


class SuiteTests(unittest.TestCase):
    def test_all_prepared_before_install_vetro_last(self):
        with tempfile.TemporaryDirectory() as work:
            u = FakeUpdater(work)
            u.execute()
            self.assertEqual(u.events[:5], ['preflight', 'prepare:glass', 'prepare:garage', 'prepare:vetro', 'install:glass'])
            self.assertEqual([x for x in u.events if x.startswith('install:')], ['install:glass', 'install:garage', 'install:vetro'])

    def test_unresolved_attempt_never_reinstalled(self):
        with tempfile.TemporaryDirectory() as work:
            u = FakeUpdater(work)
            u.state['apps']['glass'] = {'submitted': True, 'verified': False}
            with self.assertRaises(m.Stop):
                u.execute()
            self.assertFalse(any(e.startswith('install:') for e in u.events))

    def test_resume_skips_verified_app_and_continues(self):
        with tempfile.TemporaryDirectory() as work:
            u = FakeUpdater(work)
            u.state['apps']['glass'] = {'submitted': True, 'verified': True}
            u.execute()
            self.assertNotIn('install:glass', u.events)
            self.assertIn('install:vetro', u.events)

    def test_failed_runtime_stops_before_remaining_installs(self):
        with tempfile.TemporaryDirectory() as work:
            u = FakeUpdater(work)
            u.refresh_runtime = lambda *args: False
            with self.assertRaises(m.Stop):
                u.execute()
            self.assertNotIn('install:garage', u.events)

    def test_check_only_does_not_install_or_restart(self):
        with tempfile.TemporaryDirectory() as work:
            u = FakeUpdater(work)
            u.args.check_only = True
            u.execute()
            self.assertFalse(any(e.startswith(('install:', 'runtime:')) for e in u.events))

    def test_preserves_current_config_and_key_bytes(self):
        with tempfile.TemporaryDirectory() as work:
            for app in m.APPS[:2]:
                u = FakeUpdater(work)
                u.download = lambda spec: payload(spec)
                u.root = lambda spec: '/installed'
                old = {'js/config.js': b'window.GH.config={user:true};',
                       'js/local-key.js': b'window.GH_LOCAL_KEY="private";',
                       'garage-config.js': b'window.GARAGE_CONFIG={user:true};',
                       'local-key.js': b'window.GARAGE_LOCAL_KEY="private";'}
                u.read_tv = lambda path: old[path.removeprefix('/installed/')]
                path = m.Updater.prepare(u, app)
                actual = m.archive_files(path.read_bytes())
                for name in app['preserve']:
                    self.assertEqual(actual[name], old[name])
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_package_identity_must_match(self):
        for app in m.APPS:
            data = payload(app)
            m.validate_payload(app, data)
            data['config.xml'] = data['config.xml'].replace(app['app'].encode(), b'Wrong.app')
            with self.assertRaises(m.Stop):
                m.validate_payload(app, data)

    def test_full_vetro_payload_required(self):
        data = payload(m.APPS[2])
        del data['payload/SamsungTvRootAgent.dll']
        with self.assertRaises(m.Stop):
            m.validate_payload(m.APPS[2], data)

    def test_download_verifies_archive_and_native_binary(self):
        with tempfile.TemporaryDirectory() as work:
            app = copy.deepcopy(m.APPS[2])
            data = payload(app)
            outer = {'app.wgt': zip_bytes(data), 'SOURCE_COMMIT.txt': app['revision'].encode(),
                     'LAUNCHER_SHA256.txt': m.sha(data['native/dock/tvlauncher-dotnet.dll']).encode()}
            archive = zip_bytes(outer)
            app['digest'] = m.sha(archive)
            (Path(work) / 'vetro-artifact.zip').write_bytes(archive)
            u = FakeUpdater(work)
            good_run = {'head_sha': app['revision'], 'status': 'completed', 'conclusion': 'success'}
            with patch.object(m, 'json_url', return_value=good_run):
                self.assertEqual(m.Updater.download(u, app), data)
                (Path(work) / 'vetro-artifact.zip').write_bytes(archive + b'changed')
                with self.assertRaises(m.Stop):
                    m.Updater.download(u, app)
                outer['LAUNCHER_SHA256.txt'] = b'0' * 64
                archive = zip_bytes(outer)
                app['digest'] = m.sha(archive)
                (Path(work) / 'vetro-artifact.zip').write_bytes(archive)
                with self.assertRaises(m.Stop):
                    m.Updater.download(u, app)

    def test_archive_rejects_traversal_duplicate_symlink(self):
        with self.assertRaises(m.Stop):
            m.archive_files(zip_bytes({'../file': b'x'}))
        out = io.BytesIO()
        with zipfile.ZipFile(out, 'w') as z:
            link = zipfile.ZipInfo('link')
            link.external_attr = 0o120777 << 16
            z.writestr(link, 'target')
        with self.assertRaises(m.Stop):
            m.archive_files(out.getvalue())

    def test_certificate_requires_unique_existing_matching_profile(self):
        result = {'ok': True, 'tvDuid': 'A1234567890', 'profiles': [dict(level='Partner', exists=True,
                  usable=True, duids=['A1234567890'], path='/saved/profile')]}
        self.assertEqual(m.partner_profile(result)[1], Path('/saved/profile'))
        result['profiles'].append(result['profiles'][0])
        with self.assertRaises(m.Stop):
            m.partner_profile(result)

    def test_installer_arguments_preserve_package_and_do_not_remove(self):
        args = argparse.Namespace(tv='192.168.84.19', local_ip='192.168.84.2')
        command = m.install_command('/cli', '/prepared.wgt', m.APPS[0], args, 'A1234567890')
        self.assertIn('--own-id', command)
        self.assertIn('--partner', command)
        self.assertFalse(set(command) & {'--allow-remove', '--remove-first', '--force-login', '--new-id'})

    def test_record_persisted_before_external_install(self):
        with tempfile.TemporaryDirectory() as work:
            u = FakeUpdater(work)
            app = m.APPS[0]
            p = Path(work) / 'ready.wgt'
            p.write_bytes(b'ready')
            u.state['apps']['glass'] = {'submitted': False, 'packageSha256': m.sha(b'ready')}
            u.cli, u.duid = '/cli', 'A1234567890'
            u.check_profile = lambda: None
            u.idle_relay = lambda: None
            u.verify = lambda *args, **kwargs: True
            def run(*args, **kwargs):
                self.assertTrue(json.loads(u.state_path.read_text())['apps']['glass']['submitted'])
                raise m.Stop('simulated lost reply')
            u.run = run
            m.Updater.install(u, app, p)
            with self.assertRaises(m.Stop):
                m.Updater.install(u, app, p)

    def test_garage_health_uses_key_on_tv(self):
        with tempfile.TemporaryDirectory() as work:
            u = FakeUpdater(work)
            commands = []
            u.root = lambda app: '/usr/apps/GarageHome/res/wgt'
            def script(source):
                commands.append(source)
                return '{"ok":true,"protocol":1}'
            u.script = script
            self.assertTrue(m.Updater.refresh_runtime(u, m.APPS[1], {}))
            self.assertIn('X-Garage-Key: $key', commands[-1])
            self.assertIn('local-key.js', commands[-1])

    def test_native_reload_preserves_disabled_state(self):
        with tempfile.TemporaryDirectory() as work:
            u = FakeUpdater(work)
            u.owner = Mock()
            u.owner.request.return_value = {'enabled': False, 'customApp': ''}
            self.assertTrue(m.Updater.refresh_native(u, {}))
            u.owner.request.assert_called_once_with('/dock', timeout=30)

    def test_active_native_reloaded_once_without_mode_change(self):
        with tempfile.TemporaryDirectory() as work:
            u = FakeUpdater(work)
            u.owner = Mock()
            dock = {'enabled': False, 'customApp': 'GlassHome1.GlassHome', 'running': True}
            u.owner.request.return_value = dock
            record = {}
            self.assertTrue(m.Updater.refresh_native(u, record))
            self.assertTrue(record['nativeRefreshVerified'])
            self.assertEqual(u.owner.request.call_args_list[1].args, ('/dock', {'action': 'refresh'}))
            u.owner.request.reset_mock()
            self.assertTrue(m.Updater.refresh_native(u, record))
            self.assertEqual(u.owner.request.call_count, 1)


if __name__ == '__main__':
    unittest.main()
