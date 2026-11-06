'use strict';
const assert=require('assert').strict;
const {Gesture}=require('../service/home-double-press.js');
const event=(action,ms)=>({action,time_seconds:1000+Math.floor(ms/1000),time_microseconds:(ms%1000)*1000});
function fixture(){const g=new Gesture();return {g,send:(action,ms,context='one')=>g.feed(event(action,ms),context)};}

// The first press is returned synchronously; there is no timer or delayed single.
let f=fixture();
assert.equal(f.send('down',0),'single');
assert.equal(f.send('up',45),null);
assert.equal(f.send('down',180),'double');
assert.equal(f.send('up',225),null);
assert.equal(f.send('down',300),null,'a third fast press cannot undo the double action');
f.send('up',340);
assert.equal(f.send('down',700),'single','ordinary Home works again after the gesture');

for(const gap of [70,180,350]){
 f=fixture();f.send('down',0);f.send('up',25);
 assert.equal(f.send('down',gap),'double','inside the gesture window: '+gap);
}
for(const gap of [351,800,30000]){
 f=fixture();f.send('down',0);f.send('up',25);
 assert.equal(f.send('down',gap),'single','separate presses stay separate: '+gap);
}
f=fixture();f.send('down',0);f.send('up',10);
assert.equal(f.send('down',30),null,'a bounced complete press does not launch');

f=fixture();assert.equal(f.send('down',0),'single');
assert.equal(f.send('down',20),null,'duplicate downs do not toggle again');
assert.equal(f.send('repeat',100),null);
assert.equal(f.send('down',160),null);
f.send('up',200);
assert.equal(f.send('down',250),'single','holding is not the first half of a double press');

f=fixture();f.send('down',0);f.send('up',40);f.send('up',41);
assert.equal(f.send('down',180),'double','duplicate releases are harmless');
f=fixture();f.send('down',0);f.send('up',600);
assert.equal(f.send('down',650),'single','long holds without repeat events do not form a pair');

f=fixture();f.send('down',0);f.send('up',40);
assert.equal(f.send('down',180,'new-assignment'),'single','settings changes cancel a pending pair');
f=fixture();f.send('down',0);f.send('up',40);f.g.reset();
assert.equal(f.send('down',180),'single','navigation and input reconnects cancel a pending pair');
f=fixture();f.send('down',0);f.send('up',40);
assert.equal(f.send('down',180,null),null,'disabled handling has no gesture action');
assert.equal(f.send('down',250),'single','reenabling starts fresh');

for(const invalid of [{},{time_seconds:1,time_microseconds:-1},{time_seconds:1,time_microseconds:1000000},{time_seconds:Infinity,time_microseconds:0}]){
 f=fixture();f.send('down',0);f.send('up',40);
 assert.equal(f.g.feed({...invalid,action:'down'},'one'),'single','bad timing preserves a single action without a double');
}
f=fixture();f.send('down',100);f.send('up',140);
assert.equal(f.send('down',90),'single','a clock change cannot manufacture a pair');
// Both events can arrive together; their native timestamps remain authoritative.
f=fixture();f.send('down',0);f.send('up',40);
assert.equal(f.send('down',2000),'single','buffered delivery cannot compress two seconds into a double press');
console.log('PASS Home gestures: immediate singles, native timing, releases, repeats, bounce, triples, clock changes and configuration reset');
