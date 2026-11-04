'use strict';
const assert=require('assert').strict,fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process');
const registry=require('../service/app-permission-registry.js'),Access=require('../service/app-access.js');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'vetro-permission-registry-'));
const dbroot=path.join(root,'dbspace'),globalDb=path.join(dbroot,'.pkgmgr_parser.db');
const uid=process.getuid?process.getuid():5001,ownerDb=path.join(dbroot,'user',String(uid),'.pkgmgr_parser.db');
const calls=[];
fs.mkdirSync(path.dirname(ownerDb),{recursive:true});
// Run the actual generated shell command with a SQLite CLI adapter backed by
// Python's SQLite. No metadata/dependency/icon tables exist in these fixtures.
fs.writeFileSync(path.join(root,'sqlite3'),`#!/usr/bin/env python3
import sqlite3, sys
from urllib.parse import quote
try:
    assert sys.argv[1] == '-readonly'
    db = sqlite3.connect('file:' + quote(sys.argv[2]) + '?mode=ro', uri=True)
    for row in db.execute(sys.argv[3]):
        print('|'.join('' if item is None else str(item) for item in row))
    db.close()
except Exception as e:
    print(str(e), file=sys.stderr)
    sys.exit(1)
`,{mode:0o700});
function sql(file,statements){
    const r=cp.spawnSync('python3',['-c',
        'import json,sqlite3,sys\nf,s=json.load(sys.stdin)\nc=sqlite3.connect(f)\nfor q,p in s: c.execute(q,p)\nc.commit()\nc.close()'],
        {input:JSON.stringify([file,statements]),encoding:'utf8'});
    assert.equal(r.status,0,r.stderr);
}
function execute(command,timeout){
    calls.push({command,timeout});
    const r=cp.spawnSync('sh',['-c',command.replace(/\/opt\/dbspace/g,dbroot)],
        {encoding:'utf8',timeout,env:{...process.env,PATH:root+path.delimiter+process.env.PATH},maxBuffer:3*1024*1024});
    return Promise.resolve({exit_code:r.status,timed_out:!!r.error,stdout:r.stdout,stderr:r.stderr});
}
function pkg(id,system='false',preload='false',version='1.0'){
    sql(globalDb,[['INSERT INTO package_info VALUES(?,?,?,?)',[id,version,system,preload]]]);
}
function app(id,packageId,overrides={}){
    const r={type:'wgt',component:'uiapp',disabled:'false',removable:'true',nodisplay:'false',...overrides};
    sql(globalDb,[['INSERT INTO package_app_info VALUES(?,?,?,?,?,?,?)',[id,packageId,r.type,r.component,r.disabled,r.removable,r.nodisplay]]]);
}
function load(probe={apps:[]}){return registry.load(execute,probe);}
function row(d,id){return d.apps.find(a=>a.appId===id);}
const encoded=values=>values.map(value=>Buffer.from(value).toString('hex')).join('|');
(async()=>{
    sql(globalDb,[
        ['CREATE TABLE package_info(package TEXT,package_version TEXT,package_system TEXT,package_preload TEXT)',[]],
        ['CREATE TABLE package_app_info(app_id TEXT,package TEXT,app_type TEXT,app_component TEXT,app_disable TEXT,app_removable TEXT,app_nodisplay TEXT)',[]],
        ['CREATE TABLE package_app_info_for_uid(app_id TEXT,uid INTEGER,is_disabled TEXT)',[]]
    ]);
    pkg('garage.pkg');pkg('media.pkg','true','true','7.2');pkg('mixed.pkg');pkg('unknown.pkg',null,null);
    app('garage.app','garage.pkg');app('garage.service','garage.pkg',{component:'svcapp',nodisplay:'true'});
    app('media.app','media.pkg',{removable:'false'});
    app('mixed.app','mixed.pkg');app('com.samsung.tv.coba.adagent','mixed.pkg',{component:'svcapp',nodisplay:'true'});
    app('unknown.app','unknown.pkg');
    app('hidden.app','garage.pkg',{nodisplay:'true'});
    app('flagless.app','garage.pkg',{disabled:null,nodisplay:null});
    let d=await load({apps:[{id:'garage.app',name:'Garage | 日本語',packageId:'forged.pkg',show:false,system:true},{id:'probe.only',name:'Not installed'}]});
    assert.equal(calls.length,1);assert.equal(calls[0].timeout,4000);
    assert.match(calls[0].command,/sqlite3 -readonly/);
    assert.doesNotMatch(calls[0].command,/package_dependency_info|package_app_localized_info|app_icon|package_size|author_name/);
    assert.equal(d.apps.length,8);assert.equal(row(d,'garage.app').name,'Garage | 日本語');
    assert.equal(row(d,'garage.app').packageId,'garage.pkg');assert.equal(row(d,'garage.app').show,true);
    assert.equal(row(d,'probe.only'),undefined);
    assert.equal(Access.userApp(row(d,'garage.app'),d.apps),true);
    assert.equal(Access.userApp(row(d,'media.app'),d.apps),false);
    assert.equal(Access.launchableApp(row(d,'media.app'),d.apps),true,'preinstalled launch targets remain eligible');
    assert.equal(row(d,'media.app').version,'7.2');
    assert.equal(row(d,'com.samsung.tv.coba.adagent').protected,true);
    assert.equal(Access.userApp(row(d,'mixed.app'),d.apps),false,'hidden protected siblings block caller eligibility');
    assert.equal(Access.launchableApp(row(d,'mixed.app'),d.apps),false,'hidden protected siblings also block launch targets');
    assert.equal(Access.userApp(row(d,'hidden.app'),d.apps),false);
    assert.equal(Access.userApp(row(d,'garage.service'),d.apps),false);
    assert.equal(row(d,'flagless.app').disabled,null);assert.equal(row(d,'flagless.app').show,null);
    assert.equal(row(d,'unknown.app').system,null);assert.equal(row(d,'unknown.app').preload,null);
    assert.equal(Access.userApp(row(d,'unknown.app'),d.apps),false);
    assert.equal(Access.launchableApp(row(d,'unknown.app'),d.apps),false);

    // Every call is live; no cached flags or versions authorize the next call.
    sql(globalDb,[['UPDATE package_app_info SET app_disable=? WHERE app_id=?',['true','garage.app']],
        ['UPDATE package_info SET package_version=? WHERE package=?',['2.0','garage.pkg']]]);
    d=await load();assert.equal(row(d,'garage.app').disabled,true);assert.equal(row(d,'garage.app').version,'2.0');
    sql(globalDb,[['INSERT INTO package_app_info_for_uid VALUES(?,?,?)',['garage.app',uid,'false']]]);
    d=await load();assert.equal(row(d,'garage.app').disabled,false,'global per-owner value overrides app default');
    sql(ownerDb,[['CREATE TABLE package_app_info_for_uid(app_id TEXT,uid INTEGER,is_disabled TEXT)',[]],
        ['INSERT INTO package_app_info_for_uid VALUES(?,?,?)',['garage.app',uid,'true']],
        ['INSERT INTO package_app_info_for_uid VALUES(?,?,?)',['garage.app',uid+1,'false']]]);
    d=await load();assert.equal(row(d,'garage.app').disabled,true,'owner database wins over global per-owner value');
    sql(ownerDb,[['UPDATE package_app_info_for_uid SET is_disabled=NULL WHERE uid=?',[uid]]]);
    d=await load();assert.equal(row(d,'garage.app').disabled,null,'unknown owner value must not become enabled');
    sql(ownerDb,[['INSERT INTO package_app_info_for_uid VALUES(?,?,?)',['garage.app',uid,'false']]]);
    await assert.rejects(load(),/Invalid owner/);
    sql(ownerDb,[['DROP TABLE package_app_info_for_uid',[]]]);
    await assert.rejects(load(),/unavailable/,'existing owner DB with missing schema fails closed');
    fs.unlinkSync(ownerDb);d=await load();assert.equal(row(d,'garage.app').disabled,false,'missing owner DB has no overrides');
    sql(globalDb,[['INSERT INTO package_app_info_for_uid VALUES(?,?,?)',['garage.app',uid,'true']]]);
    await assert.rejects(load(),/Invalid app/,'ambiguous global owner values fail closed');
    sql(globalDb,[['DELETE FROM package_app_info_for_uid',[]],['ALTER TABLE package_app_info RENAME TO broken_app_info',[]]]);
    await assert.rejects(load(),/unavailable/,'required global schema fails closed');
    sql(globalDb,[['ALTER TABLE broken_app_info RENAME TO package_app_info',[]],['DROP TABLE package_info',[]]]);
    await assert.rejects(load(),/unavailable/,'missing package facts do not use the public probe');

    const valid=encoded(['base','garage.app','garage.pkg','wgt','uiapp','false','true','1','false','false','false']);
    const complete=encoded(['complete']);
    for(const stdout of [valid,valid+'\n'+complete+'\n'+valid,valid+'\n'+valid+'\n'+complete,'not hex\n'+complete,
        encoded(['base','invalid id','garage.pkg','wgt','uiapp','false','true','1','false','false','false'])+'\n'+complete]) {
        await assert.rejects(registry.load(()=>Promise.resolve({exit_code:0,stdout})),/registry/);
    }
    for(const result of [null,{exit_code:1,stdout:complete},{exit_code:0,timed_out:true,stdout:complete},{exit_code:0,stdout:42},
        {exit_code:0,stdout:'0'.repeat(2*1024*1024+1)}])await assert.rejects(registry.load(()=>Promise.resolve(result)),/unavailable/);
    await assert.rejects(registry.load(()=>Promise.reject(Error('Agent offline'))),/offline/);
    console.log('PASS permission registry: live SQLite facts, all protected siblings, per-user disabled precedence, preinstalled targets, no probe authority, bounded read, schema/duplicate/truncation failures closed');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>fs.rmSync(root,{recursive:true,force:true}));
