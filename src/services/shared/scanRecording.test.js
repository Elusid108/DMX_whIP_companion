const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    writeRecording,
    scanRecording,
    shouldRecordUniverseFrame
} = require('./dmxRecording');

const rgb64 = (universe, timestamp = 0) => {
    const data = Buffer.alloc(512);
    data.fill(40, 0, 192);
    return { timestamp, universe, protocol: 'artnet', data };
};

test('scan counts the union of per-universe woken ranges, not unused Art-Net tails', () => {
    const filePath = path.join(os.tmpdir(), `whip-scan-${process.pid}-${Date.now()}.dmx`);
    writeRecording(filePath, [
        rgb64(0),
        rgb64(1),
        rgb64(2),
        { timestamp: 0, universe: 3, protocol: 'artnet', data: Buffer.alloc(512) }
    ]);
    try {
        const scan = scanRecording(filePath);
        assert.equal(scan.activeChannels, 576);
        assert.equal(scan.spans.artnet.activeChannels, 576);
        assert.equal(scan.spans.artnet.ranges.length, 3);
        assert.equal(scan.spans.artnet.firstAddr, 0);
        assert.equal(scan.spans.artnet.lastAddr, (2 * 512) + 191);
        assert.equal(scan.spans.artnet.lastAddr - scan.spans.artnet.firstAddr + 1, 1216);
        scan.spans.artnet.ranges.forEach((range, index) => {
            assert.equal(range.universe, index);
            assert.equal(range.firstCh, 1);
            assert.equal(range.lastCh, 192);
        });
    } finally {
        fs.unlinkSync(filePath);
    }
});

test('never-woken all-zero universe frames are not recorded; blackouts after signal are', () => {
    const woken = new Set();
    assert.equal(shouldRecordUniverseFrame(woken, 'artnet', 0, Buffer.alloc(512)), false);
    const lit = Buffer.alloc(512);
    lit[0] = 1;
    assert.equal(shouldRecordUniverseFrame(woken, 'artnet', 0, lit), true);
    assert.equal(shouldRecordUniverseFrame(woken, 'artnet', 0, Buffer.alloc(512)), true);
    assert.equal(shouldRecordUniverseFrame(woken, 'artnet', 1, Buffer.alloc(512)), false);
});
