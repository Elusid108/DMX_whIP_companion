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
