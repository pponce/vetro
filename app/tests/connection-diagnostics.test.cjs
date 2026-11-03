'use strict';
const assert=require('assert').strict,fs=require('fs'),path=require('path');
const fixture=require('./app-access-fixture.cjs'),ports=require('../service/app-ports');
const {Auth}=require('../service/auth'),{Diagnostics}=require('../service/connection-diagnostics');
const revision='72aa727ab8a20ee8dcb5a4135a8fc4cfe2019c4c';
function gate(auth,route,options={}) {
    let status,body,headers;
    const req={method:options.method||'GET',headers:{host:'192.0.2.1:8099',...options.headers},socket:{remoteAddress:'192.0.2.2'}};
    const res={writeHead(s,h){status=s;headers=h;},end(value){body=JSON.parse(value);}};
    const blocked=auth.gate(req,res,route,options.gate);
    return {blocked,status,body,headers};
}
const f=fixture();
try {
    const auth=new Auth({file:path.join(f.dir,'owner.json')}),d=new Diagnostics({sourceRevision:revision,sourceDirty:false});
    const callbacks={};let setupFailure=false,sendFailure=false,response;
    function port(name,trusted) {return {messagePortName:name,isTrusted:trusted,addMessagePortListener(callback){if(setupFailure&&name===ports.WIDGET_PORT)throw Object.assign(Error('SECRET_SETUP_DETAIL'),{name:'SecurityError'});callbacks[name]=callback;return 0;},removeMessagePortListener(id){assert.equal(id,0);delete callbacks[name];}};}
    f.tizen.messageport={requestLocalMessagePort:n=>port(n,false),requestTrustedLocalMessagePort:n=>port(n,true)};
    const handle=ports.start(f.tizen,f.access,auth,d);
    assert.equal(handle.ready,true);assert.equal(d.snapshot().widget.listenerRegistered,true);
    function send(data,remote={}) {
        response=undefined;
        callbacks[ports.WIDGET_PORT](data,{appId:'vetrotvapp.app',isTrusted:false,sendMessage(items){if(sendFailure)throw Object.assign(Error('SECRET_NATIVE_DETAIL'),{name:'UnknownError'});response=JSON.parse(items[0].value);},...remote});
    }
    const frame=(method='widget.connect',params={})=>[{key:'json',value:JSON.stringify({version:1,id:'private-request-id',method,params})}];
    send(frame());assert.equal(response.ok,true);const token=response.result.token;
    assert.equal(d.snapshot().widget.received,1);assert.equal(d.snapshot().widget.sessionsIssued,1);
    assert.equal(d.snapshot().widget.repliesSent,1);assert.equal(d.snapshot().widget.sender.expectedApp,true);
    send(frame(),{appId:'private.other.app'});assert.equal(response,undefined);
    send(frame(),{isTrusted:undefined});assert.equal(response,undefined);
    assert.equal(auth.widgets.length,1,'rejected identities never receive a credential');
    send([{key:'json',value:'SECRET_MALFORMED_PAYLOAD'}]);assert.equal(response,undefined);
    assert.equal(d.snapshot().widget.stage,'frame-rejected');
    send([{key:'json',value:['SECRET_ARRAY_PAYLOAD']}]);assert.equal(response,undefined);
    assert.equal(d.snapshot().widget.frame.arrayValue,true);
    send(frame('SECRET_METHOD'));assert.equal(response,undefined);
    send(frame('widget.connect',{unexpected:'SECRET_PARAM'}));assert.equal(response,undefined);
    assert.equal(auth.widgets.length,1);
    sendFailure=true;send(frame());
    assert.equal(d.snapshot().widget.stage,'reply-error');assert.equal(d.snapshot().widget.error,'UnknownError');
    assert.equal(d.snapshot().widget.replyErrors,1);sendFailure=false;
    auth.pending={id:'SECRET_PENDING_ID',code:'123456',name:'SECRET_DEVICE_NAME',expires:Date.now()+120000};
    const options={connectionDiagnostics:()=>d.snapshot()};
    const denied=gate(auth,'/status',{gate:options});
    assert.equal(denied.blocked,true);assert.equal(denied.status,401);
    assert.equal(denied.body.error,'Pair this device in the Vetro dashboard first');
    assert.equal(denied.body.connectionDiagnostics.sourceRevision,revision);
    assert.equal(denied.headers['Access-Control-Allow-Origin'],undefined);
    const serialized=JSON.stringify(denied);
    for(const value of [token,'private-request-id','private.other.app','SECRET_',auth.pending.code])assert.ok(!serialized.includes(value),value+' not exposed');
    assert.deepEqual(gate(auth,'/status').body,{error:'Pair this device in the Vetro dashboard first'});
    let diagnosticCalls=0;
    const watched={connectionDiagnostics(){diagnosticCalls++;return d.snapshot();}};
    for(const route of ['/exec','/screen','/auth/pending','/app-access','/apps','/install','/monitor']) {
        const result=gate(auth,route,{gate:watched});assert.ok(result.status===401||result.status===403);
        assert.equal(result.body.connectionDiagnostics,undefined);
    }
    for(const options of [{method:'POST'},{headers:{host:'hostile.example'}},{headers:{origin:'https://hostile.example'}},{headers:{origin:'null'}},{headers:{'x-vetro-widget':'invalid'}}])
        assert.equal(gate(auth,'/status',{...options,gate:watched}).body.connectionDiagnostics,undefined);
    assert.equal(diagnosticCalls,0,'other routes, methods, origins, hosts and widget failures do not obtain diagnostics');
    const throwing=gate(auth,'/status',{gate:{connectionDiagnostics(){throw Error('SECRET_DIAGNOSTIC_ERROR');}}});
    assert.equal(throwing.status,401);assert.equal(throwing.body.connectionDiagnostics,undefined);
    const snapshot=d.snapshot();snapshot.widget.received=999;assert.notEqual(d.snapshot().widget.received,999);
    d.state.widget.received=1000000;send(frame());assert.equal(d.snapshot().widget.received,1000000);
    handle.stop();assert.equal(d.snapshot().widget.listenerRegistered,false);assert.equal(d.snapshot().appPort.available,false);
    setupFailure=true;const failed=ports.start(f.tizen,f.access,auth,d);
    assert.equal(failed.ready,false);assert.equal(d.snapshot().widget.stage,'listener-add');
    assert.equal(d.snapshot().widget.error,'SecurityError');assert.equal(d.snapshot().widget.listenerRegistered,false);failed.stop();
    fs.writeFileSync(path.join(f.dir,'corrupt.json'),'invalid');const corrupt=new Auth({file:path.join(f.dir,'corrupt.json')});
    assert.equal(gate(corrupt,'/status',{gate:options}).status,503);
    assert.equal(gate(corrupt,'/status',{gate:options}).body.connectionDiagnostics.schema,1);
    assert.equal(gate(corrupt,'/status',{headers:{origin:'https://hostile.example'},gate:options}).body.connectionDiagnostics,undefined);
} finally {f.close();}

// Exercise the actual router and lifecycle wiring in both package modes.
for(const enabled of [false,true]) {
    const f=fixture(),callbacks={};
    try {
        function port(name,trusted){return {messagePortName:name,isTrusted:trusted,addMessagePortListener(fn){callbacks[name]=fn;return 0;},removeMessagePortListener(){delete callbacks[name];}};}
        f.tizen.messageport={requestLocalMessagePort:n=>port(n,false),requestTrustedLocalMessagePort:n=>port(n,true)};
        const service=require('./service-harness.cjs')(path.resolve(__dirname,'..'),{tizen:f.tizen,
            dependencies:{'./build-info.js':{version:'0.3.5',sourceRevision:revision,sourceDirty:false,connectionDiagnostics:enabled}},setInterval:()=>({unref(){}})});
        let status,body;
        service.router({method:'GET',url:'/status',headers:{host:'192.0.2.1:8099'},socket:{remoteAddress:'192.0.2.2'}},
            {writeHead(code){status=code;},end(text){body=JSON.parse(text);}});
        assert.equal(status,401);assert.equal(!!body.connectionDiagnostics,enabled);
        if(enabled){
            assert.equal(body.connectionDiagnostics.lifecycle.starts,1);
            assert.equal(body.connectionDiagnostics.storage.authReady,true);
            assert.equal(body.connectionDiagnostics.widget.listenerRegistered,true);
            service.lifecycle.onRequest();service.lifecycle.onExit();const state=service.context.connectionDiagnostics.snapshot();
            assert.equal(state.lifecycle.requests,1);assert.equal(state.lifecycle.stops,1);assert.equal(state.widget.listenerRegistered,false);
        }else service.lifecycle.onExit();
    }finally{f.close();}
}
console.log('PASS connection diagnostics: opt-in router, lifecycle, receive/reject/reply stages, capped counters, zero listener IDs, no secrets, auth/origin/route boundaries');
