import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
spec=importlib.util.spec_from_file_location('watch_screen_lifecycle',ROOT/'watch-screen-lifecycle.py')
watch=importlib.util.module_from_spec(spec)
spec.loader.exec_module(watch)


class Tests(unittest.TestCase):
    def test_tv_shell_keeps_credential_out_of_argv_and_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            secret='b'*64
            record={'schema':1,'token':secret,'expires':1234567890000}
            (root/'vetro-widget-session.json').write_text(json.dumps(record,separators=(',',':')))
            binary=root/'bin'
            binary.mkdir()
            curl=binary/'curl'
            curl.write_text('#!/usr/bin/env python3\nimport sys\nargs=sys.argv[1:]\nassert "'+secret+'" not in " ".join(args)\ndata=sys.stdin.read()\nassert "'+secret+'" in data\nassert "Origin: null" in data\nassert args[-1] in ["http://127.0.0.1:8099/status","http://127.0.0.1:8099/auth/pending"]\nprint("200",end="")\n')
            curl.chmod(0o700)
            env=dict(os.environ,PATH=str(binary)+os.pathsep+os.environ['PATH'])
            proc_pid=int(Path('/proc/self/stat').read_text().split(' ',1)[0])
            result=subprocess.run(['sh'],input=watch.shell(proc_pid,(str(root),)),text=True,capture_output=True,env=env,timeout=15)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertNotIn(secret,result.stdout+result.stderr)
            data=watch.evidence({'output':result.stdout,'exit_code':result.returncode})
            self.assertTrue(data['complete'])
            self.assertEqual(len(data['credentialFiles']),1)
            self.assertEqual(data['credentialFiles'][0]['statusHttp'],200)
            self.assertEqual(data['credentialFiles'][0]['pairingHttp'],200)
            self.assertTrue(any(p['role']=='current-service' for p in data['processes']))

    def test_bad_token_is_never_used_for_http(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            (root/'vetro-widget-session.json').write_text('{"token":"injected-header","expires":12}')
            result=subprocess.run(['sh'],input=watch.shell(os.getpid(),(str(root),)),capture_output=True,text=True,timeout=15)
            data=watch.evidence({'output':result.stdout,'exit_code':result.returncode})
            self.assertIsNone(data['credentialFiles'][0]['statusHttp'])
            self.assertNotIn('injected-header',result.stdout)

    def test_parser_drops_arbitrary_output_and_marks_incomplete_data(self):
        secret='secret-value'
        data=watch.evidence({'output':'VETRO_LIFECYCLE|1\n'+secret+'\nPROCESS|12|1|50|S|current-service\n', 'exit_code':0, 'stderr':secret})
        self.assertFalse(data['complete'])
        self.assertTrue(data['stderrPresent'])
        self.assertNotIn(secret,json.dumps(data))
        self.assertEqual(data['processes'][0]['pid'],12)

    def test_no_control_or_repair_routes_during_observation(self):
        class Owner:
            def __init__(self):self.calls=[]
            def raw(self,route,body=None,**kw):
                self.calls.append((route,body,kw))
                if route=='/status':return {'app':{'sourceRevision':watch.REVISION,'sourceDirty':False},'agent':{'connected':True},'self':{'pid':123}}
                if route=='/exec':return {'exit_code':0,'output':'VETRO_LIFECYCLE|1\nEND|0\n'}
                raise AssertionError(route)
        owner=Owner()
        now=[0]
        def sleep(seconds):now[0]+=seconds
        with patch.object(watch.time,'monotonic',side_effect=lambda:now[0]),patch.object(watch.time,'sleep',side_effect=sleep):
            report={}
            watch.collect(owner,6,report)
        self.assertTrue(report['captureComplete'])
        self.assertTrue(owner.calls)
        for route,body,_ in owner.calls:
            self.assertIn(route,('/status','/exec'))
            if route=='/exec':
                command=body['cmd']
                self.assertNotIn('app_launcher',command)

    def test_wrong_revision_skips_root_probe(self):
        class Owner:
            def raw(self,route,body=None,**kw):
                assert route=='/status'
                return {'app':{'sourceRevision':'a'*40,'sourceDirty':False}}
        now=[0]
        def sleep(seconds):now[0]+=seconds
        with patch.object(watch.time,'monotonic',side_effect=lambda:now[0]),patch.object(watch.time,'sleep',side_effect=sleep):
            report={}
            watch.collect(Owner(),1,report)
        self.assertIn('Different running revision',report['samples'][0]['error'])

    def test_command_contains_only_read_operations_and_current_service_pid(self):
        import base64
        with self.assertRaises(ValueError):watch.command(True)
        value=watch.command(12)
        decoded=base64.b64decode(value.split()[2]).decode()
        self.assertEqual(decoded,watch.shell(12))
        for forbidden in ('app_launcher','kill ','/input','--data',' --location','/auth/pair','/auth/confirm'):
            self.assertNotIn(forbidden,decoded)

    def test_runner_pins_helpers_and_only_starts_observation(self):
        source=(ROOT/'run-screen-lifecycle-watch.sh').read_text().split("<<'PYVETRO'\n",1)[1].split('\nPYVETRO\n',1)[0]
        class Opener:
            def open(self,url,timeout):return io.BytesIO((ROOT/url.rsplit('/',1)[1]).read_bytes())
        with tempfile.TemporaryDirectory() as tmp:
            args=['-',tmp,'192.0.2.9','user@192.0.2.1','a'*40]
            with patch.object(sys,'argv',args),patch('urllib.request.build_opener',return_value=Opener()),patch('subprocess.run') as run:
                exec(compile(source,'runner','exec'),{})
            run.assert_called_once()
            command=run.call_args.args[0]
            self.assertTrue(command[2].endswith('/watch-screen-lifecycle.py'))
            self.assertEqual(len(list((Path(tmp)/'vetro-install/bin').rglob('*.py'))),2)


if __name__=='__main__':unittest.main()
