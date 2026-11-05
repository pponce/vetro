'use strict';
const assert=require('assert').strict, fs=require('fs'), path=require('path'), os=require('os'), cp=require('child_process');
const Catalog=require('../service/app-launcher-catalog'), Access=require('../service/app-access');
const fixture=require('./app-access-fixture.cjs'), API=require('../service/app-api');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'vetro-consumer-catalog-'));
const hex=s=>Buffer.from(s).toString('hex');
const record=(id,name,appId,hidden=0)=>['R',hex(id),hex(name),hex(appId),hidden].join('|');
const home=items=>['H1|1',...items.map(x=>'H1|'+x),'H1|EOFCOBA'];
const wire=(records,items=[])=>['CATALOG1',...home(items),...records,'COMPLETE',''].join('\n');
const make=id=>({appId:id,packageId:id+'.pkg',name:'App',version:'1',show:true,disabled:false,registryVerified:true,
    system:true,preload:true,removable:false,component:'uiapp',protected:false});
const ids=['com.samsung.tv.cobalt-yt','org.tizen.netflix-app','other.app','disabled.app','hidden.app',
    'protected.app','unknown.app','com.samsung.tv.cobalt-app-2146','com.samsung.tv.tvPlusDeeplinker'];
const rows=ids.map(make);
rows.find(r=>r.appId==='disabled.app').disabled=true;
rows.find(r=>r.appId==='protected.app').protected=true;
rows.find(r=>r.appId==='unknown.app').registryVerified=false;
const records=[record('yt','YouTube',ids[0]),record('nf','Netflix',ids[1]),record('other','Other',ids[2]),
    record('disabled','Disabled','disabled.app'),record('hidden','Hidden','hidden.app',1),
    record('protected','Protected','protected.app'),record('unknown','Unknown','unknown.app'),
    record('notinstalled','Store suggestion','absent.app'),record('bad','Bad','bad;id'),
    record('alias','Old Netflix title',ids[1]),record('uncertain','Unknown visibility','hidden.app','unknown')];
const text=wire(records,['d/webapp@nf','s/source.layer.hdmi@HDMI1','s/livetv@TVPLUS']);
const allowed=()=>rows.filter(r=>Access.launchableApp(r,rows));
function sql(db, statements) {
    const r=cp.spawnSync('python3',['-c','import json,sqlite3,sys\np,s=json.load(sys.stdin)\nc=sqlite3.connect(p)\nfor q,a in s: c.execute(q,a)\nc.commit()\nc.close()'],
        {input:JSON.stringify([db,statements]),encoding:'utf8'});
    assert.equal(r.status,0,r.stderr);
}
(async()=>{
    let catalog=Catalog.build(Catalog.parse(text),allowed());
    assert.deepEqual(catalog.apps.map(r=>[r.appId,r.name,r.homeOrder]),[
        [ids[1],'Netflix',0],[ids[8],'Samsung TV Plus',2],[ids[2],'Other',null],[ids[0],'YouTube',null]
    ],'full Apps catalog includes unpinned apps; Home order seeds the selection; registry-only components are excluded');
    assert.match(catalog.revision,/^[a-f0-9]{64}$/);
    assert.equal(Catalog.build(Catalog.parse(text),allowed()).revision,catalog.revision);
    assert.notEqual(Catalog.build(Catalog.parse(wire(records,[])),allowed()).revision,catalog.revision);
    assert.deepEqual(Object.keys(catalog.apps[0]),['appId','name','disabled','homeOrder']);
    assert.equal(Access.METHODS['apps.catalog'],'apps.read');
    const fallback=text.replace('H1|EOFCOBA','H1|BROKEN').replace('COMPLETE','H2|2\nH2|d/webapp@yt\nH2|EOFC OBA\nCOMPLETE');
    assert.deepEqual(Catalog.parse(fallback).order,['d/webapp@yt'],'second Home cache supports recovery');
    for(const malformed of [text.replace('COMPLETE',''),text+'R|00|00|00|0\n',text.replace('H1|EOFCOBA','H1|broken'),
        text.replace(hex('Netflix'),'zz'),wire(Array(2001).fill(record('x','X','x.app'))),'x'.repeat(2*1024*1024+1)])
        assert.throws(()=>Catalog.parse(malformed));
    assert.equal(Catalog.build(Catalog.parse(wire([])),allowed()).apps.length,0,'valid empty catalog remains empty');

    // Run the exact fixed read script against real SQLite and Home-cache fixtures.
    const homeDir=path.join(root,'opt/usr/home/owner/apps_rw/com.samsung.tv.home.media/data');
    const db=path.join(root,'opt/dbspace/.webappservice.db');
    fs.mkdirSync(homeDir,{recursive:true});fs.mkdirSync(path.dirname(db),{recursive:true});
    fs.writeFileSync(path.join(homeDir,'.appLayerCache.2'),'1\nd/webapp@nf\nEOFCOBA\n');
    sql(db,[['CREATE TABLE widgetinfo(id TEXT,title TEXT,tizen_id TEXT,is_hidden INTEGER)',[]],
        ['INSERT INTO widgetinfo VALUES(?,?,?,?)',['nf','Netflix',ids[1],0]],
        ['INSERT INTO widgetinfo VALUES(?,?,?,?)',['yt','YouTube',ids[0],0]]]);
    fs.writeFileSync(path.join(root,'sqlite3'),`#!/usr/bin/env python3
import sqlite3,sys
from urllib.parse import quote
assert sys.argv[1]=='-readonly'
db=sqlite3.connect('file:'+quote(sys.argv[2])+'?mode=ro',uri=True)
for row in db.execute(sys.argv[3]): print('|'.join(str(x) for x in row))
`,{mode:0o700});
    let calls=0;
    function execute(command,timeout) {
        calls++;assert.equal(timeout,6000);
        const shell=Buffer.from(command.split(' ')[1],'base64').toString();
        assert.equal(shell,Catalog.script());
        const r=cp.spawnSync('sh',['-c',shell.replace(/\/opt\//g,root+'/opt/')],
            {encoding:'utf8',timeout,env:{...process.env,PATH:root+':'+process.env.PATH}});
        return Promise.resolve({exit_code:r.status,stdout:r.stdout,timed_out:!!r.error});
    }
    const before=fs.readFileSync(db),cacheBefore=fs.readFileSync(path.join(homeDir,'.appLayerCache.2'));
    const read=Catalog.createReader(execute);
    const [a,b]=await Promise.all([read(true),read(true)]);
    assert.equal(calls,1);assert.equal(a,b);assert.equal(a.entries.length,2);
    await read(false);assert.equal(calls,1);
    assert.deepEqual(fs.readFileSync(db),before,'catalog reads leave the database unchanged');
    sql(db,[['INSERT INTO widgetinfo VALUES(?,?,?,?)',['other','Other',ids[2],0]]]);
    assert.equal((await read(true)).entries.length,3);assert.equal(calls,2);
    assert.deepEqual(fs.readFileSync(path.join(homeDir,'.appLayerCache.2')),cacheBefore);
    assert.doesNotMatch(Catalog.script(),/INSERT|UPDATE|DELETE|chmod|cp |mv |app_launcher|icon/);
    assert.ok(before.length>0);
    fs.unlinkSync(db);await assert.rejects(read(true));
    await assert.rejects(Catalog.createReader(async()=>({exit_code:0,timed_out:true,stdout:text}))(true));
    await assert.rejects(Catalog.createReader(async()=>({exit_code:0,stdout:text.replace('COMPLETE','')}))(true));

    // Actual scoped API: pagination over 100, live eligibility, and revocation
    // during asynchronous metadata reads. No launch/task authority is added.
    const f=fixture();
    try {
        const metadata=Catalog.parse(text);
        f.rows.push(...rows);
        for(let i=0;i<125;i++) {
            const id='extra.app'+i;f.rows.push(make(id));metadata.entries.push({id,name:'App '+i,appId:id,visible:true});
        }
        const options={catalog:async()=>metadata};f.options.perform=API.create(options);
        await f.approve(['apps.read']);
        let all=[],offset=0,revision;
        do {
            const page=await f.access.call('garage.app','apps.catalog',{offset,limit:20});
            assert.equal(page.source,'samsung-apps');
            if(revision)assert.equal(page.revision,revision);revision=page.revision;
            all=all.concat(page.apps);offset=page.nextOffset;
        }while(offset!==null);
        assert.equal(all.length,129);assert.ok(all.some(a=>a.appId===ids[1]));
        await assert.rejects(f.access.call('garage.app','apps.launch',{appId:ids[1]}),e=>e.code==='permission_denied');
        f.rows.find(r=>r.appId===ids[1]).disabled=true;
        const changed=await f.access.call('garage.app','apps.catalog',{});
        assert.notEqual(changed.revision,revision);assert.ok(!changed.apps.some(a=>a.appId===ids[1]));
        await assert.rejects(f.access.call('garage.app','apps.catalog',{path:'/etc/passwd'}),e=>e.code==='invalid_request');
        let release;options.catalog=()=>new Promise(resolve=>{release=()=>resolve(metadata);});
        const pending=f.access.call('garage.app','apps.catalog',{});await new Promise(r=>setImmediate(r));
        await f.access.admin({action:'revoke',appId:'garage.app',expectedRevision:f.access.state.revision});
        release();await assert.rejects(pending,e=>e.code==='permission_denied');
        await assert.rejects(f.access.call('garage.app','apps.catalog',{}),e=>e.code==='permission_denied');
    }finally{f.close();}
    console.log('PASS Samsung Apps catalog: real read-only SQLite, both Home caches, unpinned apps, eligibility, safe metadata, complete pagination and revocation');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>fs.rmSync(root,{recursive:true,force:true}));
