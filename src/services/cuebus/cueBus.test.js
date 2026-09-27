const { test } = require('node:test');
const assert = require('node:assert/strict');
const CueBus = require('./cueBus');
const { OP, ROLE, encode } = require('./protocol');

// Drive the companion's election with synthetic HELLO / PONG packets (no
// socket): it must follow a running node timeline first, then take the
// clock over without moving it.

const hello = (fields) => encode({
    op: OP.HELLO,
    seq: 1,
    role: ROLE.NODE,
    api: 2,
    name: 'Node',
    ...fields
});

const feed = (bus, buf, ip = '10.0.0.5') => bus.onMessage(buf, { address: ip, port: 4777 });

test('companion follows the incumbent node, then takes over on its timeline', () => {
    const bus = new CueBus();
    const sent = [];
    bus.send = (buf, ip) => sent.push({ buf, ip });
    bus.selfId = 50;

    // A node that has been master a while (two HELLOs 6 s apart).
    feed(bus, hello({ sender: 100, synced: true, isMaster: true, master: 100 }));
    bus.peers.get(100).lastSeen -= 6000;
    feed(bus, hello({ sender: 100, synced: true, isMaster: true, master: 100 }));

    bus.elect();
    assert.equal(bus.masterId, 100, 'unsynced companion defers to the running timeline');
    assert.equal(bus.isMaster, false);

    // One PONG from the node puts the companion on its clock.
    bus.tick();
    const ping = sent.find((item) => item.buf[4] === OP.PING);
    assert.ok(ping, 'companion pings the master');
    const t1 = Number(ping.buf.readBigInt64LE(20));
    const offset = 7000000;
    feed(bus, encode({
        op: OP.PONG,
        seq: 2,
        sender: 100,
        t1,
        t2: t1 + offset + 500,
        t3: t1 + offset + 600
    }));
    assert.ok(bus.everSynced);
    const synced = bus.off;

    bus.elect();
    assert.equal(bus.masterId, 50, 'synced companion outranks a node');
    assert.equal(bus.isMaster, true);
    assert.equal(bus.off, synced, 'the timeline carries on unchanged');
});

test('a Show Host outranks the companion', () => {
    const bus = new CueBus();
    bus.send = () => {};
    bus.selfId = 50;
    bus.everSynced = true;
    bus.isMaster = true;
    bus.masterId = 50;
    feed(bus, hello({ sender: 900, role: ROLE.HOST, synced: true, isMaster: true, master: 900 }));
    bus.elect();
    assert.equal(bus.masterId, 900);
    assert.equal(bus.isMaster, false);
});
