'use strict';
const assert=require('assert').strict,fs=require('fs'),path=require('path'),http=require('http');
const fixture=require('./app-access-fixture.cjs');
const {Auth}=require('../service/auth');
const {Publisher,FILE}=require('../service/widget-bootstrap');
const Client=require('../service/widget-bootstrap-client');
const {Diagnostics}=require('../service/connection-diagnostics');

function reader(directory,allowed=true){return {filesystem:{resolve(root,ok,fail,mode){
    assert.equal(root,'wgt-private');assert.equal(mode,'r');
    if(!allowed)return fail({name:'SecurityError',message:'private information'});
    ok({resolve(name){assert.equal(name,FILE);const file=path.join(directory,name),stat=fs.statSync(file);
        return {isFile:stat.isFile(),fileSize:stat.size,readAsText(done,error,encoding){assert.equal(encoding,'UTF-8');done(fs.readFileSync(file,'utf8'));}};}});
}}};}
function gate(auth,token,route='/screen',address='127.0.0.1'){
    let code,body;const req={method:'GET',headers:{host:'127.0.0.1:8099',origin:'null','x-vetro-widget':token},socket:{remoteAddress:address}};
    const blocked=auth.gate(req,{writeHead(status){code=status;},end(text){body=JSON.parse(text);}},route);
    return {blocked,code,body};
}
async function badRecord(record,size){
    const text=typeof record==='string'?record:JSON.stringify(record);
    let read=false;
    const api={filesystem:{resolve(root,ok){ok({resolve(){return {isFile:true,fileSize:size===undefined?text.length:size,
        readAsText(done){read=true;done(text);}};}});}}};
    await assert.rejects(Client.read(api,100),/Private widget credential/);
    return read;
}

(async()=>{
    const f=fixture();let now=Date.now();
    const auth=new Auth({file:path.join(f.dir,'owner.json'),now:()=>now}),d=new Diagnostics();
    const publisher=new Publisher(auth,d),file=path.join(f.dir,FILE);
    try {
        publisher.start(f.dir);
        assert.equal(d.snapshot().widgetBootstrap.ready,true);
        assert.equal(fs.statSync(file).mode&511,384,'credential file is mode 0600');
        const first=await Client.read(reader(f.dir),100);
        assert.equal(gate(auth,first.token).blocked,false);
        assert.equal(gate(auth,first.token,'/screen','192.0.2.9').code,401,'LAN clients cannot use a widget credential');
        for(const route of ['/exec','/app-access','/apps','/install','/auth/devices'])assert.equal(gate(auth,first.token,route).code,403);
        assert.equal(auth.session({headers:{authorization:'Bearer '+first.token}}),null,'widget credential never grants owner access');
        for(let i=0;i<20;i++)auth.issueWidget();
        assert.equal(gate(auth,first.token).blocked,false,'MessagePort requests cannot evict the private credential');
        publisher.start(f.dir);assert.equal(d.snapshot().widgetBootstrap.publications,1,'lifecycle requests do not republish');
        now+=120000;publisher.publish();const second=JSON.parse(fs.readFileSync(file));
        assert.notEqual(second.token,first.token);assert.equal(gate(auth,first.token).blocked,false,'unexpired readers survive rotation');
        now+=180001;assert.equal(gate(auth,first.token).code,401);assert.equal(gate(auth,second.token).blocked,false);
        assert.ok(!JSON.stringify(d.snapshot()).includes(first.token));assert.ok(!JSON.stringify(d.snapshot()).includes(second.token));
        await assert.rejects(Client.read(reader(f.dir,false),100),error=>!error.message.includes('private information'));

        // A write failure closes this channel and removes its temporary file.
        const rename=fs.renameSync;
        try {fs.renameSync=()=>{throw Error('synthetic failure');};publisher.publish();}
        finally {fs.renameSync=rename;}
        assert.equal(d.snapshot().widgetBootstrap.ready,false);assert.equal(gate(auth,second.token).code,401);
        assert.equal(fs.readdirSync(f.dir).filter(n=>n.includes('.tmp-')).length,0);
        publisher.publish();assert.equal(d.snapshot().widgetBootstrap.ready,true);
        const stale=JSON.parse(fs.readFileSync(file)).token;
        const restarted=new Auth({file:path.join(f.dir,'owner.json'),now:()=>now});
        assert.equal(gate(restarted,stale).code,401,'disk credentials do not survive service restart');
        const fresh=new Publisher(restarted);
        try {fresh.start(f.dir);const current=JSON.parse(fs.readFileSync(file)).token;
            publisher.stop();assert.equal(fs.existsSync(file),true,'old service cannot delete a newer credential');
            assert.equal(gate(restarted,current).blocked,false);
            fresh.stop();assert.equal(fs.existsSync(file),false);assert.equal(gate(restarted,current).code,401);
        }finally{fresh.stop();}

        // Do not follow an existing link or replace another file's contents.
        const target=path.join(f.dir,'unrelated');fs.writeFileSync(target,'unchanged');fs.symlinkSync(target,file);
        const linked=new Publisher(auth);
        try {linked.start(f.dir);assert.equal(linked.state.ready,false);assert.equal(fs.readFileSync(target,'utf8'),'unchanged');}
        finally {linked.stop();}
        assert.equal(fs.lstatSync(file).isSymbolicLink(),true);fs.unlinkSync(file);
        fs.writeFileSync(path.join(f.dir,'corrupt'),'invalid');
        const corrupt=new Publisher(new Auth({file:path.join(f.dir,'corrupt')}));
        try {corrupt.start(f.dir);assert.equal(corrupt.state.ready,false);assert.equal(fs.existsSync(file),false);}
        finally {corrupt.stop();}
    }finally{publisher.stop();f.close();}

    const valid={schema:1,token:'a'.repeat(64),expires:Date.now()+60000};
    for(const record of ['not-json',{...valid,schema:2},{...valid,token:'bad'},{...valid,expires:0},
        {...valid,expires:Date.now()+600000},{...valid,expires:'later'},null])await badRecord(record);
    assert.equal(await badRecord(valid,513),false,'oversized files are rejected before reading');
    await assert.rejects(Client.read({filesystem:{resolve(){}}},1),/timed out/);
    await assert.rejects(Client.read(null,100),/not available/);

    // Actual service, private file, screen reader, HTTP authentication and browser
    // pairing work even when every MessagePort creation is unavailable.
    const real=fixture();let server,service;
    try {
        real.tizen.messageport={requestLocalMessagePort(){throw Error('MessagePort unavailable');},requestTrustedLocalMessagePort(){throw Error('MessagePort unavailable');}};
        service=require('./service-harness.cjs')(path.resolve(__dirname,'..'),{tizen:real.tizen,setInterval:()=>({unref(){}})});
        assert.equal(service.context.connectionDiagnostics.snapshot().widgetBootstrap.ready,true);
        assert.equal(service.context.appPorts.ready,false);
        server=http.createServer(service.router);await new Promise(r=>server.listen(0,'127.0.0.1',r));
        const base='http://127.0.0.1:'+server.address().port;
        async function api(route,body,headers={}){
            const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
            return {status:response.status,body:await response.json()};
        }
        assert.equal((await api('/status')).status,401);
        const credential=await Client.read(reader(real.dir),100),widget={'X-Vetro-Widget':credential.token,Origin:'null'};
        assert.equal((await api('/status',undefined,widget)).status,200);
        assert.equal((await api('/app-access',undefined,widget)).status,403);
        const request=await api('/auth/pair',{name:'browser'});assert.equal(request.status,200);assert.equal(request.body.code,undefined);
        const pending=await api('/auth/pending',undefined,widget);assert.match(pending.body.code,/^\d{6}$/);
        const paired=await api('/auth/confirm',{id:request.body.id,code:pending.body.code});assert.equal(paired.status,200);
        const owner={Authorization:'Bearer '+paired.body.token};assert.equal((await api('/app-access',undefined,owner)).status,200);
        assert.ok(!fs.readFileSync(path.join(real.dir,'vetro-sign-in.json'),'utf8').includes(paired.body.token));
        assert.ok(!fs.readFileSync(path.join(real.dir,FILE),'utf8').includes(paired.body.token));
        assert.ok(!JSON.stringify(service.context.connectionDiagnostics.snapshot()).includes(credential.token));
    }finally{if(server)await new Promise(r=>server.close(r));if(service)service.lifecycle.onExit();real.close();}
    console.log('PASS private widget bootstrap: real HTTP pairing without MessagePort, private-file reader, scoped local credentials, rotation/expiry/restart, atomic writes, link refusal and no credential telemetry');
})().catch(error=>{console.error(error);process.exitCode=1;});
