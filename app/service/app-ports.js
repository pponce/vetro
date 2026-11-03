'use strict';
// MessagePort's remote.appId is supplied by Tizen. No identity from message data or HTTP is accepted.
var APP_PORT='VETRO_APP_ACCESS_V1',WIDGET_PORT='VETRO_WIDGET_V1';
var MAX_REQUEST=4096,MAX_RESPONSE=16384;
function start(tizen,access,auth,diagnostics) {
    var local,internal,listener,widgetListener,watching=false;
    function trace(stage,error) { if(diagnostics)diagnostics.widget(stage,error); }
    function decode(data) {
        if (!Array.isArray(data) || data.length!==1 || data[0].key!=='json' || typeof data[0].value!=='string' || Buffer.byteLength(data[0].value)>MAX_REQUEST) throw Error('Invalid app request');
        var p=JSON.parse(data[0].value);
        if (!p || p.version!==1 || typeof p.id!=='string' || !/^[A-Za-z0-9_-]{1,64}$/.test(p.id) ||
            typeof p.method!=='string' || p.method.length>60 || !p.params || typeof p.params!=='object' || Array.isArray(p.params) ||
            Object.keys(p).some(function(k){return ['version','id','method','params'].indexOf(k)<0;})) throw Error('Invalid app request');
        return p;
    }
    function reply(remote,p,result,error,port) {
        var message={version:1,id:p.id,ok:!error};
        if(error)message.error={code:error.code||'unavailable',message:error.code?error.message:'App request is unavailable',submitted:typeof error.submitted==='boolean'?error.submitted:null};
        else message.result=result;
        var encoded=JSON.stringify(message);
        if(Buffer.byteLength(encoded)>MAX_RESPONSE)encoded=JSON.stringify({version:1,id:p.id,ok:false,error:{code:'limit',message:'Response is too large. Request a smaller page.'}});
        try {
            remote.sendMessage([{key:'json',value:encoded}],port);
            if(port===internal)trace('reply-sent');
        } catch (error) { if(port===internal)trace('reply-error',error); }
    }
    try {
        if (!tizen || !tizen.messageport || !access.options.identity.available()) throw Error('Tizen app identity and MessagePort APIs are required');
        access.options.identity.read('vetrotvapp.app'); // Exercise the certificate privilege, not just API presence.
        function changed(id){access.options.identity.changed(id);access.packageChanged(id);}
        tizen.package.setPackageInfoEventListener({oninstalled:function(p){changed(p.id);},onupdated:function(p){changed(p.id);},onuninstalled:changed});
        watching=true;
        local=tizen.messageport.requestLocalMessagePort(APP_PORT);
        listener=local.addMessagePortListener(function(data,remote){
            var p;
            try {
                if (!remote || typeof remote.sendMessage!=='function' || typeof remote.appId!=='string') return;
                p=decode(data);
                if(p.method==='access.request' && Object.keys(p.params).some(function(k){return k!=='scopes';}) ||
                   p.method==='access.status' && Object.keys(p.params).length) throw Error('Invalid app request');
            } catch (_) { return; }
            access.call(remote.appId,p.method,p.params).then(function(r){reply(remote,p,r,null,local);},function(e){reply(remote,p,null,e,local);});
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
        trace('listener-add');
        widgetListener=internal.addMessagePortListener(function(data,remote){
            var p;
            if(diagnostics)diagnostics.received(data,remote);
            try {
                if(!remote||remote.appId!=='vetrotvapp.app'||remote.isTrusted!==true){trace('sender-rejected');return;}
                try { p=decode(data); } catch(error) { trace('frame-rejected',error);return; }
                if(p.method!=='widget.connect'||Object.keys(p.params).length){trace('method-rejected');return;}
                trace('accepted');
                // The trusted port verifies the signer; the exact sender ID restricts this to Vetro's widget.
                var session=auth.issueWidget();
                trace('session-issued');
                reply(remote,p,session,null,internal);
            } catch(e){trace('session-error',e);if(p)reply(remote,p,null,e,internal);}
        });
        if(widgetListener!==undefined)trace('listening');
    } catch(error) { trace(internal?'listener-add':'port-create',error); }
    var handle={ready:watching && listener!==undefined && widgetListener!==undefined,stop:function(){
        handle.ready=false;
        access.transport={available:false,error:'App communication stopped'};
        try{if(watching)tizen.package.unsetPackageInfoEventListener();}catch(_){}
        try{if(local && listener!==undefined)local.removeMessagePortListener(listener);}catch(_){}
        try{if(internal && widgetListener!==undefined)internal.removeMessagePortListener(widgetListener);}catch(_){}
        watching=false; listener=undefined; widgetListener=undefined;
        if(diagnostics)diagnostics.appPort(false);
        trace('stopped');
    }};
    return handle;
}
module.exports={start:start,APP_PORT:APP_PORT,WIDGET_PORT:WIDGET_PORT};
