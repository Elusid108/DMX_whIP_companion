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
    assert.equal(fx.layout(dim, pixels).footprint, 19);
    assert.equal(fx.channelText(fx.subChannels(dim, 2)), '18,19');
    const rgb = { ...dim, mode: 'rgb' };
    assert.equal(fx.layout(rgb, pixels).footprint, 28);
    assert.equal(fx.channelText(fx.subChannels(rgb, 1)), '19,20,21,22,23');
    // Basic: the 5-channel header only; sub-fixtures are kept but not used.
    const basic = { ...dim, mode: 'basic' };
    assert.equal(fx.layout(basic, pixels).footprint, 5);
    assert.equal(fx.channelText(fx.subChannels(basic, 0)), '\u2014');
    const tooLate = { mode: 'rgb', ch: 500, uni: 0, subs: [{}, {}, {}] };
    assert.match(fx.layout(tooLate, pixels).error, /does not fit/);
    // 96 RGB sub-fixtures from channel 1 still fit one universe.
    const full96 = { mode: 'rgb', ch: 1, uni: 0, subs: new Array(96).fill({}) };
    assert.equal(fx.layout(full96, pixels).footprint, 493);
    assert.equal(fx.layout(full96, pixels).error, '');
});

test('full mode never splits a pixel across a universe', () => {
    const full = { mode: 'full', ch: 1, uni: 10, subs: [] };
    const lay = fx.layout(full, pixels);
    assert.equal(lay.footprint, 13 + 96 * 3);
    assert.equal(fx.channelText(fx.pixelChannels(full, lay, [], pixels, 64)), '206,207,208');
    const late = { mode: 'full', ch: 400, uni: 10, subs: [] };
    const lay2 = fx.layout(late, pixels);
    // 400 + 13 header -> first pixel at 413; 33 pixels fit before 512.
    assert.equal(fx.channelText(fx.pixelChannels(late, lay2, [], pixels, 32)), '509,510,511');
    assert.equal(fx.channelText(fx.pixelChannels(late, lay2, [], pixels, 33)), 'U11: 1,2,3');
    assert.equal(lay2.unis, 2);
    assert.equal(lay2.footprint, 302);
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

test('channel map: header rows with value meanings', () => {
    const rows = fx.channelMap({ mode: 'dim', uni: 2, ch: 101, subs: [] }, outputs, []);
    assert.equal(rows.length, 13);
    assert.deepEqual([rows[0].channels, rows[0].name], ['101', 'Master dimmer']);
    assert.deepEqual([rows[2].name, rows[3].name], ['Strobe colour', 'Strobe intensity']);
    assert.match(rows[2].values, /0 white/);
    assert.match(rows[3].values, /0 blackout/);
    assert.match(rows[5].values, /0 none/);
    assert.deepEqual([rows[11].channels, rows[11].name], ['112', 'Folder']);
    assert.equal(rows[12].channels, '113');
    assert.match(rows[12].values, /0 normal playback/);
    const basic = fx.channelMap({ mode: 'basic', uni: 2, ch: 1, subs: [{ name: 'Ignored' }] }, outputs, []);
    assert.deepEqual(basic.map((r) => `${r.channels} ${r.name}`), ['1 Intensity', '2 Strobe', '3 Hue shift', '4 Folder', '5 Clip']);
});

test('channel map: one row per sub-fixture in Dim and RGB', () => {
    const subOf = new Array(96).fill(-1);
    subOf[0] = 0;
    subOf[1] = 0;
    subOf[5] = 1;
    const subs = [{ name: 'Left' }, { name: '' }];
    const dim = fx.channelMap({ mode: 'dim', uni: 0, ch: 1, subs }, outputs, subOf);
    assert.deepEqual(dim.slice(13).map((r) => [r.channels, r.name, r.values]), [
        ['14-15', 'Left', 'Dim, Strobe · 2 px'],
        ['16-17', 'Sub 2', 'Dim, Strobe · 1 px']
    ]);
    const rgb = fx.channelMap({ mode: 'rgb', uni: 0, ch: 1, subs }, outputs, subOf);
    assert.deepEqual(rgb.slice(13).map((r) => r.channels), ['14-18', '19-23']);
});

test('channel map: Full rows per segment across a universe', () => {
    // 64 px + 32 px at 3 ch from ch 1: header 1-13, seg 1 14-205, seg 2
    // 206-301. DMX is R, G, B whatever the chip order (grb is wire only).
    const rows = fx.channelMap({ mode: 'full', uni: 4, ch: 1, subs: [] }, [{ segs: [{ count: 64, ch_px: 3, order: 'grb' }, { count: 32, ch_px: 3 }] }]);
    assert.deepEqual(rows.slice(13).map((r) => [r.channels, r.name, r.values]), [
        ['14-205', 'Out 1 Seg 1', 'px 0-63 · 3 ch each (R, G, B)'],
        ['206-301', 'Out 1 Seg 2', 'px 64-95 · 3 ch each (R, G, B)']
    ]);
    const wide = fx.channelMap({ mode: 'full', uni: 4, ch: 400, subs: [] }, [{ segs: [{ count: 200, ch_px: 4, white: true, order: 'grbw' }] }]);
    // 100 slots after the header: 25 px (413-512) in U4, 128 px fill U5,
    // the last 47 px end at U6 ch 188.
    assert.equal(wide[13].channels, 'U4: 413 - U6: 188');
    assert.match(wide[13].values, /4 ch each \(R, G, B, W\)/);
});
