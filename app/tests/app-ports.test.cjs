'use strict';
const assert=require('assert').strict,fixture=require('./app-access-fixture.cjs'),{start,APP_PORT,WIDGET_PORT}=require('../service/app-ports'),Client=require('../service/app-access-client');
(async()=>{const f=fixture();try{const ports={},received=[];let issuing=0;
 function port(name,trusted){return ports[name]={messagePortName:name,isTrusted:trusted,addMessagePortListener(fn){this.callback=fn;return 1;},removeMessagePortListener(){}};}
 f.tizen.messageport={requestLocalMessagePort:n=>port(n,false),requestTrustedLocalMessagePort:n=>port(n,true)};
 const started=start(f.tizen,f.access,{issueWidget(){issuing++;return {token:'secret'};}});assert.equal(f.access.transport.available,true);await f.approve();
 const msg=(id,method,params={})=>[{key:'json',value:JSON.stringify({version:1,id,method,params})}];
 const remote={appId:'garage.app',sendMessage(data,p){received.push({p,data:JSON.parse(data[0].value)});}};
 ports[APP_PORT].callback(msg('1','apps.list'),remote);await new Promise(r=>setImmediate(r));assert.equal(received.pop().data.ok,true);
 ports[APP_PORT].callback(msg('2','apps.list',{appId:'garage.app'}),{...remote,appId:'imposter.app'});await new Promise(r=>setImmediate(r));assert.equal(received.pop().data.ok,false);
 for(const r of [{...remote,appId:'garage.app',isTrusted:true},{...remote,appId:'vetrotvapp.app',isTrusted:false},null])ports[WIDGET_PORT].callback(msg('3','widget.connect'),r);assert.equal(issuing,0);
 ports[WIDGET_PORT].callback(msg('4','widget.connect'),{...remote,appId:'vetrotvapp.app',isTrusted:true});assert.equal(issuing,1);assert.equal(received.pop().data.result.token,'secret');
 const forged=JSON.parse(msg('5','apps.list')[0].value);forged.appId='garage.app';ports[APP_PORT].callback([{key:'json',value:JSON.stringify(forged)}],remote);assert.equal(received.length,0);
 ports[APP_PORT].callback([{key:'json',value:'x'.repeat(4097)}],remote);assert.equal(received.length,0);
 f.tizen.package.events.onupdated({id:'garage.app.pkg'});assert.equal(f.access.state.grants.length,0);assert.equal(f.identity.epoch('garage.app.pkg'),1);
 started.stop();
 // SDK also authenticates response metadata; body IDs alone are insufficient.
 let listener,request,replyPort;const mp={requestLocalMessagePort(){return {addMessagePortListener(fn){listener=fn;return 1;},removeMessagePortListener(){}};},requestRemoteMessagePort(appId,name){assert.equal(appId,'vetrotvapp.svc');assert.equal(name,APP_PORT);return {sendMessage(data,port){request=JSON.parse(data[0].value);replyPort=port;}};}};
 const client=new Client({tizen:{messageport:mp},timeout:1000});let settled=false;const job=client.call('apps.list',{}).then(r=>{settled=true;return r;});
 const answer=[{key:'json',value:JSON.stringify({version:1,id:request.id,ok:true,result:{apps:[]}})}];
 listener(answer,{appId:'imposter',messagePortName:APP_PORT});listener(answer,{appId:'vetrotvapp.svc',messagePortName:'wrong'});await new Promise(r=>setImmediate(r));assert.equal(settled,false);
 listener(answer,{appId:'vetrotvapp.svc',messagePortName:APP_PORT});assert.deepEqual(await job,{apps:[]});assert.ok(replyPort);client.close();
 const absent=fixture();try{start(null,absent.access,{});assert.equal(absent.access.transport.available,false);}finally{absent.close();}
 console.log('PASS MessagePort: OS sender identity, trusted widget ID and signer channel, strict framing, forged replies and unavailable transport');
 }finally{f.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
