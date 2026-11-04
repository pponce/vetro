/* Read a scoped screen credential through Tizen's package-private filesystem. */
(function(root,factory){
    if(typeof module==='object'&&module.exports)module.exports=factory();
    else root.VetroWidgetSession=factory();
}(this,function(){
    'use strict';
    function read(tizen,timeout) {
        return new Promise(function(resolve,reject){
            var done=false,timer=setTimeout(function(){fail('Private widget credential read timed out');},timeout||2500);
            function fail(message){if(done)return;done=true;clearTimeout(timer);reject(Error(message));}
            function received(text){
                if(done)return;
                try {
                    if(typeof text!=='string'||text.length>512)throw Error('Invalid private widget credential');
                    var data=JSON.parse(text),now=Date.now();
                    if(!data||data.schema!==1||typeof data.token!=='string'||!/^[a-f0-9]{64}$/.test(data.token)||
                        typeof data.expires!=='number'||!isFinite(data.expires)||data.expires<=now||data.expires>now+300000)
                        throw Error('Private widget credential is unavailable or expired');
                    done=true;clearTimeout(timer);resolve({token:data.token,expires:data.expires});
                }catch(_){fail('Private widget credential is unavailable or expired');}
            }
            function unavailable(){fail('Private widget credential is not available. Keep Vetro open while its service starts.');}
            try {
                if(!tizen||!tizen.filesystem||typeof tizen.filesystem.resolve!=='function')return unavailable();
                tizen.filesystem.resolve('wgt-private',function(directory){
                    if(done)return;
                    try {
                        var file=directory.resolve('vetro-widget-session.json');
                        if(!file.isFile||typeof file.fileSize!=='number'||file.fileSize<1||file.fileSize>512)return unavailable();
                        file.readAsText(received,unavailable,'UTF-8');
                    }catch(_){unavailable();}
                },unavailable,'r');
            }catch(_){unavailable();}
        });
    }
    return {read:read};
}));
