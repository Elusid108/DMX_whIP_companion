const test = require('node:test');
const assert = require('node:assert/strict');
const {
    formatDuration,
    formatClock,
    formatBytes,
    formatDate,
    protocolName,
    protocolList
} = require('./format');

test('formatDuration is mm:ss:hh and clamps bad input to zero', () => {
    assert.equal(formatDuration(0), '00:00:00');
    assert.equal(formatDuration(61234), '01:01:23');
    assert.equal(formatDuration(-5), '00:00:00');
    assert.equal(formatDuration(undefined), '00:00:00');
    assert.equal(formatDuration(null), '00:00:00');
});

test('formatClock adds hours only when needed', () => {
    assert.equal(formatClock(0), '0:00');
    assert.equal(formatClock(59999), '0:59');
    assert.equal(formatClock(60000), '1:00');
    assert.equal(formatClock(3723000), '1:02:03');
});

test('formatBytes picks B / KB / MB', () => {
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(1536), '1.5 KB');
    assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
});

test('formatDate shows a dash for no time', () => {
    assert.equal(formatDate(0), '—');
    assert.equal(typeof formatDate(Date.now()), 'string');
});

test('protocol labels', () => {
    assert.equal(protocolName('sacn'), 'sACN');
    assert.equal(protocolName('artnet'), 'Art-Net');
    assert.equal(protocolList([]), '—');
    assert.equal(protocolList(['artnet', 'sacn']), 'Art-Net, sACN');
    assert.equal(protocolList(['artnet', 'sacn'], ' + '), 'Art-Net + sACN');
});
