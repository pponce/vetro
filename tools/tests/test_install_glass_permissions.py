import ast
import io
import json
from pathlib import Path
import re
import shutil
import tempfile
import types
import unittest
from unittest.mock import Mock


SOURCE = Path(__file__).parents[1] / 'install-glass-permissions.py'
TREE = ast.parse(SOURCE.read_text())


def load_functions():
    # Load the actual verification functions without running the CLI or parsing
    # credentials. The installer keeps its original command-line entry point.
    selected = [node for node in TREE.body
                if isinstance(node, ast.FunctionDef) and node.name in ('main', 'restart_glass')
                or isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'VERIFY_FILES' for t in node.targets)]
    namespace = dict(Path=Path, re=re, json=json, shutil=shutil)
    exec(compile(ast.Module(body=selected, type_ignores=[]), str(SOURCE), 'exec'), namespace)
    return namespace


class GlassInstallVerificationTests(unittest.TestCase):
    def test_running_service_must_report_authenticated_reply_integration(self):
        for integration, accepted in ((1, False), (2, True), (None, False)):
            namespace = load_functions()
            health = dict(name='Glass Home', vetroApps=3, dockPreferences=1, vetroLaunch=1,
                          vetroPermissions=integration)
            namespace.update(TV='192.0.2.1', say=Mock(), remote_script=Mock(),
                             time=types.SimpleNamespace(sleep=Mock()),
                             HTTP=types.SimpleNamespace(open=Mock(side_effect=lambda *a, **kw: io.BytesIO(json.dumps(health).encode()))))
            if accepted:
                namespace['restart_glass']()
                self.assertEqual(namespace['HTTP'].open.call_count, 1)
            else:
                with self.assertRaisesRegex(RuntimeError, 'scoped access integration 2'):
                    namespace['restart_glass']()
                self.assertEqual(namespace['HTTP'].open.call_count, 30)
            self.assertEqual(namespace['remote_script'].call_count, 1)

    def resume(self, mutation=None):
        namespace = load_functions()
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary)
            base = project / 'launcher-playground'
            ledger = project / 'attempt.json'
            revision = 'b' * 40
            expected = {name: 'c' * 64 for name in namespace['VERIFY_FILES']}
            saved = dict(revision=revision, sent=True, complete=False,
                         root='/opt/usr/apps/GlassHome1/res/wgt', hashCommand='sha256sum', hashes=dict(expected))
            actual = dict(expected)
            if mutation:
                mutation(saved, actual)
            ledger.write_text(json.dumps(saved))
            def api(route):
                self.assertEqual(route, '/exec', 'resume must never submit installation')
                return {'connected': True}
            def tv_hash(file, command):
                self.assertEqual(command, 'sha256sum')
                return actual.get(file.removeprefix(saved['root'] + '/'), '')
            namespace.update(PROJECT=project, BASE=base, LEDGER=ledger, REVISION=revision,
                             say=Mock(), api=api, tv_hash=tv_hash,
                             shutil=types.SimpleNamespace(which=lambda name: '/fixture/' + name),
                             restart_glass=Mock(), verify_vetro=Mock(),
                             ledger_write=lambda value: ledger.write_text(json.dumps(value)),
                             profile=Mock(side_effect=AssertionError('resume must not sign')))
            error = None
            try:
                namespace['main']()
            except RuntimeError as caught:
                error = caught
            return namespace, json.loads(ledger.read_text()), error

    def test_resume_verifies_new_reply_and_crypto_files_without_reinstalling(self):
        namespace, saved, error = self.resume()
        self.assertIsNone(error)
        for name in ('service/vetro-replies.js', 'js/vendor/sha256.js', 'js/vendor/sha256.LICENSE.txt'):
            self.assertIn(name, saved['hashes'])
        self.assertTrue(saved['complete'])
        namespace['restart_glass'].assert_called_once()
        namespace['verify_vetro'].assert_called_once()
        namespace['profile'].assert_not_called()

    def test_missing_new_file_in_attempt_does_not_silently_pass(self):
        namespace, saved, error = self.resume(lambda record, actual: record['hashes'].pop('service/vetro-replies.js'))
        self.assertIn('does not cover every required', str(error))
        self.assertFalse(saved['complete'])
        namespace['restart_glass'].assert_not_called()

    def test_changed_new_files_keep_attempt_unresolved_without_reinstall(self):
        for name in ('service/vetro-replies.js', 'js/vendor/sha256.js', 'js/vendor/sha256.LICENSE.txt'):
            namespace, saved, error = self.resume(lambda record, actual: actual.update({name: 'd' * 64}))
            self.assertIn('no second install was sent', str(error))
            self.assertFalse(saved['complete'])
            namespace['restart_glass'].assert_not_called()

    def test_another_unresolved_revision_is_preserved(self):
        namespace, saved, error = self.resume(lambda record, actual: record.update(revision='a' * 40))
        self.assertIn('earlier Glass Home update is unresolved', str(error))
        self.assertFalse(saved['complete'])
        namespace['restart_glass'].assert_not_called()


if __name__ == '__main__':
    unittest.main()
