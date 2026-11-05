'use strict';
var Access = require('./app-access.js');
var Catalog = require('./app-launcher-catalog.js');
var control = require('./control.js');
var component = require('./component-actions.js');
var AUDIO = ['XF86AudioRaiseVolume','XF86AudioLowerVolume','XF86AudioMute'];
var PLAYBACK = ['XF86AudioPlay','XF86AudioPause','XF86AudioStop','XF86AudioNext','XF86AudioPrev','XF86AudioRewind','XF86AudioForward'];
var PARAMS = {'apps.list':['offset','limit'],'apps.catalog':['offset','limit'],'apps.launch':['appId'],'tasks.list':['offset','limit'],'tasks.stop':['appId'],
    'brightness.read':[],'brightness.set':['value','expected'],'audio.key':['key'],'playback.key':['key'],'power.off':[]};
function validParams(method,p) {
    if (!Object.prototype.hasOwnProperty.call(PARAMS,method) || !p || typeof p!=='object' || Array.isArray(p) ||
        Object.keys(p).some(function (k) { return PARAMS[method].indexOf(k)<0; })) throw Access.fault('invalid_request','Unsupported parameters');
}
function page(rows,p) {
    var offset=p.offset===undefined?0:p.offset,limit=p.limit===undefined?20:p.limit;
    if (!Number.isInteger(offset) || offset<0 || !Number.isInteger(limit) || limit<1 || limit>20) throw Access.fault('invalid_request','Use an offset and a limit from 1 to 20');
    return {apps:rows.slice(offset,offset+limit),total:rows.length,nextOffset:offset+limit<rows.length?offset+limit:null};
}
function summary(row) { return {appId:row.appId,name:String(row.name||row.appId).slice(0,120),disabled:row.disabled}; }
function create(options) {
    return function perform(method,p,rows,check) {
        return Promise.resolve().then(function () {
            validParams(method,p);
            var launching=method==='apps.list'||method==='apps.catalog'||method==='apps.launch';
            var allowed=rows.filter(function (r) { return (launching?Access.launchableApp:Access.userApp)(r,rows); });
            if (method==='apps.list') return page(allowed.map(summary),p);
            if (method==='apps.catalog') {
                page([],p);
                return options.catalog(!p.offset).then(function (metadata) {
                    check();
                    var catalog=Catalog.build(metadata,allowed),result=page(catalog.apps,p);
                    result.revision=catalog.revision;result.source='samsung-apps';
                    return result;
                });
            }
            if (method==='tasks.list') {
                page([],p);
                return options.monitor().then(function (snapshot) {
                    check();
                    if (!snapshot || !Array.isArray(snapshot.processes)) throw Access.fault('unavailable','Running app state is unavailable');
                    return page(allowed.map(function (a) {
                        var matches=snapshot.processes.filter(function (r) { return r.appId===a.appId && r.kernel!==true; });
                        var item=summary(a);item.running=matches.length>0;
                        item.memoryBytes=matches.every(function (r) { return typeof r.rssBytes==='number' && isFinite(r.rssBytes) && r.rssBytes>=0; })?
                            matches.reduce(function (n,r) { return n+r.rssBytes; },0):null;
                        return item;
                    }).filter(function (a) { return a.running; }),p);
                });
            }
            if (method==='apps.launch' || method==='tasks.stop') {
                var target=allowed.find(function (r) { return r.appId===p.appId; });
                if (!target) throw Access.fault('not_allowed',launching?'The target is not a verified visible TV app':'The target is not a verified user app');
                function readTarget(){return options.identity[launching?'target':'read'](target.appId);}
                var identity=readTarget(),epoch=options.identity.epoch(target.packageId);
                if (identity.packageId!==target.packageId || identity.version!==target.version) throw Access.fault('identity_changed','Target app changed. Refresh the app list.');
                function guardTarget(){check();if(options.identity.epoch(target.packageId)!==epoch)throw Access.fault('identity_changed','Target app changed. Refresh the app list.');if(readTarget().installation!==identity.installation)throw Access.fault('identity_changed','Target app changed. Refresh the app list.');return true;}
                guardTarget.onDispatch=check.onDispatch;
                if (method==='apps.launch') {
                    if (target.disabled!==false) throw Access.fault('not_allowed','The app is disabled or its state is unknown');
                    check();return options.launch(target.appId,guardTarget).then(function () { return {ok:true,appId:target.appId,submitted:true}; });
                }
                component.validate({action:'stop',appId:target.appId},rows);
                return options.mutation(function () {
                    check();
                    if (options.identity.read(target.appId).installation!==identity.installation) throw Access.fault('identity_changed','Target app changed. Refresh the app list.');
                    return options.execute(component.command({action:'stop'},target),15000,guardTarget).then(function (r) {
                        if (r.exit_code || r.timed_out) throw Access.fault('not_confirmed','The stop result was not confirmed. Read running apps before trying again.');
                        return options.monitor(true).then(function (d) {
                            var verified=!!(d&&Array.isArray(d.processes)&&!d.processes.some(function (r) { return r.appId===target.appId; }));
                            return {ok:verified,verified:verified,appId:target.appId,error:verified?null:'The app may still be running or may have restarted.'};
                        });
                    });
                });
            }
            if (method==='brightness.read' || method==='brightness.set') {
                return options.settings.read().then(function (d) {
                    check();var item=d.items.find(function (x) { return x.id==='backlight'; });
                    if (!item || item.error || item.probe!=='confirmed' || !item.writable) throw Access.fault('unavailable','Panel brightness is not verified on this TV');
                    if (method==='brightness.read') return {value:item.value,min:item.min,max:item.max};
                    if (!Number.isInteger(p.value) || !Number.isInteger(p.expected) || p.value<item.min || p.value>item.max) throw Access.fault('invalid_request','Invalid brightness value');
                    return options.settings.write({id:'backlight',value:p.value,expected:p.expected},check).then(function (r) {
                        return {ok:r.ok,verified:r.verified,value:r.value,previous:r.previous};
                    });
                });
            }
            var key=method==='power.off'?'XF86PowerOff':p.key;
            if (method==='audio.key' && AUDIO.indexOf(key)<0 || method==='playback.key' && PLAYBACK.indexOf(key)<0) throw Access.fault('not_allowed','This remote command is not permitted');
            var command=control.injectCommand(key);
            if (!command) throw Access.fault('invalid_request','Unknown remote command');
            check();return options.execute(command,10000,check).then(function (r) {
                if (r.exit_code || r.timed_out) throw Access.fault('not_confirmed','TV command result was not confirmed');
                return {ok:true,submitted:true};
            });
        }).catch(function (e) { throw e.code?e:Access.fault('unavailable','The TV operation could not be confirmed. Refresh its state before trying again.'); });
    };
}
module.exports={create:create,AUDIO:AUDIO,PLAYBACK:PLAYBACK};
