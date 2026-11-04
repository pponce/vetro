'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const fixture = require('./app-access-fixture.cjs');
const loadService = require('./service-harness.cjs');
const {APP_PORT, WIDGET_PORT} = require('../service/app-ports');

function setup(options = {}) {
  const f = fixture(), events = [], pending = [], listeners = new Map();
  let failWidget = !!options.failWidget;
  const resolve = f.tizen.filesystem.resolve;
  f.tizen.filesystem.resolve = function (name, ok, error, mode) {
    events.push('storage');
    assert.equal(mode, 'rw');
    if (options.deferStorage) pending.push({ok: () => resolve(name, ok), error});
    else resolve(name, ok);
  };
  f.tizen.package.setPackageInfoEventListener = () => events.push('watch');
  f.tizen.package.unsetPackageInfoEventListener = () => events.push('unwatch');
  function port(name, trusted) {
    events.push('port:' + name);
    if (name === WIDGET_PORT && failWidget) throw Error('Native API not ready');
    return {
      messagePortName: name, isTrusted: trusted,
      addMessagePortListener(fn) {
        assert.equal(listeners.has(name), false, 'one listener per port');
        listeners.set(name, fn);
        return 0; // Zero is a valid native listener ID.
      },
      removeMessagePortListener(id) {
        assert.equal(id, 0);
        assert.equal(listeners.delete(name), true, 'remove each listener once');
      }
    };
  }
  f.tizen.messageport = {requestLocalMessagePort: name => port(name, false), requestTrustedLocalMessagePort: name => port(name, true)};
  const service = loadService(path.resolve(__dirname, '..'), {
    tizen: options.lateRuntime ? undefined : f.tizen, start: false,
    setTimeout: () => ({unref() {}}), setInterval: () => ({unref() {}})
  });
  function gate() {
    let status;
    service.context.auth.gate({method: 'GET', headers: {host: '127.0.0.1:8099'}, socket: {remoteAddress: '127.0.0.1'}},
      {writeHead(code) {status = code;}, end() {}}, '/status');
    return status;
  }
  function widget(appId = 'vetrotvapp.app', trusted = false) {
    let response;
    function outbound(id,name){assert.equal(id,appId);assert.equal(name,'CLIENT_REPLY');return {sendMessage(data){response=JSON.parse(data[0].value);}};}
    f.tizen.messageport.requestRemoteMessagePort=outbound;
    f.tizen.messageport.requestTrustedRemoteMessagePort=outbound;
    listeners.get(WIDGET_PORT)([{key: 'json', value: JSON.stringify({version: 1, id: 'lifecycle', method: 'widget.connect', params: {}})}],
      {appId, messagePortName: 'CLIENT_REPLY', isTrusted: trusted, sendMessage() {throw Error('Callback sends must not be used');}});
    return response;
  }
  return Object.assign(service, {f, events, pending, listeners, gate, widget,
    allowWidget() {failWidget = false;}, close() {service.lifecycle.onExit(); f.close();}});
}

// Nothing native may run while the module is being evaluated. Tizen can be
// exposed later, and its private-storage callback can finish after onRequest.
{
  const s = setup({deferStorage: true, lateRuntime: true});
  try {
    assert.deepEqual(s.events, []);
    assert.equal(s.gate(), 503, 'closed while private storage is unresolved');
    s.context.tizen = s.f.tizen;
    s.lifecycle.onStart(); s.lifecycle.onRequest(); s.lifecycle.onRequest();
    assert.equal(s.pending.length, 1, 'coalesce overlapping lifecycle callbacks');
    assert.equal(s.listeners.size, 0, 'wait for private storage before opening ports');
    s.pending.shift().ok();
    assert.equal(s.listeners.size, 3);
    assert.equal(s.context.appIdentity.tizen, s.f.tizen);
    assert.equal(s.context.appPorts.ready, true);
    assert.equal(s.gate(), 401, 'an unpaired HTTP caller is still refused');
    assert.equal(s.widget('imposter.app'), undefined);
    assert.equal(s.widget('vetrotvapp.app', null), undefined);
    assert.equal(s.context.auth.widgets.length, 0);
    assert.equal(s.widget().ok, true, 'widget can bootstrap through a trusted receiver with a regular reply port');
    const before = s.events.slice();
    s.lifecycle.onRequest(); s.lifecycle.onStart();
    assert.deepEqual(s.events, before, 'healthy callbacks do not reopen ports or reread grants');
    s.lifecycle.onStop(); s.lifecycle.onExit();
    assert.equal(s.listeners.size, 0);
    assert.equal(s.events.filter(e => e === 'unwatch').length, 1);
    s.lifecycle.onRequest();
    assert.equal(s.listeners.size, 3, 'a subsequent lifecycle start can register again');
    assert.equal(s.events.filter(e => e === 'storage').length, 1);
  } finally {s.close();}
}

// Stop invalidates an unfinished native resolve, even if another start follows.
{
  const s = setup({deferStorage: true});
  try {
    s.lifecycle.onStart(); const old = s.pending.shift();
    s.lifecycle.onExit(); s.lifecycle.onRequest();
    old.ok();
    assert.equal(s.listeners.size, 0);
    assert.equal(s.gate(), 503);
    s.pending.shift().ok();
    assert.equal(s.listeners.size, 3);
    assert.equal(s.widget().ok, true);
  } finally {s.close();}
}

// Transient native failures may recover on a later lifecycle request.
{
  const s = setup({deferStorage: true});
  try {
    s.lifecycle.onStart(); s.pending.shift().error();
    assert.equal(s.gate(), 503);
    s.lifecycle.onRequest(); s.pending.shift().ok();
    assert.equal(s.widget().ok, true);
  } finally {s.close();}
}
{
  const s = setup({failWidget: true});
  try {
    s.lifecycle.onStart();
    assert.equal(s.context.appPorts.ready, false);
    assert.equal(s.listeners.has(APP_PORT), true);
    assert.equal(s.listeners.has(WIDGET_PORT), false);
    s.allowWidget(); s.lifecycle.onRequest();
    assert.equal(s.events.filter(e => e === 'unwatch').length, 1, 'clean partial setup before retry');
    assert.equal(s.context.appPorts.ready, true);
    assert.equal(s.listeners.size, 3);
    assert.equal(s.widget().ok, true);
    assert.equal(s.events.filter(e => e === 'storage').length, 1);
  } finally {s.close();}
}

// Invalid persisted security data stays blocked; lifecycle retries cannot reset it.
{
  const s = setup();
  try {
    fs.writeFileSync(path.join(s.f.dir, 'vetro-sign-in.json'), 'invalid');
    s.lifecycle.onStart();
    assert.equal(s.gate(), 503);
    assert.equal(s.widget().ok, false);
    assert.equal(s.context.auth.widgets.length, 0);
    s.lifecycle.onRequest();
    assert.equal(s.gate(), 503);
    assert.equal(s.events.filter(e => e === 'storage').length, 1);
  } finally {s.close();}
}

console.log('PASS service lifecycle: delayed native setup, trusted handshake, idempotent callbacks, pending stop, partial retry and closed security failures');

