'use strict';
// MessagePort's remote.appId is supplied by Tizen. No identity from message data or HTTP is accepted.
var APP_PORT='VETRO_APP_ACCESS_V1',WIDGET_PORT='VETRO_WIDGET_V1',WIDGET_REPLY_PORT='VETRO_WIDGET_REPLY_V1';
var MAX_REQUEST=4096,MAX_RESPONSE=16384;
function start(tizen,access,auth,diagnostics,replies) {
    var local,internal,widgetReply,listener,widgetListener,widgetReplyListener,watching=false,widgetStage='port-create';
    function trace(stage,error) { if(diagnostics)diagnostics.widget(stage,error); }
    function appTrace(stage,data,remote,p,error,reason) {
        // Diagnostic failures must never affect request validation or dispatch.
        try {if(diagnostics&&typeof diagnostics.appRequest==='function')diagnostics.appRequest(stage,data,remote,p,error,reason);}catch(_){}
    }
    function hasReplyTarget(remote) {
        return remote && typeof remote.appId==='string' && remote.appId.length>0 &&
            typeof remote.messagePortName==='string' && remote.messagePortName.length>0 &&
            typeof remote.isTrusted==='boolean' && typeof remote.sendMessage==='function';
    }
    function decode(data) {
        if (!Array.isArray(data) || data.length!==1 || data[0].key!=='json' || typeof data[0].value!=='string' || Buffer.byteLength(data[0].value)>MAX_REQUEST) throw Error('Invalid app request');
        var p=JSON.parse(data[0].value);
        if (!p || (p.version!==1&&p.version!==2) || typeof p.id!=='string' || !/^[A-Za-z0-9_-]{1,64}$/.test(p.id) ||
            typeof p.method!=='string' || p.method.length>60 || !p.params || typeof p.params!=='object' || Array.isArray(p.params) ||
            Object.keys(p).some(function(k){return (p.version===2?['version','id','method','params','reply']:['version','id','method','params']).indexOf(k)<0;})) throw Error('Invalid app request');
        if(p.version===2&&(!p.reply||typeof p.reply!=='object'||Array.isArray(p.reply)||
            Object.keys(p.reply).length!==2||Object.keys(p.reply).some(function(k){return k!=='id'&&k!=='key';})||
            typeof p.reply.id!=='string'||!/^[a-f0-9]{64}$/.test(p.reply.id)||
            typeof p.reply.key!=='string'||!/^[a-f0-9]{64}$/.test(p.reply.key)))throw Error('Invalid app reply channel');
        return p;
    }
    function reply(remote,p,result,error,port,request) {
        var message={version:1,id:p.id,ok:!error};
        if(error)message.error={code:error.code||'unavailable',message:error.code?error.message:'App request is unavailable',submitted:typeof error.submitted==='boolean'?error.submitted:null};
        else message.result=result;
        var encoded=JSON.stringify(message);
        if(Buffer.byteLength(encoded)>MAX_RESPONSE)encoded=JSON.stringify({version:1,id:p.id,ok:false,error:{code:'limit',message:'Response is too large. Request a smaller page.'}});
        try {
            // Use the public outbound factory so the service runtime handles its
            // local-port objects. The validated callback supplies the destination;
            // outbound wrappers need not expose the callback's identity properties.
            var method=remote.isTrusted?'requestTrustedRemoteMessagePort':'requestRemoteMessagePort';
            var outbound=tizen.messageport[method](remote.appId,remote.messagePortName);
            if(!outbound||typeof outbound.sendMessage!=='function')throw Error('Reply port unavailable');
            outbound.sendMessage([{key:'json',value:encoded}],port);
            if(port===internal||port===widgetReply)trace('reply-sent');
        } catch (error) {
            if(port===internal||port===widgetReply) {
                trace('reply-error',error);
                if(diagnostics&&typeof diagnostics.replyFailure==='function')diagnostics.replyFailure(tizen,remote,port,request,encoded,error);
            }
        }
    }
    try {
        if (!tizen || !tizen.messageport || !access.options.identity.available()) throw Error('Tizen app identity and MessagePort APIs are required');
        access.options.identity.read('vetrotvapp.app'); // Exercise the certificate privilege, not just API presence.
        function changed(id){access.options.identity.changed(id);access.packageChanged(id);}
        tizen.package.setPackageInfoEventListener({oninstalled:function(p){changed(p.id);},onupdated:function(p){changed(p.id);},onuninstalled:changed});
        watching=true;
        local=tizen.messageport.requestLocalMessagePort(APP_PORT);
        listener=local.addMessagePortListener(function(data,remote){
            var p,ticket,rejection='sender-rejected',replyReason;
            appTrace('received',data,remote);
            try {
                if (!hasReplyTarget(remote)) {appTrace('sender-rejected',data,remote);return;}
                rejection='frame-rejected';
                p=decode(data);
                rejection='params-rejected';
                if(p.method==='access.request' && Object.keys(p.params).some(function(k){return k!=='scopes';}) ||
                   p.method==='access.status' && Object.keys(p.params).length) throw Error('Invalid app request');
            } catch (error) {appTrace(rejection,data,remote,p,error);return;}
            if(p.version===2){
                // Only a native-identified MessagePort request can create a reply
                // capability. HTTP cannot reserve one or dispatch an operation.
                if(!replies){appTrace('reply-unavailable',data,remote,p);return;}
                try {ticket=replies.reserve(remote.appId,p,function(reason){replyReason=reason;});}
                catch(error){appTrace('reply-error',data,remote,p,error);throw error;}
                if(ticket===null){appTrace('reply-rejected',data,remote,p,null,replyReason);return;}
                appTrace('reply-reserved',data,remote,p);
                appTrace('dispatch',data,remote,p);
                access.call(remote.appId,p.method,p.params).then(function(r){
                    appTrace('handler-resolved',data,remote,p);replies.complete(ticket,r,null);
                },function(e){appTrace('handler-rejected',data,remote,p,e);replies.complete(ticket,null,e);});
            }else {
                appTrace('dispatch',data,remote,p);
                access.call(remote.appId,p.method,p.params).then(function(r){
                    appTrace('handler-resolved',data,remote,p);reply(remote,p,r,null,local);
                },function(e){appTrace('handler-rejected',data,remote,p,e);reply(remote,p,null,e,local);});
            }
        });
        access.transport={available:true,error:null};
        if(diagnostics)diagnostics.appPort(true);
    } catch (error) {
        access.transport={available:false,error:'Verified app communication is unavailable on this TV'};
        if(diagnostics)diagnostics.appPort(false,error);
    }
    try {
        trace('port-create');
        if(!tizen||!tizen.messageport)throw Error('MessagePort unavailable');
        internal=tizen.messageport.requestTrustedLocalMessagePort(WIDGET_PORT);
        if(!internal||internal.isTrusted!==true||internal.messagePortName!==WIDGET_PORT)throw Error('Trusted widget receiver unavailable');
        widgetStage='reply-port-create';trace(widgetStage);
        widgetReply=tizen.messageport.requestLocalMessagePort(WIDGET_REPLY_PORT);
        if(!widgetReply||widgetReply.isTrusted!==false||widgetReply.messagePortName!==WIDGET_REPLY_PORT)throw Error('Widget reply port unavailable');
        // Keep this native port registered as the source identity for replies.
        // It accepts no requests; incoming data cannot reach auth or app controls.
        widgetReplyListener=widgetReply.addMessagePortListener(function(){});
        if(widgetReplyListener===undefined)throw Error('Widget reply listener unavailable');
        widgetStage='listener-add';
        trace('listener-add');
        widgetListener=internal.addMessagePortListener(function(data,remote){
            var p,replyPort;
            if(diagnostics)diagnostics.received(data,remote);
            try {
                // The receiving port enforces the signer. remote.isTrusted describes
                // the sender's reply port, which may be regular without changing identity.
                if(!hasReplyTarget(remote)||remote.appId!=='vetrotvapp.app'){trace('sender-rejected');return;}
                replyPort=remote.isTrusted?internal:widgetReply;
                try { p=decode(data); } catch(error) { trace('frame-rejected',error);return; }
                if(diagnostics&&typeof diagnostics.consume==='function'&&diagnostics.consume(p,remote))return;
                if(p.version!==1||p.method!=='widget.connect'||Object.keys(p.params).length){trace('method-rejected');return;}
                trace('accepted');
                // The trusted port verifies the signer; the exact sender ID restricts this to Vetro's widget.
                var session=auth.issueWidget();
                trace('session-issued');
                reply(remote,p,session,null,replyPort,data);
            } catch(e){trace('session-error',e);if(p)reply(remote,p,null,e,replyPort,data);}
        });
        if(widgetListener!==undefined)trace('listening');
    } catch(error) { trace(widgetStage,error); }
    var handle={ready:watching && listener!==undefined && widgetListener!==undefined && widgetReplyListener!==undefined,stop:function(){
        handle.ready=false;
        if(replies)replies.clear();
        access.transport={available:false,error:'App communication stopped'};
        try{if(watching)tizen.package.unsetPackageInfoEventListener();}catch(_){}
        try{if(local && listener!==undefined)local.removeMessagePortListener(listener);}catch(_){}
        try{if(internal && widgetListener!==undefined)internal.removeMessagePortListener(widgetListener);}catch(_){}
        try{if(widgetReply && widgetReplyListener!==undefined)widgetReply.removeMessagePortListener(widgetReplyListener);}catch(_){}
        watching=false; listener=undefined; widgetListener=undefined; widgetReplyListener=undefined;
        if(diagnostics)diagnostics.appPort(false);
        trace('stopped');
    }};
    return handle;
}
module.exports={start:start,APP_PORT:APP_PORT,WIDGET_PORT:WIDGET_PORT,WIDGET_REPLY_PORT:WIDGET_REPLY_PORT};

