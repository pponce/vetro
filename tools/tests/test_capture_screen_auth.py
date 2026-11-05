import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location('capture_screen_auth', ROOT / 'capture-screen-auth.py')
capture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture)


class Owner:
    token = 'private-owner-not-for-report'

    def __init__(self, mode='observe'):
        self.mode = mode
        self.revision = capture.REVISION
        self.calls = []

    def raw(self, route, body=None, timeout=0):
        self.calls.append((route, body))
        if route == '/status':
            return {'app': {'sourceRevision': self.revision, 'sourceDirty': False},
                'agent': {'connected': True}, 'self': {'pid': 12}}
        if route == '/input':
            if body is not None:
                assert body == {'mode': 'resume'}
                self.mode = 'filter'
                return {'ok': True}
            return {'status': {'policy': {'mode': self.mode, 'connected': True},
                'preference': {'enabled': True}}, 'home': {'ready': True}}
        raise AssertionError('Unexpected route: ' + route)


def handoff(directory):
    path = directory / 'beta-recovery' / ('input-handoff-' + capture.REVISION[:12] + '.json')
    path.parent.mkdir(parents=True, exist_ok=True)
    record = {'schema': 1, 'targetRevision': capture.REVISION, 'required': True,
        'before': {'mode': 'filter', 'connected': True, 'savedEnabled': True, 'homeReady': True},
        'observationRequested': True, 'observationConfirmed': True, 'oldFilterExited': True}
    path.write_text(json.dumps(record))
    return path


class ScreenCaptureTests(unittest.TestCase):
    def test_input_resume_only_uses_saved_setup_and_updates_existing_record(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = handoff(Path(tmp))
            owner, report = Owner(), {}
            capture.restore_input(owner, Path(tmp), report)
            self.assertEqual([v for v in owner.calls if v[1] is not None], [('/input', {'mode': 'resume'})])
            self.assertTrue(report['inputHandoff']['verified'])
            self.assertFalse(json.loads(path.read_text())['observationRequested'])
            self.assertEqual(list(path.parent.glob('*.tmp')), [])

    def test_healthy_filter_is_not_restarted(self):
        with tempfile.TemporaryDirectory() as tmp:
            handoff(Path(tmp))
            owner = Owner('filter')
            capture.restore_input(owner, Path(tmp), {})
            self.assertFalse(any(body is not None for _, body in owner.calls))

    def test_wrong_revision_or_unverified_old_helper_prevents_input_write(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = handoff(Path(tmp))
            owner = Owner()
            owner.revision = 'a' * 40
            with self.assertRaises(RuntimeError):
                capture.restore_input(owner, Path(tmp), {})
            owner.revision = capture.REVISION
            data = json.loads(path.read_text())
            data['oldFilterExited'] = False
            path.write_text(json.dumps(data))
            with self.assertRaises(capture.Error):
                capture.restore_input(owner, Path(tmp), {})
            self.assertFalse(any(body is not None for _, body in owner.calls))

    def test_default_observation_never_uses_inspector_or_launches_apps(self):
        with tempfile.TemporaryDirectory() as tmp:
            handoff(Path(tmp))
            owner, report = Owner('filter'), {'errors': []}
            state = {'sourceRevision': capture.REVISION, 'startedAt': 'unchanged',
                'screen': {'serviceAuthenticated': True}, 'widgetBootstrap': {'publications': 8}}
            with patch.object(capture, 'service_state', return_value=state), \
                 patch.object(capture.time, 'sleep'), \
                 patch.object(capture.wire, 'remote') as remote, \
                 patch.object(capture.wire, 'connect') as connect:
                capture.observe_current(owner, '192.0.2.9', Path(tmp), report)
            remote.assert_not_called()
            connect.assert_not_called()
            self.assertEqual(len(report['samples']), 7)
            self.assertTrue(report['captureComplete'])
            self.assertFalse(report['serviceRestartObserved'])

    def test_normal_state_capture_still_runs_when_input_record_is_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            report = {'errors': []}
            with patch.object(capture, 'service_state', return_value={'startedAt': 'same'}), patch.object(capture.time, 'sleep'):
                capture.observe_current(Owner('filter'), '192.0.2.9', Path(tmp), report)
            self.assertTrue(report['captureComplete'])
            self.assertTrue(report['errors'])

    def test_default_cli_preserves_screen_and_never_requests_pairing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'vetro-install/beta-recovery').mkdir(parents=True)
            args = ['capture', '--project-root', tmp, '--tv', '192.0.2.9', '--report-host', 'user@192.0.2.1']
            with patch.object(sys, 'argv', args), patch.object(capture, 'OwnerClient', return_value=Owner()), \
                 patch.object(capture, 'observe_current') as observe, patch.object(capture, 'capture') as inspector, \
                 contextlib.redirect_stdout(io.StringIO()) as out:
                capture.main()
            observe.assert_called_once()
            inspector.assert_not_called()
            self.assertIn('rsync -P user@192.0.2.1:', out.getvalue())
            self.assertIn('authentication check END', out.getvalue())
            data = json.loads(next((root / 'vetro-install/access-diagnostics').glob('*.json')).read_text())
            self.assertEqual(data['mode'], 'current-state')
            self.assertNotIn(Owner.token, json.dumps(data))

    def test_allowlists_drop_secrets_and_foreign_page_text(self):
        marker = 'sensitive-credential-or-code'
        source = {'token': marker, 'screenHttp': 401, 'pairingHttp': 401, 'requestCounts': {'screen': 7, marker: 8},
            'freshStatus': {'status': 200, 'result': 'response', 'body': marker}, 'readError': marker}
        encoded = json.dumps([capture.snapshot(source), capture.probe_result(source)])
        self.assertNotIn(marker, encoded)
        self.assertEqual(capture.snapshot(source)['screenHttp'], 401)

    def test_debug_failure_restores_only_the_screen_once(self):
        report, owner = {'errors': []}, Owner('filter')
        relay = {'relay': {'enabled': True, 'listening': True, 'sessions': 0, 'port': 26201}}
        with patch.object(capture, 'service_state', return_value={'startedAt': 'same'}), \
             patch.object(capture, 'restore_input'), \
             patch.object(capture.wire, 'verify_files', return_value={'one': True}), \
             patch.object(capture.wire, 'read_json', return_value=relay), \
             patch.object(capture.wire, 'connect', return_value=Mock()), \
             patch.object(capture, 'open_debug', side_effect=capture.Error('No port')), \
             patch.object(capture.wire, 'remote') as remote, patch.object(capture.time, 'sleep'):
            capture.capture(owner, '192.0.2.9', Path('/unused'), report)
        self.assertEqual(remote.call_count, 2)
        commands = '\n'.join(c.args[1] for c in remote.call_args_list)
        self.assertNotIn('vetrotvapp.svc', commands)
        self.assertEqual(commands.count('/usr/bin/app_launcher -s vetrotvapp.app'), 1)
        self.assertTrue(report['normalRelaunchCommandCompleted'])

    def test_browser_probe_keeps_credentials_and_pairing_response_on_tv(self):
        program = r'''
const assert=require('assert').strict,vm=require('vm');
const expressions=JSON.parse(process.argv[1]);
let seen=[],fresh='a'.repeat(64),cached='b'.repeat(64);
class XHR{
 open(method,url){assert.equal(method,'GET');this.url=url;}
 setRequestHeader(name,value){assert.equal(name,'X-Vetro-Widget');this.token=value;}
 send(body){assert.equal(body,null);seen.push({url:this.url,token:this.token});
  this.status=this.token===fresh?200:401;this.responseText='{"code":"123456","token":"DO-NOT-EXPORT"}';this.onload();}
}
const c={window:{widgetCredential:{token:cached}},tizen:{},XMLHttpRequest:XHR,
 VetroWidgetSession:{read:async()=>({token:fresh,expires:Date.now()+120000})},Promise,Date};
c.window.VetroWidgetSession=c.VetroWidgetSession;c.window.tizen=c.tizen;
(async()=>{
 const result=await vm.runInNewContext(expressions.probe,c);
 assert.equal(result.cachedMatchesFresh,false);
 assert.equal(result.freshStatus.status,200);assert.equal(result.freshPairing.status,200);
 assert.equal(result.cachedStatus.status,401);assert.equal(seen.length,3);
 assert.ok(seen.every(r=>/^http:\/\/127\.0\.0\.1:8099\/(status|auth\/pending)\?screen_auth_capture=1$/.test(r.url)));
 const serialized=JSON.stringify(result);for(const secret of [fresh,cached,'123456','DO-NOT-EXPORT'])assert.ok(!serialized.includes(secret));
 assert.equal(c.window.widgetCredential.token,cached,'probe must not change screen cache');
 const p={getEntriesByType:()=>[
  {name:'http://127.0.0.1:8099/screen',startTime:1,duration:2},
  {name:'http://127.0.0.1:8099/auth/pending',startTime:3,duration:4},
  {name:'http://127.0.0.1:8099/status?screen_auth_capture=1',startTime:5,duration:6},
  {name:'https://other.invalid/?token=secret',startTime:7,duration:8}],now:()=>10};
 const s={window:{performance:p},performance:p,document:{hidden:false,readyState:'complete'}};
 const state=vm.runInNewContext(expressions.snapshot,s);
 assert.equal(state.requestCounts.screen,1);assert.equal(state.requestCounts.pairing,1);assert.equal(state.requestCounts.status,0);
 assert.ok(!JSON.stringify(state).includes('secret'));
})().catch(e=>{console.error(e);process.exitCode=1;});
'''
        result = subprocess.run(['node', '-e', program, json.dumps({'probe': capture.PROBE, 'snapshot': capture.SNAPSHOT})],
            capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_pinned_runner_verifies_every_helper_and_defaults_to_current_state(self):
        source = (ROOT / 'run-screen-auth-check.sh').read_text().split("<<'PYVETRO'\n", 1)[1].split('\nPYVETRO\n', 1)[0]
        class Opener:
            def open(self, url, timeout):
                self.last = url
                return io.BytesIO((ROOT / url.rsplit('/', 1)[1]).read_bytes())
        for extra in ([], ['--inspect-screen']):
            with tempfile.TemporaryDirectory() as tmp:
                args = ['-', tmp, '192.0.2.9', 'user@192.0.2.1', 'c' * 40] + extra
                with patch.object(sys, 'argv', args), patch('urllib.request.build_opener', return_value=Opener()), \
                     patch('subprocess.run') as run:
                    exec(compile(source, 'run-screen-auth-check.sh', 'exec'), {})
                run.assert_called_once()
                call = run.call_args.args[0]
                self.assertEqual(call[1], '-u')
                self.assertTrue(call[2].endswith('/capture-screen-auth.py'))
                self.assertEqual('--inspect-screen' in call, bool(extra))
                self.assertFalse(any('update-connection' in arg or 'install' == arg for arg in call))
                self.assertEqual(len(list((Path(tmp)/'vetro-install/bin').rglob('*.py'))), 6)


if __name__ == '__main__':
    unittest.main()
