'use strict';
// Gesture timing comes from the authenticated native events, not delivery time:
// a busy service must not turn buffered, separate presses into a double press.
var WINDOW_MS = 350, BOUNCE_MS = 70;
function timestamp(event) {
    var seconds=event.time_seconds, micros=event.time_microseconds;
    if(!Number.isSafeInteger(seconds)||seconds<0||!Number.isInteger(micros)||micros<0||micros>=1000000)return null;
    var value=seconds*1000+micros/1000;
    return Number.isFinite(value)&&value<=Number.MAX_SAFE_INTEGER?value:null;
}
function Gesture() { this.reset(); }
Gesture.prototype.reset = function () {
    this.context=null;this.down=false;this.first=null;this.released=false;
    this.lastTime=null;this.lastPress=null;this.quietUntil=null;
};
Gesture.prototype.feed = function (event, context) {
    if(!context){this.reset();return null;}
    if(this.context!==context){this.reset();this.context=context;}
    var now=timestamp(event);
    if(now===null||this.lastTime!==null&&now<this.lastTime){
        this.first=null;this.released=false;this.lastPress=null;this.quietUntil=null;
    }
    this.lastTime=now;
    if(event.action==='repeat'){this.first=null;this.released=false;return null;}
    if(event.action==='up'){
        if(!this.down)return null;
        this.released=this.down&&this.first!==null&&now!==null&&now-this.first<=WINDOW_MS;
        if(!this.released)this.first=null;
        this.down=false;return null;
    }
    if(event.action!=='down'||this.down)return null;
    this.down=true;
    if(now!==null&&(this.quietUntil!==null&&now<this.quietUntil||this.lastPress!==null&&now-this.lastPress<BOUNCE_MS)){
        this.first=null;this.released=false;return null;
    }
    this.lastPress=now;
    if(this.first!==null&&this.released&&now!==null&&now-this.first<=WINDOW_MS){
        this.first=null;this.released=false;this.quietUntil=now+WINDOW_MS;
        return 'double';
    }
    this.first=now;this.released=false;return 'single';
};
module.exports={Gesture:Gesture,WINDOW_MS:WINDOW_MS};
