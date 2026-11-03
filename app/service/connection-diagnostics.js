'use strict';
// Opt-in connection telemetry. Only fixed labels, booleans and bounded counters
// leave this module: never message contents, identities, tokens or exception text.
var ERROR_NAMES = ['Error','TypeError','SyntaxError','SecurityError','NotFoundError',
    'InvalidAccessError','InvalidValuesError','TypeMismatchError','QuotaExceededError',
    'NotSupportedError','UnknownError','IOError','InvalidStateError'];
var STAGES = ['not-started','port-create','reply-port-create','listener-add','listening','received',
    'sender-rejected','frame-rejected','method-rejected','accepted','session-issued',
    'session-error','reply-sent','reply-error','stopped'];
function errorName(error) {
    try { return error && ERROR_NAMES.indexOf(error.name) >= 0 ? error.name : 'Error'; }
    catch (_) { return 'Error'; }
}
function increment(object,key) { object[key] = Math.min(1000000,object[key]+1); }
function Diagnostics(info) {
    info=info||{};
    this.state={
        schema:1,
        sourceRevision:typeof info.sourceRevision==='string' && /^[a-f0-9]{40}$/.test(info.sourceRevision)?info.sourceRevision:null,
        sourceDirty:typeof info.sourceDirty==='boolean'?info.sourceDirty:null,
        startedAt:new Date().toISOString(),
        lifecycle:{starts:0,requests:0,stops:0},
        storage:{phase:'not-started',authReady:false,appsReady:false,error:null},
        appPort:{available:false,error:null},
        widget:{portCreated:false,listenerRegistered:false,received:0,rejected:0,
            accepted:0,sessionsIssued:0,repliesSent:0,replyErrors:0,
            stage:'not-started',error:null,sender:null,frame:null}
    };
}
Diagnostics.prototype.lifecycle=function(kind) {
    if(['starts','requests','stops'].indexOf(kind)>=0)increment(this.state.lifecycle,kind);
};
Diagnostics.prototype.storage=function(phase,authReady,appsReady,error) {
    if(['resolving','ready','blocked','failed'].indexOf(phase)<0)return;
    this.state.storage={phase:phase,authReady:authReady===true,appsReady:appsReady===true,error:error?errorName(error):null};
};
Diagnostics.prototype.appPort=function(available,error) {
    this.state.appPort={available:available===true,error:error?errorName(error):null};
};
Diagnostics.prototype.widget=function(stage,error) {
    if(STAGES.indexOf(stage)<0)return;
    var w=this.state.widget;
    w.stage=stage;w.error=error?errorName(error):null;
    if(stage==='port-create'){w.portCreated=false;w.listenerRegistered=false;}
    if(stage==='reply-port-create'||stage==='listener-add')w.portCreated=true;
    if(stage==='listening')w.listenerRegistered=true;
    if(stage==='stopped')w.listenerRegistered=false;
    var counter={'received':'received','sender-rejected':'rejected','frame-rejected':'rejected',
        'method-rejected':'rejected','accepted':'accepted','session-issued':'sessionsIssued',
        'reply-sent':'repliesSent','reply-error':'replyErrors'}[stage];
    if(counter)increment(w,counter);
};
Diagnostics.prototype.received=function(data,remote) {
    this.widget('received');
    var w=this.state.widget;
    try {
        w.sender={present:!!remote,expectedApp:!!remote&&remote.appId==='vetrotvapp.app',
            trusted:!!remote&&remote.isTrusted===true,
            trustedIsBoolean:!!remote&&typeof remote.isTrusted==='boolean',
            canReply:!!remote&&typeof remote.sendMessage==='function'};
        var item=Array.isArray(data)&&data.length===1?data[0]:null;
        w.frame={isArray:Array.isArray(data),singleItem:Array.isArray(data)&&data.length===1,
            jsonKey:!!item&&item.key==='json',stringValue:!!item&&typeof item.value==='string',
            arrayValue:!!item&&Array.isArray(item.value)};
    } catch (_) { w.sender=null;w.frame=null; }
};
Diagnostics.prototype.snapshot=function() {
    // All stored values above are constructed here; caller-owned objects are never retained.
    return JSON.parse(JSON.stringify(this.state));
};
module.exports={Diagnostics:Diagnostics};
