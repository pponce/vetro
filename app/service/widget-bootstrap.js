'use strict';
// The screen and service share their package-private wgt-private directory.
// This file carries only a short-lived widget credential, never owner access.
var fs=require('fs'),path=require('path'),crypto=require('crypto');
var FILE='vetro-widget-session.json',RENEW_MS=120000;
function Publisher(auth,diagnostics) {
    this.auth=auth;this.diagnostics=diagnostics;this.file=null;this.timer=null;
    this.instance=crypto.randomBytes(16).toString('hex');
    this.state={transport:'private-storage',ready:false,publications:0,error:null};
}
Publisher.prototype.report=function(error) {
    this.state.error=error?(error.name==='Error'?'IOError':error.name):null;
    if(this.diagnostics&&typeof this.diagnostics.bootstrap==='function')this.diagnostics.bootstrap(this.state);
};
Publisher.prototype.publish=function() {
    var tmp,fd;
    try {
        if(!this.file)throw Error('Private widget storage unavailable');
        try {
            var info=fs.lstatSync(this.file);
            if(!info.isFile()||info.isSymbolicLink())throw Error('Invalid private widget file');
        } catch(e) {if(e.code!=='ENOENT')throw e;}
        var credential=this.auth.issuePrivateWidget();
        var record={schema:1,instance:this.instance,token:credential.token,expires:credential.expires};
        tmp=this.file+'.tmp-'+crypto.randomBytes(8).toString('hex');
        fd=fs.openSync(tmp,'wx',384);
        fs.writeFileSync(fd,JSON.stringify(record));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
        fs.renameSync(tmp,this.file);tmp=null;
        fd=fs.openSync(path.dirname(this.file),'r');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
        this.state.ready=true;this.state.publications=Math.min(1000000,this.state.publications+1);this.report();
    } catch(error) {
        if(fd!==undefined)try{fs.closeSync(fd);}catch(_){}
        if(tmp)try{fs.unlinkSync(tmp);}catch(_){}
        this.auth.revokePrivateWidgets();this.state.ready=false;this.report(error);
    }
};
Publisher.prototype.start=function(directory) {
    if(this.timer!==null)return;
    if(typeof directory!=='string'||!path.isAbsolute(directory))throw Error('Private widget directory required');
    this.file=path.join(directory,FILE);this.publish();
    var self=this;this.timer=setInterval(function(){self.publish();},RENEW_MS);
    if(this.timer&&this.timer.unref)this.timer.unref();
};
Publisher.prototype.stop=function() {
    if(this.timer!==null)clearInterval(this.timer);this.timer=null;
    this.auth.revokePrivateWidgets();this.state.ready=false;
    // A stale process must not remove a newer process's credential file.
    try {
        var info=fs.lstatSync(this.file);
        if(info.isFile()&&!info.isSymbolicLink()&&info.size<=512&&
            JSON.parse(fs.readFileSync(this.file,'utf8')).instance===this.instance)fs.unlinkSync(this.file);
    }catch(_){}
    this.file=null;this.report();
};
module.exports={Publisher:Publisher,FILE:FILE};
