const { test } = require('node:test');
const assert = require('node:assert/strict');
const { analyzePush, slicePlan } = require('./pushFit');

const range = (universe) => ({
    universe,
    protocol: 'artnet',
    firstCh: 1,
    lastCh: 192,
    firstAddr: universe * 512,
    lastAddr: (universe * 512) + 191
});

const multiscreenLook = () => ({
    filePath: 'C:/tmp/multiscreen-2.dmx',
    name: 'Multiscreen 2',
    scan: {
        protocols: ['artnet'],
        activeChannels: 576,
        startUniverse: 0,
        startChannel: 1,
        endUniverse: 2,
        endChannel: 192,
        spans: {
            artnet: {
                startUniverse: 0,
                startChannel: 1,
                endUniverse: 2,
                endChannel: 192,
                activeChannels: 576,
                firstAddr: 0,
                lastAddr: (2 * 512) + 191,
                ranges: [range(0), range(1), range(2)]
            }
        }
    }
});

const whip = (id, artnet, extra = {}) => ({
    id: `whip-${id}`,
    ip: `10.0.0.${id}`,
    mac: `aa:bb:cc:dd:ee:0${id}`,
    longName: `Whip-${id}`,
    shortName: `Whip-${id}`,
    status: extra.status || {
        proto: 'artnet',
        live: Boolean(extra.live),
        outputs: [{
            segs: [{ proto: 'artnet', artnet, ch: 1, count: 64, ch_px: 3 }]
        }],
        play: { sync: true }
    },
    statusError: extra.statusError || ''
});

test('three 64 px boards covering U0–U2 are a green split, not 640 uncovered', () => {
    const analysis = analyzePush(
        [multiscreenLook()],
        [whip(1, 0), whip(2, 1), whip(3, 2)]
    );
    const look = analysis.looks[0];
    assert.equal(look.span.activeChannels, 576);
    assert.equal(look.batch.uncovered, 0);
    assert.equal(look.batch.kind, 'slice');
    assert.equal(look.batch.level, 'green');
    assert.equal(look.blocked, false);
    assert.equal(analysis.overall.canPush, true);
    assert.equal(look.devices[0].kind, 'slice');
    assert.equal(look.devices[0].destFirstAddr, 0);
    assert.equal(look.devices[0].destLastAddr, 191);
    assert.equal(look.devices[1].destFirstAddr, 512);
    assert.equal(look.devices[1].destLastAddr, 512 + 191);
    assert.ok(slicePlan(look, 'whip-1'));
    assert.ok(slicePlan(look, 'whip-2'));
    assert.ok(slicePlan(look, 'whip-3'));
});

test('selecting one overlapping board allows a partial Push', () => {
    const analysis = analyzePush(
        [multiscreenLook()],
        [whip(1, 0)]
    );
    const look = analysis.looks[0];
    assert.equal(look.batch.kind, 'partial');
    assert.equal(look.batch.level, 'amber');
    assert.equal(look.batch.uncovered, 384);
    assert.match(look.batch.label, /192 of 576/);
    assert.equal(look.blocked, false);
    assert.equal(analysis.overall.canPush, true);
    assert.equal(analysis.overall.kind, 'partial');
    assert.ok(slicePlan(look, 'whip-1'));
});

test('live-locked nodes do not block Push to overlapping idle nodes', () => {
    const analysis = analyzePush(
        [multiscreenLook()],
        [whip(1, 0, { live: true }), whip(2, 1)]
    );
    const look = analysis.looks[0];
    assert.equal(look.devices[0].kind, 'live');
    assert.equal(look.blocked, false);
    assert.equal(analysis.overall.canPush, true);
    assert.equal(slicePlan(look, 'whip-1'), null);
    assert.ok(slicePlan(look, 'whip-2'));
});

test('a node that only fits after a slide can still take a partial Push', () => {
    const analysis = analyzePush(
        [multiscreenLook()],
        [whip(9, 10)]
    );
    const look = analysis.looks[0];
    assert.equal(look.blocked, false);
    assert.equal(analysis.overall.canPush, true);
    assert.equal(look.batch.kind, 'partial');
    assert.ok(look.devices[0].slideDelta !== 0);
    assert.ok(slicePlan(look, 'whip-9'));
});

test('no idle patched node still blocks Push', () => {
    const analysis = analyzePush(
        [multiscreenLook()],
        [whip(9, 10, { status: null, statusError: 'Unable to read /status' })]
    );
    const look = analysis.looks[0];
    assert.equal(look.blocked, true);
    assert.equal(analysis.overall.canPush, false);
    assert.equal(slicePlan(look, 'whip-9'), null);
});
