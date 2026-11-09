'use strict';
const assert = require('assert').strict, path = require('path'), EventEmitter = require('events');
const starts = [], timers = [];
class Bridge {
  constructor(execute, onEvent) { this.onEvent = onEvent; this.current = {mode: 'off', connected: false}; }
  inventory() { return Promise.resolve([{name: 'Smart Control', node: '/dev/input/event4', selectable: true, unique: true}]); }
  status() { return {policy: this.current, events: []}; }
  stop() { this.current = {mode: 'off', connected: false}; }
  async start(device, mode, tokens, homeEnabled) {
    starts.push({device, mode, tokens, homeEnabled});
    this.current = {mode, connected: true, device: 'Smart Control', node: '/dev/input/event4'};
    return this.status();
  }
}
const h = require('./service-harness.cjs')(path.resolve(__dirname, '..'), {
  dependencies: {'./physical-input.js': {Bridge}, './platform.js': {start() {}, status: () => ({agent: {connected: true}}), execute: () => Promise.resolve({exit_code: 0, stdout: ''})}},
  setInterval: fn => {timers.push(fn); return {unref() {}};}
});
function post(body) {
  return new Promise(resolve => {
    const req = new EventEmitter(); req.method = 'POST'; req.url = '/input';
    h.router(req, {writeHead(code) {this.code = code;}, end(body) {resolve({code: this.code, data: JSON.parse(body)});}});
    req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end');
  });
}
const tick = async () => {h.context.restoreInput(); await new Promise(resolve => setImmediate(resolve));};
(async () => {
  const c = h.context;
  let state = {enabled: true, customApp: null};
  c.dock.readState = () => state;
  c.remapStore.rules = [];
  c.remapStore.input = {enabled: true, device: 'Smart Control', node: '/dev/input/event4'};
  await tick();
  assert.equal(starts.length, 1, 'saved remote reconnects for Home without another shortcut');
  assert.equal(starts[0].homeEnabled, true); assert.equal(starts[0].tokens.length, 0);
  c.physical.onEvent({action: 'down', decision: 'blocked', code: 63});
  await c.actionQueue;
  assert.equal(c.pendingActions, 0, 'native-routed Home is not dispatched twice by the service');
  c.stopInput(); state = {enabled: false, customApp: 'org.example.Home'};
  await tick(); assert.equal(starts.length, 2, 'custom launcher also restores direct delivery');
  c.stopInput(); state = {enabled: false, customApp: null};
  await tick(); assert.equal(starts.length, 2, 'Samsung mode with no shortcuts needs no interception');
  state.enabled = true; c.remapStore.input = {enabled: false};
  await tick(); assert.equal(starts.length, 2, 'explicit interception off is respected');
  c.remapStore.input = {enabled: true, device: 'Smart Control', node: '/dev/input/event4'};
  await post({mode: 'observe', device: '/dev/input/event4'});
  const count = starts.length; await tick();
  assert.equal(starts.length, count, 'listening does not restart direct interception');
  console.log('PASS direct Home: empty shortcut list, saved remote recovery, custom mode, no duplicate service action, persistent off and listening');
})().catch(error => {console.error(error); process.exitCode = 1;});
