'use strict';
const assert=require('assert').strict;
const fixture=require('./app-access-fixture.cjs');
const Client=require('../service/app-access-client');
const {start,WIDGET_PORT,WIDGET_REPLY_PORT,APP_PORT}=require('../service/app-ports');
const {Diagnostics}=require('../service/connection-diagnostics');
const UI='vetrotvapp.app',SVC='vetrotvapp.svc';
const flush=()=>new Promise(resolve=>setImmediate(resolve));

// Native metadata is derived from registered applications and ports, never data.
// Model the captured TV behavior: attaching a trusted local port drops delivery.
function transport() {
    const apps=new Map(),held=[];
    const state={dropTrustedReply:true,holdReplies:false,dropped:0};
    function app(id,certificate='author-A') {apps.set(id,{certificate,ports:new Map()});}
    function local(owner,name,trusted) {
        const ports=apps.get(owner).ports;
        if(ports.has(name))return ports.get(name);
        const p={owner,messagePortName:name,isTrusted:trusted,callback:null,
            addMessagePortListener(fn){this.callback=fn;return 0;},
            removeMessagePortListener(id){assert.equal(id,0);this.callback=null;}};
        ports.set(name,p);return p;
    }
    function remote(sender,recipient,name,trusted) {
        const target=apps.get(recipient),port=target&&target.ports.get(name);
        if(!port||port.isTrusted!==trusted)throw Object.assign(Error('Port not found'),{name:'NotFoundError'});
        if(trusted&&apps.get(sender).certificate!==target.certificate)throw Object.assign(Error('Certificate mismatch'),{name:'InvalidAccessError'});
        return Object.freeze({appId:recipient,messagePortName:name,isTrusted:trusted,
            sendMessage(data,source){
                if(source)assert.equal(source.owner,sender,'only a caller-owned return port can be attached');
                if(source&&source.isTrusted&&state.dropTrustedReply){state.dropped++;return;}
                const metadata=source?remote(recipient,sender,source.messagePortName,source.isTrusted):null;
                const deliver=()=>{if(port.callback)port.callback(JSON.parse(JSON.stringify(data)),metadata);};
                if(state.holdReplies&&sender===SVC&&recipient===UI)held.push(deliver);
                else setImmediate(deliver);
            }});
    }
    function api(owner) {return {
        requestLocalMessagePort:name=>local(owner,name,false),
        requestTrustedLocalMessagePort:name=>local(owner,name,true),
        requestRemoteMessagePort:(id,name)=>remote(owner,id,name,false),
        requestTrustedRemoteMessagePort:(id,name)=>remote(owner,id,name,true)
    };}
    return {app,api,apps,state,held};
}

(async()=>{
    const f=fixture(),bus=transport(),diag=new Diagnostics();
    for(const id of [UI,SVC,'other.same.signer'])bus.app(id);
    bus.app('other.signer','author-B');
    f.tizen.messageport=bus.api(SVC);
    let issued=0;
    const handle=start(f.tizen,f.access,{issueWidget(){issued++;return {token:'widget-'+issued,expires:Date.now()+60000};}},diag);
    const ui=bus.api(UI),other=bus.api('other.same.signer');
    const frame=(id,extra={})=>[{key:'json',value:JSON.stringify({version:1,id,method:'widget.connect',params:{},...extra})}];
    try {
        assert.equal(handle.ready,true);
        assert.equal(bus.apps.get(SVC).ports.get(WIDGET_PORT).isTrusted,true);
        assert.equal(bus.apps.get(SVC).ports.get(WIDGET_REPLY_PORT).isTrusted,false);
        assert.equal(typeof bus.apps.get(SVC).ports.get(WIDGET_REPLY_PORT).callback,'function','reply source stays registered');

        const legacy=ui.requestTrustedLocalMessagePort('legacy');legacy.addMessagePortListener(()=>{});
        ui.requestTrustedRemoteMessagePort(SVC,WIDGET_PORT).sendMessage(frame('legacy'),legacy);
        await flush();assert.equal(diag.snapshot().widget.received,0);assert.equal(bus.state.dropped,1);

        assert.throws(()=>bus.api('other.signer').requestTrustedRemoteMessagePort(SVC,WIDGET_PORT),{name:'InvalidAccessError'});
        const attacker=other.requestLocalMessagePort('attacker');attacker.addMessagePortListener(()=>{});
        other.requestTrustedRemoteMessagePort(SVC,WIDGET_PORT).sendMessage(frame('wrong-sender'),attacker);
        ui.requestTrustedRemoteMessagePort(SVC,WIDGET_PORT).sendMessage(frame('no-sender'));
        const uiPort=ui.requestLocalMessagePort('malformed');uiPort.addMessagePortListener(()=>{});
        ui.requestTrustedRemoteMessagePort(SVC,WIDGET_PORT).sendMessage(frame('claimed-identity',{appId:UI}),uiPort);
        ui.requestRemoteMessagePort(SVC,APP_PORT).sendMessage(frame('wrong-endpoint'),uiPort);
        ui.requestRemoteMessagePort(SVC,WIDGET_REPLY_PORT).sendMessage(frame('reply-source-is-inert'),uiPort);
        await flush();await flush();assert.equal(issued,0,'other identities, absent metadata, payload claims and ordinary API never issue a widget credential');

        bus.state.holdReplies=true;
        const client=new Client({widget:true,tizen:{messageport:ui},timeout:1000});
        assert.equal(client.local.isTrusted,false);
        let settled=false;
        const result=client.call('widget.connect',{}).then(value=>{settled=true;return value;});
        await flush();assert.equal(issued,1);assert.equal(bus.held.length,1);
        const requestId=Object.keys(client.pending)[0];
        const answer=[{key:'json',value:JSON.stringify({version:1,id:requestId,ok:true,appId:SVC,result:{token:'forged'}})}];
        const fakeSource=other.requestLocalMessagePort(WIDGET_REPLY_PORT);fakeSource.addMessagePortListener(()=>{});
        other.requestRemoteMessagePort(UI,client.local.messagePortName).sendMessage(answer,fakeSource);
        const wrongSource=f.tizen.messageport.requestLocalMessagePort('WRONG_SOURCE');
        f.tizen.messageport.requestRemoteMessagePort(UI,client.local.messagePortName).sendMessage(answer,wrongSource);
        f.tizen.messageport.requestRemoteMessagePort(UI,client.local.messagePortName).sendMessage(answer);
        client.local.callback(answer,{appId:SVC,messagePortName:WIDGET_REPLY_PORT,isTrusted:true});
        client.local.callback([{key:'json',value:JSON.stringify({version:1,id:'unknown',ok:true,result:{token:'forged'}})}],
            {appId:SVC,messagePortName:WIDGET_REPLY_PORT,isTrusted:false});
        await flush();assert.equal(settled,false,'forged source, missing metadata and uncorrelated replies stay rejected');
        // Deliver the two held invalid service replies and check that they cannot settle it.
        bus.held.splice(1).forEach(deliver=>deliver());assert.equal(settled,false);
        bus.held.shift()();assert.equal((await result).token,'widget-1');
        assert.equal(diag.snapshot().widget.repliesSent,1);assert.equal(bus.state.dropped,1,'new round trip attaches no trusted return port');
        client.close();assert.equal(client.local.callback,null);

        const refused=new Client({widget:true,tizen:{messageport:{...ui,requestTrustedRemoteMessagePort(){throw Object.assign(Error('Certificate mismatch'),{name:'InvalidAccessError'});}}}});
        await assert.rejects(refused.call('widget.connect',{}),e=>e.name==='InvalidAccessError'&&e.submitted===false);
        assert.equal(Object.keys(refused.pending).length,0);refused.close();
        const wrongTarget=new Client({widget:true,tizen:{messageport:{...ui,requestTrustedRemoteMessagePort(){return {appId:SVC,messagePortName:WIDGET_PORT,isTrusted:false};}}}});
        await assert.rejects(wrongTarget.call('widget.connect',{}),/Trusted Vetro service unavailable/);wrongTarget.close();

        // Legacy clients still use the original trusted reply source where supported.
        bus.state.dropTrustedReply=false;bus.state.holdReplies=false;let legacyResponse;
        legacy.callback=(data,source)=>{legacyResponse=JSON.parse(data[0].value);assert.equal(source.appId,SVC);assert.equal(source.messagePortName,WIDGET_PORT);assert.equal(source.isTrusted,true);};
        ui.requestTrustedRemoteMessagePort(SVC,WIDGET_PORT).sendMessage(frame('legacy-ok'),legacy);
        await flush();await flush();assert.equal(legacyResponse.ok,true);assert.equal(issued,2);
    }finally{handle.stop();f.close();}

    // A runtime returning an untrusted object for the trusted receiver stays closed.
    const bad=fixture();let registered=false;
    bad.tizen.messageport={requestLocalMessagePort(name){return {messagePortName:name,isTrusted:false,addMessagePortListener(){return 0;},removeMessagePortListener(){}};},
        requestTrustedLocalMessagePort(name){return {messagePortName:name,isTrusted:false,addMessagePortListener(){registered=true;return 0;}};}};
    const failed=start(bad.tizen,bad.access,{issueWidget(){throw Error('Must remain closed');}});
    assert.equal(failed.ready,false);assert.equal(registered,false);failed.stop();bad.close();
    console.log('PASS widget transport: captured trusted-reply drop, regular return round trip, signer and native sender checks, response spoofing, endpoint isolation and legacy compatibility');
})().catch(error=>{console.error(error);process.exitCode=1;});
