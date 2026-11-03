'use strict';
const assert = require('assert').strict, fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const {create, hash} = require('../tv-update-worker.js');
const REV = 'a'.repeat(40), OLD = 'b'.repeat(40);
function fixture() {
    const directory = '/tmp/vetro-update-' + crypto.randomBytes(8).toString('hex');
    fs.mkdirSync(directory);
    const installed = path.join(directory, 'installed');
    fs.mkdirSync(path.join(installed, 'service'), {recursive:true});fs.mkdirSync(path.join(installed, 'native/dock'), {recursive:true});
    fs.writeFileSync(path.join(installed, 'author-signature.xml'),'<Signature><X509Certificate>YXV0aG9y</X509Certificate></Signature>');
    fs.writeFileSync(path.join(installed, 'service/build-info.js'),'module.exports = {"sourceRevision":"'+OLD+'"};');
    fs.writeFileSync(path.join(installed, 'native/dock/tvlauncher-dotnet.dll'),'new-native');
    fs.writeFileSync(path.join(directory, 'vetro.wgt'),'signed-package');
    const f = {directory,installed,lock:path.join(directory,'lock'),commands:[],launches:[],closes:0,connects:0};
    const duid='TEST-DUID-1234567890';
    const transport = {connect:async options=>{assert.equal(options.host,'127.0.0.1');assert.equal(options.port,26101);f.connects++;if(f.failConnect===f.connects)throw Error('connect failed');return {};},
        exec:async (client,command)=>{f.commands.push(command);if(command==='shell:0 getduid')return duid+'\n';if(f.failure)throw Error('acknowledgement lost');return 'SDK returned';},
        close:()=>{f.closes++;}};
    f.worker=create({directory,lock:f.lock,roots:[installed],uid:()=>0,sdb:transport,
        execFile:(file,args,options,done)=>{f.launches.push([file,args]);done(null);}});
    f.job={revision:REV,previousRevision:OLD,sha256:hash(Buffer.from('signed-package')),size:14,
        authorFingerprint:hash(Buffer.from('author')),duidFingerprint:hash(duid.toLowerCase()),launcherSha256:hash(Buffer.from('new-native'))};
    f.clean=()=>fs.rmSync(directory,{recursive:true,force:true});
    return f;
}
const fixtures=[];const make=()=>{const f=fixture();fixtures.push(f);return f;};
(async()=>{
    let f=make();let p=await f.worker.probe();assert.equal(p.sourceRevision,OLD);assert.equal(p.uid,0);assert.equal(p.updateLocked,false);
    let r=await f.worker.install(f.job);assert.equal(r.phase,'install-returned');assert.equal(r.submitted,true);
    assert.equal(f.commands.filter(c=>c.includes('vd_appinstall')).length,1);
    assert.deepEqual(f.launches[0],['/usr/bin/app_launcher',['-s','vetrotvapp.app']]);
    assert.throws(()=>f.worker.finish(f.job),/not been verified/);assert.ok(fs.existsSync(f.lock));
    fs.writeFileSync(path.join(f.installed,'service/build-info.js'),'module.exports = {"sourceRevision":"'+REV+'"};');
    assert.equal(f.worker.finish(f.job).verified,true);assert.ok(!fs.existsSync(f.lock));

    for(const reason of ['checksum','identity','tv','revision','lock','connect']) {
        f=make();
        if(reason==='checksum')f.job.sha256='0'.repeat(64);
        if(reason==='identity')f.job.authorFingerprint='0'.repeat(64);
        if(reason==='tv')f.job.duidFingerprint='0'.repeat(64);
        if(reason==='revision')f.job.previousRevision='0'.repeat(40);
        if(reason==='lock'){fs.mkdirSync(f.lock);fs.writeFileSync(path.join(f.lock,'owner'),'/tmp/another-attempt');}
        if(reason==='connect')f.failConnect=2;
        r=await f.worker.install(f.job);assert.equal(r.phase,'not-submitted',reason);assert.equal(r.submitted,false,reason);
        assert.equal(f.commands.filter(c=>c.includes('vd_appinstall')).length,0,reason);
        assert.equal(f.launches.length,0,reason);
        if(reason==='lock')assert.equal(fs.readFileSync(path.join(f.lock,'owner'),'utf8'),'/tmp/another-attempt');
        if(reason==='connect')assert.ok(!fs.existsSync(f.lock),'failed pre-dispatch connection releases its own lock');
    }
    f=make();f.failure=true;r=await f.worker.install(f.job);
    assert.equal(r.phase,'install-uncertain');assert.equal(r.submitted,true);assert.ok(fs.existsSync(f.lock));
    r=await f.worker.install(f.job);assert.equal(f.commands.filter(c=>c.includes('vd_appinstall')).length,1,'no second install after lost acknowledgement');
    assert.equal(r.phase,'install-uncertain');assert.ok(fs.existsSync(f.lock),'a repeated invocation cannot release an unresolved update lock');
    assert.equal(f.launches.length,1);assert.equal(f.closes,f.connects,'SDB connections close after both success and failure');
    console.log('PASS TV updater: loopback only, identity and checksum guards, one dispatch, lost acknowledgement, independent relaunch, and verified lock release');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>fixtures.forEach(f=>f.clean()));
