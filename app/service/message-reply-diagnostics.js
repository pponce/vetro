'use strict';
var crypto=require('crypto');
var NAMES=['Error','TypeError','SyntaxError','SecurityError','NotFoundError','InvalidAccessError','InvalidValuesError','TypeMismatchError','QuotaExceededError','NotSupportedError','UnknownError','IOError','InvalidStateError'];
function scrub(value,secrets,limit) {
    var text=typeof value==='string'?value:'';
    (secrets||[]).forEach(function(secret){if(typeof secret==='string'&&secret.length>0){text=text.split(secret).join('[redacted]');text=text.split(JSON.stringify(secret).slice(1,-1)).join('[redacted]');}});
    return text.replace(/\b[a-f0-9]{24,}\b/gi,'[redacted-token]').replace(/\b\d{6}\b/g,'[redacted-code]')
        .replace(/(?:file:\/\/)?\/(?:[^\/\s():]+\/)+([^\/\s():]+:\d+(?::\d+)?)/g,'[path]/$1').slice(0,limit||2048);
}
function failure(error,secrets) {
    var name='Error',message='',stack='';
    try {if(error&&NAMES.indexOf(error.name)>=0)name=error.name;message=scrub(error&&error.message,secrets,2048);stack=scrub(error&&error.stack,secrets,4096);}catch(_){}
    return {name:name,message:message,stack:stack};
}
function portInfo(port) {
    if(!port)return null;
    var result={properties:{},constructor:null};
    try {var n=port.constructor&&port.constructor.name;if(typeof n==='string'&&/^[A-Za-z0-9_$]{1,80}$/.test(n))result.constructor=n;}catch(_){}
    ['appId','messagePortName','isTrusted','sendMessage','addMessagePortListener','removeMessagePortListener'].forEach(function(key){
        try {var v=port[key];result.properties[key]={type:typeof v,own:Object.prototype.hasOwnProperty.call(port,key)};
            if(key==='isTrusted'&&typeof v==='boolean')result.properties[key].value=v;
            if(key==='messagePortName')result.properties[key].length=typeof v==='string'?v.length:null;
            if(key==='appId')result.properties[key].expectedWidget=v==='vetrotvapp.app';
        }catch(_){result.properties[key]={unreadable:true};}
    });
    return result;
}
function functionSource(fn) {
    try {return typeof fn==='function'?scrub(Function.prototype.toString.call(fn),[],32768):null;}catch(_){return null;}
}
function Report(tizen,remote,source,request,encoded,error) {
    var self=this,started=Date.now(),secrets=[remote&&remote.messagePortName],original;
    try {original=JSON.parse(encoded);if(original.result&&typeof original.result.token==='string')secrets.push(original.result.token);}
    catch(_){}
    secrets.push(encoded);
    this.started=started;this.pending=Object.create(null);
    var item=Array.isArray(request)&&request.length===1?request[0]:null;
    this.state={schema:2,startedAt:new Date(started).toISOString(),initialError:failure(error,secrets),
        runtime:{node:process.version,v8:process.versions.v8,platform:process.platform,arch:process.arch},
        actualCall:{dataIsArray:true,itemCount:1,key:'json',valueType:typeof encoded,valueBytes:Buffer.byteLength(encoded),
            responseKeys:original?Object.keys(original).filter(function(k){return ['version','id','ok','result','error'].indexOf(k)>=0;}):[],
            resultHasToken:!!(original&&original.result&&typeof original.result.token==='string'),
            tokenLength:original&&original.result&&typeof original.result.token==='string'?original.result.token.length:null,
            requestArray:Array.isArray(request),requestUsesServiceArrayPrototype:!!request&&Object.getPrototypeOf(request)===Array.prototype,
            requestItemUsesServiceObjectPrototype:!!item&&Object.getPrototypeOf(item)===Object.prototype,
            target:portInfo(remote),source:portInfo(source)},
        api:{callbackSend:functionSource(remote&&remote.sendMessage)},lookup:null,sourceLookup:null,tests:[]};
    var mp=tizen&&tizen.messageport;
    if(!mp||!remote||remote.appId!=='vetrotvapp.app'||typeof remote.isTrusted!=='boolean'||
        typeof remote.messagePortName!=='string'||!remote.messagePortName||remote.messagePortName.length>256||
        typeof remote.sendMessage!=='function'||!source||typeof source.isTrusted!=='boolean'||
        ['VETRO_WIDGET_V1','VETRO_WIDGET_REPLY_V1'].indexOf(source.messagePortName)<0) {
        this.state.stopped='invalid-native-metadata';return;
    }
    this.state.api.requestRemote=functionSource(mp.requestRemoteMessagePort);
    this.state.api.requestLocal=functionSource(mp.requestLocalMessagePort);
    this.state.api.sourceListener=functionSource(source.addMessagePortListener);
    var fresh=null,freshSource=null;
    try {
        fresh=mp[remote.isTrusted?'requestTrustedRemoteMessagePort':'requestRemoteMessagePort']('vetrotvapp.app',remote.messagePortName);
        if(!fresh||fresh.appId!==remote.appId||fresh.messagePortName!==remote.messagePortName||fresh.isTrusted!==remote.isTrusted||typeof fresh.sendMessage!=='function')throw Error('Unexpected reply target');
        this.state.lookup={ok:true,error:null,sameHandle:fresh===remote,samePrototype:Object.getPrototypeOf(fresh)===Object.getPrototypeOf(remote),port:portInfo(fresh)};
        this.state.api.lookupSend=functionSource(fresh.sendMessage);
    }catch(e){fresh=null;this.state.lookup={ok:false,error:failure(e,secrets)};}
    try {
        freshSource=mp[source.isTrusted?'requestTrustedLocalMessagePort':'requestLocalMessagePort'](source.messagePortName);
        if(!freshSource||freshSource.messagePortName!==source.messagePortName||freshSource.isTrusted!==source.isTrusted)throw Error('Unexpected reply source');
        this.state.sourceLookup={ok:true,error:null,sameHandle:freshSource===source,samePrototype:Object.getPrototypeOf(freshSource)===Object.getPrototypeOf(source),port:portInfo(freshSource)};
    }catch(e){freshSource=null;this.state.sourceLookup={ok:false,error:failure(e,secrets)};}
    function send(label,target,local,valueArray,nativeArray,padded) {
        var row={label:label,returned:false,error:null,observed:false,observation:null,valueArray:!!valueArray,nativeArray:!!nativeArray};
        self.state.tests.push(row);
        if(!target||(nativeArray&&(!Array.isArray(request)||typeof request.slice!=='function'))){row.skipped=true;return;}
        var nonce=crypto.randomBytes(12).toString('hex');
        self.pending[nonce]={row:row,port:remote.messagePortName};
        var frame={version:1,id:'vetro_diagnostic',ok:false,diagnostic:{nonce:nonce},error:{code:'diagnostic',message:'Reply transport check'}};
        if(padded)frame.padding=new Array(Math.max(0,Math.min(16384,Buffer.byteLength(encoded))-200)+1).join('x');
        var value=JSON.stringify(frame),data=nativeArray?request.slice(0,0):[];
        data.push({key:'json',value:valueArray?[value]:value});
        row.payloadBytes=Buffer.byteLength(value);
        try {if(local)target.sendMessage(data,local);else target.sendMessage(data);row.returned=true;}
        catch(e){row.error=failure(e,secrets.concat([nonce,value]));}
    }
    send('callback/string/source',remote,source,false,false,false);
    send('callback/string/no-source',remote,null,false,false,false);
    send('lookup/string/source',fresh,source,false,false,false);
    send('lookup/string/no-source',fresh,null,false,false,false);
    if(freshSource)send('lookup/string/refreshed-source',fresh,freshSource,false,false,false);
    send('callback/string-array/source',remote,source,true,false,false);
    send('callback/string-array/no-source',remote,null,true,false,false);
    send('lookup/string-array/source',fresh,source,true,false,false);
    send('lookup/string-array/no-source',fresh,null,true,false,false);
    send('callback/native-array/source',remote,source,false,true,false);
    send('lookup/native-array/source',fresh,source,false,true,false);
    send('lookup/response-sized/source',fresh,source,false,false,true);
}
Report.prototype.ack=function(params,remote) {
    if(Date.now()-this.started>300000||!params||typeof params.nonce!=='string'||!this.pending[params.nonce])return false;
    var pending=this.pending[params.nonce],row=pending.row;
    if(!remote||remote.appId!=='vetrotvapp.app'||remote.messagePortName!==pending.port||typeof remote.isTrusted!=='boolean')return false;
    row.observed=true;row.observation={};
    ['sourcePresent','expectedService','expectedPort','sourceTrusted','sourceTrustBoolean'].forEach(function(k){row.observation[k]=params[k]===true;});
    delete this.pending[params.nonce];return true;
};
Report.prototype.snapshot=function() {
    var result=JSON.parse(JSON.stringify(this.state));
    result.elapsedMs=Math.min(300000,Math.max(0,Date.now()-this.started));
    result.phase=this.state.stopped?'stopped':result.elapsedMs>=5000?'complete':'waiting-for-screen';
    return result;
};
function screen(params) {
    var result={receivedAt:new Date().toISOString(),client:{},checks:{}};
    ['visible','runningChecks','fullCheck','pairingVisible','summaryReady','sessionReceived'].forEach(function(k){result[k]=params[k]===true;});
    result.sourceRevision=typeof params.sourceRevision==='string'&&/^[a-f0-9]{40}$/.test(params.sourceRevision)?params.sourceRevision:null;
    result.screenError=scrub(params.screenError,[],512);result.pairingError=scrub(params.pairingError,[],512);
    var c=params.client||{};
    ['trusted','closed','replyTrusted'].forEach(function(k){result.client[k]=c[k]===true;});
    ['sequence','pending'].forEach(function(k){result.client[k]=typeof c[k]==='number'&&isFinite(c[k])?Math.max(0,Math.min(1000000,Math.floor(c[k]))):null;});
    var checks=params.checks||{};
    ['serviceLaunch','tizenObject','webapisObject','productinfo','systeminfoBattery','remoteApi8001','serviceReach'].forEach(function(k){
        var p=checks[k];if(p&&typeof p==='object')result.checks[k]={ok:p.ok===true,error:scrub(p.error,[],512)};
    });
    return result;
}
module.exports={Report:Report,screen:screen,failure:failure};
