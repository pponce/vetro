'use strict';
const assert=require('assert').strict,crypto=require('crypto');
const {capture}=require('../service/runtime-source-diagnostics');
function fixture(text,options={}) {
    const bytes=Buffer.from(text),calls=[];
    return {calls,io:{
        openSync(path,flags){calls.push(['open',path,flags]);if(options.openError)throw options.openError;return 7;},
        fstatSync(fd){assert.equal(fd,7);return {isFile:()=>options.regular!==false,size:options.size===undefined?bytes.length:options.size};},
        readSync(fd,target,offset,length,position){
            calls.push(['read',length]);assert.equal(fd,7);
            if(options.readError)throw options.readError;
            return bytes.copy(target,offset,position,Math.min(bytes.length,position+length,position+13));
        },
        closeSync(fd){assert.equal(fd,7);calls.push(['close']);}
    }};
}
const f=fixture('class LocalMessagePortRouter { /* fixture-secret */ }');
const result=capture(text=>text.replace('fixture-secret','[redacted]'),f.io);
assert.equal(result.retrieved,true);assert.equal(result.loadedRuntimeVerified,false);
assert.equal(result.redacted,true);assert.ok(!result.source.includes('fixture-secret'));
assert.equal(result.sha256,crypto.createHash('sha256').update('class LocalMessagePortRouter { /* fixture-secret */ }').digest('hex'));
assert.deepEqual(f.calls[0],['open','/usr/share/wrt/app/service/service_runner.js','r']);
assert.deepEqual(f.calls.at(-1),['close']);
for(const code of ['EACCES','ENOENT','UNKNOWN']) {
    const bad=fixture('',{openError:Object.assign(Error('private-error-content'),{code})});
    const report=capture(text=>text,bad.io);
    assert.equal(report.retrieved,false);assert.equal(report.error,code==='UNKNOWN'?'read-failed':code);
    assert.ok(!JSON.stringify(report).includes('private-error-content'));
    assert.equal(bad.calls.length,1);
}
for(const [text,options,error] of [
    ['',{},'empty-source'],['code',{regular:false},'not-a-regular-file'],
    ['code',{size:131073},'source-size-limit'],
    ['x'.repeat(131073),{size:10},'source-size-limit'],
    ['code',{readError:Object.assign(Error('private'),{code:'EIO'})},'EIO']
]) {
    const bad=fixture(text,options),report=capture(value=>value,bad.io);
    assert.equal(report.retrieved,false);assert.equal(report.error,error);assert.equal(report.source,undefined);
    assert.deepEqual(bad.calls.at(-1),['close']);
    if(options.regular===false||options.size===131073)assert.equal(bad.calls.filter(c=>c[0]==='read').length,0);
}
console.log('PASS runtime source capture: one fixed read-only path, fragmented reads, denied/missing/oversized/non-file inputs, redaction, source hash, descriptor cleanup; candidate source is not loaded-runtime verification');
