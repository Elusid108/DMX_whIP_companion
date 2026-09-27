const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createBurstStamper, parseRecording, writeRecording } = require('./dmxRecording');
const { flattenToFrames } = require('./compilationEdl');
const { sliceRecording } = require('./dmxSlice');

const tmp = (name) => path.join(os.tmpdir(), `whip-${name}-${process.pid}-${Date.now()}.dmx`);
const filled = (value) => new Uint8Array(512).fill(value);

test('a burst of universes shares one timestamp until a universe repeats', () => {
    const stamp = createBurstStamper();
    assert.equal(stamp(3, 'artnet:0'), 0);
    assert.equal(stamp(4, 'artnet:1'), 0);
    assert.equal(stamp(5, 'artnet:2'), 0);
    // next console frame
    assert.equal(stamp(28, 'artnet:0'), 28);
    assert.equal(stamp(29, 'artnet:1'), 28);
    // a repeat inside the window still starts a new frame
    assert.equal(stamp(30, 'artnet:1'), 30);
    // past the window
    assert.equal(stamp(40, 'artnet:2'), 40);
});

test('flatten sends a universe once per recorded packet, not once per timestamp', () => {
    // Three universes, each on its own millisecond, 10 frames.
    const media = [];
    for (let f = 0; f < 10; f += 1) {
        for (let u = 0; u < 3; u += 1) {
            media.push({ timestamp: (f * 25) + u, universe: u, protocol: 'artnet', data: filled(f + u) });
        }
    }
    const clips = [{ id: 'a', mediaId: 'm', startMs: 0, sourceInMs: 0, sourceOutMs: 250 }];
    const out = flattenToFrames({ m: media }, clips);
    assert.equal(out.length, 30);
    // one output frame per console frame, all universes at the frame's time
    const times = [...new Set(out.map((frame) => frame.timestamp))];
    assert.equal(times.length, 10);
    assert.deepEqual(out.filter((frame) => frame.timestamp === 25).map((frame) => frame.universe), [0, 1, 2]);
    assert.equal(out.find((frame) => frame.timestamp === 25 && frame.universe === 2).data[0], 3);
});

test('flatten averages clips that share a universe (look-at)', () => {
    const a = [0, 40].map((t) => ({ timestamp: t, universe: 0, protocol: 'artnet', data: filled(100) }));
    const b = [0, 40].map((t) => ({ timestamp: t, universe: 0, protocol: 'artnet', data: filled(200) }));
    const clips = [
        { id: '1', mediaId: 'a', startMs: 0, sourceInMs: 0, sourceOutMs: 40 },
        { id: '2', mediaId: 'b', startMs: 0, sourceInMs: 0, sourceOutMs: 40 }
    ];
    const out = flattenToFrames({ a, b }, clips);
    assert.equal(out.length, 2);
    assert.equal(out[0].data[10], 150);
});

test('flatten never produces sACN universe 0', () => {
    const media = [0, 40].map((t) => ({ timestamp: t, universe: 1, protocol: 'sacn', data: filled(9) }));
    const clips = [{ id: '1', mediaId: 'm', startMs: 0, sourceInMs: 0, sourceOutMs: 40, universeOffset: -1 }];
    assert.equal(flattenToFrames({ m: media }, clips).length, 0);
});

test('a slice that straddles two source universes carries both forward', () => {
    // Source universes 0 and 1 arrive on different milliseconds; the node's
    // window starts mid-universe, so each dest universe needs both sources.
    const src = tmp('slice-src');
    const dest = tmp('slice-dest');
    writeRecording(src, [
        { timestamp: 0, universe: 0, protocol: 'artnet', data: filled(10) },
        { timestamp: 6, universe: 1, protocol: 'artnet', data: filled(20) },
        { timestamp: 25, universe: 0, protocol: 'artnet', data: filled(11) },
        { timestamp: 31, universe: 1, protocol: 'artnet', data: filled(21) }
    ]);
    try {
        sliceRecording(src, dest, {
            proto: 'artnet',
            destProto: 'artnet',
            slideDelta: -256,
            destFirstAddr: 0,
            destLastAddr: 511
        });
        const frames = parseRecording(fs.readFileSync(dest));
        assert.ok(frames.length >= 2);
        const last = frames[frames.length - 1];
        // dest 0..255 = source U0 ch 257..512, dest 256..511 = source U1 ch 1..256
        assert.equal(last.data[0], 11);
        assert.equal(last.data[255], 11);
        assert.equal(last.data[256], 21);
        assert.equal(last.data[511], 21);
        // After both universes have arrived, no record blanks either half.
        frames.filter((frame) => frame.timestamp >= 6).forEach((frame) => {
            assert.ok(frame.data[0] > 0);
            assert.ok(frame.data[300] > 0);
        });
    } finally {
        fs.unlinkSync(src);
        if (fs.existsSync(dest)) {
            fs.unlinkSync(dest);
        }
    }
});

test('a slice for an sACN-patched node renumbers Art-Net universes', () => {
    const src = tmp('proto-src');
    const dest = tmp('proto-dest');
    writeRecording(src, [
        { timestamp: 0, universe: 0, protocol: 'artnet', data: filled(5) }
    ]);
    try {
        sliceRecording(src, dest, {
            proto: 'artnet',
            destProto: 'sacn',
            destUniShift: 1,
            destFirstAddr: 0,
            destLastAddr: 191
        });
        const [frame] = parseRecording(fs.readFileSync(dest));
        assert.equal(frame.protocol, 'sacn');
        assert.equal(frame.universe, 1);
        assert.equal(frame.data[0], 5);
    } finally {
        fs.unlinkSync(src);
        if (fs.existsSync(dest)) {
            fs.unlinkSync(dest);
        }
    }
});
