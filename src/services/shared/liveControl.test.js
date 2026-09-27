const test = require('node:test');
const assert = require('node:assert/strict');
const lc = require('./liveControl');

test('defaults: faders on ch 1-32, pads on 33-57, all Art-Net U0', () => {
    const d = lc.defaultLive();
    assert.equal(d.faders.length, 32);
    assert.equal(d.pads.length, 25);
    assert.deepEqual([d.faders[0].ch, d.faders[31].ch, d.pads[0].ch, d.pads[24].ch], [1, 32, 33, 57]);
    assert.equal(d.pads[0].mode, 'toggle');
    assert.equal(d.pads[0].on, 255);
    assert.equal(d.dest, '');
});

test('normalizeLive clamps and repairs', () => {
    const n = lc.normalizeLive({
        faders: [{ name: 'A very long fader name here', proto: 'sacn', uni: 0, ch: 900 }, null],
        pads: [{ mode: 'flash', on: 0, proto: 'bogus', uni: -3 }],
        dest: '10.0.0.300'
    });
    assert.equal(n.faders[0].name.length, lc.NAME_MAX);
    assert.deepEqual([n.faders[0].proto, n.faders[0].uni, n.faders[0].ch], ['sacn', 1, 512]);
    assert.equal(n.faders[1].ch, 2);
    assert.deepEqual([n.pads[0].mode, n.pads[0].on, n.pads[0].proto, n.pads[0].uni], ['flash', 1, 'artnet', 0]);
    assert.equal(n.dest, '');
    assert.equal(lc.normalizeLive({ dest: ' 10.0.0.25 ' }).dest, '10.0.0.25');
});

test('patchSequential rolls into the next universe', () => {
    const d = lc.defaultLive();
    const next = lc.patchSequential(d.faders, 16, 16, { proto: 'sacn', uni: 3, ch: 505 });
    assert.equal(next[15].ch, 16);
    assert.deepEqual([next[16].proto, next[16].uni, next[16].ch], ['sacn', 3, 505]);
    assert.deepEqual([next[23].uni, next[23].ch], [3, 512]);
    assert.deepEqual([next[24].uni, next[24].ch], [4, 1]);
});

test('HTP across controls sharing an address', () => {
    const layout = lc.defaultLive();
    layout.pads[0] = { ...layout.pads[0], ch: 1, on: 128 };
    const state = lc.emptyState();
    state.faders[0] = 40;
    state.pads[0] = true;
    let levels = lc.levelsByAddress(layout, state);
    assert.equal(levels.get('artnet:0:1').value, 128);
    state.faders[0] = 200;
    levels = lc.levelsByAddress(layout, state);
    assert.equal(levels.get('artnet:0:1').value, 200);
});

test('diffLevels reports changes and zeroes moved addresses', () => {
    const layout = lc.defaultLive();
    const state = lc.emptyState();
    state.faders[1] = 90;
    const before = lc.levelsByAddress(layout, state);
    const moved = { ...layout, faders: layout.faders.map((f, i) => (i === 1 ? { ...f, ch: 100 } : f)) };
    const after = lc.levelsByAddress(moved, state);
    const changes = lc.diffLevels(before, after);
    assert.deepEqual(changes.map((c) => [c.ch, c.value]).sort((a, b) => a[0] - b[0]), [[2, 0], [100, 90]]);
    assert.deepEqual(lc.diffLevels(after, after), []);
});

test('parseMidi reads notes, CC and pitch bend and skips the rest', () => {
    assert.deepEqual(lc.parseMidi([0x90, 36, 100]), { kind: 'note', ch: 1, num: 36, value: 100, on: true });
    assert.equal(lc.parseMidi([0x92, 36, 0]).on, false, 'note on at velocity 0 is a release');
    assert.deepEqual(lc.parseMidi([0x81, 36, 64]), { kind: 'note', ch: 2, num: 36, value: 0, on: false });
    assert.deepEqual(lc.parseMidi([0xb0, 48, 127]), { kind: 'cc', ch: 1, num: 48, value: 127, on: true });
    assert.deepEqual(lc.parseMidi([0xe3, 0x7f, 0x7f]), { kind: 'pb', ch: 4, num: 0, value: 16383, on: true });
    assert.equal(lc.parseMidi([0xf8]), null);
    assert.equal(lc.parseMidi([0xfe, 0]), null);
    assert.equal(lc.parseMidi([0xd0, 40]), null);
});

test('learn replaces the control and the message', () => {
    let maps = [];
    const cc48 = lc.parseMidi([0xb0, 48, 10]);
    maps = lc.learnMap(maps, 'f0', 'APC MINI', cc48);
    maps = lc.learnMap(maps, 'p3', 'APC MINI', lc.parseMidi([0x90, 1, 127]));
    assert.deepEqual(lc.findTargets(maps, 'APC MINI', cc48), ['f0']);
    // Same fader learns another CC: its old mapping goes.
    maps = lc.learnMap(maps, 'f0', 'APC MINI', lc.parseMidi([0xb0, 49, 10]));
    assert.deepEqual(lc.findTargets(maps, 'APC MINI', cc48), []);
    // Another fader takes CC 49: fader 0 loses it.
    maps = lc.learnMap(maps, 'f1', 'APC MINI', lc.parseMidi([0xb0, 49, 90]));
    assert.deepEqual(maps.map((m) => m.target).sort(), ['f1', 'p3']);
    // Same CC on another device is a different message.
    maps = lc.learnMap(maps, 'f2', 'nanoKONTROL', lc.parseMidi([0xb0, 49, 1]));
    assert.equal(maps.length, 3);
    assert.deepEqual(lc.clearDevice(maps, 'APC MINI').map((m) => m.target), ['f2']);
    assert.deepEqual(lc.clearTarget(maps, 'p3').length, 2);
});

test('scaling and feedback bytes', () => {
    assert.equal(lc.faderValue(lc.parseMidi([0xb0, 1, 127])), 255);
    assert.equal(lc.faderValue(lc.parseMidi([0xb0, 1, 64])), 129);
    assert.equal(lc.faderValue(lc.parseMidi([0xe0, 0x7f, 0x7f])), 255);
    assert.equal(lc.faderValue(lc.parseMidi([0x80, 1, 0])), 0);
    const note = { kind: 'note', ch: 1, num: 36 };
    assert.deepEqual(lc.feedbackBytes(note, true, true), [0x90, 36, 127]);
    assert.deepEqual(lc.feedbackBytes(note, false, true), [0x90, 36, 0]);
    assert.deepEqual(lc.feedbackBytes({ kind: 'cc', ch: 2, num: 7 }, 255, false), [0xb1, 7, 127]);
    assert.deepEqual(lc.feedbackBytes({ kind: 'pb', ch: 1, num: 0 }, 255, false), [0xe0, 0x7f, 0x7f]);
    assert.equal(lc.midiLabel({ kind: 'cc', ch: 1, num: 48 }), 'CC 48 · ch 1');
});

test('normalizeMidi keeps valid mappings keyed by the controller name', () => {
    const n = lc.normalizeMidi({
        maps: [
            { target: 'f31', device: 'MIDIIN2 (APC MINI)', kind: 'cc', ch: 1, num: 48 },
            { target: 'f32', device: 'X', kind: 'cc', ch: 1, num: 1 },
            { target: 'p0', device: '', kind: 'note', ch: 1, num: 1 },
            { target: 'p1', device: 'X', kind: 'sysex', ch: 1, num: 1 },
            { target: 'p2', device: 'X', kind: 'pb', ch: 20, num: 9 }
        ],
        devices: { 'MIDIOUT2 (APC MINI)': { feedback: false }, X: {} }
    });
    assert.deepEqual(n.maps, [
        { target: 'f31', device: 'APC MINI', kind: 'cc', ch: 1, num: 48 },
        { target: 'p2', device: 'X', kind: 'pb', ch: 16, num: 0 }
    ]);
    assert.deepEqual(n.devices, { 'APC MINI': { feedback: false, on: 0 }, X: { feedback: true, on: 0 } });
    assert.deepEqual(lc.targetInfo('p24'), { kind: 'pads', index: 24 });
    assert.equal(lc.targetInfo('p25'), null);
});
