/* Included in the TV screen only by an explicit diagnostic build. */
(function(root){
'use strict';
var revision=null; // BUILD_DIAGNOSTIC_REVISION
function clean(value){return String(value||'').replace(/\b[a-f0-9]{24,}\b/gi,'[redacted-token]').replace(/\b\d{6}\b/g,'[redacted-code]').slice(0,400);}
function inputSummary(value){
    if(!value||typeof value!=='object')return null;
    var result={};
    ['enabled','connected','recovering','available'].forEach(function(k){result[k]=typeof value[k]==='boolean'?value[k]:null;});
    return result;
}
function readTime(value){return typeof value==='number'&&isFinite(value)&&value>0&&Math.floor(value)===value&&value<=8640000000000000?value:null;}
root.VetroConnectionDiagnostics=function(client){
    var last=0,sent=0,seen=Object.create(null),acks=0;
    function send(method,params){
        var mp=client.tizen&&client.tizen.messageport;
        if(!mp||client.closed)return;
        var target=mp.requestTrustedRemoteMessagePort('vetrotvapp.svc','VETRO_WIDGET_V1');
        if(target.appId!=='vetrotvapp.svc'||target.messagePortName!=='VETRO_WIDGET_V1'||target.isTrusted!==true)return;
        var data=JSON.stringify({version:1,id:'diagnostic_'+(++sent),method:method,params:params});
        if(data.length>3800)return;
        target.sendMessage([{key:'json',value:data}],client.local);
    }
    return {
        publish:function(force){
            if(sent>=200||(!force&&Date.now()-last<1500))return;
            last=Date.now();
            try {
                var state={sourceRevision:revision,visible:root.document.hidden===false,runningChecks:root.running===true,
                    fullCheck:root.fullCheck===true,pairingVisible:root.pairingVisible===true,summaryReady:root.summaryReady===true,
                    sessionReceived:!!root.widgetCredential,serviceAuthenticated:root.widgetServiceAuthenticated===true,
                    input:inputSummary(root.screenSummaryData&&root.screenSummaryData.input),inputReadAt:readTime(root.screenInputReadAt),
                    screenError:clean(root.screenError),pairingError:clean(root.pairingError),
                    client:{trusted:client.trusted===true,closed:client.closed===true,replyTrusted:client.local.isTrusted===true,
                        sequence:client.sequence,pending:Object.keys(client.pending).length},checks:{}};
                var checks=(root.report||{}).probe||{};
                ['serviceLaunch','tizenObject','webapisObject','productinfo','systeminfoBattery','remoteApi8001','serviceReach'].forEach(function(k){
                    if(checks[k])state.checks[k]={ok:checks[k].ok===true,error:clean(checks[k].error)};
                });
                send('diagnostic.screen',state);
            }catch(_){}
        },
        observe:function(data,remote){
            try {
                if(acks>=24||!Array.isArray(data)||data.length!==1||data[0].key!=='json')return;
                var value=data[0].value;
                if(Array.isArray(value)&&value.length===1)value=value[0];
                if(typeof value!=='string'||value.length>18000)return;
                var p=JSON.parse(value),nonce=p&&p.diagnostic&&p.diagnostic.nonce;
                if(p.version!==1||p.id!=='vetro_diagnostic'||p.ok!==false||!p.error||p.error.code!=='diagnostic'||
                    typeof nonce!=='string'||!/^[a-f0-9]{24}$/.test(nonce)||seen[nonce])return;
                // A receipt only reports observation. It never authenticates a reply or resolves a request.
                if(remote&&remote.appId!=='vetrotvapp.svc')return;
                seen[nonce]=true;acks++;
                send('diagnostic.ack',{nonce:nonce,sourcePresent:!!remote,expectedService:!!remote&&remote.appId==='vetrotvapp.svc',
                    expectedPort:!!remote&&remote.messagePortName==='VETRO_WIDGET_REPLY_V1',sourceTrusted:!!remote&&remote.isTrusted===true,
                    sourceTrustBoolean:!!remote&&typeof remote.isTrusted==='boolean'});
            }catch(_){}
        }
    };
};
}(this));
