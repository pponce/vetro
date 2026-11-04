'use strict';
// Registry fields are hex encoded by SQLite: no delimiter ambiguity, SQL values
// supplied by callers, or arbitrary file paths accepted from HTTP requests.
var apps = require('./apps.js');
function flag(value){return value==='true'?true:value==='false'?false:null;}
function command(sql){return 'sqlite3 -readonly /opt/dbspace/.pkgmgr_parser.db "'+sql+'"';}
function fields(text){return String(text||'').trim().split('\n').filter(Boolean).map(function(line){return line.split('|').map(function(v){if(!/^(?:[a-fA-F0-9]{2})*$/.test(v))throw new Error('invalid registry field');return Buffer.from(v,'hex').toString('utf8');});});}
function query(execute,sql){return execute(command(sql),15000).then(function(r){if(r.exit_code||r.timed_out)throw new Error('registry query failed');return fields(r.stdout);});}
function load(execute,probe){
    var ownerUid=typeof process.getuid==='function'?process.getuid():5001;var rows=apps.normalize(probe.apps,probe.packages), byId={};rows.forEach(function(r){byId[r.appId]=r;});
    return Promise.all([
        query(execute,"SELECT hex(a.app_id),hex(a.package),hex(a.app_type),hex(a.app_component),hex(COALESCE((SELECT is_disabled FROM package_app_info_for_uid u WHERE u.app_id=a.app_id AND u.uid=OWNER_UID),a.app_disable)),hex(a.app_removable),hex(p.package_version),hex(p.package_size),hex(p.author_name),hex(p.package_system),hex(p.package_preload),hex(a.app_onboot),hex(a.app_autorestart),hex(a.app_nodisplay),hex((SELECT app_label FROM package_app_localized_info l WHERE l.app_id=a.app_id AND app_label != '' ORDER BY CASE WHEN app_locale='en_US' THEN 0 ELSE 1 END LIMIT 1)),hex((SELECT app_icon FROM package_app_localized_info l WHERE l.app_id=a.app_id AND app_icon != '' LIMIT 1)) FROM package_app_info a LEFT JOIN package_info p ON p.package=a.package;".replace('OWNER_UID',String(ownerUid))),
        query(execute,'SELECT hex(package),hex(depends_on),hex(type),hex(required_version) FROM package_dependency_info;'),
        execute('sqlite3 -readonly /opt/dbspace/user/'+ownerUid+'/.pkgmgr_parser.db \"SELECT hex(app_id),hex(is_disabled) FROM package_app_info_for_uid WHERE uid='+ownerUid+';\"',5000).then(function(r){return r.exit_code?[]:fields(r.stdout)})
    ]).then(function(data){
        var registered={};data[0].forEach(function(f){if(!/^[A-Za-z0-9_.-]+$/.test(f[0]))return;registered[f[0]]=true;var r=byId[f[0]];
            if(!r){r=apps.normalize([{id:f[0],packageId:f[1],show:false}],[])[0];rows.push(r);byId[f[0]]=r;}
            Object.assign(r,{packageId:f[1],type:f[2],component:f[3],disabled:flag(f[4]),removable:flag(f[5]),version:f[6]||r.version,size:+f[7]||r.size,author:f[8]||null,system:flag(f[9]),preload:flag(f[10]),onboot:flag(f[11]),autorestart:flag(f[12]),registryVerified:true,show:flag(f[13])===null?null:!flag(f[13]),name:r.name||f[14]||null,iconPath:f[15]||null,dependencies:[],dependents:[],dependencySource:'package registry'});
        });
        data[2].forEach(function(f){if(byId[f[0]])byId[f[0]].disabled=flag(f[1]);});rows=rows.filter(function(r){return registered[r.appId]});rows.forEach(function(r){r.origin=r.system?'system':r.preload?'preinstalled':r.system===false&&r.preload===false?'installed':'unknown';Object.assign(r,apps.classification(r),apps.describe(r));r.dependencies=r.dependencies||[];r.dependents=r.dependents||[];data[1].forEach(function(d){if(d[0]===r.packageId)r.dependencies.push({packageId:d[1],type:d[2],version:d[3]||null});if(d[1]===r.packageId)r.dependents.push({packageId:d[0],type:d[2],version:d[3]||null});});});
        return {apps:rows,summary:apps.summarize(rows),source:'package registry + public probe',collectedAt:new Date().toISOString()};
    });
}
// Owner-selected foreground launches need current visibility/disabled flags for
// at most the destination and a resumed app, not labels, icons or dependencies.
// This is not the identity/permission inventory used by third-party app calls.
function launchable(execute,appIds,timeoutMs){
    return Promise.resolve().then(function(){
        if(!Array.isArray(appIds)||!appIds.length||appIds.length>2||appIds.some(function(id){return typeof id!=='string'||!/^[A-Za-z0-9_.-]{1,120}$/.test(id);}))throw Error('Invalid foreground app selection');
        var ids=appIds.filter(function(id,i){return appIds.indexOf(id)===i;}),ownerUid=typeof process.getuid==='function'?process.getuid():5001;
        if(!Number.isInteger(ownerUid)||ownerUid<0)throw Error('TV owner identity unavailable');
        var list=ids.map(function(id){return "'"+id+"'";}).join(','),ownerFile='/opt/dbspace/user/'+ownerUid+'/.pkgmgr_parser.db';
        var base="SELECT hex('base'),hex(a.app_id),hex(a.app_nodisplay),hex(COALESCE((SELECT is_disabled FROM package_app_info_for_uid u WHERE u.app_id=a.app_id AND u.uid="+ownerUid+"),a.app_disable)) FROM package_app_info a WHERE a.app_component='uiapp' AND a.app_id IN ("+list+");";
        var override="SELECT hex('owner'),hex(app_id),'',hex(is_disabled) FROM package_app_info_for_uid WHERE uid="+ownerUid+" AND app_id IN ("+list+");";
        // A missing owner database has no override. An existing unreadable or
        // malformed database is an error; do not silently use global flags.
        var cmd=command(base)+' && { if [ -e "'+ownerFile+'" ] || [ -L "'+ownerFile+'" ]; then sqlite3 -readonly "'+ownerFile+'" "'+override+'"; fi; } && printf \'\\n646f6e65|||\\n\'';
        var limit=typeof timeoutMs==='number'&&isFinite(timeoutMs)?Math.floor(timeoutMs):4000;
        if(limit<1)throw Error('Foreground app validation expired');
        return execute(cmd,Math.min(limit,4000)).then(function(r){
            if(!r||r.exit_code!==0||r.timed_out||Buffer.byteLength(String(r.stdout||''))>4096)throw Error('Foreground app registry unavailable');
            var rows=Object.create(null),overrides=Object.create(null),complete=false;
            fields(r.stdout).forEach(function(f){
                if(complete||f.length!==4)throw Error('Invalid foreground app registry response');
                if(f[0]==='done'&&f[1]===''&&f[2]===''&&f[3]===''){complete=true;return;}
                if(ids.indexOf(f[1])<0)throw Error('Invalid foreground app registry response');
                if(f[0]==='base'){
                    if(rows[f[1]])throw Error('Ambiguous foreground app registry response');
                    var hidden=flag(f[2]);rows[f[1]]={appId:f[1],show:hidden===null?null:!hidden,disabled:flag(f[3])};
                }else if(f[0]==='owner'){
                    if(Object.prototype.hasOwnProperty.call(overrides,f[1])||f[2]!=='')throw Error('Ambiguous owner app registry response');
                    overrides[f[1]]=flag(f[3]);
                }else throw Error('Invalid foreground app registry response');
            });
            // The root transport may bound stdout. Incomplete output cannot
            // establish that the owner database had no disabled override.
            if(!complete)throw Error('Incomplete foreground app registry response');
            Object.keys(overrides).forEach(function(id){if(rows[id])rows[id].disabled=overrides[id];});
            return {apps:ids.filter(function(id){return !!rows[id];}).map(function(id){return rows[id];})};
        });
    });
}
function iconCommand(row){var p=row&&row.iconPath;if(typeof p!=='string'||!/^\/(?:usr\/apps|opt\/usr\/apps)\/[A-Za-z0-9_.\/-]+\.(?:png|jpg|jpeg)$/i.test(p)||p.split('/').indexOf('..')!==-1)return null;
    return 'if [ -f "'+p+'" ] && [ "$(stat -c %s "'+p+'")" -le 262144 ]; then base64 "'+p+'"; else exit 1; fi';
}
module.exports={load:load,launchable:launchable,fields:fields,iconCommand:iconCommand};

