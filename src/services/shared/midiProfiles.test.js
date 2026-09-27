const test = require('node:test');
const assert = require('node:assert/strict');
const { padLight, profileFor } = require('./midiProfiles');

const note = (ch, num) => ({ kind: 'note', ch, num });

test('profiles are picked by port name (and Behringer by manufacturer)', () => {
    assert.equal(profileFor('APC mini mk2').id, 'apc-mini-mk2');
    assert.equal(profileFor('MIDIIN2 (APC mini mk2)').id, 'apc-mini-mk2');
    assert.equal(profileFor('APC MINI').id, 'apc');
    assert.equal(profileFor('APC Key 25 mk2').id, 'apc-key25-mk2');
    assert.equal(profileFor('APC40 mkII').id, 'apc40-mk2');
    assert.equal(profileFor('APC40').id, 'apc');
    assert.equal(profileFor('X-TOUCH MINI').id, 'xtouch-mini');
    assert.equal(profileFor('X-Touch Compact').id, 'behringer-std');
    assert.equal(profileFor('BCF2000').id, 'bcx2000');
    assert.equal(profileFor('Some Pad', 'BEHRINGER International GmbH').id, 'behringer-std');
    assert.equal(profileFor('LoopBe Internal MIDI').id, 'generic');
});

test('APC mini mk2: RGB pads at full brightness, single-colour buttons', () => {
    const p = profileFor('APC mini mk2');
    assert.deepEqual(padLight(p, note(1, 10), true), [[0x96, 10, 21]]);
    assert.deepEqual(padLight(p, note(1, 10), false), [[0x96, 10, 0]]);
    assert.deepEqual(padLight(p, note(1, 100), true), [[0x90, 100, 1]]);
});

test('X-Touch Mini standard mode lights LED n-8 / n-32 with velocity 1', () => {
    const p = profileFor('X-TOUCH MINI');
    assert.deepEqual(padLight(p, note(11, 8), true), [[0x90, 0, 1], [0x9a, 0, 1]]);
    assert.deepEqual(padLight(p, note(11, 23), false), [[0x90, 15, 0], [0x9a, 15, 0]]);
    assert.deepEqual(padLight(p, note(11, 40), true), [[0x90, 8, 1], [0x9a, 8, 1]]);
    assert.equal(padLight(p, note(11, 0), true), null, 'encoder push has no LED');
    assert.deepEqual(padLight(p, note(1, 89), true), [[0x90, 89, 127]], 'MC mode');
});

test('generic echo and the per-device override', () => {
    const g = profileFor('Unknown');
    assert.deepEqual(padLight(g, note(2, 36), true), [[0x91, 36, 127]]);
    assert.deepEqual(padLight(g, { kind: 'cc', ch: 1, num: 20 }, false), [[0xb0, 20, 0]]);
    assert.deepEqual(padLight(profileFor('X-TOUCH MINI'), note(11, 8), true, 5), [[0x9a, 8, 5]]);
    assert.deepEqual(padLight(profileFor('APC mini mk2'), { kind: 'cc', ch: 1, num: 48 }, true), [[0xb0, 48, 127]]);
});
