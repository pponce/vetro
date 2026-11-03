'use strict';
const assert = require('assert').strict, vm = require('vm');
const nodes = {};
const el = id => nodes[id] || (nodes[id] = {innerHTML:'',textContent:'',value:'',hidden:false,disabled:false,focus(){},style:{}});
const rows = [
    {appId:'video.one',name:'Video One',show:true,disabled:false,onboot:false},
    {appId:'video.two',name:'Video <Two>',show:true,disabled:false,onboot:true},
    {appId:'video.service',name:'Background',show:false,disabled:false,onboot:true}
];
let choice = {appId:'video.one', revision:1}, stale = false;
const writes = [];
const sandbox = {document:{getElementById:el,querySelectorAll:()=>[],addEventListener(){}},
    console,setInterval(){},setTimeout(){},clearTimeout(){},fetch:async (url, options) => {
        let body = {}, ok = true;
        if (url.startsWith('/apps')) body = {apps:rows,summary:{total:3}};
        else if (url === '/remap') body = {rules:[]};
        else if (url === '/startup-app') body = {appId:'video.one',revision:9};
        else if (url === '/return-app') {
            if (options && options.body) {
                const p = JSON.parse(options.body); writes.push(p);
                if (stale || p.expectedRevision !== choice.revision) {ok=false;body={error:'Return choice changed'};}
                else {choice={appId:p.appId,revision:choice.revision+1};body={...choice,verified:true};}
            } else body = {...choice};
        }
        return {ok,json:async()=>body};
    }};
vm.runInNewContext(require('../service/dashboard.js')().match(/<script>([\s\S]*?)<\/script>/)[1], sandbox);
(async () => {
    await new Promise(setImmediate); sandbox.inventory=rows;
    await sandbox.loadStartupApp();await sandbox.loadReturnApp();
    let html=sandbox.returnAppMarkup(rows[1]);
    assert.match(html,/Return here after exiting another app/); assert.match(html,/Samsung Home or TV/);
    assert.match(html,/Currently selected: Video One/); assert.match(html,/replaces it/);
    assert.match(sandbox.returnAppMarkup(rows[0]),/id="returnDestination" checked/);
    assert.match(sandbox.returnAppMarkup(rows[2]),/id="returnDestination" disabled/);
    await sandbox.saveReturnApp(rows[1],{checked:true});
    assert.equal(choice.appId,'video.two');
    assert.equal(sandbox.startupAppData.appId,'video.one','return selection does not change power-on app');
    assert.equal(sandbox.startupAppData.revision,9);
    assert.equal(writes[0].expectedRevision,1);
    assert.equal(rows[0].onboot,false); assert.equal(rows[1].onboot,true);
    assert.ok(!sandbox.returnAppMarkup(rows[0]).includes('id="returnDestination" checked'));
    assert.match(sandbox.returnAppMarkup(rows[0]),/Video &lt;Two&gt;/, 'app names are escaped');
    stale=true; await sandbox.saveReturnApp(rows[0],{checked:true});
    assert.equal(choice.appId,'video.two'); assert.equal(sandbox.returnAppData.appId,'video.two');
    stale=false; await sandbox.saveReturnApp(rows[1],{checked:false});
    assert.equal(choice.appId,null);
    assert.match(sandbox.returnAppMarkup(rows[1]),/No app is selected/);
    choice={appId:'removed.app',revision:5};await sandbox.loadReturnApp();sandbox.renderReturnChoice();
    assert.match(el('returnChoiceSummary').innerHTML,/removed.app/);
    await el('clearReturnChoice').onclick();assert.equal(choice.appId,null,'a removed app can be deselected from the Startup overview');
    console.log('PASS return UI: exclusive selection, replacement copy, independent boot flags, disabled background apps, stale refresh, and off');
})().catch(error=>{console.error(error);process.exitCode=1;});
