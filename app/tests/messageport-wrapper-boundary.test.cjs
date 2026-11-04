'use strict';
const assert = require('assert').strict;
const fixture = require('./app-access-fixture.cjs');
const Client = require('../service/app-access-client');
const {start, APP_PORT, WIDGET_PORT, WIDGET_REPLY_PORT} = require('../service/app-ports');
const {Diagnostics} = require('../service/connection-diagnostics');
const {Report} = require('../service/message-reply-diagnostics');
const tick = () => new Promise(resolve => setImmediate(resolve));

// Model the captured callback/factory distinction and local-port conversion.
// Physical TV routing remains a hardware acceptance check; widget-transport
// separately exercises client authentication with registered sender metadata.
function runtimeModel() {
    const locals = new Map(), sends = [], failures = [], lookups = [];
    class LocalMessagePort {
        constructor(name, trusted) { this.owner='vetrotvapp.svc'; this.messagePortName=name; this.isTrusted=trusted; }
        addMessagePortListener(fn) { this.callback=fn; return 0; }
        removeMessagePortListener() { this.callback=null; }
    }
    class LocalMessagePortRouter {
        constructor(native) {
            this.messagePortObj=native;
            this.messagePortName=native.messagePortName;
            this.isTrusted=native.isTrusted;
        }
        get [Symbol.toStringTag]() { return 'LocalMessagePortRouter'; }
        toString() { return 'LocalMessagePortRouter'; }
        get() { return this.messagePortObj; }
        // The captured listener takes one native callback argument and obtains
        // the reply target from org_remote fields. The producer of those fields
        // and its identity guarantees are deliberately outside this model.
        addMessagePortListener(callback) {
            return this.messagePortObj.addMessagePortListener(data => {
                let appId='', name='';
                data.forEach(item => {
                    if(item.key==='org_remote_app_id') appId=item.value;
                    else if(item.key==='org_remote_port') name=item.value;
                });
                callback(data.filter(item => !item.key.includes('org_remote')),
                    appId && name ? new RemoteMessagePort(appId, name, false) : undefined);
            });
        }
        removeMessagePortListener(id) { this.messagePortObj.removeMessagePortListener(id); }
    }
    class RemoteMessagePort {
        constructor(appId, name, trusted) {
            this.appId=appId; this.messagePortName=name; this.isTrusted=trusted;
        }
        sendMessage(data, source) {
            assert.ok(Array.isArray(data));
            if(source != null && !(source instanceof LocalMessagePort)) {
                const type=Object.prototype.toString.call(source).slice(8,-1);
                const error=Object.assign(Error('Cannot convert '+type+' to LocalMessagePort.'), {name:'TypeMismatchError'});
                failures.push(error);
                throw error;
            }
            sends.push({target:this, data, source:source || null});
        }
    }
    // Public factory results expose neither appId nor isTrusted on this runtime.
    class OutboundMessagePort {
        constructor(appId,name,trusted) {
            this.remoteAppId=appId;this.messagePortName=name;
            this.messagePortObj=new RemoteMessagePort(appId,name,trusted);
        }
        sendMessage(data,source) {
            if(source=='LocalMessagePortRouter')source=source.get();
            this.messagePortObj.sendMessage(data,source);
        }
    }
    function outbound(appId,name,trusted) {
        lookups.push({appId,name,trusted});
        return new OutboundMessagePort(appId,name,trusted);
    }
    function local(name, trusted) {
        if(!locals.has(name)) locals.set(name, new LocalMessagePort(name, trusted));
        return new LocalMessagePortRouter(locals.get(name));
    }
    function receive(name, frame, appId) {
        const data=frame.slice();
        if(appId) data.push({key:'org_remote_app_id', value:appId}, {key:'org_remote_port', value:'CLIENT_REPLY'});
        locals.get(name).callback(data);
    }
    return {locals,sends,failures,lookups,receive,RemoteMessagePort,api:{
        requestLocalMessagePort:name=>local(name,false),
        requestTrustedLocalMessagePort:name=>local(name,true),
        requestRemoteMessagePort:(id,name)=>outbound(id,name,false),
        requestTrustedRemoteMessagePort:(id,name)=>outbound(id,name,true)
    }};
}
const frame=(id,method,params={})=>[{key:'json',value:JSON.stringify({version:1,id,method,params})}];

(async()=>{
    const f=fixture(), model=runtimeModel(), diagnostics=new Diagnostics();
    let issued=0;
    f.tizen.messageport=model.api;
    const handle=start(f.tizen,f.access,{issueWidget(){issued++;return {token:'synthetic-widget-token'};}},diagnostics);
    try {
        assert.equal(handle.ready,true);
        model.receive(WIDGET_PORT,frame('missing','widget.connect'));
        model.receive(WIDGET_PORT,frame('wrong','widget.connect'),'other.app');
        assert.equal(issued,0);
        model.receive(WIDGET_PORT,frame('connect','widget.connect'),'vetrotvapp.app');
        assert.equal(issued,1);
        assert.equal(model.sends.length,1);
        assert.equal(model.failures.length,0);
        assert.equal(model.sends[0].source.owner,'vetrotvapp.svc');
        assert.equal(model.sends[0].source.messagePortName,WIDGET_REPLY_PORT);
        assert.equal(model.sends[0].target.appId,'vetrotvapp.app');
        assert.equal(diagnostics.snapshot().widget.replyErrors,0);
        assert.equal(diagnostics.snapshot().widget.repliesSent,1);

        await f.approve();
        model.receive(APP_PORT,frame('app-ok','apps.list'),'garage.app');
        await tick();
        model.receive(APP_PORT,frame('app-denied','apps.list'),'other.app');
        await tick();
        assert.equal(model.failures.length,0);
        assert.equal(model.sends.length,3,'widget, granted and denied app-access replies use the factory');
        assert.equal(JSON.parse(model.sends[1].data[0].value).ok,true);
        assert.equal(JSON.parse(model.sends[2].data[0].value).ok,false);
        assert.ok(model.sends.slice(1).every(send=>send.source.messagePortName===APP_PORT&&send.source.owner==='vetrotvapp.svc'));
        assert.deepEqual(model.lookups.map(x=>x.appId),['vetrotvapp.app','garage.app','other.app']);

        const source=model.api.requestLocalMessagePort(WIDGET_REPLY_PORT);
        const refreshed=model.api.requestLocalMessagePort(WIDGET_REPLY_PORT);
        assert.notEqual(source,refreshed);
        assert.equal(Object.getPrototypeOf(source),Object.getPrototypeOf(refreshed));
        const remote=new model.RemoteMessagePort('vetrotvapp.app','CLIENT_REPLY',false);
        for(const value of ['payload',['payload']]) {
            assert.throws(()=>remote.sendMessage([{key:'json',value}],source),{name:'TypeMismatchError'});
            assert.throws(()=>remote.sendMessage([{key:'json',value}],refreshed),{name:'TypeMismatchError'});
            remote.sendMessage([{key:'json',value}]);
        }
        assert.equal(model.failures[0].name,'TypeMismatchError');
        assert.equal(model.failures[0].message,'Cannot convert LocalMessagePortRouter to LocalMessagePort.');
        assert.equal(model.sends.length,5);
        assert.ok(model.sends.slice(-2).every(send=>send.source===null),'no-source success supplies no identity evidence');

        // Retain the observed failed diagnostic guard as evidence: the public
        // outbound wrapper has the requested name, but no callback identity fields.
        const report=new Report({messageport:model.api},remote,source,frame('r','widget.connect'),
            JSON.stringify({version:1,id:'r',ok:true,result:{token:'synthetic'}}),model.failures[0]).snapshot();
        assert.equal(report.lookup.error.message,'Unexpected reply target');
        assert.deepEqual(report.lookupObservation.matches,{appId:false,messagePortName:true,isTrusted:false});
        assert.equal(report.tests.filter(row=>row.skipped).length,7);

        // A failed factory must never fall back to the raw callback or no source.
        const sent=model.sends.length;
        for(const factory of [()=>{throw Error('Target unavailable');},()=>null,()=>({})]) {
            model.api.requestRemoteMessagePort=factory;
            model.receive(WIDGET_PORT,frame('factory-failed','widget.connect'),'vetrotvapp.app');
            assert.equal(model.sends.length,sent);
        }
        assert.equal(diagnostics.snapshot().widget.replyErrors,3);
        assert.equal(diagnostics.snapshot().widget.repliesSent,1);
    } finally { handle.stop(); f.close(); }

    // Independently exercise the real SDK's receiving guard for both clients.
    // A synthetic valid source below is a control, not hardware verification.
    for(const widget of [true,false]) {
        let listener, request;
        const expectedPort=widget?WIDGET_REPLY_PORT:APP_PORT;
        const api={requestLocalMessagePort:()=>({isTrusted:false,
            addMessagePortListener(fn){listener=fn;return 0;},removeMessagePortListener(){}}),
            requestRemoteMessagePort:()=>({sendMessage(data){request=JSON.parse(data[0].value);}}),
            requestTrustedRemoteMessagePort:()=>({appId:'vetrotvapp.svc',messagePortName:WIDGET_PORT,isTrusted:true,
                sendMessage(data){request=JSON.parse(data[0].value);}})};
        const client=new Client({widget,tizen:{messageport:api},timeout:1000});
        let settled=false;
        const pending=client.call(widget?'widget.connect':'apps.list',{}).then(r=>{settled=true;return r;});
        const answer=[{key:'json',value:JSON.stringify({version:1,id:request.id,ok:true,
            appId:'vetrotvapp.svc',messagePortName:expectedPort,result:{synthetic:true}})}];
        for(const source of [undefined,null,{appId:'other.app',messagePortName:expectedPort,isTrusted:false},
            {appId:'vetrotvapp.svc',messagePortName:'WRONG',isTrusted:false}]) listener(answer,source);
        if(widget) listener(answer,{appId:'vetrotvapp.svc',messagePortName:expectedPort,isTrusted:true});
        await tick();
        assert.equal(settled,false,'missing/mismatched metadata and body claims cannot authenticate');
        listener(answer,{appId:'vetrotvapp.svc',messagePortName:expectedPort,isTrusted:false});
        assert.deepEqual(await pending,{synthetic:true});
        client.close();
    }
    console.log('PASS wrapper boundary: exact raw-send failure, public-factory widget and app-access replies, observed wrapper metadata, closed factory failures and strict client sender checks');
})().catch(error=>{console.error(error);process.exitCode=1;});
