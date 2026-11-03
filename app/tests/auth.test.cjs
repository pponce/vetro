'use strict';
const assert=require('assert').strict,fs=require('fs'),path=require('path'),{EventEmitter}=require('events');
const fixture=require('./app-access-fixture.cjs'),{Auth}=require('../service/auth');
function request(auth,url,options={}){return new Promise(resolve=>{const req=new EventEmitter();Object.assign(req,{method:options.method||'GET',headers:{host:'192.0.2.1:8099',...options.headers},socket:{remoteAddress:options.address||'192.0.2.9'}});let status,headers;
 const res={writeHead(s,h){status=s;headers=h;},end(body){let data;try{data=JSON.parse(body);}catch(_){data=body;}resolve({status,headers,data});}};
 if(!auth.gate(req,res,url,options.gate))return resolve({status:200,passed:true});
 if(options.body!==undefined){req.emit('data',Buffer.from(typeof options.body==='string'?options.body:JSON.stringify(options.body)));req.emit('end');}
 });}
const post=(auth,url,body,headers={})=>request(auth,url,{method:'POST',body,headers:{'content-type':'application/json',...headers}});
(async()=>{const f=fixture();try{let now=1700000000000;const file=path.join(f.dir,'auth.json'),a=new Auth({file,now:()=>now});
 for(const route of ['/exec','/app-access','/monitor','/control','/probe','/install','/diagnostics/download'])for(const origin of [undefined,'null','https://evil.example']){
  const r=await request(a,route,{address:'127.0.0.1',headers:origin?{origin}:{}});assert.ok(r.status===401||r.status===403,route+' '+origin);
 }
 assert.equal((await request(a,'/',{headers:{origin:'null'}})).status,403);assert.match((await request(a,'/')).data,/Pair with your TV/);
 assert.equal((await request(a,'/auth/pending',{address:'127.0.0.1'})).status,403);
 assert.equal((await request(a,'/auth/pair',{method:'POST',headers:{'content-type':'text/plain'}})).status,415);
 assert.equal((await post(a,'/auth/pair',{name:'owner'},{origin:'http://evil.example'})).status,403);
 const p=await post(a,'/auth/pair',{name:'owner'});assert.equal(p.status,200);assert.equal(p.data.code,undefined);
 assert.equal((await post(a,'/auth/pair',{})).status,429);
 const w=a.issueWidget(),widget={'x-vetro-widget':w.token,origin:'null'};
 const pending=await request(a,'/auth/pending',{address:'127.0.0.1',headers:widget});assert.match(pending.data.code,/^\d{6}$/);
 for(const route of ['/exec','/app-access','/monitor','/apps','/probe?diagnostics=1'])assert.equal((await request(a,route,{address:'127.0.0.1',headers:widget})).status,403);
 assert.equal((await request(a,'/screen',{address:'127.0.0.1',headers:widget})).passed,true);
 assert.equal((await request(a,'/screen',{headers:widget})).status,401);
 assert.equal((await request(a,'/screen',{method:'OPTIONS',headers:{origin:'null'}})).status,204);
 const approved=await post(a,'/auth/confirm',{id:p.data.id,code:pending.data.code});assert.equal(approved.status,200);assert.match(approved.headers['set-cookie'],/HttpOnly; SameSite=Strict/);
 assert.ok(!fs.readFileSync(file,'utf8').includes(approved.data.token));assert.ok(!fs.readFileSync(file,'utf8').includes(pending.data.code));
 const bearer={authorization:'Bearer '+approved.data.token};assert.equal((await request(new Auth({file,now:()=>now}),'/app-access',{headers:bearer})).passed,true);
 assert.equal((await request(a,'/auth/pending',{headers:bearer})).status,403);
 assert.equal((await post(a,'/exec',{cmd:'x'},{...bearer,origin:'http://evil.example'})).status,403);
 assert.equal((await request(a,'/auth/signout',{headers:bearer})).status,405);
 assert.equal((await post(a,'/auth/signout',{},bearer)).status,200);assert.equal((await request(a,'/exec',{headers:bearer})).status,401);
 now+=10001;const retry=await post(a,'/auth/pair',{});for(let i=0;i<5;i++)assert.equal((await post(a,'/auth/confirm',{id:retry.data.id,code:'wrong'})).status,403);assert.equal(a.pending,null);
 now+=10001;const expiry=await post(a,'/auth/pair',{});const code=a.pending.code;now+=120001;assert.equal((await post(a,'/auth/confirm',{id:expiry.data.id,code})).status,410);
 const again=await post(a,'/auth/pair',{});a.store.file=path.join(f.dir,'missing','auth.json');assert.equal((await post(a,'/auth/confirm',{id:again.data.id,code:a.pending.code})).status,503);assert.equal((await request(a,'/')).status,503);
 fs.writeFileSync(file,'corrupt');assert.equal((await request(new Auth({file}),'/')).status,503);
 console.log('PASS authentication: loopback/null-origin denied, PIN isolated, pairing limits, widget boundary, persisted hashed sessions, CSRF, revocation, expiry and storage failures');
 }finally{f.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={request};
