'use strict';
const assert=require('assert').strict, fs=require('fs'), vm=require('vm');
const script=/<script>\s*([\s\S]*?)<\/script>/.exec(fs.readFileSync(require.resolve('../index.html'),'utf8'))[1];
const flush=()=>new Promise(setImmediate);
const GOOD={version:'0.5.0',port:8099,address:'192.0.2.10',root:{mode:'tv-integration',connected:true},input:{enabled:true,connected:true},launcher:{installed:true,enabled:true,running:true,failures:0},memory:{availableMb:500}};
function fixture(){
 const f={requests:[],inventory:[],starts:[],exits:0,handlers:{},timers:[],intervals:[],nodes:{},pending:[],screen:GOOD,status:200};
 const node=id=>f.nodes[id]||(f.nodes[id]={style:{},innerHTML:'',textContent:''});
 function XHR(){}
 XHR.prototype.open=function(method,url){this.method=method;this.route=url.replace('http://127.0.0.1:8099','');};
 XHR.prototype.setRequestHeader=function(){};
 XHR.prototype.abort=function(){this.aborted=true;if(this.onabort)this.onabort();};
 XHR.prototype.send=function(body){this.body=body;f.requests.push(this);if(f.hold&&f.hold(this)){f.pending.push(this);return;}f.answer(this);};
 f.answer=x=>{if(x.route==='/status'&&f.status===0)return x.onerror();x.status=x.route==='/status'?f.status:200;x.responseText=JSON.stringify(x.route.startsWith('/screen')?f.screen:x.route==='/probe'?{ok:true}:x.route==='/auth/pending'?{code:'123456',name:'Browser',expiresIn:90}:{});x.onload();};
 const c={document:{hidden:false,readyState:'loading',getElementById:node,addEventListener:(name,fn)=>{f.handlers[name]=fn;}},
 window:{innerWidth:1920,innerHeight:1080,addEventListener(){},a2sService:function(){this.start=()=>{f.starts.push(1);return Promise.resolve();};}},
 XMLHttpRequest:XHR,WebSocket:function(){this.close=function(){};setImmediate(()=>this.onopen());},btoa:value=>Buffer.from(value).toString('base64'),
 tizen:{application:{getCurrentApplication:()=>({appInfo:{version:'0.5.0'},exit(){f.exits++;if(f.exitError)throw Error('refused');}}),launch(){throw Error('Unexpected legacy start');},getAppsInfo(ok){f.inventory.push('apps');if(f.holdApps)f.appsReply=ok;else ok([]);}},
 package:{getPackagesInfo(ok){f.inventory.push('packages');ok([]);}},tvinputdevice:{getSupportedKeys(){return[];}},systeminfo:{getCapability(){return'9.0';},getPropertyValue(name,ok){ok({});}}},
 webapis:{productinfo:{getModel:()=> 'Test TV',getFirmware:()=> '1.0'}},
 setTimeout(fn,ms){const t={fn,ms,cleared:false};f.timers.push(t);return t;},clearTimeout(t){if(t)t.cleared=true;},
 setInterval(fn,ms){const t={fn,ms,cleared:false};f.intervals.push(t);return t;},clearInterval(t){if(t)t.cleared=true;},console};
 vm.createContext(c);vm.runInContext(script,c);f.c=c;f.html=()=>node('screen').innerHTML;return f;
}
(async()=>{
 let f=fixture(),c=f.c;await c.run(false);await flush();
 assert.deepEqual(f.inventory,[]);assert.equal(f.starts.length,0,'reuse an answering service');
 assert.equal(c.report.progress.of,5);assert.equal(c.report.settings.model,'Test TV');assert.equal(c.report.settings.platformVersion,'9.0');
 assert.match(f.html(),/Full check available/);assert.match(f.html(),/123 456/);assert.equal(c.report.probe.apps,undefined);
 await c.run(true);await flush();assert.deepEqual(f.inventory,['apps','packages']);assert.equal(c.report.progress.of,9);
 const report=c.report,launch=c.lastScreen.launcher,count=f.requests.length,idles=f.timers.filter(t=>t.ms===300000).length;
 f.screen={...GOOD,input:{enabled:true,connected:false},launcher:{...GOOD.launcher,running:null}};await c.pollScreen();
 assert.equal(c.report,report);assert.equal(c.lastScreen.launcher,launch);assert.match(f.html(),/Remote input disconnected/);
 assert.equal(f.requests.slice(count).length,1);assert.equal(f.requests.at(-1).route,'/screen?live=1');assert.equal(f.requests.at(-1).method,'GET');
 assert.equal(f.timers.filter(t=>t.ms===300000).length,idles,'live refresh must not reset idle timeout');
 f.screen=GOOD;await c.pollScreen();assert.match(f.html(),/input ok/);
 f.hold=x=>x.route==='/screen?live=1';const held=c.pollScreen();await flush();await c.pollScreen();assert.equal(f.pending.length,1);
 f.pending.shift().ontimeout();await held;assert.match(f.html(),/Status update unavailable/);assert.ok(!f.html().includes('root ok'));
 f.hold=null;await c.pollScreen();assert.match(f.html(),/root ok/);
 // A stale live read cannot replace a manual check or repaint after close.
 f.hold=x=>x.route==='/screen?live=1';const old=c.pollScreen();await flush();const oldXhr=f.pending.shift();
 f.screen={...GOOD,input:{enabled:false,connected:false}};await c.run(false);f.screen=GOOD;f.answer(oldXhr);await old;
 assert.equal(c.lastScreen.input.enabled,false);
 const waiting=c.pollScreen();await flush();const late=f.pending.shift(),sent=f.requests.length;
 c.leave();await waiting;f.answer(late);f.handlers.keydown({keyCode:10009});f.handlers.keydown({keyCode:13});f.intervals.forEach(t=>t.fn());
 f.timers.filter(t=>t.ms===300000).forEach(t=>t.fn());await flush();
 assert.equal(f.exits,1);assert.equal(f.requests.length,sent);assert.equal(late.aborted,true);assert.ok(f.intervals.every(t=>t.cleared));
 assert.equal(c.screenTasks.length,0);
 // An HTTP refusal proves a listener exists; do not start another service.
 for(const status of [401,403,503]){f=fixture();f.status=status;await assert.rejects(f.c.launchService(),/HTTP/);assert.equal(f.starts.length,0);}
 f=fixture();f.status=0;await f.c.launchService();assert.equal(f.starts.length,1);
 // First summary failure recovers without app/package inventory or another start.
 f=fixture();c=f.c;f.screen=null;await c.run(false);assert.equal(c.lastScreen,null);f.screen=GOOD;await c.pollScreen();assert.match(f.html(),/root ok/);assert.deepEqual(f.inventory,[]);
 assert.equal(f.requests.at(-1).route,'/screen','initial recovery obtains the launcher verdict once');
 // Leaving during full inventory cancels the chain and its late native callback.
 f=fixture();c=f.c;f.holdApps=true;const full=c.run(true);for(let i=0;i<5;i++)await flush();assert.deepEqual(f.inventory,['apps']);c.leave();await full;f.appsReply([{id:'late'}]);await flush();
 assert.deepEqual(f.inventory,['apps']);assert.equal(c.report.apps.length,0);assert.equal(c.screenTasks.length,0);
 // A refused exit can be tried again and resumes status/pairing polling.
 f=fixture();c=f.c;await c.run(false);f.exitError=true;c.leave();assert.equal(c.leaving,false);assert.equal(f.intervals.filter(t=>!t.cleared).length,3);f.exitError=false;c.leave();assert.equal(f.exits,2);
 console.log('PASS quick screen and lifecycle: opt-in inventory, pairing, service reuse, bounded live recovery, stale replies and one cancellable exit');
})().catch(e=>{console.error(e);process.exitCode=1;});
