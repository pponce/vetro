'use strict';
const assert=require('assert').strict,fs=require('fs'),path=require('path'),http=require('http');
const fixture=require('./app-access-fixture.cjs'),load=require('./service-harness.cjs');
const {FILE}=require('../service/widget-bootstrap');
const root=path.resolve(__dirname,'..');

(async()=>{
    const f=fixture(),file=path.join(f.dir,FILE),instances=[];
    function instance(port){
        const events={platform:0,mqtt:0},servers=[];
        const h=load(root,{tizen:f.tizen,setInterval:()=>({unref(){}}),setTimeout:()=>({unref(){}}),dependencies:{
            http:{createServer(router){
                const server=http.createServer(router),listen=server.listen.bind(server);
                server.listen=function(ignored,callback){return listen(port,'127.0.0.1',callback);};
                servers.push(server);return server;
            }},
            './platform.js':{start(){events.platform++;},status(){return {mode:'app-only',agent:{connected:false}};}},
            './mqtt-bridge.js':{MqttBridge:function(){this.start=()=>events.mqtt++;this.setTopics=()=>{};}}
        }});
        const item={h,events,server:servers[0]};instances.push(item);return item;
    }
    async function authenticated(server,token,route){
        const response=await fetch('http://127.0.0.1:'+server.address().port+route,
            {headers:{'X-Vetro-Widget':token,Origin:'null',Connection:'close'}});
        await response.text();return response.status;
    }
    try {
        const owner=instance(0);
        assert.equal(fs.existsSync(file),false,'no credential may be published before the HTTP listener is ready');
        assert.equal(owner.events.platform,0,'root startup waits for HTTP ownership');
        assert.equal(owner.events.mqtt,0,'MQTT startup waits for HTTP ownership');
        await new Promise((resolve,reject)=>{owner.server.once('listening',resolve);owner.server.once('error',reject);});
        const first=fs.readFileSync(file,'utf8'),listeningHandlers=owner.server.listenerCount('listening');
        assert.equal(owner.events.platform,1);assert.equal(owner.events.mqtt,1);
        const duplicate=instance(owner.server.address().port);
        assert.equal(fs.readFileSync(file,'utf8'),first,'a second start cannot overwrite the active credential');
        const failure=await new Promise(resolve=>duplicate.server.once('error',resolve));
        assert.equal(failure.code,'EADDRINUSE');
        duplicate.h.lifecycle.onRequest();duplicate.h.lifecycle.onStart();
        assert.equal(duplicate.h.context.widgetBootstrap,null,'failed bind never creates a publisher');
        assert.equal(duplicate.h.context.appPorts,null,'failed bind never registers competing native ports');
        assert.equal(duplicate.events.platform,0);assert.equal(duplicate.events.mqtt,0);
        for(let i=0;i<3;i++){
            owner.h.context.widgetBootstrap.publish();
            const current=fs.readFileSync(file,'utf8'),token=JSON.parse(current).token;
            duplicate.h.lifecycle.onRequest();
            assert.equal(fs.readFileSync(file,'utf8'),current);
            assert.equal(await authenticated(owner.server,token,'/status'),200);
            assert.equal(await authenticated(owner.server,token,'/auth/pending'),200);
        }
        duplicate.h.lifecycle.onExit();
        assert.equal(fs.existsSync(file),true,'stopping the non-owner preserves the owner credential');
        owner.h.lifecycle.onExit();assert.equal(fs.existsSync(file),false);
        await new Promise(r=>owner.server.close(r));
        duplicate.h.lifecycle.onRequest();
        await new Promise((resolve,reject)=>{duplicate.server.once('listening',resolve);duplicate.server.once('error',reject);});
        assert.equal(duplicate.server.listenerCount('listening'),listeningHandlers,'failed bind retries do not accumulate startup callbacks');
        assert.equal(duplicate.events.platform,1);assert.equal(duplicate.events.mqtt,1);
        assert.equal(await authenticated(duplicate.server,JSON.parse(fs.readFileSync(file)).token,'/auth/pending'),200,
            'a lifecycle request can claim the port after its previous owner closes');

        const current=fs.readFileSync(file,'utf8'),stopped=instance(0);
        stopped.h.lifecycle.onStop();
        await new Promise((resolve,reject)=>{stopped.server.once('listening',resolve);stopped.server.once('error',reject);});
        assert.equal(stopped.events.platform,0);assert.equal(stopped.events.mqtt,0);
        assert.equal(stopped.h.context.widgetBootstrap,null,'a late listener callback cannot reactivate a stopped lifecycle');
        assert.equal(fs.readFileSync(file,'utf8'),current);
        assert.equal(await authenticated(duplicate.server,JSON.parse(current).token,'/status'),200);
    } finally {
        await new Promise(r=>setImmediate(r));
        for(const {h,server} of instances){h.lifecycle.onExit();if(server.listening)await new Promise(r=>server.close(r));}
        f.close();
    }
    console.log('PASS service listener ownership: real port conflict, no competing credential/native ports/root/MQTT, authenticated rotation and independent shutdown');
})().catch(error=>{console.error(error);process.exitCode=1;});
