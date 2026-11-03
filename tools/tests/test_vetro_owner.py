import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

spec = importlib.util.spec_from_file_location('vetro_owner', Path(__file__).parents[1] / 'vetro_owner.py')
owner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(owner)

class OwnerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.logs = []
        self.environment = patch.dict(os.environ, {'VETRO_TOKEN': ''})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.client = owner.OwnerClient('http://192.0.2.1:8099', self.temp.name, self.logs.append, lambda:'123456')

    def test_only_401_replays_after_pairing_without_logging_secrets(self):
        calls = []
        def raw(route, body=None, timeout=40, authenticated=True):
            calls.append((route,body,authenticated))
            if route == '/auth/pair': return {'id':'b'*32}
            if route == '/auth/confirm': return {'token':'a'*64}
            if len(calls)==1: raise urllib.error.HTTPError('url',401,'unauthorized',{},None)
            return {'ok':True}
        self.client.raw = raw
        self.assertEqual(self.client.request('/exec',{'cmd':'test'})['ok'],True)
        self.assertEqual([x[0] for x in calls],['/exec','/auth/pair','/auth/confirm','/exec'])
        self.assertEqual(self.client.file.stat().st_mode & 0o777,0o600)
        self.assertNotIn('123456',' '.join(self.logs));self.assertNotIn('a'*64,' '.join(self.logs))
        other = owner.OwnerClient(self.client.base,self.temp.name)
        self.assertEqual(other.token,'a'*64)

    def test_uncertain_failure_never_replays(self):
        for error in (TimeoutError(),urllib.error.URLError('reset'),urllib.error.HTTPError('url',503,'failed',{},None)):
            calls=[]
            def raw(*args,**kwargs): calls.append(args);raise error
            self.client.raw=raw
            with self.assertRaises(type(error)):self.client.request('/exec',{'cmd':'test'})
            self.assertEqual(len(calls),1)

    def test_token_goes_only_in_header_and_redirects_are_blocked(self):
        self.client.token='a'*64
        requests=[]
        class Opener:
            def open(self,req,timeout):requests.append(req);return io.BytesIO(b'{"ok":true}')
        self.client.opener=Opener();self.client.raw('/status')
        req=requests[0];self.assertEqual(req.get_header('Authorization'),'Bearer '+'a'*64)
        self.assertNotIn('a'*64,req.full_url)
        with self.assertRaises(RuntimeError):owner.NoRedirect().redirect_request(req,None,302,'',{},'http://other.test')

    def test_untrusted_token_file_is_rejected(self):
        self.client.file.write_text(json.dumps({'token':'a'*64}));self.client.file.chmod(0o644)
        with self.assertRaises(RuntimeError):owner.OwnerClient(self.client.base,self.temp.name)
        self.client.file.unlink();self.client.file.symlink_to(Path(self.temp.name)/'different')
        (Path(self.temp.name)/'different').write_text('{}')
        with self.assertRaises(OSError):owner.OwnerClient(self.client.base,self.temp.name)

if __name__=='__main__':unittest.main()
