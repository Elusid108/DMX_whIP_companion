const test = require('node:test');
const assert = require('node:assert/strict');
const bytes = require('./bytes');
const dmxrec = require('./dmxrec');
const { createUniverseMonitor, STALE_MS, REMOVE_MS } = require('./monitor');
const { createDiscovery, normalizeKnownNodes, STALE_MS: NODE_STALE_MS, DROP_MS } = require('./discovery');
const { whipRejectReason } = require('./artnet/pairing');
const { createOwnOutput } = require('./ownOutput');
const { createRouter } = require('../api/router');

// Fake clock and scheduler: every core timer is driven by hand.
const rig = () => {
    let t = 10000;
    const timers = [];
    const clock = { now: () => t, monotonicNs: () => BigInt(t) * 1000000n };
    const add = (fn, ms, repeat) => {
        const id = { fn, at: t + ms, ms, repeat };
        timers.push(id);
        return id;
    };
    const remove = (id) => {
        const i = timers.indexOf(id);
        if (i >= 0) {
            timers.splice(i, 1);
        }
    };
    const scheduler = {
        setTimeout: (fn, ms) => add(fn, ms, false),
        clearTimeout: remove,
        setInterval: (fn, ms) => add(fn, ms, true),
        clearInterval: remove,
        setImmediate: (fn) => add(fn, 0, false),
        clearImmediate: remove
    };
    const advance = (ms) => {
        const until = t + ms;
        for (;;) {
            const due = timers.filter((id) => id.at <= until).sort((a, b) => a.at - b.at)[0];
            if (!due) {
                break;
            }
            t = due.at;
            if (due.repeat) {
                due.at += due.ms;
            } else {
                remove(due);
            }
            due.fn();
        }
        t = until;
    };
    return { clock, scheduler, advance, timers };
};

test('bytes: integer helpers and strings match Buffer', () => {
    const b = new Uint8Array(12);
    bytes.writeU16LE(b, 0xbeef, 0);
    bytes.writeU16BE(b, 0xbeef, 2);
    bytes.writeU32LE(b, 0xdeadbeef, 4);
    bytes.writeU32BE(b, 0xdeadbeef, 8);
    const ref = Buffer.from(b);
    assert.equal(bytes.readU16LE(b, 0), ref.readUInt16LE(0));
    assert.equal(bytes.readU16BE(b, 2), ref.readUInt16BE(2));
    assert.equal(bytes.readU32LE(b, 4), ref.readUInt32LE(4));
    assert.equal(bytes.readU32BE(b, 8), ref.readUInt32BE(8));
    assert.equal(bytes.hex(b), ref.toString('hex'));
    assert.deepEqual(Buffer.from(bytes.fromHex(ref.toString('hex'))), ref);
    const name = new Uint8Array([0x41, 0xe9, 0x00, 0x20]);
    assert.equal(bytes.ascii(name), Buffer.from(name).toString('ascii'));
    assert.equal(bytes.latin1(name), Buffer.from(name).toString('latin1'));
});

test('dmxrec: frames round-trip through the codec and the scan accumulator agrees with the file facts', () => {
    const frames = [
        { timestamp: 0, universe: 0, protocol: 'artnet', data: Uint8Array.from([0, 10, 0]) },
        { timestamp: 0, universe: 1, protocol: 'sacn', data: Uint8Array.from([5]) },
        { timestamp: 40, universe: 0, protocol: 'artnet', data: new Uint8Array(512).fill(7) }
    ];
    const file = dmxrec.encodeRecording(frames);
    assert.equal(file.length, dmxrec.HEADER_SIZE + 3 * dmxrec.FRAME_SIZE);
    const parsed = dmxrec.parseRecording(file);
    assert.equal(parsed.length, 3);
    assert.deepEqual(parsed.map((f) => [f.timestamp, f.universe, f.protocol]), [[0, 0, 'artnet'], [0, 1, 'sacn'], [40, 0, 'artnet']]);
    assert.equal(parsed[0].data[1], 10);
    assert.equal(parsed[2].data[511], 7);
    assert.throws(() => dmxrec.parseRecording(file.subarray(0, file.length - 1)), /truncated/);
    assert.throws(() => dmxrec.parseRecording(dmxrec.createHeader(0)), /empty/);

    const scan = dmxrec.createScanAccumulator();
    for (let i = 0; i < 3; i += 1) {
        const rec = file.subarray(dmxrec.HEADER_SIZE + i * dmxrec.FRAME_SIZE, dmxrec.HEADER_SIZE + (i + 1) * dmxrec.FRAME_SIZE);
        scan.add(rec, dmxrec.frameInfo(rec));
    }
    const result = scan.finish({ frameCount: 3, walked: 3, size: file.length, created: 1, modified: 2, error: null });
    assert.equal(result.duration, 40);
    assert.deepEqual(result.universes, [0, 1]);
    assert.deepEqual(result.protocols, ['artnet', 'sacn']);
    assert.equal(result.spans.artnet.activeChannels, 512);
    assert.equal(result.spans.sacn.activeChannels, 1);
    assert.equal(result.playable, true);

    const stamp = dmxrec.createBurstStamper();
    assert.equal(stamp(100, 'artnet:0'), 0);
    assert.equal(stamp(102, 'artnet:1'), 0, 'same burst');
    assert.equal(stamp(103, 'artnet:0'), 103, 'a repeated universe starts a new burst');
});

test('monitor: injected clock drives FPS, stale and removal; the tick runs only while wanted', () => {
    const { clock, scheduler, advance, timers } = rig();
    const monitor = createUniverseMonitor({ clock, scheduler });
    const snapshots = [];
    const grids = [];
    monitor.start((s) => snapshots.push(s), (g) => grids.push(g));
    assert.equal(timers.length, 1, 'tick armed');
    monitor.setEmit({ snapshot: false, grid: false });
    assert.equal(timers.length, 0, 'tick stops when nothing is shown');
    monitor.setEmit({ snapshot: true, grid: true });
    monitor.setSelected('artnet', 0);
    for (let i = 0; i < 10; i += 1) {
        monitor.ingest({ protocol: 'artnet', universe: 0, sourceIp: '10.0.0.5', dmxData: Uint8Array.from([0, i ? 0 : 200, 3]) });
        advance(100);
    }
    const entry = monitor.universes.get('artnet-0');
    // Ten frames 100 ms apart, measured 1 s after the first: the first one
    // sits exactly on the window edge and is out, as the Buffer code counted.
    assert.equal(entry.fps, 9);
    assert.equal(entry.activeChannels, 2, 'channel 2 stays woken after going back to 0');
    assert.equal(entry.values[1], 0);
    assert.ok(snapshots.length >= 4 && snapshots.length <= 6, `5 Hz snapshots, got ${snapshots.length}`);
    assert.equal(snapshots[snapshots.length - 1].levels.artnet['0'][2], 3);
    assert.ok(grids.length > 0);
    advance(STALE_MS + 100);
    assert.equal(monitor.toRow(entry).sourceIp, 'Disconnected');
    assert.equal(entry.stale, true);
    advance(REMOVE_MS);
    assert.equal(monitor.universes.size, 0);
    monitor.stop();
    assert.equal(timers.length, 0);
});

test('pairing: only a whIP ArtPollReply passes', () => {
    const reply = { oem: 0x00ff, bindIndex: 1, portType: 0x80, style: 0, nodeReport: '#0001 [0012] Whip-1a2b v0.61.0 ok' };
    assert.equal(whipRejectReason(reply), '');
    assert.equal(whipRejectReason({ ...reply, oem: 0x1234 }), 'oem:4660');
    assert.equal(whipRejectReason({ ...reply, bindIndex: 2 }), 'bind:2');
    assert.equal(whipRejectReason({ ...reply, nodeReport: 'hello' }), 'report:hello');
    assert.equal(whipRejectReason(null), 'no-reply');
});

test('ownOutput: per instance, by CID or by local port and address', () => {
    const own = createOwnOutput({ localIps: () => new Set(['127.0.0.1', '10.0.0.2']), now: () => 0 });
    const other = createOwnOutput({ localIps: () => new Set(['127.0.0.1']), now: () => 0 });
    own.addPort(5000);
    own.addCid(Uint8Array.from({ length: 16 }, (_, i) => i));
    assert.equal(own.isOwn({ sourceIp: '10.0.0.2', sourcePort: 5000 }), true);
    assert.equal(own.isOwn({ sourceIp: '10.0.0.9', sourcePort: 5000 }), false);
    assert.equal(own.isOwn({ cid: '000102030405060708090a0b0c0d0e0f' }), true);
    assert.equal(other.isOwn({ sourceIp: '10.0.0.2', sourcePort: 5000 }), false, 'another engine does not share the table');
    own.removePort(5000);
    assert.equal(own.isOwn({ sourceIp: '10.0.0.2', sourcePort: 5000 }), false);
});

test('discovery: strategies merge into one node table; known nodes stay while silent', () => {
    const { clock, scheduler, advance } = rig();
    const router = createRouter({ now: clock.now, setTimer: scheduler.setTimeout, clearTimer: scheduler.clearTimeout });
    const polls = [];
    let listener = null;
    let saved = { knownNodes: normalizeKnownNodes({ nodes: [{ mac: 'AA:BB:CC:DD:EE:01', ip: '10.0.0.21', name: 'Rig' }] }) };
    const settings = {
        load: () => saved,
        save: (patch) => {
            saved = { ...saved, ...patch };
            return saved;
        }
    };
    const discovery = createDiscovery({
        router,
        clock,
        scheduler,
        log: { info() {}, warn() {}, error() {} },
        settings,
        poll: (dest) => {
            polls.push(dest || 'broadcast');
            return true;
        },
        onPollReply: (fn) => {
            listener = fn;
            return () => {
                listener = null;
            };
        }
    });
    const whip = (mac, ip, name) => ({
        mac, ip, sourceIp: ip, shortName: name, longName: `${name} long`, universes: [0], bindIndex: 1, oem: 0x00ff, portType: 0x80, style: 0, nodeReport: `#0001 [0001] ${name} v0.61.0`
    });

    assert.equal(discovery.list().length, 0);
    listener(whip('aa:bb:cc:dd:ee:02', '10.0.0.22', 'Loose'));
    assert.equal(discovery.list().length, 0, 'nothing is collected until a strategy runs');

    discovery.setStrategies([
        { kind: 'artpollBroadcast', intervalMs: 2500 },
        { kind: 'knownNodes' },
        { kind: 'manual', ip: '10.0.0.30' }
    ]);
    assert.deepEqual(polls.sort(), ['10.0.0.21', '10.0.0.30', 'broadcast']);
    let nodes = discovery.list();
    assert.deepEqual(nodes.map((n) => [n.id, n.stale, n.sources]), [
        ['10.0.0.30', true, ['manual']],
        ['aa:bb:cc:dd:ee:01', true, ['knownNodes']]
    ]);

    listener(whip('aa:bb:cc:dd:ee:01', '10.0.0.21', 'Rig'));
    listener(whip('aa:bb:cc:dd:ee:02', '10.0.0.22', 'Loose'));
    listener({ ...whip('aa:bb:cc:dd:ee:03', '10.0.0.23', 'Other'), oem: 0x1111 });
    nodes = discovery.list();
    assert.equal(nodes.length, 4);
    const rig1 = nodes.find((n) => n.id === 'aa:bb:cc:dd:ee:01');
    assert.equal(rig1.paired, true);
    assert.equal(rig1.stale, false);
    assert.deepEqual(rig1.sources, ['knownNodes']);
    assert.equal(nodes.find((n) => n.id === 'aa:bb:cc:dd:ee:03').paired, false);
    assert.deepEqual(nodes.find((n) => n.id === 'aa:bb:cc:dd:ee:02').sources, ['artpollBroadcast']);

    advance(NODE_STALE_MS + 1000);
    nodes = discovery.list();
    assert.equal(nodes.find((n) => n.id === 'aa:bb:cc:dd:ee:01').stale, true);
    advance(DROP_MS);
    nodes = discovery.list();
    assert.deepEqual(nodes.map((n) => n.id).sort(), ['10.0.0.30', 'aa:bb:cc:dd:ee:01'], 'known and manual nodes are kept, the rest dropped');
    assert.ok(polls.filter((p) => p === 'broadcast').length >= 10, 'broadcast polled every 2.5 s');

    discovery.setStrategies([{ kind: 'knownNodes', nodes: [{ ip: '10.0.0.40' }] }]);
    assert.equal(saved.knownNodes.nodes[0].ip, '10.0.0.40', 'a given list is persisted');
    assert.equal(saved.knownNodes.version, 1);
    assert.deepEqual(discovery.list().map((n) => n.id), ['10.0.0.40']);

    discovery.setStrategies([]);
    assert.equal(discovery.list().length, 0);
    discovery.close();
    assert.equal(listener, null);
});
