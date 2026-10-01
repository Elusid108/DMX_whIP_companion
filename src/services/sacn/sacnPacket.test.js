const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Packet } = require('sacn/dist/packet');
const { createSacnDmxPacket, parseSacnPacket } = require('../../engine/core/sacn/packet');

const cid = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
const levels = () => {
    const data = new Uint8Array(512);
    for (let i = 0; i < 512; i += 1) {
        data[i] = (i * 7) & 0xff;
    }
    return data;
};

test('E1.31 data packet is byte-identical to the sacn reference encoder', () => {
    const data = levels();
    const { packet } = createSacnDmxPacket(7, data, {
        cid,
        sourceName: 'Test Src',
        priority: 100,
        sequence: 42
    });
    const payload = {};
    data.forEach((value, i) => {
        payload[i + 1] = value;
    });
    const reference = new Packet({
        universe: 7,
        payload,
        sourceName: 'Test Src',
        priority: 100,
        sequence: 42,
        cid,
        useRawDmxValues: true
    }).buffer;
    assert.equal(packet.length, 638);
    assert.deepEqual(Buffer.from(packet), reference);
});

test('receiver drops non-zero start codes, preview and stream-terminated data', () => {
    const rinfo = { address: '10.0.0.9', port: 5568 };
    const { packet } = createSacnDmxPacket(3, levels(), { cid });
    const ok = parseSacnPacket(packet, rinfo);
    assert.equal(ok.universe, 3);
    assert.equal(ok.dmxData.length, 512);
    assert.equal(ok.dmxData[1], 7);

    const priority = Buffer.from(packet);
    priority[125] = 0xdd;
    assert.equal(parseSacnPacket(priority, rinfo), null);

    const preview = Buffer.from(packet);
    preview[112] = 0x80;
    assert.equal(parseSacnPacket(preview, rinfo), null);

    const terminated = Buffer.from(packet);
    terminated[112] = 0x40;
    assert.equal(parseSacnPacket(terminated, rinfo), null);
});
