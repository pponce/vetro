'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const html = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'index.html'), 'utf8');
const script = /<script>\s*([\s\S]*?)<\/script>/.exec(html)[1];

const GOOD = {version: '0.3.5', port: 8099, address: '192.168.1.42', root: {mode: 'tv-integration', connected: true},
  input: {enabled: false, connected: false}, launcher: {installed: true, enabled: true, running: true, failures: 0, hasError: false}, memory: {availableMb: 612}};

// screen: the /screen body (null: the service answers nothing); probeResponse: the /probe reply.
async function run(options) {
  const o = Object.assign({probeResponse: {ok: true, persisted: true}, screen: GOOD, failFetch: null, appVersion: '0.3.5', hangLaunch: false}, options || {});
  const sent = [], timers = [], listeners = {}, windowListeners = {}, exits = [], launched = [], calls = [], pending = [];
  let sessions = 0;
  const screen = {innerHTML: ''}, stage = {style: {}};
  const elements = {screen,stage,pairing:{hidden:true},pairingCode:{textContent:''},pairingName:{textContent:''},pairingExpiry:{textContent:''},pairingStatus:{textContent:''},sum:{textContent:''}};
  function XHR() {}
  XHR.prototype.open = function (method, url) { this.method = method; this.url = url; };
  XHR.prototype.setRequestHeader = function () {};
  XHR.prototype.send = function (body) {
    const route = this.url.slice('http://127.0.0.1:8099'.length);
    sent.push({method:this.method,url:this.url,body:body ? JSON.parse(body) : undefined});
    if(o.http){const result=o.http(this,route);if(result===false){pending.push(this);return;}}
    if(route==='/status'&&o.failFetch&&o.failFetch.n-- > 0)return this.onerror();
    if(route==='/screen'&&o.screen===null)return this.onerror();
    this.status=this.status||200;
    this.responseText=JSON.stringify(route==='/probe'?o.probeResponse:route==='/screen'?o.screen:route==='/auth/pending'?(o.pairing||{}):{});
    this.onload();
  };
  function WS() { setImmediate(() => this.onopen()); }
  WS.prototype.close = function () {};
  const context = {
    document: {readyState: o.readyState || 'complete', getElementById: id => elements[id], hidden: false, addEventListener: (n, f) => { listeners[n] = f; }},
    window: {a2sService: o.Service, innerWidth: 1920, innerHeight: 1080, addEventListener: (n, f) => { windowListeners[n] = f; }},
    XMLHttpRequest: XHR, WebSocket: WS,
    VetroAppAccess: function(){this.call=async()=>{sessions++;return o.session ? o.session(sessions) : {token:"a".repeat(64),expires:Date.now()+300000};};}, setInterval(){},
    fetch: async () => { if (o.failFetch && o.failFetch.n-- > 0) throw new Error('refused'); return {status: 200}; },
    tizen: {
      tvinputdevice: {getSupportedKeys: () => [{name: 'VolumeUp'}]},
      application: {launch: (id, ok) => { launched.push(id); if (!o.hangLaunch) ok(); }, getAppsInfo: ok => {calls.push('apps');ok([{id: 'vetrotvapp.app', packageId: 'vetrotvapp'}]);},
        getCurrentApplication: () => ({exit: () => exits.push(1), appInfo: {version: o.appVersion}})},
      package: {getPackagesInfo: ok => {calls.push('packages');if(!o.hangPackages)ok([{id: 'vetrotvapp', version: '0.1.0'}]);}},
      systeminfo: {getPropertyValue: (name, ok) => ok({model: 'TV'})}
    }, webapis: {productinfo: {getModel: () => 'QE55Q80A', getFirmware: () => '2310.0'}},
    btoa: s => Buffer.from(s).toString('base64'), clearTimeout: id => {if(timers[id-1])timers[id-1].cleared=true;},
    setTimeout: (f, ms) => { if (ms === 1500) { setImmediate(f); return 0; } timers.push({f, ms}); return timers.length; }
  };
  vm.runInNewContext(script, context);   // its value is the page's run() promise, which a stuck call leaves pending
  // run() is not awaited by the page: let its promise chain settle.
  for (let i = 0; i < 40; i++) await new Promise(r => setImmediate(r));
  const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(r => setImmediate(r)); };
  if(o.full!==false&&o.readyState!=='loading'&&!o.hangLaunch){await context.run(true);await settle();}
  return {settle, sent, timers, exits, launched, listeners, windowListeners, screen, stage, context, elements, calls, pending, sessions:()=>sessions};
}
const key = (r, keyCode) => r.listeners.keydown({keyCode});

(async function () {
  assert.ok(html.includes("<script type=\"module\">import { Service } from 'wrt:service'; window.a2sService = Service;</script>"));
  // The classic script must wait for the later module before choosing a launcher.
  const deferred = await run({readyState: 'loading'}), started = [];
  assert.equal(deferred.launched.length, 0);
  assert.equal(deferred.sent.filter(s => s.method === 'POST').length, 0);
  deferred.context.window.a2sService = function (id) {
    this.start = () => { started.push(id); return Promise.resolve(); };
  };
  deferred.listeners.DOMContentLoaded();
  await deferred.settle();
  assert.deepEqual(started, ['vetrotvapp.svc']);
  assert.equal(deferred.launched.length, 0);
  assert.equal(deferred.context.report.probe.serviceLaunch.ok, true);
  assert.equal(deferred.sent.filter(s => s.method === 'POST').length, 0);
  const noReturn = await run({Service: function () { this.start = () => {}; }});
  assert.equal(noReturn.sent.find(s => s.method === 'POST').body.probe.serviceLaunch.ok, true);
  assert.equal(noReturn.launched.length, 0);
  for (const synchronous of [false, true]) {
    const refused = await run({screen: null, Service: function () {
      this.start = () => { if (synchronous) throw new Error('refused <start>'); return Promise.reject(new Error('refused <start>')); };
    }});
    assert.equal(refused.launched.length, 0);
    assert.equal(refused.sent.find(s => s.method === 'POST').body.probe.serviceLaunch.error, 'launch failed (wrt:service: refused <start>)');
    assert.ok(refused.screen.innerHTML.includes('launch failed (wrt:service: refused &lt;start&gt;)'));
  }
  // Missing/unsupported module on an older runtime leaves the legacy launcher available.
  const older = await run({readyState: 'loading'});
  older.listeners.DOMContentLoaded();
  await older.settle();
  assert.deepEqual(older.launched, ['vetrotvapp.svc']);
  assert.deepEqual(older.calls, [], 'opening never invokes app or package enumeration');
  // Healthy TV: the probe report is still sent, and the screen says so.
  const good = await run();
  const posts = good.sent.filter(s => s.method === 'POST');
  assert.equal(posts.length, 1, 'widget must still POST its collected report');
  assert.equal(posts[0].url, 'http://127.0.0.1:8099/probe');
  assert.equal(posts[0].body.apps[0].id, 'vetrotvapp.app');
  assert.equal(posts[0].body.probe.serviceReach.ok, true);
  assert.deepEqual(good.launched, ['vetrotvapp.svc','vetrotvapp.svc'], 'the page starts the background service itself');
  assert.ok(good.sent.some(s => s.method === 'GET' && s.url === 'http://127.0.0.1:8099/screen'));
  assert.ok(good.screen.innerHTML.includes('Running in the background'));
  assert.ok(good.screen.innerHTML.includes('You can close this screen, Vetro keeps running without it.'));
  assert.ok(good.screen.innerHTML.includes('http://192.168.1.42:8099'));
  assert.ok(good.screen.innerHTML.includes('QE55Q80A'), 'model comes from the TV itself');
  assert.ok(good.screen.innerHTML.includes('V0.3.5 &middot; QE55Q80A 2310.0 &middot; svc ok &middot; root ok'), 'the support line');
  assert.ok(!/class="c (bad|warn)/.test(good.screen.innerHTML));
  assert.match(good.stage.style.transform, /^scale\(1\)$/);

  // The PIN slot of 0.4.0 exists but is hidden until the service sends one.
  assert.ok(/id="pin" hidden/.test(good.screen.innerHTML), 'the PIN slot is reserved and hidden');
  const pinned = await run({screen: Object.assign({}, GOOD, {pin: '4829'})});
  assert.ok(/id="pin">PIN<b>4829<\/b>/.test(pinned.screen.innerHTML), 'a PIN sent by the service is shown');

  // The page stays up while the user reads; Back leaves; OK checks again; idle leaves.
  assert.equal(good.exits.length, 0);
  assert.ok(!good.timers.some(t => t.ms === 5000), 'no more closing 5 seconds after the report');
  assert.ok(good.timers.some(t => t.ms === 300000), 'an idle screen closes itself');
  key(good, 13);
  for (let i = 0; i < 40; i++) await new Promise(r => setImmediate(r));
  assert.equal(good.sent.filter(s => s.method === 'POST').length, 2, 'OK runs the checks again');
  key(good, 10009);
  assert.equal(good.exits.length, 1, 'Back closes the screen');
  const idle = good.timers.filter(t => t.ms === 300000).pop();
  idle.f();
  assert.equal(good.exits.length, 2);

  // Errors are loud and say what to do.
  const root = await run({screen: Object.assign({}, GOOD, {root: {mode: 'app-only', connected: false}})});
  assert.ok(root.screen.innerHTML.includes('Running, with limits'));
  assert.ok(!root.screen.innerHTML.includes('You can close this screen'), 'the all-clear is only said when everything is green');
  assert.ok(root.screen.innerHTML.includes('app-only package'));
  assert.ok(root.screen.innerHTML.includes('<em class="w">ROOT NO</em>'));
  const failed = await run({screen: Object.assign({}, GOOD, {launcher: {installed: true, enabled: true, running: false, failures: 4, hasError: true}, memory: {availableMb: 148}})});
  assert.ok(failed.screen.innerHTML.includes('Needs attention'));
  assert.ok(failed.screen.innerHTML.includes('Failed to start'));
  assert.ok(failed.screen.innerHTML.includes('Tried 4 times'));
  assert.ok(failed.screen.innerHTML.includes('<em>LAUNCHER FAIL x4</em>'));
  assert.ok(failed.screen.innerHTML.includes('1 problem<'), 'the summary counts problems');
  assert.ok(failed.screen.innerHTML.includes('MEM 148M'));
  const mismatch = await run({appVersion: '0.3.2'});
  assert.ok(mismatch.screen.innerHTML.includes('Version differs'), 'an app and a service of different versions are named');

  // Service down: the page still draws itself, with no invented facts.
  const down = await run({screen: null});
  assert.ok(down.screen.innerHTML.includes('Connection needs attention'));
  assert.ok(down.screen.innerHTML.includes('Address unavailable'));
  assert.ok(down.screen.innerHTML.includes('SVC UNVERIFIED'));
  assert.ok(!down.screen.innerHTML.includes('You can close this screen'));
  assert.ok(down.screen.innerHTML.includes('QE55Q80A'), 'model and firmware come from the TV, not the service');

  // A service still starting is retried; a refused report keeps the page open for diagnosis.
  const slow = await run({failFetch: {n: 2}});
  assert.equal(slow.sent.find(s => s.method === 'POST').body.probe.serviceReach.ok, true);
  const bad = await run({probeResponse: {}});
  bad.context.document.hidden = true;
  bad.listeners.visibilitychange();
  assert.equal(bad.exits.length, 0, 'a rejected report is not a delivered one');
  const leaving = await run();
  leaving.context.document.hidden = true;
  leaving.listeners.visibilitychange();
  assert.equal(leaving.exits.length, 1, 'a delivered page leaves when the user goes elsewhere');
  // A Tizen call that never answers must not keep the screen on "Checking": its probe times out and the rest goes on.
  const hung = await run({hangLaunch: true});
  assert.ok(hung.screen.innerHTML.includes('Checking'), 'still waiting for the stuck call');
  const limit = hung.timers.find(t => t.ms === 8000);
  assert.ok(limit, 'every probe has a time limit');
  limit.f();
  await hung.settle();
  const report = hung.context.report;
  assert.equal(report.probe.serviceLaunch.ok, false);
  assert.ok(/no answer/.test(report.probe.serviceLaunch.error));
  assert.equal(report.probe.serviceReach.ok, true, 'the probes after the stuck one still run');
  assert.ok(!hung.context.running, 'the screen leaves the waiting state');
  // While the checks run the screen says what it is doing: placeholders for each check, a turning ring, a step counter.
  const waiting = await run({hangLaunch: true});
  assert.ok(waiting.screen.innerHTML.includes('class="c wait"'), 'one placeholder per check while waiting');
  assert.ok(waiting.screen.innerHTML.includes('Root access'));
  assert.ok(waiting.screen.innerHTML.includes('Vetro is checking the service connection'));
  assert.ok(!waiting.screen.innerHTML.includes('Asking for help') || !waiting.screen.innerHTML.includes('SVC'), 'no verdict while waiting');
  assert.ok(/<style>[\s\S]*@keyframes spin/.test(html), 'the waiting ring turns');
  // A fresh launch must show a code without ever invoking the blocking inventory APIs.
  const quick = await run({full:false,pairing:{code:'123456',name:'Browser',expiresIn:110},hangPackages:true});
  assert.deepEqual(quick.calls, []);
  assert.equal(quick.elements.pairing.hidden, false);
  assert.equal(quick.elements.pairingCode.textContent, '123456');
  assert.ok(quick.screen.innerHTML.includes('Full check not run'));
  assert.equal(quick.sent.filter(s=>s.method==='POST').length,0,'quick checks preserve the previous complete service report');
  key(quick,13);await quick.settle();
  assert.deepEqual(quick.calls,[],'OK cannot start a blocking inventory while a code is displayed');
  assert.equal(quick.timers.filter(t=>t.ms===300000&&!t.cleared).length,0,'no idle close while pairing');

  const newPairing={};
  const requestedDuringStart=await run({full:false,pairing:newPairing,hangPackages:true});
  Object.assign(newPairing,{code:'654321',name:'Installer',expiresIn:120});
  key(requestedDuringStart,13);await requestedDuringStart.settle();
  assert.deepEqual(requestedDuringStart.calls,[],'a newly discovered request interrupts full inventory before it blocks painting the code');
  assert.equal(requestedDuringStart.elements.pairingCode.textContent,'654321');
  assert.equal(requestedDuringStart.sent.filter(s=>s.method==='POST').length,0);

  // The idle clock starts after healthy results, never while waiting or on errors.
  for(const result of [root,failed,down,waiting,bad])assert.equal(result.timers.filter(t=>t.ms===300000&&!t.cleared).length,0);
  const hangingInventory=await run({full:false,hangPackages:true});
  const beforeCheck=hangingInventory.timers.filter(t=>t.ms===300000&&!t.cleared).pop();
  assert.ok(beforeCheck);
  key(hangingInventory,13);await hangingInventory.settle();
  assert.equal(hangingInventory.context.running,true);
  assert.equal(beforeCheck.cleared,true);
  beforeCheck.f();
  assert.equal(hangingInventory.exits.length,0,'an already queued idle callback cannot close an active check');
  const packageLimit=hangingInventory.timers.filter(t=>t.ms===8000&&!t.cleared).pop();
  packageLimit.f();await hangingInventory.settle();
  assert.equal(hangingInventory.context.running,false);
  assert.ok(hangingInventory.screen.innerHTML.includes('packages'));
  assert.equal(hangingInventory.timers.filter(t=>t.ms===300000&&!t.cleared).length,0,'failed full diagnostics remain visible');

  // Stale sessions after a service restart are renewed only on explicit HTTP 401.
  const restarting=await run({full:false,http(xhr,route){if(route==='/auth/pending'&&!this.refused){this.refused=true;xhr.status=401;}}});
  assert.equal(restarting.sessions(),2);
  assert.equal(restarting.context.pairingBusy,false);
  assert.equal(restarting.context.pairingError,'');
  const rejected=await run({full:false,session(){throw Error('Trusted port unavailable');}});
  assert.ok(rejected.elements.pairingStatus.textContent.includes('Trusted port unavailable'));
  assert.ok(rejected.screen.innerHTML.includes('Trusted port unavailable'));
  assert.ok(!rejected.screen.innerHTML.includes('service is down'));
  const invalid=await run({full:false,session(n){return n===1?{token:'invalid',expires:Date.now()+300000}:{token:'b'.repeat(64),expires:Date.now()+300000};}});
  assert.ok(invalid.sessions()>1,'a validation failure must not poison the cached connection promise');
  await invalid.context.pollPairing();
  assert.equal(invalid.context.pairingError,'');

  // A stalled HTTP request is bounded and does not stop all future code polls.
  const stalled=await run({full:false,http(xhr,route){if(route==='/auth/pending')return false;}});
  assert.equal(stalled.pending[0].timeout,4000);
  stalled.pending[0].ontimeout();await stalled.settle();
  assert.equal(stalled.context.pairingBusy,false);
  assert.ok(stalled.elements.pairingStatus.textContent.includes('timed out'));
  const retry=stalled.context.pollPairing();
  assert.equal(stalled.context.pairingBusy,true);
  await stalled.settle();stalled.pending[1].ontimeout();await retry;
  assert.equal(stalled.context.pairingBusy,false);
  const malformed=await run({full:false,pairing:'invalid'});
  assert.equal(malformed.context.pairingBusy,false);
  assert.ok(malformed.elements.pairingStatus.textContent.includes('Pairing response is invalid'));
  // No pairing code, token or pairing body is ever posted as diagnostic data.
  for(const request of good.sent.filter(s=>s.method==='POST'))assert.ok(!JSON.stringify(request.body).includes('"token"'));
  console.log('PASS TV screen: probe report kept, quick pairing, manual inventory, visible connection failures, stale sessions, bounded polls, safe idle');
})().catch(e => {console.error(e); process.exitCode = 1;});
