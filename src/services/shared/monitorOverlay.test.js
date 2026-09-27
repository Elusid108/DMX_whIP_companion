const test = require('node:test');
const assert = require('node:assert/strict');
const mo = require('./monitorOverlay');

const seg = (over) => ({
    proto: 'auto', order: 'grb', count: 10, white: false, cct: false,
    artnet: 0, sacn: 1, ch: 1, ch_px: 3, ...over
});
const device = (id, segs, fixture = null, name = id) => ({
    id,
    shortName: name,
    patch: { outputs: [{ chip: 'ws2812b', segs }], fixture }
});

test('patchFromStatus reads outputs, the legacy map and the fixture', () => {
    const p = mo.patchFromStatus({
        outputs: [{ chip: 'ws2812b', segs: [{ proto: 'artnet', order: 'grbw', count: 4, white: true, artnet: 3, sacn: 4, ch: 7, ch_px: 4 }] }],
        fixture: { en: true, mode: 'rgb', proto: 'sacn', uni: 9, ch: 1, subs: 2, valid: true }
    });
    assert.equal(p.outputs[0].segs[0].ch_px, 4);
    assert.deepEqual(p.fixture, { mode: 'rgb', proto: 'sacn', uni: 9, ch: 1, subs: 2, valid: true });
    const legacy = mo.patchFromStatus({ map: { order: 'rgb', count: 5, artnet: 2, ch: 1 } });
    assert.equal(legacy.outputs[0].segs[0].sacn, 3);
    assert.equal(mo.patchFromStatus({ fixture: { en: false } }).fixture, null);
});

test('GRB pixels: groups of 3 with wire-order roles', () => {
    const o = mo.buildOverlay([device('a', [seg({ ch: 4, count: 2 })])], 'artnet', 0);
    assert.equal(o.cells[2], null);
    assert.deepEqual(o.cells.slice(3, 9).map((c) => c.role), ['g', 'r', 'b', 'g', 'r', 'b']);
    assert.equal(o.cells[3].group, o.cells[5].group);
    assert.notEqual(o.cells[5].group, o.cells[6].group);
    assert.equal(o.spans.length, 1);
    assert.deepEqual([o.spans[0].first, o.spans[0].last], [4, 9]);
    assert.equal(mo.describeChannel(o, 5), 'Ch 5 · a · Out 1 Seg 1 · Px 1 · Red');
});

test('4 and 5 channel pixels', () => {
    const o4 = mo.buildOverlay([device('a', [seg({ order: 'grbw', white: true, ch_px: 4, count: 2 })])], 'artnet', 0);
    assert.deepEqual(o4.cells.slice(0, 8).map((c) => c.role).join(''), 'grbwgrbw');
    assert.equal(o4.cells[3].group, o4.cells[0].group);
    const o5 = mo.buildOverlay([device('a', [seg({ order: 'rgbwc', white: true, cct: true, ch_px: 5, count: 1 })])], 'artnet', 0);
    assert.equal(o5.cells.slice(0, 5).map((c) => c.role).join(''), 'rgbwc');
    assert.equal(o5.cells[5], null);
});

test('a packed segment straddles into the next universe', () => {
    // ch 511 + 3 ch: pixel 0 = U0 511,512 + U1 1; pixel 1 = U1 2-4.
    const d = device('a', [seg({ order: 'rgb', ch: 511, count: 2 })]);
    const u0 = mo.buildOverlay([d], 'artnet', 0);
    assert.deepEqual([u0.cells[510].role, u0.cells[511].role], ['r', 'g']);
    const u1 = mo.buildOverlay([d], 'artnet', 1);
    assert.equal(u1.cells[0].role, 'b');
    assert.equal(u1.cells[0].pixel, 0);
    assert.equal(u1.cells[1].pixel, 1);
    assert.equal(u1.cells[4], null);
});

test('a whole segment in one universe stays put', () => {
    const d = device('a', [seg({ ch: 1, count: 170 })]);
    const u0 = mo.buildOverlay([d], 'artnet', 0);
    assert.equal(u0.cells[509].pixel, 169);
    assert.equal(u0.cells[510], null);
    assert.equal(mo.buildOverlay([d], 'artnet', 1).spans.length, 0);
});

test('sACN numbering is Art-Net + 1 and protocol filters apply', () => {
    const d = device('a', [seg({ artnet: 4, sacn: 5, count: 1 })]);
    assert.equal(mo.buildOverlay([d], 'sacn', 5).spans.length, 1);
    assert.equal(mo.buildOverlay([d], 'sacn', 4).spans.length, 0);
    const artOnly = device('b', [seg({ proto: 'artnet', artnet: 4, sacn: 5, count: 1 })]);
    assert.equal(mo.buildOverlay([artOnly], 'sacn', 5).spans.length, 0);
    assert.equal(mo.buildOverlay([artOnly], 'artnet', 4).spans.length, 1);
});

test('overlapping nodes take separate lanes', () => {
    const o = mo.buildOverlay([
        device('a', [seg({ ch: 1, count: 10 })]),
        device('b', [seg({ ch: 16, count: 10 })]),
        device('c', [seg({ ch: 100, count: 2 })])
    ], 'artnet', 0);
    const lanes = Object.fromEntries(o.spans.map((s) => [s.name, s.lane]));
    assert.deepEqual(lanes, { a: 0, b: 1, c: 0 });
    assert.equal(o.lanes, 2);
    assert.deepEqual(o.cells[20].names, ['a', 'b']);
});

test('fixture Dim and RGB footprints', () => {
    const dim = device('a', [seg({ artnet: 0, count: 4 })], { mode: 'dim', proto: 'artnet', uni: 2, ch: 101, subs: 3, valid: true });
    const o = mo.buildOverlay([dim], 'artnet', 2);
    assert.equal(o.spans.length, 1);
    assert.deepEqual([o.spans[0].first, o.spans[0].last], [101, 116]);
    assert.equal(o.spans[0].name, 'a · Fixture');
    assert.equal(o.cells[100].label, 'Master dimmer');
    assert.equal(o.cells[110].label, 'Sub 1 dim');
    assert.equal(o.cells[110].group, o.cells[111].group);
    const rgb = device('a', [seg({ count: 4 })], { mode: 'rgb', proto: 'artnet', uni: 2, ch: 1, subs: 2, valid: true });
    const r = mo.buildOverlay([rgb], 'artnet', 2);
    assert.equal(r.spans[0].last, 20);
    assert.deepEqual(r.cells.slice(10, 15).map((c) => c.role), ['fx', 'fx', 'r', 'g', 'b']);
});

test('fixture Full never splits a pixel across a universe', () => {
    // 10 header + 170 pixels * 3 = 520 from ch 1: pixel 167 ends at 511, so
    // pixel 168 starts U1 ch 1.
    const full = device('a', [seg({ order: 'grb', count: 170 })], { mode: 'full', proto: 'sacn', uni: 7, ch: 1, subs: 0, valid: true });
    const u7 = mo.buildOverlay([full], 'sacn', 7);
    assert.equal(u7.cells[10].role, 'g');
    assert.equal(u7.cells[510].pixel, 166);
    assert.equal(u7.cells[511], null);
    const u8 = mo.buildOverlay([full], 'sacn', 8);
    assert.equal(u8.cells[0].pixel, 167);
    assert.equal(u8.cells[0].role, 'g');
    assert.equal(mo.describeChannel(u8, 1), 'Ch 1 · a · Fixture · Pixel 167 · Green');
});

test('manual grouping and off', () => {
    const m = mo.buildOverlay([], 'artnet', 0, { group: '2' });
    assert.equal(m.cells[0].group, m.cells[1].group);
    assert.notEqual(m.cells[1].group, m.cells[2].group);
    assert.deepEqual([m.cells[0].role, m.cells[1].role], ['w', 'c']);
    assert.equal(mo.describeChannel(m, 3), 'Ch 3 · 2-ch group 2 · White');
    const off = mo.buildOverlay([device('a', [seg({ count: 2 })])], 'artnet', 0, { group: 'off' });
    assert.equal(off.cells[0].group, -1);
    assert.equal(off.cells[0].role, 'g');
});
