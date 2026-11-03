'use strict';
// Read and validate Samsung's foreground app, overlay and selected source.
var Choice = require('./startup-app.js');
var COMMAND = 'vconftool get memory/appfw/current_fullscreen_appid && ' +
    'vconftool get memory/appfw/current_partial_appid && vconftool get memory/system/source_type';

function parse(text) {
    var values = [], pattern = /value[ \t]*=[ \t]*([^\r\n]*)/g, match;
    while ((match = pattern.exec(String(text || '')))) {
        // vconftool appends the value's type, including for an empty String.
        // Remove only the expected type for this field; malformed values still fail.
        var value = match[1].trim(), type = values.length < 2 ? 'String' : 'Int32';
        var suffix = ' (' + type + ')';
        if (value === '(' + type + ')') value = '';
        else if (value.slice(-suffix.length) === suffix) value = value.slice(0, -suffix.length).trim();
        values.push(value.replace(/^(?:"(.*)"|'(.*)')$/, function (_, a, b) { return a === undefined ? b : a; }));
    }
    if (values[1] === '(null)' || values[1] === 'null') values[1] = '';
    if (values.length !== 3 || !Choice.validId(values[0]) || !values[0] ||
        values[1] && !Choice.validId(values[1]) || !/^\d{1,3}$/.test(values[2])) throw Error('Foreground/source state unavailable');
    return {full: values[0], partial: values[1], sourceType: Number(values[2])};
}
module.exports = {COMMAND: COMMAND, parse: parse};
