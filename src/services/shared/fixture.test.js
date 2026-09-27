const test = require('node:test');
const assert = require('node:assert/strict');
const fx = require('./fixture');

const outputs = [{
    data: 14,
    segs: [
        { count: 64, ch_px: 3 },
        { count: 32, ch_px: 3 }
    ]
}];
const pixels = fx.pixelsFromOutputs(outputs);

test('pixels follow outputs and segments in order', () => {
    assert.equal(pixels.length, 96);
    const segs = fx.segmentsFromOutputs(outputs);
    assert.deepEqual(segs.map((s) => [s.g0, s.count]), [[0, 64], [64, 32]]);
    const rgbw = fx.pixelsFromOutputs([{ segs: [{ count: 2, white: true }] }]);
    assert.equal(rgbw[0].cpp, 4);
});

test('ranges round-trip', () => {
    const { pixels: list, error } = fx.parseRanges('0-3, 10,5-5,11');
    assert.equal(error, '');
    assert.deepEqual(list, [0, 1, 2, 3, 5, 10, 11]);
    assert.equal(fx.formatRanges(list), '0-3,5,10-11');
    assert.ok(fx.parseRanges('4-2').error);
    assert.ok(fx.parseRanges('x').error);
    assert.deepEqual(fx.parseRanges('90-99', 96).pixels, [90, 91, 92, 93, 94, 95]);
});

test('reduced modes: header then fixed channels per sub-fixture', () => {
    const dim = { mode: 'dim', ch: 1, uni: 10, subs: [{}, {}, {}] };
    assert.equal(fx.layout(dim, pixels).footprint, 16);
    assert.equal(fx.channelText(fx.subChannels(dim, 2)), '15,16');
    const rgb = { ...dim, mode: 'rgb' };
    assert.equal(fx.layout(rgb, pixels).footprint, 25);
    assert.equal(fx.channelText(fx.subChannels(rgb, 1)), '16,17,18,19,20');
    const tooLate = { mode: 'rgb', ch: 500, uni: 0, subs: [{}, {}, {}] };
    assert.match(fx.layout(tooLate, pixels).error, /does not fit/);
    // 96 RGB sub-fixtures from channel 1 still fit one universe.
    const full96 = { mode: 'rgb', ch: 1, uni: 0, subs: new Array(96).fill({}) };
    assert.equal(fx.layout(full96, pixels).footprint, 490);
    assert.equal(fx.layout(full96, pixels).error, '');
});

test('full mode never splits a pixel across a universe', () => {
    const full = { mode: 'full', ch: 1, uni: 10, subs: [] };
    const lay = fx.layout(full, pixels);
    assert.equal(lay.footprint, 10 + 96 * 3);
    assert.equal(fx.channelText(fx.pixelChannels(full, lay, [], pixels, 64)), '203,204,205');
    const late = { mode: 'full', ch: 400, uni: 10, subs: [] };
    const lay2 = fx.layout(late, pixels);
    // 400 + 10 header -> first pixel at 410; 34 pixels fit before 512.
    assert.equal(fx.channelText(fx.pixelChannels(late, lay2, [], pixels, 33)), '509,510,511');
    assert.equal(fx.channelText(fx.pixelChannels(late, lay2, [], pixels, 34)), 'U11: 1,2,3');
    assert.equal(lay2.unis, 2);
    assert.equal(lay2.footprint, 299);
    const big = fx.pixelsFromOutputs([{ segs: [{ count: 1024, ch_px: 3 }] }]);
    assert.match(fx.layout(full, big).error, /more than 6 universes/);
});

test('validate catches what the node would reject', () => {
    const subOf = new Array(96).fill(-1);
    const base = { en: true, mode: 'dim', proto: 'artnet', uni: 10, ch: 1, subs: [{ name: 'A' }] };
    assert.equal(fx.validate(base, subOf, pixels), '');
    assert.match(fx.validate({ ...base, ch: 0 }, subOf, pixels), /Channel/);
    assert.match(fx.validate({ ...base, proto: 'sacn', uni: 0 }, subOf, pixels), /sACN/);
    const scattered = subOf.map((_, g) => (g % 2 === 0 ? 0 : -1));
    const many = fx.pixelsFromOutputs([{ segs: [{ count: 1024, ch_px: 3 }] }]);
    const wide = new Array(1024).fill(-1).map((_, g) => (g % 2 === 0 ? 0 : -1));
    assert.equal(fx.validate(base, scattered, pixels), '');
    assert.match(fx.validate(base, wide, many), /too many separate pixel runs/);
});

test('fixture JSON <-> form fields', () => {
    const json = {
        en: true,
        mode: 'rgb',
        proto: 'sacn',
        uni: 5,
        ch: 20,
        subs: [{ name: 'Left', px: '0-3' }, { name: 'Right', px: '4,6' }]
    };
    const { fx: state, subOf } = fx.fromFixture(json, 8);
    assert.deepEqual(subOf, [0, 0, 0, 0, 1, -1, 1, -1]);
    assert.deepEqual(fx.toFields(state, subOf), {
        en: 1,
        mode: 'rgb',
        proto: 'sacn',
        uni: 5,
        ch: 20,
        n: 2,
        s0n: 'Left',
        s0px: '0-3',
        s1n: 'Right',
        s1px: '4,6'
    });
});
