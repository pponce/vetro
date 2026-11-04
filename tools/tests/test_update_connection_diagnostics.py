import importlib.util
import contextlib
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('updater', Path(__file__).parents[1] / 'update-connection-diagnostics.py')
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)


class UpdateDiagnosticTests(unittest.TestCase):
    def test_existing_attempt_never_reinstalls_even_if_status_is_old_or_missing(self):
        for status in ({}, {'connectionDiagnostics': {'sourceRevision': 'old', 'sourceDirty': False}}):
            self.assertEqual(M.decision(status, 'new', 'old', True), 'collect-existing-attempt')

    def test_revision_and_dirty_guards(self):
        def status(revision, dirty):
            return {'connectionDiagnostics': {'sourceRevision': revision, 'sourceDirty': dirty}}
        self.assertEqual(M.decision(status('new', False), 'new', 'old', False), 'collect')
        self.assertEqual(M.decision(status('old', False), 'new', 'old', False), 'install')
        for value in (status('other', False), status('old', True), status('old', None), {}):
            with self.assertRaises(RuntimeError):
                M.decision(value, 'new', 'old', False)

    def test_certificate_must_exist_be_usable_and_cover_reported_tv(self):
        duid = 'EXAMPLE1234567'
        profile = dict(level='Partner', exists=True, usable=True, duids=[duid], path='/fixture/profile')
        good = dict(ok=True, tvDuid=duid, profiles=[profile])
        self.assertEqual(M.partner_profile(good), (duid, Path('/fixture/profile')))
        for override in ({'exists': False}, {'usable': False}, {'duids': ['OTHER12345678']}, {'level': 'Public'}):
            with self.assertRaises(RuntimeError):
                M.partner_profile(dict(good, profiles=[dict(profile, **override)]))
        with self.assertRaises(RuntimeError):
            M.partner_profile(dict(good, profiles=[profile, profile]))

    def test_install_never_requests_uninstall_new_identity_or_certificate_replacement(self):
        command = M.install_command('/cli', '/candidate.wgt', '192.0.2.1', '192.0.2.2', 'EXAMPLE1234567')
        self.assertIn('--own-id', command)
        self.assertIn('--partner', command)
        self.assertIn('--launch', command)
        self.assertTrue(set(command).isdisjoint({'--allow-remove', '--remove-first', '--new-id', '--force-login', '--prepare'}))

    def test_ci_requires_exact_revision_and_all_four_successful_jobs(self):
        run = dict(head_sha='revision', status='completed', conclusion='success')
        jobs = {'jobs': [dict(name=name, conclusion='success') for name in ('check', 'permissions_ui', 'launcher', 'combined_package')]}
        with patch.object(M, 'read_json', side_effect=[run, jobs]):
            M.verify_ci('revision', 1)
        jobs['jobs'][-1]['conclusion'] = 'skipped'
        with patch.object(M, 'read_json', side_effect=[run, jobs]), self.assertRaises(RuntimeError):
            M.verify_ci('revision', 1)
        with patch.object(M, 'read_json', return_value=dict(run, head_sha='different')), self.assertRaises(RuntimeError):
            M.verify_ci('revision', 1)

    def test_full_host_update_and_unresolved_repeat_submit_only_once(self):
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary)
            cli = project / 'fixture-cli'
            cli.write_text('fixture')
            cli.chmod(0o700)
            locator = project / 'vetro-install/bin/apps2samsung-beta.path'
            locator.parent.mkdir(parents=True)
            locator.write_text(str(cli))
            profile = project / 'fixture-profile'
            profile.mkdir()
            (profile / 'author.p12').write_bytes(b'fixture-author-certificate')
            baseline, revision, duid = 'a' * 40, 'b' * 40, 'EXAMPLE1234567'
            status = {'connectionDiagnostics': {'sourceRevision': baseline, 'sourceDirty': False}}
            cert = dict(ok=True, tvDuid=duid, profiles=[dict(level='Partner', exists=True, usable=True,
                        duids=[duid], path=str(profile))])
            captured = dict(capture=dict(complete=False, runningServiceVerified=False, screenBuildVerified=False), status=status)
            arguments = ['updater', '--project-root', str(project), '--tv', '192.0.2.1', '--local-ip', '192.0.2.2',
                         '--revision', revision, '--expected-before', baseline, '--report-host', 'fixture@192.0.2.2', '--ci-run', '1']
            result = subprocess.CompletedProcess([], 1, json.dumps({'ok': False, 'error': 'Fixture disconnect'}), '')
            with patch('sys.argv', arguments), patch.object(M, 'verify_ci'), patch.object(M, 'read_json', return_value=status), \
                 patch.object(M, 'checkout', return_value=project), patch.object(M, 'idle_relay'), \
                 patch.object(M, 'checked', side_effect=[M.CLI_VERSION, json.dumps(cert), '']), \
                 patch.object(M, 'run', return_value=result) as install, patch.object(M, 'collect', side_effect=lambda *a: json.loads(json.dumps(captured))), \
                 contextlib.redirect_stdout(io.StringIO()):
                M.main()
                M.main()
            self.assertEqual(install.call_count, 1)
            directory = project / 'vetro-install/beta-recovery'
            self.assertTrue((directory / ('attempt-' + revision[:12] + '.json')).is_file())
            reports = [json.loads(p.read_text()) for p in sorted(directory.glob('connection-report-*.json'))]
            self.assertEqual(len(reports), 2)
            self.assertEqual([p['installation']['installSubmittedByThisRun'] for p in reports], [True, False])
            self.assertEqual(reports[1]['installation']['action'], 'collect-existing-attempt')
            self.assertTrue(all(duid not in json.dumps(p) for p in reports))


if __name__ == '__main__':
    unittest.main()
