'use strict';
const assert=require('assert').strict,fs=require('fs'),vm=require('vm');
const source=/<script>\s*([\s\S]*?)<\/script>/.exec(fs.readFileSync(require.resolve('../index.html'),'utf8'))[1];
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const GOOD={version:'0.3.5',port:8099,address:'192.0.2.10',root:{mode:'tv-integration',connected:true},
 input:{enabled:true,connected:true},launcher:{installed:true,enabled:false},memory:{availableMb:400}};
function fixture(){
 const f={requests:[],reads:0,nodes:{},handlers:{},intervals:[],token:'a'.repeat(64),accepted:'b'.repeat(64)};
 const element=id=>f.nodes[id]||(f.nodes[id]={innerHTML:'',textContent:'',hidden:false,style:{}});
 f.reply=(xhr,status,body)=>{xhr.status=status;xhr.responseText=JSON.stringify(body);xhr.onload();};
 f.answer=xhr=>f.reply(xhr,xhr.headers['X-Vetro-Widget']===f.accepted?200:401,
  xhr.route.indexOf('/screen')===0?GOOD:xhr.route==='/probe'?{ok:true}:{});
 function XHR(){this.headers={};}
 XHR.prototype.open=function(method,url){this.method=method;this.route=url.replace('http://127.0.0.1:8099','');};
 XHR.prototype.setRequestHeader=function(name,value){this.headers[name]=value;};
 XHR.prototype.send=function(body){this.body=body;f.requests.push(this);f.answer(this);};
 const c={document:{hidden:false,readyState:'loading',getElementById:element,addEventListener:(name,fn)=>{f.handlers[name]=fn;}},
  window:{innerWidth:1920,innerHeight:1080,addEventListener(){}},XMLHttpRequest:XHR,
  VetroWidgetSession:{read:async()=>{f.reads++;if(f.readError)throw Error('Private widget credential is not available');
   return {token:f.token,expires:Date.now()+300000};}},
  tizen:{application:{getCurrentApplication:()=>({appInfo:{version:'0.3.5'},exit(){}})}},
  setInterval:(fn,ms)=>f.intervals.push({fn,ms}),setTimeout:()=>1,clearTimeout(){},console};
 vm.createContext(c);vm.runInContext(source,c);f.c=c;
 c.attempt=async name=>{c.report.probe[name]={ok:true};};
 f.tick=()=>f.intervals.find(item=>item.ms===5000).fn();
 f.html=()=>element('screen').innerHTML;
 return f;
}
(async()=>{
 // Startup cannot authenticate, then the private credential becomes current.
 let f=fixture(),c=f.c;
 await c.run(false);
 assert.equal(c.screenSummaryData,null);assert.equal(c.summaryReady,false);assert.equal(c.running,false);
 assert.match(f.html(),/Service reachable; reconnecting authentication/);
 assert.ok(!f.html().includes('Connection needs attention'));assert.equal(c.canIdle,false);
 const firstCount=f.requests.length;
 await f.tick();assert.equal(f.requests.length,firstCount+2,'a stale credential gets one immediate renewal, then waits for the next poll');
 assert.equal(c.liveScreenBusy,false);assert.equal(c.screenSummaryData,null);
 f.token=f.accepted;
 await f.tick();
 assert.equal(c.summaryReady,true);assert.equal(c.widgetServiceAuthenticated,true);
 assert.match(f.html(),/svc ok/);assert.match(f.html(),/input ok/);assert.match(f.html(),/Full check not run/);
 assert.ok(!f.html().includes('AUTH WAIT'));assert.ok(!f.html().includes('Report not saved'));
 assert.equal(c.screenError,'');assert.equal(c.screenConnectionError,null);assert.equal(c.fullCheck,false);
 assert.ok(f.requests.slice(firstCount).every(x=>x.method==='GET'&&x.route==='/screen'),'first-summary recovery only reads status');
 await f.tick();assert.equal(f.requests.at(-1).route,'/screen?live=1','successful recovery switches to lightweight live reads');
 f.accepted='c'.repeat(64);await f.tick();
 assert.match(f.html(),/Service reachable; reconnecting authentication/);assert.equal(c.screenSummaryData.input.available,false);
 f.token=f.accepted;await f.tick();assert.match(f.html(),/input ok/);assert.ok(!f.html().includes('AUTH WAIT'));

 // A missing private file is retried without claiming an HTTP response occurred.
 f=fixture();c=f.c;f.readError=true;
 await c.run(false);assert.equal(f.requests.length,0);
 assert.match(f.html(),/Waiting for screen authentication/);assert.ok(!f.html().includes('Service reachable'));
 f.readError=false;f.token=f.accepted;await f.tick();assert.equal(c.summaryReady,true);

 // A 401 followed by unavailable private storage still proves service reachability.
 f=fixture();c=f.c;
 f.answer=xhr=>{f.readError=true;f.reply(xhr,401,{});};
 await c.pollScreen();assert.match(f.html(),/Service reachable; reconnecting authentication/);
 f.readError=false;f.token=f.accepted;f.answer=xhr=>f.reply(xhr,200,GOOD);
 await f.tick();assert.equal(c.summaryReady,true);

 // Timeouts and HTTP failures remain distinct from an explicit auth refusal.
 for(const mode of ['timeout','network','503','json']){
  f=fixture();c=f.c;f.token=f.accepted;
  f.answer=xhr=>{
   if(mode==='timeout')xhr.ontimeout();else if(mode==='network')xhr.onerror();
   else if(mode==='503')f.reply(xhr,503,{});else{xhr.status=200;xhr.responseText='invalid';xhr.onload();}
  };
  await c.run(false);assert.equal(c.summaryReady,false);assert.match(f.html(),/Connection needs attention/);
  assert.ok(!f.html().includes('AUTH WAIT'));assert.equal(c.liveScreenBusy,false);
  f.answer=xhr=>f.reply(xhr,200,GOOD);await f.tick();assert.equal(c.summaryReady,true);
 }

 // Hidden screens do no work; a single bounded summary read remains in flight.
 f=fixture();c=f.c;f.token=f.accepted;
 c.document.hidden=true;await f.tick();assert.equal(f.requests.length,0);
 c.document.hidden=false;f.answer=()=>{};
 const pending=f.tick();await flush();const held=f.requests[0];assert.equal(held.timeout,12000);
 await f.tick();await f.tick();assert.equal(f.requests.length,1);
 c.document.hidden=true;f.handlers.visibilitychange();c.document.hidden=false;f.handlers.visibilitychange();
 f.reply(held,200,GOOD);await pending;assert.equal(c.screenSummaryData,null,'hidden epoch invalidates old initial summaries');
 f.answer=xhr=>f.reply(xhr,200,GOOD);await f.tick();assert.equal(c.summaryReady,true);

 // A read started before a manual check cannot replace that check's summary.
 f=fixture();c=f.c;f.token=f.accepted;f.answer=()=>{};
 const old=f.tick();await flush();const oldRead=f.requests[0];
 f.answer=xhr=>f.reply(xhr,200,xhr.route==='/screen'?{...GOOD,input:{enabled:false,connected:false}}:{});
 await c.run(false);assert.equal(c.screenSummaryData.input.enabled,false);
 f.reply(oldRead,200,GOOD);await old;assert.equal(c.screenSummaryData.input.enabled,false);

 // A delayed old-token 401 cannot clear an already authenticated replacement.
 f=fixture();c=f.c;f.answer=()=>{};
 const delayed=c.widgetRequest('GET','/status',undefined,4000);await flush();const refused=f.requests[0];
 c.widgetCredential={token:f.accepted,expires:Date.now()+300000};c.widgetServiceAuthenticated=true;
 f.reply(refused,401,{});await flush();
 assert.equal(c.widgetCredential.token,f.accepted);assert.equal(c.widgetServiceAuthenticated,true);
 assert.equal(f.requests[1].headers['X-Vetro-Widget'],f.accepted);
 f.reply(f.requests[1],200,{});await delayed;

 // Report persistence failures are not erased by a recovered status connection.
 f=fixture();c=f.c;f.token=f.accepted;
 f.answer=xhr=>f.reply(xhr,xhr.route==='/probe'?500:200,xhr.route.indexOf('/screen')===0?GOOD:{});
 await c.run(true);assert.equal(c.delivered,false);assert.match(f.html(),/Report not saved/);
 await f.tick();assert.match(f.html(),/Report not saved/);assert.equal(c.fullCheck,true);
 assert.equal(f.requests.filter(x=>x.method==='POST').length,1,'background polling does not retry report writes');
 console.log('PASS screen authentication recovery: initial 401/storage/network failures, automatic retry, bounded reads, epochs, stale-token refusal and preserved report errors');
})().catch(error=>{console.error(error);process.exitCode=1;});
