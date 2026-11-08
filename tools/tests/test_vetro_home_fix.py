import argparse
import importlib.util
import io
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
spec = importlib.util.spec_from_file_location('home_fix_wrapper', TOOLS / 'update-vetro-home-fix.py')
wrapper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wrapper)


class VetroOnlyTests(unittest.TestCase):
    def test_installs_and_restarts_only_vetro(self):
        suite = wrapper.updater_module()
        class Fake(suite.Updater):
            def __init__(self, work):
                self.work = Path(work)
                self.state = {'suite': suite.SUITE, 'apps': {}}
                self.report = {'apps': {}}
                self.args = argparse.Namespace(check_only=False)
                self.events = []
            def preflight(self):
                pass
            def prepare(self, app):
                self.events.append(('prepare', app['key']))
                self.state['apps'][app['key']] = {'revision': app['revision']}
                return self.work / (app['key'] + '.wgt')
            def install(self, app, path):
                self.events.append(('install', app['key']))
                self.state['apps'][app['key']].update(submitted=True, verified=True)
            def refresh_runtime(self, app, record):
                self.events.append(('runtime', app['key']))
                return True
            def save(self):
                pass
        with tempfile.TemporaryDirectory() as work, patch('sys.stdout', io.StringIO()):
            updater = Fake(work)
            updater.execute()
        self.assertEqual(updater.events, [('prepare', 'vetro'), ('install', 'vetro'), ('runtime', 'vetro')])
        self.assertEqual(list(updater.report['apps']), ['Vetro'])
        self.assertTrue(updater.report['complete'])

    def test_separate_ledger_reuses_existing_owner_pairing_location(self):
        suite = wrapper.updater_module()
        with tempfile.TemporaryDirectory() as work:
            old_ledger = Path(work) / 'vetro-install/home-suite-20261108-r1'
            old_ledger.mkdir(parents=True)
            marker = old_ledger / 'prior-install.json'
            marker.write_text('retained')
            updater = suite.Updater(argparse.Namespace(project_root=work, tv='192.0.2.1'))
            try:
                self.assertNotEqual(updater.work, old_ledger)
                self.assertEqual(updater.owner.file.parent, Path(work) / 'vetro-install/combined-updates')
                self.assertEqual(updater.state['apps'], {})
                self.assertEqual(marker.read_text(), 'retained')
            finally:
                updater.lock.close()


if __name__ == '__main__':
    unittest.main()
