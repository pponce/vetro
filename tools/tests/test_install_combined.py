import base64
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
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
PROBE = {'uid':0,'duid':'TESTTV1234567','sourceRevision':'b'*40,'updateLocked':False,
         'authorFingerprint':installer.digest(b'author'),
         'launcherSha256':installer.digest(b'native'),'runtime':'6.0.9'}


def frame(mode, result):
    return installer.WORKER_PREFIX + json.dumps({'protocol':1,'mode':mode,'result':result})


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
        obj.worker=lambda stage,mode: obj.calls.append(('worker',mode)) or (
            {'verified':True,'revision':REV} if mode=='finish' else {'sourceRevision':REV,'launcherSha256':'native'})
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

    def test_runtime_refresh_is_independent_of_home_assignment(self):
        obj,ledger=self.fake_installer()
        original=obj.request
        def request(route,body=None,timeout=None):
            result=original(route,body,timeout)
            if route=='/dock':result.update(enabled=False,runtimeEnabled=True,home={'launcher':False})
            return result
        obj.request=request
        with patch.object(installer.time,'sleep'):obj.verify(ledger)
        self.assertTrue(ledger['complete'])
        self.assertIn(('/dock',{'action':'refresh'}),obj.calls)

    def test_home_detection_guidance_does_not_repeat_install(self):
        obj,ledger=self.fake_installer()
        original=obj.request
        def request(route,body=None,timeout=None):
            result=original(route,body,timeout)
            if route=='/dock':result['home']={'launcher':True,'device':None,'ready':False}
            return result
        obj.request=request
        with patch.object(installer.time,'sleep'):obj.verify(ledger)
        self.assertTrue(ledger['complete'])
        self.assertTrue(any('Home setup needed' in message for message in obj.messages))

    def test_unknown_outcome_stays_pending(self):
        obj,ledger=self.fake_installer(ready=False)
        with patch.object(installer.time,'monotonic',side_effect=[0,1,1,1,400]),patch.object(installer.time,'sleep'):
            with self.assertRaisesRegex(RuntimeError,'No second install'):
                obj.verify(ledger)
        self.assertTrue(ledger['sent']);self.assertFalse(ledger['complete'])
        self.assertNotIn(('worker','finish'),obj.calls)

    def test_tv_service_executable_is_never_probed_as_node(self):
        obj=object.__new__(installer.Installer);commands=[]
        obj.execute=lambda command: commands.append(command) or frame('probe',PROBE)
        stage='/tmp/vetro-update-'+'a'*16
        self.assertEqual(obj.worker(stage,'probe'),PROBE)
        self.assertEqual(commands,['/usr/bin/dotnet '+stage+'/VetroUpdate.dll probe'])
        self.assertNotIn('/proc/',installer.launch_command('/usr/bin/dotnet',stage))
        self.assertFalse(hasattr(installer.Installer,'node_path'))

    def test_versioned_result_ignores_surrounding_runtime_output(self):
        output='Runtime startup\n{"unrelated":true}\n'+frame('probe',PROBE)+'\nRuntime shutdown\n'
        self.assertEqual(installer.worker_response(output,'probe'),PROBE)
        installed={k:PROBE[k] for k in ('authorFingerprint','sourceRevision','launcherSha256')}
        self.assertEqual(installer.worker_response(frame('installed',installed),'installed'),installed)
        done={'verified':True,'revision':REV}
        self.assertEqual(installer.worker_response(frame('finish',done)+'\nshutdown','finish'),done)

    def test_result_rejects_missing_duplicate_truncated_and_wrong_operation(self):
        valid=frame('probe',PROBE)
        outputs=['',json.dumps(PROBE),valid+'\n'+valid,valid[:-1],valid+' extra',frame('installed',PROBE),
                 'VETRO_UPDATE_RESULT_V2 '+json.dumps(PROBE),valid+'\n'+'x'*65536]
        for output in outputs:
            with self.subTest(output_length=len(output)):
                with self.assertRaises(RuntimeError) as caught:installer.worker_response(output,'probe')
                self.assertNotIn(PROBE['duid'],str(caught.exception))
        for version in (2,True,'1'):
            output=installer.WORKER_PREFIX+json.dumps({'protocol':version,'mode':'probe','result':PROBE})
            with self.assertRaises(RuntimeError):installer.worker_response(output,'probe')

    def test_result_requires_typed_identity_and_completion_fields(self):
        for field,value in [('uid',False),('uid',1),('updateLocked',0),('duid','TEST12345'),
                            ('authorFingerprint','bad'),('launcherSha256',None),('sourceRevision','bad'),('runtime','')]:
            result=dict(PROBE);result[field]=value
            with self.subTest(field=field):
                with self.assertRaises(RuntimeError):installer.worker_response(frame('probe',result),'probe')
        for result in ({},[],{'verified':False,'revision':REV},{'verified':True,'revision':'bad'}):
            with self.assertRaises(RuntimeError):installer.worker_response(frame('finish',result),'finish')

    def test_valid_frame_cannot_hide_failed_tv_command(self):
        obj=object.__new__(installer.Installer)
        obj.request=lambda route,body: {'ok':False,'exit_code':1,'output':frame('probe',PROBE),'stderr':'runtime failed'}
        with self.assertRaisesRegex(RuntimeError,'runtime failed'):
            obj.worker('/tmp/vetro-update-'+'a'*16,'probe')

    def test_unconfirmed_finish_keeps_attempt_pending(self):
        obj,ledger=self.fake_installer()
        obj.worker=lambda stage,mode: ({'verified':True,'revision':'c'*40} if mode=='finish'
                                      else {'sourceRevision':REV,'launcherSha256':'native'})
        with patch.object(installer.time,'sleep'):
            with self.assertRaisesRegex(RuntimeError,'requested revision'):obj.verify(ledger)
        self.assertFalse(ledger['complete']);self.assertTrue(ledger['sent'])

    def test_complete_host_flow_with_runtime_noise_and_short_tv_id(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);native=root/'app/native/dock/tvlauncher-dotnet.dll'
            native.parent.mkdir(parents=True);native.write_bytes(b'native')
            obj=object.__new__(installer.Installer)
            obj.root=root;obj.args=SimpleNamespace(expected_commit=REV)
            obj.ledger_file=root/'state.json';obj.redactions=[];obj.sent=False;obj.messages=[]
            obj.log=obj.messages.append
            stage='/tmp/vetro-update-'+'a'*16
            obj.stage_helper=lambda:stage
            obj.command=lambda args: REV if args==['git','rev-parse','HEAD'] else ''
            uploads=[];obj.upload=lambda folder,name,data:uploads.append((name,data))
            state={'submitted':0,'pid':42}
            def request(route,body=None,timeout=None):
                if route=='/status':
                    return {'mode':'tv-integration','agent':{'connected':True},
                            'app':{'sourceRevision':REV if state['submitted'] else 'b'*40,'sourceDirty':False}}
                if route=='/dock':
                    if body:state['pid']=99
                    return {'enabled':True,'running':True,'pid':state['pid'],'fixTizenTube':False}
                if route in ('/startup-app','/return-app'):return {'appId':None,'revision':0}
                self.assertEqual(route,'/exec');command=body['cmd']
                if command.startswith('nohup setsid '):
                    state['submitted']+=1;output='updater-started\n'
                elif command.startswith('cat '):
                    output=json.dumps({'submitted':True,'finished':True,'phase':'install-returned'})
                elif command.startswith('rm -rf '):output=''
                else:
                    self.assertTrue(command.startswith('/usr/bin/dotnet '+stage+'/VetroUpdate.dll '))
                    mode=command.rsplit(' ',1)[1]
                    result=(dict(PROBE) if mode=='probe' else dict(PROBE,sourceRevision=REV) if mode=='installed'
                            else {'verified':True,'revision':REV})
                    output='Runtime startup\n'+frame(mode,result)+'\nRuntime shutdown\n'
                return {'ok':True,'exit_code':0,'timed_out':False,'output':output,'stderr':''}
            obj.request=request
            def sign(duid,revision,native_hash):
                profile={'profiles':[{'Level':'Partner','Exists':True,'Usable':True,'Duids':['testtv1234567'],'Path':str(root)}]}
                self.assertEqual(installer.partner_profile(json.dumps(profile),duid),root)
                self.assertEqual(revision,REV);self.assertEqual(native_hash,installer.digest(b'native'))
                file=root/'signed.wgt';file.write_bytes(b'package')
                return file,{'authorFingerprint':PROBE['authorFingerprint'],'sha256':installer.digest(b'package'),'size':7}
            obj.sign=sign
            obj.run()
            self.assertTrue(json.loads(obj.ledger_file.read_text())['complete'])
            self.assertEqual(state['submitted'],1);self.assertEqual(state['pid'],99)
            job=json.loads(dict(uploads)['job.json'])
            self.assertEqual(job['duidFingerprint'],installer.digest(PROBE['duid'].lower().encode()))
            self.assertTrue(any(line.startswith('VERIFIED:') for line in obj.messages))
            obj.run()
            self.assertEqual(state['submitted'],1,'Already-installed build is not resubmitted')

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
