'use strict';
const assert=require('assert').strict;
const {parse}=require('../service/foreground-state.js');
assert.deepEqual(parse('value = netflix.app (String)\nvalue = (String)\nvalue = 1 (Int32)\n'),{full:'netflix.app',partial:'',sourceType:1});
assert.deepEqual(parse('value = "netflix.app"\nvalue = null\nvalue = 40\n'),{full:'netflix.app',partial:'',sourceType:40});
assert.deepEqual(parse('value = com.samsung.tv.csfs (String)\nvalue = org.tizen.menu (String)\nvalue = 0 (Int32)\n'),{full:'com.samsung.tv.csfs',partial:'org.tizen.menu',sourceType:0});
for(const input of ['', 'value = (String)\nvalue = (String)\nvalue = 0 (Int32)', 'value = app (Int32)\nvalue = (String)\nvalue = 0 (Int32)', 'value = app\nvalue =\nvalue = HDMI'])assert.throws(()=>parse(input),/unavailable/);
console.log('PASS foreground snapshot: typed values, empty overlay, legacy values and malformed states');
