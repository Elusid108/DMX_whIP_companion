const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dgram = require('dgram');
const { parseRecording } = require('./core/dmxrec');
const { createSettingsStore } = require('./settingsStore');
const { createEngine } = require('./index');
const { writeFixture, testPorts, FRAME_MS, UNIVERSES } = require('./test/fixture');

// Play a synthetic two-protocol look through one engine, record it with a
// second engine's receivers on loopback in the same process (own-output
// filtering is per engine, so the recorder does not treat the player's
// packets as its own), and compare packets: same universes, same bytes,
// same burst order. Ports come from DMXWHIP_TEST_PORT_BASE so runs do not
// clash.

const NIC = '127.0.0.1';
const TIME_TOLERANCE_MS = 50;

const canBind = (port) => new Promise((resolve) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    socket.once('error', () => {
        resolve(false);
    });
    socket.bind(port, NIC, () => {
        socket.close(() => resolve(true));
    });
});

const key = (f) => `${f.protocol}:${f.universe}`;
const byBurst = (frames) => {
    const bursts = [];
    for (const f of frames) {
        const last = bursts[bursts.length - 1];
        if (last && last.timestamp === f.timestamp) {
            last.frames.push(f);
        } else {
            bursts.push({ timestamp: f.timestamp, frames: [f] });
        }
    }
    return bursts;
};
const sortBurst = (frames) => [...frames].sort((a, b) => (
    a.protocol === b.protocol ? a.universe - b.universe : a.protocol.localeCompare(b.protocol)
));

test('loopback: play a look, record it back, same universes, data and order', { timeout: 30000 }, async (t) => {
    const ports = testPorts();
    if (!(await canBind(ports.artnet)) || !(await canBind(ports.sacn))) {
        t.skip(`loopback ports ${ports.artnet}/${ports.sacn} are not bindable here`);
        return;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whip-loopback-'));
    const playerDir = path.join(dir, 'player');
    const recorderDir = path.join(dir, 'recorder');
    fs.mkdirSync(path.join(playerDir, 'Shows'), { recursive: true });
    fs.mkdirSync(path.join(recorderDir, 'Shows'), { recursive: true });
    const fixturePath = path.join(playerDir, 'Shows', 'fixture.dmx');
    const expected = writeFixture(fixturePath);

    const engine = createEngine({
        settings: createSettingsStore({
            filePath: path.join(recorderDir, 'settings.json'),
            defaultLibraryDir: path.join(recorderDir, 'Shows')
        }),
        appVersion: 'loopback-test',
        udpPorts: ports
    });
    const client = engine.client({ client: 'loopback-test' });
    const player = createEngine({
        settings: createSettingsStore({
            filePath: path.join(playerDir, 'settings.json'),
            defaultLibraryDir: path.join(playerDir, 'Shows')
        }),
        appVersion: 'loopback-player',
        udpPorts: ports
    });
    const playerClient = player.client({ client: 'loopback-player' });
    try {
        const hello = await client.hello();
        assert.equal(hello.apiVersion, 1);
        const bound = await client.command('receive.setNic', { nic: NIC });
        assert.equal(bound.success, true, 'receivers bound on loopback');
        await client.command('receive.setUniverses', { universes: UNIVERSES.map((u) => `${u.protocol}-${u.universe}`) });

        // The player: the fixture as a one-clip Studio session sent unicast
        // to loopback, so sACN does not depend on multicast routing here.
        await playerClient.hello();
        const loaded = await playerClient.command('playback.loadCompilation', {
            sources: [{ filePath: fixturePath, name: 'fixture' }],
            name: 'fixture'
        });
        assert.equal(loaded.success, true, loaded.error);
        assert.equal(loaded.frameCount, expected.length, 'player loaded every fixture frame');
        const edited = await playerClient.command('studio.edit', {
            op: 'update',
            clipId: loaded.clips[0].id,
            patch: { destIp: NIC }
        });
        assert.equal(edited.success, true, edited.error);
        const ended = new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('playback did not end within 15 s')), 15000);
            let started = false;
            playerClient.subscribe('playback.stats', (stats) => {
                if (stats.isPlaying) {
                    started = true;
                } else if (started && !stats.isPaused) {
                    clearTimeout(timer);
                    resolve(stats.playheadMs);
                }
            });
        });

        const takePath = path.join(recorderDir, 'Shows', 'take.dmx');
        const started = await client.command('record.start', { filePath: takePath });
        assert.equal(started.success, true);
        const played = await playerClient.command('playback.toggle', { source: 'studio', playbackNetwork: NIC, loop: false });
        assert.equal(played.success, true);
        await ended;
        await new Promise((resolve) => setTimeout(resolve, 200));
        const stopped = await client.command('record.stop', { emitSaved: false });
        assert.equal(stopped.success, true);
        assert.equal(stopped.filePath, takePath);

        const recorded = parseRecording(fs.readFileSync(takePath));

        // Universes: exactly the fixture's, each with the same packet count.
        const count = (frames) => {
            const m = new Map();
            frames.forEach((f) => m.set(key(f), (m.get(key(f)) || 0) + 1));
            return [...m.entries()].sort();
        };
        assert.deepEqual(count(recorded), count(expected));

        // Per universe: same packets in the same order, byte for byte.
        for (const u of UNIVERSES) {
            const k = `${u.protocol}:${u.universe}`;
            const got = recorded.filter((f) => key(f) === k);
            const want = expected.filter((f) => key(f) === k);
            assert.equal(got.length, want.length, `${k} packet count`);
            got.forEach((f, i) => {
                assert.deepEqual(Buffer.from(f.data), Buffer.from(want[i].data), `${k} packet ${i} data`);
            });
        }

        // Across universes: every burst holds the same set of packets as the
        // fixture's, in the same burst order. Inside a burst the two sockets
        // may hand packets over in either order, so bursts are compared sorted.
        const gotBursts = byBurst(recorded);
        const wantBursts = byBurst(expected);
        assert.equal(gotBursts.length, wantBursts.length, 'burst count');
        gotBursts.forEach((burst, i) => {
            const got = sortBurst(burst.frames).map((f) => [key(f), Buffer.from(f.data).toString('hex')]);
            const want = sortBurst(wantBursts[i].frames).map((f) => [key(f), Buffer.from(f.data).toString('hex')]);
            assert.deepEqual(got, want, `burst ${i}`);
        });

        // Timing: loose. Bursts land about FRAME_MS apart, the first at 0.
        gotBursts.forEach((burst, i) => {
            const want = i * FRAME_MS;
            assert.ok(
                Math.abs(burst.timestamp - want) <= TIME_TOLERANCE_MS,
                `burst ${i} at ${burst.timestamp} ms, expected about ${want} ms`
            );
        });
    } finally {
        playerClient.close();
        player.close();
        client.close();
        engine.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
