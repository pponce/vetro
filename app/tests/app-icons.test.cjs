'use strict';
const assert=require('assert').strict,fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto'),zlib=require('zlib');
const Icons=require('../service/app-icons'),API=require('../service/app-api'),Access=require('../service/app-access');
const fixture=require('./app-access-fixture.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'vetro-icons-'));
function crc(data){let c=0xffffffff;for(const b of data){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function chunk(type,data){const body=Buffer.concat([Buffer.from(type),data]),n=Buffer.alloc(4),sum=Buffer.alloc(4);n.writeUInt32BE(data.length);sum.writeUInt32BE(crc(body));return Buffer.concat([n,body,sum]);}
function png(extra=0){const header=Buffer.alloc(13);header.writeUInt32BE(1,0);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('tEXt',Buffer.from('fixture\0'+'x'.repeat(extra))),chunk('IDAT',zlib.deflateSync(Buffer.from([0,255,0,0,255]))),chunk('IEND',Buffer.alloc(0))]);}
const map=p=>p.startsWith('/opt/')?root+p:p;
const io={...fs,realpathSync:p=>fs.realpathSync(map(p))};
const store='/opt/share/webappservice/apps_icon/all';
function write(id,data,name='224x224.png'){const file=map(store+'/'+id+'/'+name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,data);return file;}
const metadata={entries:[{id:'111',appId:'media.app',name:'Media',visible:true}],order:[]};
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
    const small=png(),large=png(19000);write('111',large);
    let now=1;const reader=Icons.createReader({fs:io,now:()=>now});
    assert.ok(Icons.png(large));assert.equal(reader('media.app',metadata).revision,hash(large));
    assert.equal(reader('absent.app',metadata),null);
    assert.equal(reader('media.app',{entries:[{id:'../../secret',appId:'media.app',visible:true}]}),null,'database IDs cannot escape the fixed icon root');
    assert.equal(reader('media.app',{entries:[{id:'111',appId:'media.app',visible:false}]}),null);
    write('111',small);assert.equal(reader('media.app',metadata).revision,hash(large),'chunks retain one cached image');
    now+=120001;assert.equal(reader('media.app',metadata).revision,hash(small));
    const escaped=path.join(root,'private.png');fs.writeFileSync(escaped,small);
    const linked=write('222',small);fs.unlinkSync(linked);fs.symlinkSync(escaped,linked);
    assert.equal(reader('media.app',{entries:[{id:'222',appId:'media.app',visible:true}]}),null,'symlinks outside artwork storage are not read');
    for(const [id,data] of [['333',Buffer.alloc(131073)],['444',Buffer.from('<svg/>')],['555',Buffer.from(small)]]) {
        if(id==='555')data.writeUInt32BE(100000,16);
        write(id,data);assert.equal(reader('media.app',{entries:[{id,appId:'media.app',visible:true}]}),null);
    }
    write('333',small,'104x104.png');now+=120001;
    assert.equal(reader('media.app',{entries:[{id:'333',appId:'media.app',visible:true}]}).revision,hash(small),'smaller valid artwork is used when the preferred image is too large');
    const plus=map('/opt/usr/apps/com.samsung.tv.tvPlusDeeplinker/shared/res/TVPlus_app_icon.png');
    fs.mkdirSync(path.dirname(plus),{recursive:true});fs.writeFileSync(plus,small);
    assert.equal(reader('com.samsung.tv.tvPlusDeeplinker',{entries:[]}).revision,hash(small));
    const f=fixture();
    try {
        write('111',large);now+=120001;
        const options={catalog:async()=>metadata,icons:reader};f.options.perform=API.create(options);
        assert.equal(Access.METHODS['apps.icon'],'apps.read');
        await f.approve(['apps.launch']);
        await assert.rejects(f.access.call('garage.app','apps.icon',{appId:'media.app'}),e=>e.code==='permission_denied');
        await f.approve(['apps.read']);
        assert.equal((await f.access.call('garage.app','apps.catalog',{})).iconSupport,true);
        let offset=0,revision,parts=[];
        do {
            const params={appId:'media.app',offset};if(revision)params.revision=revision;
            const response=await f.access.call('garage.app','apps.icon',params);
            assert.equal(response.mimeType,'image/png');assert.equal(response.totalBytes,large.length);
            assert.ok(Buffer.byteLength(JSON.stringify({version:2,id:'1',ok:true,result:response}))<16384,'image chunks fit the authenticated reply limit');
            assert.ok(!JSON.stringify(response).includes('/opt/'),'filesystem paths do not cross the API');
            if(revision)assert.equal(response.revision,revision);revision=response.revision;
            parts.push(Buffer.from(response.data,'base64'));offset=response.nextOffset;
        }while(offset!==null);
        assert.deepEqual(Buffer.concat(parts),large,'unlisted-in-Home app artwork is delivered exactly');
        f.advance(10001);
        for(const params of [{appId:'media.app',path:'/etc/passwd'},{appId:'media.app',offset:-1},{appId:'media.app',offset:1},
            {appId:'media.app',offset:8192},{appId:'media.app',revision:[revision]},{appId:'media.app',offset:131072,revision}])
            await assert.rejects(f.access.call('garage.app','apps.icon',params),e=>e.code==='invalid_request');
        await assert.rejects(f.access.call('garage.app','apps.icon',{appId:'garage.app'}),e=>e.code==='not_allowed','registry-only entries are not icon targets');
        f.rows[1].disabled=true;
        await assert.rejects(f.access.call('garage.app','apps.icon',{appId:'media.app'}),e=>e.code==='not_allowed');
        f.rows[1].disabled=false;f.rows[1].protected=true;
        await assert.rejects(f.access.call('garage.app','apps.icon',{appId:'media.app'}),e=>e.code==='not_allowed');
        f.rows[1].protected=false;
        write('111',small);now+=120001;
        await assert.rejects(f.access.call('garage.app','apps.icon',{appId:'media.app',offset:8192,revision}),e=>e.code==='icon_changed');
        fs.unlinkSync(map(store+'/111/224x224.png'));now+=120001;
        assert.deepEqual(await f.access.call('garage.app','apps.icon',{appId:'media.app'}),{appId:'media.app',icon:null});
        let release;options.icons=()=>new Promise(r=>{release=()=>r({data:small,revision:hash(small)});});
        const pending=f.access.call('garage.app','apps.icon',{appId:'media.app'});await new Promise(setImmediate);
        await f.access.admin({action:'revoke',appId:'garage.app',expectedRevision:f.access.state.revision});
        release();await assert.rejects(pending,e=>e.code==='permission_denied','revocation during an icon read withholds the image');
    } finally {f.close();}
    console.log('PASS app icons: fixed storage, PNG bounds, symlink confinement, chunks, integrity, unpinned apps, eligibility and revocation');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>fs.rmSync(root,{recursive:true,force:true}));
