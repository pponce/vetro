'use strict';
var fs=require('fs'),crypto=require('crypto');
var SOURCE='/usr/share/wrt/app/service/service_runner.js',LIMIT=131072;
var CODES=['ENOENT','EACCES','EPERM','EISDIR','EFBIG','EMFILE','ENFILE','EIO','ELOOP'];
// Only the opt-in reply report calls this. The path is fixed, reads are bounded,
// and neither settings nor application data are examined or written.
function capture(redact,io) {
    io=io||fs;
    var result={path:SOURCE,retrieved:false,loadedRuntimeVerified:false},fd;
    try {
        fd=io.openSync(SOURCE,'r');
        var info=io.fstatSync(fd);
        if(!info.isFile()){result.error='not-a-regular-file';return result;}
        if(info.size>LIMIT){result.error='source-size-limit';return result;}
        var data=Buffer.alloc(LIMIT+1),used=0;
        while(used<data.length) {
            var count=io.readSync(fd,data,used,data.length-used,used);
            if(!count)break;
            used+=count;
        }
        if(used>LIMIT){result.error='source-size-limit';return result;}
        if(!used){result.error='empty-source';return result;}
        data=data.slice(0,used);
        var text=data.toString('utf8'),clean=redact(text);
        result.retrieved=true;result.bytes=used;
        result.sha256=crypto.createHash('sha256').update(data).digest('hex');
        result.redacted=clean!==text;result.source=clean;
    }catch(error){result.error=CODES.indexOf(error&&error.code)>=0?error.code:'read-failed';}
    finally {if(fd!==undefined){try {io.closeSync(fd);}catch(_){}}}
    return result;
}
module.exports={capture:capture};
