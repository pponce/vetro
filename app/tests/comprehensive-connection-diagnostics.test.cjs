'use strict';
const assert=require('assert').strict,vm=require('vm'),fs=require('fs');
const fixture=require('./app-access-fixture.cjs');
const {start,WIDGET_PORT,WIDGET_REPLY_PORT}=require('../service/app-ports');
const {Diagnostics}=require('../service/connection-diagnostics');
const Client=require('../service/app-access-client');
const {Report,screen,failure}=require('../service/message-reply-diagnostics');
const UI='vetrotvapp.app',SVC='vetrotvapp.svc',token='a'.repeat(64);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const foreign=vm.createContext({});
const ForeignArray=vm.runInContext('Array',foreign);
const nativeCopy=data=>vm.runInContext('JSON.parse('+JSON.stringify(JSON.stringify(data))+')',foreign);
function bus(mode) {
    const apps=new Map(),sent=[];
    for(const id of [UI,SVC,'other.app'])apps.set(id,new Map());
    function local(owner,name,trusted) {
        const map=apps.get(owner);
        if(map.has(name))return map.get(name);
        const port={messagePortName:name,isTrusted:trusted,owner,handlers:new Map(),
            addMessagePortListener(fn){const id=this.handlers.size;this.handlers.set(id,fn);return id;},
            removeMessagePortListener(id){this.handlers.delete(id);}};
        map.set(name,port);return port;
    }
    function remote(sender,recipient,name,trusted,kind) {
        const port=apps.get(recipient).get(name);
        if(!port||port.isTrusted!==trusted)throw Error('Port not found');
        return {appId:recipient,messagePortName:name,isTrusted:trusted,sendMessage(data,source){
            sent.push({sender,kind,source:!!source,data});
            if(sender===SVC) {
                let reason=null;
                if(mode==='source'&&source)reason='localMessagePort has an incompatible platform object';
                if(mode==='callback'&&kind==='callback')reason='Invalid receiver';
                if(mode==='value-array'&&!Array.isArray(data[0].value))reason='data value must be an array';
                if(mode==='native-array'&&!(data instanceof ForeignArray))reason='data must be a runtime array';
                if(reason)throw Object.assign(Error(reason+' '+JSON.stringify(data)),{name:'TypeMismatchError'});
            }
            const metadata=source?remote(recipient,sender,source.messagePortName,source.isTrusted,'callback'):null;
            setImmediate(()=>port.handlers.forEach(fn=>fn(nativeCopy(data),metadata)));
        }};
    }
    function api(owner){return {
        requestLocalMessagePort:n=>local(owner,n,false),requestTrustedLocalMessagePort:n=>local(owner,n,true),
        requestRemoteMessagePort:(id,n)=>remote(owner,id,n,false,'lookup'),
        requestTrustedRemoteMessagePort:(id,n)=>remote(owner,id,n,true,'lookup')
    };}
    return {api,apps,sent};
}
(async()=>{
for(const mode of ['source','callback','value-array','native-array']) {
    const f=fixture(),network=bus(mode),d=new Diagnostics({connectionDiagnostics:true});
    f.tizen.messageport=network.api(SVC);
    let issued=0;
    const handle=start(f.tizen,f.access,{issueWidget(){issued++;return {token,expires:Date.now()+60000};}},d);
    const context=vm.createContext({document:{hidden:false},running:false,report:{probe:{serviceLaunch:{ok:false,error:'no answer in 8 s'}},apps:['SECRET_INVENTORY']},
        screenError:'No confirmation',pairingError:'No confirmation',widgetCredential:null,Date,console});
    vm.runInContext(fs.readFileSync(require.resolve('../service/connection-debug-client.js'),'utf8'),context);
    const client=new Client({widget:true,tizen:{messageport:network.api(UI)},timeout:1000,diagnostics:context.VetroConnectionDiagnostics});
    let settled=false;
    const pending=client.call('widget.connect',{}).then(()=>{settled=true;},()=>{settled=true;});
    try {
        for(let i=0;i<8;i++)await tick();
        const report=d.snapshot(),detail=report.widget.replyDiagnostics;
        assert.equal(issued,1,'fixed test messages never issue extra credentials');
        assert.equal(detail.schema,2);assert.equal(detail.tests.length,12);
        assert.equal(detail.initialError.name,'TypeMismatchError');
        assert.ok(detail.initialError.message.length>0);assert.ok(detail.initialError.stack.length>0);
        assert.equal(detail.actualCall.tokenLength,64);
        assert.equal(detail.actualCall.requestUsesServiceArrayPrototype,false);
        assert.equal(detail.actualCall.requestItemUsesServiceObjectPrototype,false);
        assert.ok(detail.tests.some(t=>t.returned&&t.observed),'successful native calls are observed on the screen');
        assert.ok(detail.tests.some(t=>!t.returned&&!t.observed),'failed calls are distinguished from delivery');
        assert.equal(settled,false,'probe receipts do not resolve the pending authentication request');
        assert.equal(report.screen.client.trusted,true);assert.equal(report.screen.visible,true);
        assert.equal(report.screen.checks.serviceLaunch.error,'no answer in 8 s');
        if(mode==='source')assert.ok(detail.tests.filter(t=>t.observed).every(t=>t.label.includes('no-source')&&t.observation.sourcePresent===false));
        if(mode==='callback')assert.ok(detail.tests.filter(t=>t.observed).every(t=>t.label.startsWith('lookup/')));
        if(mode==='value-array')assert.ok(detail.tests.filter(t=>t.observed).every(t=>t.valueArray));
        if(mode==='native-array')assert.ok(detail.tests.filter(t=>t.observed).every(t=>t.nativeArray));
        const serialized=JSON.stringify(report);
        assert.ok(!serialized.includes(token));assert.ok(!serialized.includes('SECRET_INVENTORY'));
        assert.ok(!serialized.includes('vetro_diagnostic'),'wire messages and nonces are not report fields');
        assert.equal(d.replyReport.ack({nonce:'b'.repeat(24)},{appId:UI,messagePortName:client.local.messagePortName,isTrusted:false}),false);
        const before=JSON.stringify(d.snapshot().screen);
        assert.equal(d.consume({method:'diagnostic.screen',params:{visible:false}},{appId:'other.app',isTrusted:false}),false);
        assert.equal(JSON.stringify(d.snapshot().screen),before);
        const count=network.sent.filter(x=>x.sender===SVC).length;
        d.replyFailure(f.tizen,null,null,null,'{}',Object.assign(Error('again'),{name:'TypeMismatchError'}));
        assert.equal(network.sent.filter(x=>x.sender===SVC).length,count,'one bounded matrix per service');
    }finally{client.close();await pending;handle.stop();f.close();}
}
const disabled=new Diagnostics();
assert.equal(disabled.consume({method:'diagnostic.screen',params:{}},{appId:UI,isTrusted:false}),false);
disabled.replyFailure(null,null,null,null,'{}',Object.assign(Error('fail'),{name:'TypeMismatchError'}));
assert.equal(disabled.replyReportStarted,false,'ordinary builds run no active probes');
const sanitized=screen({sourceRevision:'not-a-revision',screenError:token+' 123456',client:{sequence:Infinity},checks:{serviceLaunch:{ok:false,error:token}},apps:['private']});
assert.equal(sanitized.sourceRevision,null);assert.equal(sanitized.client.sequence,null);
assert.ok(!JSON.stringify(sanitized).includes(token));assert.ok(!JSON.stringify(sanitized).includes('123456'));assert.equal(sanitized.apps,undefined);
const e=failure(Object.assign(Error('credential '+token),{name:'UnknownSecretClass'}),[]);
assert.equal(e.name,'Error');assert.ok(!JSON.stringify(e).includes(token));
console.log('PASS comprehensive connection report: 12 reply cases, screen receipts including absent source, native runtime arrays, exact identity, opt-in and once-only probes, no credential retries or disclosure');
})().catch(e=>{console.error(e);process.exitCode=1;});
