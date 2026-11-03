'use strict';
const fs=require('fs'),os=require('os'),path=require('path');
const {Resolver}=require('../service/app-identity');
const {Access}=require('../service/app-access');
module.exports=function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vetro-access-'));let now=1700000000000;
 const installed={};
 function add(id){installed[id]={id,packageId:id+'.pkg',name:id,version:'1.0',modified:1700000000000,cert:'author-'+id};return {appId:id,packageId:id+'.pkg',name:id,version:'1.0',registryVerified:true,system:false,preload:false,removable:true,show:true,component:'uiapp',protected:false,disabled:false};}
 const rows=[add('garage.app'),add('media.app')],tizen={
  application:{getAppInfo(id){if(!installed[id])throw Error('Not installed');return installed[id];},getAppCerts:id=>[{type:'AUTHOR_SIGNER',value:installed[id].cert}]},
  package:{setPackageInfoEventListener(fn){this.events=fn;},unsetPackageInfoEventListener(){this.events=null;},getPackageInfo(id){const a=Object.values(installed).find(x=>x.packageId===id);if(!a)throw Error('No package');return {id,appIds:[a.id],version:a.version,lastModified:new Date(a.modified)};}},
  filesystem:{resolve(name,ok){if(name!=='wgt-private')throw Error('Wrong storage');ok({toURI:()=> 'file://'+dir});}}
 };
 add('vetrotvapp.app');installed['vetrotvapp.app'].packageId='vetrotvapp';
 const identity=new Resolver(tizen),calls=[],options={identity,now:()=>now,file:path.join(dir,'grants.json'),inventory:async()=>({apps:rows}),perform:async(method,p,r,check)=>{check();calls.push({method,p});return {ok:true};}};
 const access=new Access(options);access.transport={available:true,error:null};
 const f={dir,rows,installed,tizen,identity,calls,access,options,advance:n=>now+=n,close:()=>fs.rmSync(dir,{recursive:true,force:true})};
 f.enable=()=>access.admin({action:'enable',enabled:true,expectedRevision:access.state.revision});
 f.approve=async(scopes=['apps.read'])=>{await f.enable();const p=await access.call('garage.app','access.request',{scopes});await access.admin({action:'approve',requestId:p.requestId,scopes,expectedRevision:access.state.revision});};
 return f;
};
