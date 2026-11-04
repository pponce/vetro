'use strict';
const assert=require('assert').strict;
const {Report}=require('../service/message-reply-diagnostics');
const UI='vetrotvapp.app',reply='PRIVATE_CLIENT_REPLY',token='d'.repeat(64);
const failure=Object.assign(Error('Cannot convert LocalMessagePortRouter to LocalMessagePort.'),{name:'TypeMismatchError'});
const encoded=JSON.stringify({version:1,id:'connect',ok:true,result:{token}});
const request=[{key:'json',value:JSON.stringify({version:1,id:'connect',method:'widget.connect'})}];
let callbackSends=0,freshSends=0;
class LocalMessagePortRouter {
    constructor(){this.messagePortName='VETRO_WIDGET_REPLY_V1';this.isTrusted=false;}
    addMessagePortListener(){}
}
class NativeRemote {
    constructor(){this.appId=UI;this.messagePortName=reply;this.isTrusted=false;}
    sendMessage(data,source){
        callbackSends++;
        assert.ok(!JSON.stringify(data).includes(token),'diagnostic probes never contain a credential');
        if(source)throw failure;
    }
}
class RemoteMessagePortRouter {
    constructor(){this.appId=UI;this.messagePortName=reply;this.isTrusted=false;}
    sendMessage(){freshSends++;}
}
const remote=new NativeRemote(),source=new LocalMessagePortRouter();
function capture(fresh){
    const api={requestRemoteMessagePort:()=>fresh,requestLocalMessagePort:()=>new LocalMessagePortRouter()};
    return new Report({messageport:api},remote,source,request,encoded,failure).snapshot();
}
for(const key of ['appId','messagePortName','isTrusted','sendMessage']) {
    const fresh=new RemoteMessagePortRouter();fresh[key]=undefined;
    const report=capture(fresh),observation=report.lookupObservation;
    assert.equal(report.lookup.ok,false);
    assert.equal(report.lookup.error.message,'Unexpected reply target');
    assert.equal(report.tests.filter(row=>row.skipped).length,7,'the existing metadata guard still blocks lookup sends');
    assert.equal(freshSends,0,'inspecting a rejected wrapper never sends through it');
    assert.ok(report.sourceObservation.constructorSource.includes('class LocalMessagePortRouter'));
    assert.ok(observation.constructorSource.includes('class RemoteMessagePortRouter'));
    for(const property of ['appId','messagePortName','isTrusted'])assert.equal(observation.matches[property],property!==key);
    assert.equal(observation.port.properties[key].type,'undefined');
    if(key==='sendMessage')assert.equal(observation.sendSource,null);
    else assert.ok(observation.sendSource.includes('freshSends++'));
    assert.ok(!JSON.stringify(report).includes(token));
    assert.ok(!JSON.stringify(report).includes(reply),'raw dynamic reply-port names remain private');
}
// A different port with exactly the same length must be distinguishable.
const wrongName=new RemoteMessagePortRouter();wrongName.messagePortName='X'.repeat(reply.length);
const wrongNameReport=capture(wrongName);
assert.equal(wrongNameReport.lookupObservation.matches.messagePortName,false);
assert.equal(wrongNameReport.lookupObservation.port.properties.messagePortName.length,reply.length);
assert.equal(wrongNameReport.lookup.ok,false);
assert.equal(freshSends,0);
// Missing wrappers and throwing getters leave useful evidence without admitting a target.
const absent=capture(null);
assert.equal(absent.lookupObservation.port,null);
assert.equal(absent.lookupObservation.constructorSource,null);
const unreadable=new RemoteMessagePortRouter();
Object.defineProperty(unreadable,'isTrusted',{get(){throw Error('unreadable');}});
const unreadableReport=capture(unreadable);
assert.equal(unreadableReport.lookupObservation.matches.isTrusted,null);
assert.equal(unreadableReport.lookupObservation.port.properties.isTrusted.unreadable,true);
assert.ok(unreadableReport.lookupObservation.sendSource);
assert.equal(unreadableReport.lookup.ok,false);
assert.equal(freshSends,0);
// Method source is scrubbed with the known reply name and credential, too.
const literal=new RemoteMessagePortRouter();literal.appId=undefined;
literal.sendMessage=new Function('data','/* '+reply+' '+token+' */');
const literals=capture(literal);
assert.ok(literals.lookupObservation.sendSource.includes('[redacted]'));
assert.ok(!JSON.stringify(literals).includes(reply));
assert.ok(!JSON.stringify(literals).includes(token));
assert.equal(freshSends,0);
assert.equal(callbackSends,8*5,'the observation adds no probes to the existing five callback cases');
console.log('PASS wrapper observations: constructor/method capture, all metadata mismatches retained before rejection, same-length wrong port, absent/throwing fields, redaction, unchanged send guard and probe count');
