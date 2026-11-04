'use strict';
const assert=require('assert').strict,fs=require('fs'),path=require('path'),cp=require('child_process');
const registry=require('../service/app-registry.js');
const directory=fs.mkdtempSync(path.join(__dirname,'.launchable-test-'));
const ownerUid=process.getuid(),ownerFile=path.join(directory,'db/user',String(ownerUid),'.pkgmgr_parser.db');
const hex=values=>values.map(value=>Buffer.from(value).toString('hex')).join('|');
const base=hex(['base','video.one','false','false']);
// Python's standard SQLite binding exercises the generated SQL and both shell
// branches without requiring the sqlite3 command-line package on the test host.
fs.mkdirSync(path.dirname(ownerFile),{recursive:true});
fs.mkdirSync(path.join(directory,'bin'));
fs.writeFileSync(path.join(directory,'bin/sqlite3'),`#!/usr/bin/env python3
import sqlite3,sys
try:
    connection=sqlite3.connect('file:'+sys.argv[2]+'?mode=ro',uri=True)
    for row in connection.execute(sys.argv[3]):
        print('|'.join('' if value is None else str(value) for value in row))
except Exception as error:
    print(str(error),file=sys.stderr)
    sys.exit(1)
`,{mode:0o755});
function sql(file,script){
 const result=cp.spawnSync('python3',['-c','import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.executescript(sys.argv[2]); c.commit()',file,script],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr||String(result.error));
}
const calls=[];
async function execute(command,timeoutMs){
 calls.push({command,timeoutMs});
 const result=cp.spawnSync('sh',['-c',installedAgentCommand(command.split('/opt/dbspace').join(path.join(directory,'db')))],{
  encoding:'utf8',timeout:timeoutMs,env:{...process.env,PATH:path.join(directory,'bin')+path.delimiter+process.env.PATH}
 });
 return {exit_code:result.status,timed_out:!!result.error,stdout:result.stdout,stderr:result.stderr};
}
// Model the installed native agent's QuoteArgument and .NET 6 Unix
// ProcessStartInfo.Arguments parsing before executing the real shell/SQLite.
// Only backslashes immediately preceding a quote are reduced by the parser.
function installedAgentCommand(command){
 const text='"'+command.replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"';
 let result='',position=0,inQuotes=false;
 while(position<text.length){
  let count=0;
  while(position<text.length&&text[position]==='\\'){count++;position++;}
  if(count){
   if(position===text.length||text[position]!=='"')result+='\\'.repeat(count);
   else{
    result+='\\'.repeat(Math.floor(count/2));
    if(count%2){result+='"';position++;}
   }
   continue;
  }
  const character=text[position];
  if(character==='"'){
   if(inQuotes&&position+1<text.length&&text[position+1]==='"'){result+='"';position++;}
   else inQuotes=!inQuotes;
  }else result+=character;
  position++;
 }
 return result;
}
function brokenMarkerExecute(command,timeoutMs){
 return execute(command.replace("{ echo; echo '646f6e65|||'; }", "printf '\\n646f6e65|||\\n'"),timeoutMs);
}
(async()=>{
 sql(path.join(directory,'db/.pkgmgr_parser.db'),`
 CREATE TABLE package_app_info(app_id TEXT PRIMARY KEY,app_component TEXT,app_nodisplay TEXT,app_disable TEXT);
 CREATE TABLE package_app_info_for_uid(app_id TEXT,uid INTEGER,is_disabled TEXT);
 INSERT INTO package_app_info VALUES
 ('video.one','uiapp','false','false'),('video.two','uiapp','false','false'),
 ('hidden.app','uiapp','true','false'),('service.app','svcapp','false','false'),
 ('disabled.app','uiapp','false','true'),('unknown.app','uiapp',NULL,NULL),
 ('global.owner','uiapp','false','false'),('unrelated.app','uiapp','false','false');
 INSERT INTO package_app_info_for_uid VALUES('global.owner',${ownerUid},'true');
 `);
 let data=await registry.launchable(execute,['video.one','video.two'],9000);
 assert.deepEqual(data.apps,[{appId:'video.one',show:true,disabled:false},{appId:'video.two',show:true,disabled:false}]);
 assert.equal(calls.length,1,'one root command reads both databases');assert.equal(calls[0].timeoutMs,4000);
 assert.ok(!/package_dependency_info|app_label|app_icon/.test(calls[0].command),'no full inventory fields');
 assert.match(calls[0].command,/app_id IN \('video.one','video.two'\)/);
 const broken=await brokenMarkerExecute(calls[0].command,4000);
 assert.equal(broken.exit_code,0);assert.equal(broken.timed_out,false);
 assert.ok(broken.stdout.endsWith('\\n646f6e65|||\\n'),'old marker is literal backslash-n after native argument parsing');
 await assert.rejects(registry.launchable(brokenMarkerExecute,['video.one','video.two']),/invalid registry field/);
 assert.deepEqual((await registry.launchable(execute,['video.one','video.two'])).apps,data.apps,
  'fixed marker preserves selected app eligibility through the installed transport');
 data=await registry.launchable(execute,['hidden.app','service.app'],1000);
 assert.deepEqual(data.apps,[{appId:'hidden.app',show:false,disabled:false}]);
 data=await registry.launchable(execute,['disabled.app','global.owner']);
 assert.equal(data.apps.every(row=>row.disabled===true),true);
 data=await registry.launchable(execute,['unknown.app','missing.app']);
 assert.deepEqual(data.apps,[{appId:'unknown.app',show:null,disabled:null}]);
 sql(ownerFile,`CREATE TABLE package_app_info_for_uid(app_id TEXT,uid INTEGER,is_disabled TEXT);
 INSERT INTO package_app_info_for_uid VALUES('video.one',${ownerUid},'true'),('disabled.app',${ownerUid},'false'),('video.two',${ownerUid+1},'true');`);
 data=await registry.launchable(execute,['video.one','disabled.app'],750);
 assert.deepEqual(data.apps,[{appId:'video.one',show:true,disabled:true},{appId:'disabled.app',show:true,disabled:false}]);
 assert.equal(calls[calls.length-1].timeoutMs,750);
 assert.equal((await registry.launchable(execute,['video.two','video.two'])).apps.length,1,'duplicate request IDs are harmless');
 assert.equal((await registry.launchable(execute,['video.two'])).apps[0].disabled,false,'another owner does not disable this owner');
 sql(ownerFile,`INSERT INTO package_app_info_for_uid VALUES('video.one',${ownerUid},'false');`);
 await assert.rejects(registry.launchable(execute,['video.one']),/Ambiguous owner/);
 fs.writeFileSync(ownerFile,'not a database');
 await assert.rejects(registry.launchable(execute,['video.one']),/registry unavailable/,'an existing bad owner database cannot be ignored');
 fs.unlinkSync(ownerFile);
 assert.equal((await registry.launchable(execute,['video.one'])).apps[0].disabled,false,'a missing owner database has no override');
 fs.symlinkSync(path.join(directory,'missing-owner-db'),ownerFile);
 await assert.rejects(registry.launchable(execute,['video.one']),/registry unavailable/,'a broken owner database link cannot be ignored');
 fs.unlinkSync(ownerFile);
 const unexpected=()=>{throw Error('unexpected command');};
 for(const ids of [[],['one','two','three'],['bad;id'],['bad\"id'],[null],['a'.repeat(121)],null]){
  await assert.rejects(registry.launchable(unexpected,ids),/Invalid foreground/);
 }
 await assert.rejects(registry.launchable(unexpected,['video.one'],0),/expired/);
 for(const result of [null,{exit_code:1,stdout:base},{exit_code:0,timed_out:true,stdout:base},{stdout:base},{exit_code:0,stdout:'0'.repeat(4097)}]){
  await assert.rejects(registry.launchable(async()=>result,['video.one']),/registry unavailable/);
 }
 for(const stdout of ['not hex',base+'\n'+base,hex(['base','other.app','false','false']),hex(['unknown','video.one','false','false']),hex(['base','video.one','false']),base+'\n'+hex(['owner','video.one','unexpected','false'])]){
  await assert.rejects(registry.launchable(async()=>({exit_code:0,stdout}),['video.one']),/registry (field|response)/);
 }
 await assert.rejects(registry.launchable(async()=>({exit_code:0,stdout:base}),['video.one']),/Incomplete/,'truncation before the owner override cannot enable an app');
 const done=hex(['done','','','']);
 await assert.rejects(registry.launchable(async()=>({exit_code:0,stdout:base+'\n'+done+'\n'+done}),['video.one']),/Invalid/);
 assert.equal((await registry.launchable(async()=>({exit_code:0,stdout:base+'\n'+done}),['video.one'])).apps[0].disabled,false);
 console.log('PASS launch eligibility: real SQLite selected-only queries, owner overrides, bounded command, missing/corrupt DB, ambiguous rows and invalid inputs');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>fs.rmSync(directory,{recursive:true,force:true}));
