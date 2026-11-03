'use strict';
const assert = require('assert').strict, fs = require('fs'), path = require('path');
const {ReturnApp, parse, COMMAND} = require('../service/return-app.js');
const directory = fs.mkdtempSync(path.join(__dirname, '.return-test-'));
const TV = 'org.tizen.tv-viewer', HOME = 'com.samsung.tv.csfs';
const rows = ['home.app', 'home.other', 'video.one', 'video.two', 'org.tizen.menu'].map(appId => ({appId, show:true, disabled:false}));
rows.push({appId:'background.svc',show:false,disabled:false});
let sequence = 0;
function fixture() {
    const state = {full:TV,partial:'',sourceType:0};
    const clock = {bootId:'boot-a',suspendOffset:0};
    const f = {state,clock,time:0,power:'on',ready:true,paused:false,reads:0,launches:[],inside:[],rows:JSON.parse(JSON.stringify(rows))};
    f.options = {file:path.join(directory, 'choice-' + sequence++ + '.json'),
        clock:()=>({...clock}), now:()=>f.time, ready:()=>f.ready, paused:()=>f.paused,
        readPower:async()=>{f.reads++;if(f.powerError)throw Error('power unavailable');return f.power;},
        snapshot:async inside=>{f.inside.push(inside);if(f.snapshotError)throw Error('state unavailable');return {...state};},
        inventory:async()=>({apps:f.rows,registryError:f.registryError}),
        launch:async(id,guard)=>{if(f.beforeLaunch)await f.beforeLaunch();if(!await guard())throw Error('cancelled');f.launches.push(id);}
    };
    f.app = new ReturnApp(f.options);
    f.tick = async(full,ms=2000)=>{if(full!==undefined)state.full=full;f.time+=ms;await f.app.tick();};
    f.choose = id=>f.app.configure(id,f.app.status().revision,f.rows);
    f.exit = async()=>{await f.tick('video.one');await f.tick(HOME);await f.tick();};
    return f;
}
(async()=>{
    assert.deepEqual(parse('key value = video.one\nkey value = \nkey value = 13\n'),{full:'video.one',partial:'',sourceType:13});
    assert.equal(parse('value = "video.one"\nvalue = (null)\nvalue = 0').full,'video.one');
    const typed = (full,partial='',source=0) => 'memory/appfw/current_fullscreen_appid, value = '+full+' (String)\n'+
        'memory/appfw/current_partial_appid, value = '+partial+' (String)\n'+
        'memory/system/source_type, value = '+source+' (Int32)\n';
    assert.deepEqual(parse(typed(HOME)),{full:HOME,partial:'',sourceType:0});
    assert.deepEqual(parse(typed('"video.one"','(null)',13)),{full:'video.one',partial:'',sourceType:13});
    assert.throws(()=>parse(typed(HOME).replace('(Int32)','(Boolean)')),/unavailable/);
    assert.throws(()=>parse(typed('video.one;id')),/unavailable/);
    for(const input of ['', 'value = video.one\nvalue = 0','value = video.one;id\nvalue = \nvalue = 0','value = video.one\nvalue = \nvalue = unknown']) assert.throws(()=>parse(input),/unavailable/);
    assert.ok(!/\b(set|app_launcher|kill)\b/.test(COMMAND),'snapshot is read-only');

    let f=fixture();await f.tick();assert.equal(f.reads,0,'disabled feature does no polling');
    assert.equal(f.app.nextDelay(), 1000);
    const fast=fixture();fast.choose('home.app');
    await fast.tick('video.one',1000);await fast.tick(HOME,1000);
    assert.equal(fast.app.nextDelay(),300);
    await fast.tick(undefined,299);assert.equal(fast.launches.length,0,'fallback must settle before returning');
    assert.equal(fast.app.nextDelay(),1);
    await fast.tick(undefined,1);assert.deepEqual(fast.launches,['home.app'],'return is requested at the short settling deadline');
    assert.equal(fast.app.nextDelay(),1000,'verification uses the normal interval');
    await fast.tick('home.app',1000);assert.match(fast.app.status().lastResult,/confirmed/);
    for(const cause of ['app','overlay','source','power']) {
        const quick=fixture();quick.choose('home.app');
        await quick.tick('video.one',1000);await quick.tick(HOME,1000);
        if(cause==='app')quick.state.full='video.two';
        if(cause==='overlay')quick.state.partial='org.tizen.menu';
        if(cause==='source')quick.state.sourceType=13;
        if(cause==='power')quick.power='standby';
        await quick.tick(undefined,300);
        assert.equal(quick.launches.length,0,'fast recheck cancels for '+cause);
        assert.equal(quick.app.nextDelay(),1000,'cancellation restores normal polling');
    }
    const tv=fixture();tv.choose('home.app');
    tv.app.snapshot=async()=>parse(typed(tv.state.full,tv.state.partial,tv.state.sourceType));
    await tv.exit();assert.deepEqual(tv.launches,['home.app'],'typed TV output detects the app exit and passes the launch guard');
    await tv.tick('home.app');assert.match(tv.app.status().lastResult,/confirmed/);
    f.choose('home.app');await f.tick();await f.tick();assert.equal(f.launches.length,0,'enabling does not launch');
    assert.throws(()=>f.choose('background.svc'),/launcher/);
    assert.throws(()=>f.app.configure('home.other',0,f.rows),/changed/);
    assert.equal(f.choose('home.other').previousAppId,'home.app');f.choose('home.app');
    assert.equal(f.app.status().appId,'home.app','one persisted choice');
    await f.exit();assert.deepEqual(f.launches,['home.app']);assert.ok(f.inside.includes(true),'fresh snapshot inside launch queue slot');
    await f.tick('home.app');assert.match(f.app.status().lastResult,/confirmed/);
    await f.tick(TV);await f.tick();assert.equal(f.launches.length,1,'leaving the destination for TV stays on TV');

    f=fixture();f.choose('home.app');await f.tick('video.one');await f.tick(HOME);await f.tick('video.two');await f.tick();
    assert.equal(f.launches.length,0,'transient Home between apps is cancelled');
    await f.tick(TV);await f.tick();assert.deepEqual(f.launches,['home.app'],'any eligible app can be the app being left');
    await f.tick();await f.tick(undefined,10000);await f.tick();assert.equal(f.launches.length,1,'failed foreground confirmation does not repeatedly reclaim focus');

    for(const cause of ['source','overlay','system','target','power','snapshotError','powerError','root','startup','gap','suspend']) {
        f=fixture();f.choose('home.app');await f.tick(cause==='system'?'org.tizen.menu':cause==='target'?'home.app':'video.one');
        if(cause==='source')f.state.sourceType=13;
        if(cause==='overlay')f.state.partial='org.tizen.menu';
        if(cause==='power')f.power='standby';
        if(cause==='snapshotError')f.snapshotError=true;
        if(cause==='powerError')f.powerError=true;
        if(cause==='root')f.ready=false;
        if(cause==='startup')f.paused=true;
        if(cause==='suspend')f.clock.suspendOffset+=30;
        await f.tick(TV,cause==='gap'?8000:2000);
        f.state.partial='';f.power='on';f.snapshotError=false;f.powerError=false;f.ready=true;f.paused=false;
        await f.tick();await f.tick();
        assert.equal(f.launches.length,0,'no return caused by '+cause);
    }

    for(const cause of ['app','power','source','choice','off','root','startup','expired','suspend']) {
        f=fixture();f.choose('home.app');
        f.beforeLaunch=async()=>{
            if(cause==='app')f.state.full='video.two';
            if(cause==='power')f.power='standby';
            if(cause==='source')f.state.sourceType=13;
            if(cause==='choice')f.choose('home.other');
            if(cause==='off')f.choose(null);
            if(cause==='root')f.ready=false;
            if(cause==='startup')f.paused=true;
            if(cause==='expired')f.time+=12000;
            if(cause==='suspend')f.clock.suspendOffset+=30;
        };
        await f.exit();assert.equal(f.launches.length,0,'queued launch cancelled for '+cause);
    }

    f=fixture();f.choose('home.app');f.rows.find(r=>r.appId==='home.app').disabled=true;await f.exit();
    assert.equal(f.launches.length,0);assert.match(f.app.status().lastResult,/disabled/);
    f=fixture();f.choose('home.app');f.registryError='offline';await f.exit();assert.equal(f.launches.length,0);
    assert.equal(f.choose(null).appId,null,'turn off remains possible without inventory');

    f=fixture();f.choose('home.app');await f.exit();f.app=new ReturnApp(f.options);await f.tick(TV);await f.tick();
    assert.equal(f.launches.length,1,'restart at fallback does not replay an earlier exit');
    const before=f.app.status();f.app.fs={...fs,renameSync(){throw Error('disk failure');}};
    assert.throws(()=>f.choose('home.other'),/disk failure/);assert.equal(f.app.status().appId,before.appId);
    assert.equal(new ReturnApp(f.options).status().appId,'home.app','failed atomic write preserves saved choice');
    assert.deepEqual(rows.slice(0,2).map(r=>r.appId),['home.app','home.other']);
    console.log('PASS return app: short settling recheck, fallback detection, one choice, source/app/overlay guards, boot and suspend suppression, queue cancellation, no replay, persistence, and off');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>fs.rmSync(directory,{recursive:true,force:true}));
