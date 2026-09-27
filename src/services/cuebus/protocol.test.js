const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    OP,
    ROLE,
    hashGroup,
    encode,
    decode,
    pingSample,
    cuePosition
} = require('./protocol');

test('group hash matches the firmware FNV-1a', () => {
    // FNV-1a 32-bit reference values
    assert.equal(hashGroup(''), 2166136261);
    assert.equal(hashGroup('a'), 0xe40c292c);
    assert.equal(hashGroup('foobar'), 0xbf9cf968);
});

test('LAUNCH has the firmware byte layout', () => {
    const buf = encode({
        op: OP.LAUNCH,
        seq: 0x1234,
        sender: 0xaabbccdd,
        group: 0x01020304,
        cue: 0x05060708,
        loop: true,
        createdAt: 1000000,
        startAt: 1300000,
        startPos: 0,
        dur: 60000
    });
    assert.equal(buf.length, 44);
    assert.equal(buf.toString('latin1', 0, 4), 'WHP3');
    assert.equal(buf[4], OP.LAUNCH);
    assert.equal(buf[5], 1);
    assert.equal(buf.readUInt16LE(6), 0x1234);
    assert.equal(buf.readUInt32LE(8), 0xaabbccdd);
    assert.equal(buf.readUInt32LE(12), 0x01020304);
    assert.equal(buf.readUInt32LE(16), 0x05060708);
    assert.equal(buf.readBigInt64LE(20), 1000000n);
    assert.equal(buf.readBigInt64LE(28), 1300000n);
    assert.equal(buf.readUInt32LE(40), 60000);
    const back = decode(buf);
    assert.equal(back.startAt, 1300000);
    assert.equal(back.dur, 60000);
    assert.equal(back.loop, true);
});

test('HELLO round-trips with a running cue', () => {
    const buf = encode({
        op: OP.HELLO,
        seq: 7,
        sender: 42,
        role: ROLE.COMPANION,
        synced: true,
        isMaster: true,
        master: 42,
        rttUs: 0,
        waitGroup: 0,
        name: 'DMX whIP Companion',
        cueState: {
            group: 9,
            cue: 10,
            createdAt: 5,
            startAt: 6,
            startPos: 7,
            dur: 8,
            pausePos: 9,
            paused: true,
            loop: false
        }
    });
    assert.equal(buf.length, 88);
    const back = decode(buf);
    assert.equal(back.name, 'DMX whIP Companion');
    assert.equal(back.role, ROLE.COMPANION);
    assert.equal(back.isMaster, true);
    assert.equal(back.cueState.group, 9);
    assert.equal(back.cueState.paused, true);
    assert.equal(back.cueState.startAt, 6);
});

test('one PING/PONG gives offset and round trip', () => {
    // master clock = local + 5000 us, 1000 us each way, 200 us to answer
    const t1 = 100000;
    const t2 = t1 + 1000 + 5000;
    const t3 = t2 + 200;
    const t4 = t1 + 2200;
    const { offset, rtt } = pingSample({ t1, t2, t3, t4 });
    assert.equal(offset, 5000);
    assert.equal(rtt, 2000);
});

test('cue position follows the schedule and holds when paused', () => {
    const cue = { startAt: 1000000, startPos: 500, paused: false };
    assert.equal(cuePosition(cue, 1000000), 500);
    assert.equal(cuePosition(cue, 3000000), 2500);
    assert.equal(cuePosition({ ...cue, paused: true, pausePos: 800 }, 9000000), 800);
});
