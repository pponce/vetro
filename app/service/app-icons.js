'use strict';
// Read only Samsung's installed-app artwork. Clients supply an app ID, never a path.
var fs = require('fs'), path = require('path'), crypto = require('crypto');
var ROOT = '/opt/share/webappservice/apps_icon/all';
var PLUS_ROOT = '/opt/usr/apps/com.samsung.tv.tvPlusDeeplinker/shared/res';
var MAX_BYTES = 128 * 1024, CHUNK_BYTES = 8192, MAX_CACHE = 32;
var SIGNATURE = Buffer.from([137,80,78,71,13,10,26,10]);
var SIZES = ['224x224.png','152x152.png','104x104.png','304x304.png','icon.png'];
function png(data) {
    if (!Buffer.isBuffer(data) || data.length < 45 || data.length > MAX_BYTES || !data.slice(0,8).equals(SIGNATURE) ||
        data.readUInt32BE(8) !== 13 || data.toString('ascii',12,16) !== 'IHDR') return false;
    var width=data.readUInt32BE(16),height=data.readUInt32BE(20);
    return width>0 && height>0 && width<=1024 && height<=1024 &&
        data.readUInt32BE(data.length-12)===0 && data.toString('ascii',data.length-8,data.length-4)==='IEND';
}
function candidates(appId,metadata) {
    var ids=[];
    (metadata.entries || []).forEach(function (r) {
        if (r.appId===appId && r.visible && typeof r.id==='string' && /^[A-Za-z0-9_-]{1,120}$/.test(r.id) && ids.indexOf(r.id)<0 && ids.length<8) ids.push(r.id);
    });
    ids.sort();
    var files=[];
    ids.forEach(function (id) { SIZES.forEach(function (size) { files.push({root:ROOT,file:path.join(ROOT,id,size)}); }); });
    if (appId==='com.samsung.tv.tvPlusDeeplinker') files.push({root:PLUS_ROOT,file:path.join(PLUS_ROOT,'TVPlus_app_icon.png')});
    return files;
}
function readFile(io,candidate) {
    var fd;
    try {
        var root=io.realpathSync(candidate.root),file=io.realpathSync(candidate.file);
        if (file.indexOf(root+path.sep)!==0) return null;
        fd=io.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
        var stat=io.fstatSync(fd);
        if (!stat.isFile() || stat.size<45 || stat.size>MAX_BYTES) return null;
        var data=Buffer.alloc(stat.size),offset=0;
        while (offset<data.length) {
            var count=io.readSync(fd,data,offset,data.length-offset,offset);
            if (!count) return null;
            offset+=count;
        }
        return png(data)?data:null;
    } catch (_) { return null; }
    finally { if (fd!==undefined) try { io.closeSync(fd); } catch (_) {} }
}
function createReader(options) {
    options=options || {};
    var io=options.fs || fs,now=options.now || Date.now,cache=new Map();
    return function read(appId,metadata) {
        var files=candidates(appId,metadata),key=JSON.stringify([appId,files]),prior=cache.get(key);
        if (prior && now()-prior.at<120000) { cache.delete(key);cache.set(key,prior);return prior.image; }
        var image=null;
        files.some(function (file) {
            var data=readFile(io,file);
            if (!data) return false;
            image={data:data,revision:crypto.createHash('sha256').update(data).digest('hex')};return true;
        });
        cache.delete(key);cache.set(key,{at:now(),image:image});
        while (cache.size>MAX_CACHE) cache.delete(cache.keys().next().value);
        return image;
    };
}
module.exports={createReader:createReader,png:png,MAX_BYTES:MAX_BYTES,CHUNK_BYTES:CHUNK_BYTES};
