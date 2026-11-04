'use strict';
const assert=require('assert').strict,fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto');
const sdk=fs.readFileSync(path.join(__dirname,'../service/app-access-client.js'),'utf8');
const vendor=fs.readFileSync(path.join(__dirname,'../service/vendor/sha256.js'),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const plain=value=>JSON.parse(JSON.stringify(value));

// Browser globals deliberately omit Node require/process and crypto.subtle.
// This exercises the bundled browser HMAC implementation, not Node's fast path.
function setup(options={}) {
    const requests=[],polls=[],randomSizes=[],timers=new Set();let listener,removed=0,portCreated=0,parsed=0;
    const context=vm.createContext({Promise,Uint8Array,ArrayBuffer,Date,Math,encodeURIComponent,isFinite,
        JSON:{stringify:JSON.stringify,parse(text){parsed++;return JSON.parse(text);}},
        setTimeout(fn,ms){const timer=setTimeout(()=>{timers.delete(timer);fn();},ms);timers.add(timer);return timer;},
        clearTimeout(timer){timers.delete(timer);clearTimeout(timer);}});
    context.window=context;
    if(!options.noRandom)context.crypto={getRandomValues(bytes){randomSizes.push(bytes.length);if(options.randomError)throw Error('Random generator unavailable');crypto.randomFillSync(bytes);return bytes;}};
    const local={messagePortName:'TEST_REPLY',isTrusted:false,addMessagePortListener(fn){listener=fn;return 0;},removeMessagePortListener(id){assert.equal(id,0);removed++;listener=null;}};
    context.tizen={messageport:{requestLocalMessagePort(){portCreated++;return local;},requestRemoteMessagePort(appId,port){
        assert.equal(appId,'vetrotvapp.svc');assert.equal(port,'VETRO_APP_ACCESS_V1');
        if(options.lookupError)throw Object.assign(Error('Port absent'),{name:'NotFoundError'});
        return {sendMessage(data,source){assert.equal(source,local);if(options.sendError)throw Error('Send outcome unknown');requests.push(JSON.parse(data[0].value));}};
    }}};
    if(!options.noVendor)vm.runInContext(vendor,context);
    vm.runInContext(sdk,context);
    function create(extra={}) {
        return new context.VetroAppAccess(Object.assign({httpReplies:true,timeout:1000,
            pollReply:function(id){assert.equal(arguments.length,1,'the polling transport receives no MAC key');polls.push(id);return options.reply?options.reply(requests[requests.length-1],polls.length,id):answer(requests[requests.length-1],{ok:true});}},extra));
    }
    return {context,create,requests,polls,randomSizes,timers,listener:()=>listener,removed:()=>removed,portCreated:()=>portCreated,parsed:()=>parsed};
}
function signed(request,body,replyId=request.reply.id) {
    return {status:200,body:{body,mac:crypto.createHmac('sha256',Buffer.from(request.reply.key,'hex'))
        .update('VETRO_APP_REPLY_V2\n'+replyId+'\n'+body,'utf8').digest('hex')}};
}
function answer(request,result){return signed(request,JSON.stringify({version:2,id:request.id,ok:true,result}));}
function rejected(request,submitted){return signed(request,JSON.stringify({version:2,id:request.id,ok:false,error:{code:'permission_denied',message:'Not approved',submitted}}));}

(async()=>{
    const reference=setup(),hmac=reference.context.sha256.hmac;
    // RFC 4231 cases 1, 2 and 6 (long key), plus UTF-8 interoperability.
    assert.equal(hmac(new Uint8Array(20).fill(0x0b),'Hi There'),'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
    assert.equal(hmac(new Uint8Array(Buffer.from('Jefe')),'what do ya want for nothing?'),'5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
    assert.equal(hmac(new Uint8Array(131).fill(0xaa),'Test Using Larger Than Block-Size Key - Hash Key First'),'60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54');
    for(const message of ['', '日本語 · Español · 🌍', 'VETRO_APP_REPLY_V2\n'+'f'.repeat(64)+'\n'+JSON.stringify({name:'TV "One"',value:'\u0000'})]) {
        const key=crypto.randomBytes(32);
        assert.equal(hmac(new Uint8Array(key),message),crypto.createHmac('sha256',key).update(message).digest('hex'));
    }

    let f=setup({reply:request=>answer(request,{apps:[{name:'日本語 🌍',disabled:false}]})}),client=f.create();
    try {
        let promise=client.call('apps.list',{offset:0,limit:20});
        const entry=client.pending['1'],secret=entry.secret;
        assert.deepEqual(plain(await promise),{apps:[{name:'日本語 🌍',disabled:false}]});
        assert.equal(f.requests[0].version,2);
        assert.match(f.requests[0].reply.id,/^[a-f0-9]{64}$/);assert.match(f.requests[0].reply.key,/^[a-f0-9]{64}$/);
        assert.notEqual(f.requests[0].reply.id,f.requests[0].reply.key);
        assert.equal(f.polls[0],f.requests[0].reply.id);assert.notEqual(f.polls[0],f.requests[0].reply.key);
        assert.ok(Array.from(secret).every(x=>x===0),'settled request erases the mutable MAC key');
        await client.call('access.status',{});
        assert.notEqual(f.requests[0].reply.id,f.requests[1].reply.id);
        assert.notEqual(f.requests[0].reply.key,f.requests[1].reply.key);
        assert.deepEqual(f.randomSizes,[64,64]);assert.equal(f.timers.size,0);
    } finally {client.close();}

    f=setup({reply:(request,n)=>n===1?{status:404}:n===2?{status:202}:answer(request,{state:'approved'})});client=f.create();
    try {
        assert.deepEqual(plain(await client.call('access.status',{})),{state:'approved'});
        assert.equal(f.requests.length,1,'polling never resubmits the MessagePort operation');
        assert.equal(f.polls.length,3);assert.ok(f.polls.every(id=>id===f.requests[0].reply.id));
    }finally{client.close();}

    // A valid V1 metadata envelope is not a substitute for the V2 response MAC.
    let complete;f=setup({reply:()=>new Promise(resolve=>{complete=resolve;})});client=f.create();
    try {
        let settled=false;const promise=client.call('apps.launch',{appId:'example.app'}).then(result=>{settled=true;return result;});
        await flush();const request=f.requests[0];
        const forged=[{key:'json',value:JSON.stringify({version:1,id:request.id,ok:true,result:{forged:true}})}];
        f.listener()(forged,{appId:'vetrotvapp.svc',messagePortName:'VETRO_APP_ACCESS_V1',isTrusted:false});
        await flush();assert.equal(settled,false);
        complete(answer(request,{ok:true,submitted:true,appId:'example.app'}));
        assert.equal((await promise).submitted,true);assert.equal(f.requests.length,1);
    }finally{client.close();}

    const invalidFrames=[
        request=>{const r=answer(request,{allowed:true});r.body.body=r.body.body.replace('true','false');return r;},
        request=>{const r=answer(request,{});r.body.mac='0'.repeat(64);return r;},
        request=>signed(request,JSON.stringify({version:2,id:request.id,ok:true,result:{}}),'f'.repeat(64)),
        request=>signed(request,JSON.stringify({version:1,id:request.id,ok:true,result:{}})),
        request=>signed(request,JSON.stringify({version:2,id:'other',ok:true,result:{}})),
        request=>signed(request,JSON.stringify({version:2,id:request.id,ok:'true',result:{}})),
        request=>signed(request,'not JSON'),
        request=>signed(request,JSON.stringify({version:2,id:request.id,ok:true,result:'é'.repeat(9000)})),
        request=>signed(request,'\u0000'.repeat(10000)),
        request=>{const r=answer(request,{});r.body.extra='ignored';return r;},
        request=>({status:200,body:{body:JSON.stringify({version:2,id:request.id,ok:false,error:{code:'permission_denied',submitted:false}})}})
    ];
    for(const reply of invalidFrames) {
        f=setup({reply});client=f.create();
        try {
            await assert.rejects(client.call('apps.launch',{appId:'example.app'}),e=>e.code==='invalid_reply'&&e.submitted===null);
            assert.equal(f.requests.length,1);assert.equal(f.polls.length,1);assert.equal(f.timers.size,0);
        }finally{client.close();}
    }
    f=setup({reply:request=>{const r=answer(request,{});r.body.mac='0'.repeat(64);return r;}});client=f.create();
    await assert.rejects(client.call('access.status',{}));assert.equal(f.parsed(),0,'body is not parsed before its MAC verifies');client.close();

    for(const submitted of [false,true,null]) {
        f=setup({reply:request=>rejected(request,submitted)});client=f.create();
        try {await assert.rejects(client.call('apps.launch',{appId:'example.app'}),e=>e.code==='permission_denied'&&e.submitted===submitted);}
        finally{client.close();}
    }
    // Unauthenticated HTTP errors cannot claim that an operation was not dispatched.
    for(const reply of [()=>({status:403,body:{code:'permission_denied',submitted:false}}),()=>Promise.reject(Object.assign(Error('Offline'),{submitted:false}))]) {
        f=setup({reply});client=f.create();
        try {await assert.rejects(client.call('apps.launch',{appId:'example.app'}),e=>e.code==='reply_unavailable'&&e.submitted===null);assert.equal(f.requests.length,1);}
        finally{client.close();}
    }

    f=setup({reply:()=>({status:404})});client=f.create({timeout:20});
    await assert.rejects(client.call('apps.launch',{appId:'example.app'}),e=>e.code==='timeout'&&e.submitted===null);
    assert.equal(f.requests.length,1);assert.equal(f.polls.length,1);assert.equal(f.timers.size,0);client.close();

    f=setup({reply:()=>new Promise(resolve=>{complete=resolve;})});client=f.create();
    const promise=client.call('access.status',{});await flush();
    await assert.rejects(client.call('access.status',{}),/current Vetro request/);
    client.close();await assert.rejects(promise,e=>e.code==='closed'&&e.submitted===null);
    complete(answer(f.requests[0],{}));await flush();
    assert.equal(f.requests.length,1);assert.equal(f.polls.length,1);assert.equal(f.timers.size,0);assert.equal(f.removed(),1);
    f=setup({reply:()=>({status:202})});client=f.create();
    const pending=client.call('access.status',{});await flush();assert.equal(f.timers.size,2);
    client.close();await assert.rejects(pending,/closed/);assert.equal(f.timers.size,0,'close cancels both polling and overall timers');

    for(const options of [{noRandom:true},{noVendor:true}]) {
        f=setup(options);assert.throws(()=>f.create(),e=>e.code==='unavailable'&&e.submitted===false);
        assert.equal(f.portCreated(),0);assert.equal(f.requests.length,0);
    }
    f=setup();assert.throws(()=>f.create({pollReply:null}),e=>e.code==='unavailable'&&e.submitted===false);
    f=setup({randomError:true});client=f.create();
    await assert.rejects(client.call('access.status',{}),e=>e.submitted===false);
    assert.equal(f.requests.length,0);assert.equal(f.polls.length,0);client.close();
    f=setup({lookupError:true});client=f.create();
    await assert.rejects(client.call('access.status',{}),e=>e.name==='NotFoundError'&&e.submitted===false);client.close();
    f=setup({sendError:true});client=f.create();
    await assert.rejects(client.call('apps.launch',{appId:'example.app'}),e=>e.submitted===null);
    assert.equal(f.polls.length,0);assert.equal(f.timers.size,0);client.close();
    console.log('PASS authenticated HTTP reply client: browser HMAC vectors, native entropy, exact-body MAC, polling, metadata isolation, limits, refusals, no redispatch, expiry and close');
})().catch(error=>{console.error(error);process.exitCode=1;});
