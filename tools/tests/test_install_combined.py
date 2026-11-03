import base64
import importlib.util
import json
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location('installer', Path(__file__).parents[1] / 'install-combined.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)
REV = 'a' * 40


class InstallerTests(unittest.TestCase):
    def test_existing_partner_profile_only(self):
        p = {'Level':'Partner','Exists':True,'Usable':True,'Duids':['TESTTV1234567'],'Path':'/profile'}
        raw = 'CLI progress\n' + json.dumps({'result':{'profiles':[p]}})
        self.assertEqual(installer.partner_profile(raw,'testtv1234567'),Path('/profile'))
        for key, value in [('Usable',False),('Level','Public'),('Duids',['OTHER'])]:
            bad=dict(p);bad[key]=value
            with self.assertRaises(RuntimeError):installer.partner_profile(json.dumps({'profiles':[bad]}),'TESTTV1234567')

    def test_chunk_transfer_is_exact_and_repeatable(self):
        stage='/tmp/vetro-update-'+secrets.token_hex(8)
        Path(stage).mkdir()
        try:
            data=bytes(range(256))*150 + b'last block'
            commands=list(installer.transfer_commands(stage,'vetro.wgt',data))
            for command in commands:subprocess.run(['sh','-c',command],check=True)
            subprocess.run(['sh','-c',commands[1]],check=True)
            self.assertEqual((Path(stage)/'vetro.wgt').read_bytes(),data)
            with self.assertRaises(ValueError):list(installer.transfer_commands('/tmp/other','vetro.wgt',data))
            with self.assertRaises(ValueError):list(installer.transfer_commands(stage,'../file',data))
        finally:shutil.rmtree(stage)

    def test_signed_package_identity_and_native_hash(self):
        with tempfile.TemporaryDirectory() as temp:
            file=Path(temp)/'test.wgt'
            def write(package='vetrotvapp',dirty=False):
                with zipfile.ZipFile(file,'w') as z:
                    z.writestr('config.xml',f'<widget xmlns:tizen="http://tizen.org/ns/widgets"><tizen:application id="vetrotvapp.app" package="{package}"/></widget>')
                    z.writestr('author-signature.xml','<Signature><X509Certificate>YXV0aG9y</X509Certificate></Signature>')
                    z.writestr('signature1.xml','signature')
                    z.writestr('service/build-info.js',f'module.exports={{"sourceRevision":"{REV}","sourceDirty":{str(dirty).lower()}}}')
                    for name in ('service/startup-app.js','service/return-app.js','payload/SamsungTvRootAgent.dll'):z.writestr(name,'file')
                    z.writestr('native/dock/tvlauncher-dotnet.dll',b'native')
            write();value=installer.package_metadata(file,REV,installer.digest(b'native'))
            self.assertEqual(value['authorFingerprint'],installer.digest(b'author'))
            with self.assertRaises(RuntimeError):installer.package_metadata(file,REV,'0'*64)
            write(dirty=True)
            with self.assertRaises(RuntimeError):installer.package_metadata(file,REV,installer.digest(b'native'))
            write(package='another-app')
            with self.assertRaises(RuntimeError):installer.package_metadata(file,REV,installer.digest(b'native'))

    def test_updater_finishes_after_the_launching_shell_exits(self):
        stage=Path('/tmp/vetro-update-'+secrets.token_hex(8));stage.mkdir()
        try:
            (stage/'VetroUpdate.dll').write_text('import time\nfrom pathlib import Path\ntime.sleep(.3)\nPath(__file__).with_name("finished").write_text("ok")\n')
            result=subprocess.run(['sh','-c',installer.launch_command(sys.executable,str(stage))],capture_output=True,text=True,timeout=2)
            self.assertEqual(result.returncode,0);self.assertEqual(result.stdout,'updater-started\n')
            deadline=time.monotonic()+3
            while not (stage/'finished').exists() and time.monotonic()<deadline:time.sleep(.02)
            self.assertEqual((stage/'finished').read_text(),'ok')
        finally:shutil.rmtree(stage)

    def fake_installer(self, ready=True):
        obj=object.__new__(installer.Installer);obj.sent=False;obj.calls=[];obj.messages=[]
        obj.log=obj.messages.append;obj.write_ledger=lambda d: obj.calls.append(('ledger',dict(d)))
        count=[0]
        def request(route, body=None, timeout=None):
            obj.calls.append((route,body))
            if route=='/status':
                count[0]+=1
                if ready and count[0]>1:return {'app':{'sourceRevision':REV,'sourceDirty':False},'agent':{'connected':True}}
                return {'app':{'sourceRevision':'b'*40},'agent':{'connected':True}}
            if route in ('/startup-app','/return-app'):return {'appId':None,'revision':0}
            if route=='/dock':return {'enabled':True,'running':True,'fixTizenTube':False,'pid':99}
            raise AssertionError(route)
        obj.request=request
        obj.execute=lambda command: obj.calls.append(('exec',command)) or json.dumps({'phase':'install-returned','submitted':True,'finished':True})
        obj.worker=lambda stage,mode: obj.calls.append(('worker',mode)) or {'sourceRevision':REV,'launcherSha256':'native'}
        ledger={'revision':REV,'launcherSha256':'native','stage':'/tmp/vetro-update-'+'a'*16,
                'dock':{'enabled':True,'fixTizenTube':False,'pid':42},'sent':True,'complete':False}
        return obj,ledger

    def test_reconnect_verifies_without_resubmitting(self):
        obj,ledger=self.fake_installer()
        with patch.object(installer.time,'sleep'):
            obj.verify(ledger)
        self.assertTrue(ledger['complete'])
        self.assertIn(('/dock',{'action':'refresh'}),obj.calls)
        self.assertIn(('worker','finish'),obj.calls)
        self.assertFalse(any('vd_appinstall' in str(c) or c[0]=='/install' for c in obj.calls))

    def test_definite_preflight_failure_can_be_retried(self):
        obj,ledger=self.fake_installer(ready=False)
        obj.execute=lambda _: json.dumps({'phase':'not-submitted','submitted':False,'error':'certificate changed'})
        with self.assertRaisesRegex(RuntimeError,'before installation'):
            obj.verify(ledger)
        self.assertFalse(ledger['sent']);self.assertFalse(obj.sent)
        self.assertFalse(ledger['complete'])

    def test_unknown_outcome_stays_pending(self):
        obj,ledger=self.fake_installer(ready=False)
        with patch.object(installer.time,'monotonic',side_effect=[0,1,1,1,400]),patch.object(installer.time,'sleep'):
            with self.assertRaisesRegex(RuntimeError,'No second install'):
                obj.verify(ledger)
        self.assertTrue(ledger['sent']);self.assertFalse(ledger['complete'])
        self.assertNotIn(('worker','finish'),obj.calls)

    def test_tv_service_executable_is_never_probed_as_node(self):
        obj=object.__new__(installer.Installer);commands=[]
        obj.execute=lambda command: commands.append(command) or '{"uid":0}'
        stage='/tmp/vetro-update-'+'a'*16
        self.assertEqual(obj.worker(stage,'probe'),{'uid':0})
        self.assertEqual(commands,['/usr/bin/dotnet '+stage+'/VetroUpdate.dll probe'])
        self.assertNotIn('/proc/',installer.launch_command('/usr/bin/dotnet',stage))
        self.assertFalse(hasattr(installer.Installer,'node_path'))

    def test_helper_transfer_is_checked_before_any_execution(self):
        obj=object.__new__(installer.Installer);obj.root=Path('/unused');obj.log=lambda _:None
        obj.upload=lambda *args:None;obj.calls=[]
        obj.execute=lambda command: obj.calls.append(command) or 'wrong-checksum  file'
        with patch.object(installer,'helper_files',return_value={'VetroUpdate.dll':b'helper'}):
            with self.assertRaisesRegex(RuntimeError,'checksum'):obj.stage_helper()
        self.assertEqual(len(obj.calls),2)
        self.assertNotIn('VetroUpdate.dll probe',' '.join(obj.calls))

    def test_running_updater_is_not_cleaned_or_unlocked(self):
        obj,ledger=self.fake_installer()
        obj.request=lambda route,body=None,timeout=None: {'app':{'sourceRevision':REV,'sourceDirty':False},'agent':{'connected':True}}
        obj.execute=lambda command: json.dumps({'phase':'installing','submitted':True,'finished':False})
        with patch.object(installer.time,'monotonic',side_effect=[0,1,2,3,200]),patch.object(installer.time,'sleep'):
            with self.assertRaisesRegex(RuntimeError,'updater has not finished'):obj.verify(ledger)
        self.assertNotIn(('worker','finish'),obj.calls)
        self.assertFalse(ledger['complete']);self.assertTrue(ledger['sent'])

    def test_precompiled_helper_matches_source_and_manifest(self):
        root=Path(__file__).resolve().parents[2]
        files=installer.helper_files(root)
        self.assertEqual(set(files),{'VetroUpdate.dll','VetroUpdate.runtimeconfig.json'})
        self.assertTrue(files['VetroUpdate.dll'].startswith(b'MZ'))
        spec=importlib.util.spec_from_file_location('bundle',root/'tools/tv-updater/bundle.py')
        bundle=importlib.util.module_from_spec(spec);spec.loader.exec_module(bundle)
        with tempfile.TemporaryDirectory() as directory:
            copy=Path(directory)/'helper';shutil.copytree(root/'tools/tv-updater',copy)
            for name in ('VetroUpdate.cs','compiled/VetroUpdate.dll'):
                file=copy/name;old=file.read_bytes();file.write_bytes(old+b'changed')
                with self.assertRaisesRegex(RuntimeError,'does not match'):bundle.verify(copy)
                file.write_bytes(old)


if __name__=='__main__':unittest.main()
