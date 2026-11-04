'use strict';
const assert=require('assert').strict,fs=require('fs'),vm=require('vm');
const source=/<script>\s*([\s\S]*?)<\/script>/.exec(fs.readFileSync(require.resolve('../index.html'),'utf8'))[1];
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const clone=value=>JSON.parse(JSON.stringify(value));
const GOOD={version:'0.3.5',port:8099,address:'192.0.2.10',root:{mode:'tv-integration',connected:true},
 input:{enabled:true,connected:true,recovering:false},launcher:{installed:true,enabled:true,running:true},memory:{availableMb:400}};
function fixture(){
 const f={requests:[],live:[],timers:[],intervals:[],handlers:{},nodes:{},fullResponse:clone(GOOD)};
 const element=id=>f.nodes[id]||(f.nodes[id]={innerHTML:'',textContent:'',hidden:false,style:{}});
 function XHR(){}
 XHR.prototype.open=function(method,url){this.method=method;this.route=url.replace('http://127.0.0.1:8099','');};
 XHR.prototype.setRequestHeader=function(){};
 XHR.prototype.send=function(body){
  f.requests.push({method:this.method,route:this.route,body});
  if(this.route==='/screen?live=1'){f.live.push(this);return;}
  this.status=200;this.responseText=JSON.stringify(this.route==='/screen'?f.fullResponse:this.route==='/probe'?{ok:true}:{});this.onload();
 };
 const context={document:{hidden:false,readyState:'loading',getElementById:element,addEventListener:(name,fn)=>{f.handlers[name]=fn;}},
  window:{innerWidth:1920,innerHeight:1080,addEventListener(){}},XMLHttpRequest:XHR,
  VetroWidgetSession:{read:async()=>({token:'a'.repeat(64),expires:Date.now()+300000})},
  tizen:{application:{getCurrentApplication:()=>({appInfo:{version:'0.3.5'},exit(){}})}},
  setInterval:(fn,ms)=>{f.intervals.push({fn,ms});},
  setTimeout:(fn,ms)=>{f.timers.push({fn,ms,cleared:false});return f.timers.length;},
  clearTimeout:id=>{if(f.timers[id-1])f.timers[id-1].cleared=true;},console};
 vm.createContext(context);vm.runInContext(source,context);f.context=context;
 f.seed=data=>{context.fullCheck=true;context.report.probe={tizenObject:{ok:true},webapisObject:{ok:true},apps:{ok:true},packages:{ok:true}};
  context.screenSummaryData=clone(data);context.screenInputReadAt=1;context.render(context.screenSummaryData,false);context.resetIdle();};
 f.respond=(xhr,data)=>{xhr.status=200;xhr.responseText=JSON.stringify(data);xhr.onload();};
 f.poll=async(data=GOOD)=>{const pending=context.pollScreen();await flush();f.respond(f.live[f.live.length-1],data);await pending;};
 f.html=()=>element('screen').innerHTML;
 return f;
}
(async()=>{
 let f=fixture(),c=f.context;
 assert.equal(f.intervals.filter(timer=>timer.ms===5000).length,1);
 await c.pollScreen();assert.equal(f.requests.length,0,'no polling before a summary exists');
 f.seed({...GOOD,input:{enabled:true,connected:false,recovering:false}});
 assert.match(f.html(),/Remote input disconnected/);assert.ok(!f.html().includes('Remote not found'));
 const launcher=c.screenSummaryData.launcher,memory=c.screenSummaryData.memory,report=c.report;
 const pending=c.pollScreen();await flush();assert.equal(f.live.length,1);assert.equal(f.live[0].timeout,4000);
 await c.pollScreen();await c.pollScreen();assert.equal(f.live.length,1,'only one live status read can be in flight');
 f.respond(f.live[0],{...GOOD,launcher:{installed:true,enabled:true,running:null},memory:{availableMb:10}});await pending;
 assert.match(f.html(),/Filtering/);assert.ok(!f.html().includes('INPUT LOST'));
 assert.equal(c.screenSummaryData.launcher,launcher);assert.equal(c.screenSummaryData.memory,memory);assert.equal(c.report,report);
 assert.match(f.html(),/launcher ok/);assert.match(f.html(),/api ok/);assert.equal(c.fullCheck,true);
 assert.ok(c.screenInputReadAt>1);
 assert.ok(f.requests.every(request=>request.method==='GET'&&request.route==='/screen?live=1'),'live refresh runs no probes, launches, inventory or writes');
 const idleTimers=f.timers.filter(timer=>timer.ms===300000).length;
 await f.poll();await f.poll();assert.equal(f.timers.filter(timer=>timer.ms===300000).length,idleTimers,'healthy polls do not restart the idle timeout');
 await f.poll({...GOOD,input:{enabled:true,connected:false,recovering:true}});assert.match(f.html(),/Reconnecting/);
 await f.poll({...GOOD,input:{enabled:true,connected:false,recovering:false}});assert.match(f.html(),/Remote input disconnected/);assert.ok(!f.html().includes('Reconnecting'));
 await f.poll({...GOOD,input:{enabled:false,connected:false,recovering:false}});assert.match(f.html(),/input off/);assert.ok(!f.html().includes('INPUT LOST'));
 await f.poll();const lastRead=c.screenInputReadAt;
 const failed=c.pollScreen();await flush();f.live[f.live.length-1].ontimeout();await failed;
 assert.equal(c.screenSummaryData.input.available,false);assert.equal(c.screenSummaryData.input.enabled,true);assert.equal(c.screenInputReadAt,lastRead);
 assert.match(f.html(),/Input status unavailable/);assert.match(f.html(),/Status update unavailable/);assert.ok(!f.html().includes('input ok'));assert.ok(!f.html().includes('root ok'));
 assert.equal(c.liveScreenBusy,false);assert.equal(c.canIdle,false);
 await f.poll();assert.equal(c.screenSummaryData.input.available,true);assert.match(f.html(),/input ok/);
 await f.poll({...GOOD,input:{enabled:true,connected:'true'}});assert.match(f.html(),/Input status unavailable/,'malformed success cannot become green');
 await f.poll();
 c.document.hidden=true;const count=f.requests.length;await c.pollScreen();assert.equal(f.requests.length,count,'hidden screens do not poll');
 c.document.hidden=false;c.running=true;await c.pollScreen();assert.equal(f.requests.length,count,'full checks pause live reads');c.running=false;
 // A response started before hiding cannot repaint after the screen reappears.
 const old=c.pollScreen();await flush();const oldXhr=f.live[f.live.length-1];
 c.document.hidden=true;f.handlers.visibilitychange();c.document.hidden=false;f.handlers.visibilitychange();
 f.respond(oldXhr,{...GOOD,input:{enabled:true,connected:false}});await old;
 assert.match(f.html(),/input ok/);await f.poll();
 // A response from before a new full check cannot replace the new summary.
 const stale=c.pollScreen();await flush();const staleXhr=f.live[f.live.length-1];
 f.fullResponse={...GOOD,input:{enabled:false,connected:false}};
 c.attempt=async name=>{c.report.probe[name]={ok:true};};
 await c.run(true);assert.equal(c.screenSummaryData.input.enabled,false);
 f.respond(staleXhr,GOOD);await stale;assert.equal(c.screenSummaryData.input.enabled,false);assert.match(f.html(),/input off/);
 assert.equal(c.liveScreenBusy,false);
 console.log('PASS screen live status: recovery refresh, accurate unknown/off/reconnecting states, no repeated probes, single bounded read, visibility/run epochs, preserved full results and idle timeout');
})().catch(error=>{console.error(error);process.exitCode=1;});
