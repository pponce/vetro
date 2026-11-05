'use strict';
const assert=require('assert').strict,fs=require('fs'),vm=require('vm');
const source=/<script>\s*([\s\S]*?)<\/script>/.exec(fs.readFileSync(require.resolve('../index.html'),'utf8'))[1];
const GOOD={version:'0.3.5',port:8099,address:'192.0.2.10',root:{mode:'tv-integration',connected:true},
 input:{enabled:true,connected:true},launcher:{installed:true,enabled:false},memory:{availableMb:400}};
async function flush(){for(let i=0;i<30;i++)await new Promise(resolve=>setImmediate(resolve));}
function fixture(){
 const f={requests:[],handlers:{},nodes:{},timers:[],intervals:[],starts:[],legacy:[],exits:0,reads:0,inventory:[]};
 const element=id=>f.nodes[id]||(f.nodes[id]={innerHTML:'',textContent:'',hidden:false,style:{}});
 f.reply=(xhr,status,body)=>{xhr.status=status;xhr.responseText=JSON.stringify(body);xhr.onload();};
 f.answer=xhr=>f.reply(xhr,200,xhr.route.indexOf('/screen')===0?GOOD:xhr.route==='/probe'?{ok:true}:{});
 f.read=async()=>{f.reads++;return {token:'a'.repeat(64),expires:Date.now()+300000};};
 function XHR(){this.headers={};}
 XHR.prototype.open=function(method,url){this.method=method;this.route=url.replace('http://127.0.0.1:8099','');};
 XHR.prototype.setRequestHeader=function(name,value){this.headers[name]=value;};
 XHR.prototype.send=function(body){this.body=body;f.requests.push(this);f.answer(this);};
 XHR.prototype.abort=function(){this.aborted=true;this.onabort();};
 const c={document:{hidden:false,readyState:'loading',getElementById:element,addEventListener:(name,fn)=>{f.handlers[name]=fn;}},
  window:{innerWidth:1920,innerHeight:1080,addEventListener(){},a2sService:function(id){this.start=()=>{f.starts.push(id);};}},
  XMLHttpRequest:XHR,VetroWidgetSession:{read:()=>f.read()},
  tizen:{application:{launch:(id,ok)=>{f.legacy.push(id);ok();},getCurrentApplication:()=>({appInfo:{version:'0.3.5'},
   exit(){f.exits++;if(f.exitError)throw Error('exit refused');}}),
   getAppsInfo:ok=>{f.inventory.push('apps');f.appsReply=ok;if(!f.holdApps)ok([]);}},
   tvinputdevice:{getSupportedKeys:()=>[]},package:{getPackagesInfo:ok=>{f.inventory.push('packages');ok([]);}}},
  webapis:{productinfo:{}},
  setTimeout:(fn,ms)=>{const t={fn,ms};f.timers.push(t);return t;},clearTimeout:t=>{if(t)t.cleared=true;},
  setInterval:(fn,ms)=>{const t={fn,ms};f.intervals.push(t);return t;},clearInterval:t=>{if(t)t.cleared=true;}};
 vm.createContext(c);vm.runInContext(source,c);f.c=c;return f;
}
(async()=>{
 // Opening and manual diagnostics reuse authenticated service ownership.
 let f=fixture(),c=f.c;
 await c.run(false);await c.run(false);
 assert.equal(c.summaryReady,true);assert.equal(f.starts.length,0);assert.equal(f.legacy.length,0);
 assert.ok(f.requests.every(x=>x.headers['X-Vetro-Widget']==='a'.repeat(64)));
 assert.equal(c.report.probe.serviceLaunch.value,'already running');

 // A network failure or unavailable private credential still permits startup.
 for(const privateUnavailable of [false,true]){
  f=fixture();c=f.c;
  if(privateUnavailable)f.read=async()=>{throw Error('Private widget credential is unavailable');};
  else f.answer=xhr=>xhr.onerror();
  await c.launchService();assert.deepEqual(f.starts,['vetrotvapp.svc']);assert.equal(f.legacy.length,0);
 }
 f=fixture();c=f.c;c.window.a2sService=undefined;f.answer=xhr=>xhr.onerror();
 await c.launchService();assert.deepEqual(f.legacy,['vetrotvapp.svc']);

 // An answering service is not started again to repair an HTTP/auth error.
 for(const status of [401,403,503]){
  f=fixture();c=f.c;f.answer=xhr=>f.reply(xhr,status,{});
  await assert.rejects(c.launchService(),error=>error.status===status);
  assert.equal(f.starts.length,0);assert.equal(f.legacy.length,0);
  assert.equal(c.widgetServiceAuthenticated,false,'a response alone does not authenticate the screen');
  assert.equal(f.requests.length,status===401?2:1);
 }
 f=fixture();c=f.c;f.answer=xhr=>{xhr.status=200;xhr.responseText='invalid';xhr.onload();};
 await assert.rejects(c.launchService(),/not JSON/);assert.equal(f.starts.length,0);

 // Back, visibility change and queued timer callbacks share one exit request.
 f=fixture();c=f.c;await c.run(false);
 let closed=0;c.widgetClient={close(){closed++;}};
 const sent=f.requests.length,drawn=f.nodes.screen.innerHTML;
 f.handlers.keydown({keyCode:10009});c.document.hidden=true;f.handlers.visibilitychange();
 f.handlers.keydown({keyCode:10009});f.handlers.keydown({keyCode:13});
 f.timers.filter(t=>t.ms===300000).forEach(t=>t.fn());
 f.intervals.forEach(t=>t.fn());await c.run(true);await flush();
 assert.equal(f.exits,1);assert.equal(closed,1);assert.equal(f.requests.length,sent);
 assert.equal(f.nodes.screen.innerHTML,drawn);assert.equal(f.intervals.filter(t=>!t.cleared).length,0);
 assert.equal(f.timers.filter(t=>!t.cleared).length,0);

 // Cancelled reads cannot retry a late 401 or paint after exit.
 f=fixture();c=f.c;f.answer=()=>{};
 const pending=c.pollScreen();await flush();const held=f.requests[0];
 c.leave();await pending;assert.equal(held.aborted,true);
 f.reply(held,401,{});await flush();
 assert.equal(f.requests.length,1);assert.equal(c.screenSummaryData,null);assert.equal(c.screenTasks.length,0);

 // Closing during startup cancels its probe and never falls back to start().
 f=fixture();c=f.c;f.answer=()=>{};
 const opening=c.run(false);await flush();c.leave();await opening;
 assert.equal(f.starts.length,0);assert.equal(f.legacy.length,0);assert.equal(c.running,false);
 assert.equal(f.requests.length,1);assert.ok(f.timers.every(t=>t.cleared));

 // Late private-filesystem callbacks cannot start a service or send an HTTP request.
 f=fixture();c=f.c;let resolveRead;
 f.read=()=>new Promise(resolve=>{resolveRead=resolve;});
 const launching=c.launchService();await flush();c.leave();
 resolveRead({token:'a'.repeat(64),expires:Date.now()+300000});
 await assert.rejects(launching,/Screen is closing/);
 assert.equal(f.starts.length,0);assert.equal(f.requests.length,0);assert.equal(c.widgetCredential,null);

 // A queued connection retry is cancelled, including its timer.
 f=fixture();c=f.c;f.answer=xhr=>xhr.onerror();
 const reaching=c.reach(3);await flush();assert.ok(f.timers.some(t=>t.ms===1500&&!t.cleared));
 c.leave();await reaching;assert.equal(f.requests.length,1);assert.ok(f.timers.every(t=>t.cleared));

 // Leaving a blocked full inventory skips subsequent native probes and reports.
 f=fixture();c=f.c;f.holdApps=true;
 const inventory=c.run(true);await flush();assert.deepEqual(f.inventory,['apps']);
 c.leave();await inventory;f.appsReply([]);await flush();
 assert.deepEqual(f.inventory,['apps']);assert.equal(f.requests.filter(x=>x.method==='POST').length,0);
 assert.equal(c.running,false);assert.ok(f.timers.every(t=>t.cleared));

 // A synchronous exit refusal must leave a usable screen, not a permanent closing flag.
 f=fixture();c=f.c;await c.run(false);f.exitError=true;c.leave();
 assert.equal(c.leaving,false);assert.equal(f.intervals.filter(t=>!t.cleared).length,2);
 await c.pollScreen();assert.equal(c.summaryReady,true);
 f.exitError=false;c.leave();assert.equal(f.exits,2);assert.equal(c.leaving,true);
 console.log('PASS screen lifecycle: authenticated service reuse, startup fallback, HTTP refusals, single exit, cancellation, late callbacks and exit failure');
})().catch(error=>{console.error(error);process.exitCode=1;});
