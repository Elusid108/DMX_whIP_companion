const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dgram = require('dgram');
const { fork } = require('child_process');
const { parseRecording } = require('../services/shared/dmxRecording');
const { createSettingsStore } = require('./settingsStore');
const { createEngine } = require('./index');
const { writeFixture, testPorts, FRAME_MS, UNIVERSES } = require('./test/fixture');

// Play a look through one engine (in a child process, so the parent's
// own-output filter does not drop it), record it with another engine's
// receivers on loopback, and compare packets. Ports come from
// DMXWHIP_TEST_PORT_BASE so runs do not clash.

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

const waitFor = (child, type, timeoutMs) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`child did not send ${type} within ${timeoutMs} ms`)), timeoutMs);
    const onMessage = (msg) => {
        if (msg && msg.type === 'error') {
            clearTimeout(timer);
            child.off('message', onMessage);
            reject(new Error(`player child: ${msg.message}`));
        } else if (msg && msg.type === type) {
            clearTimeout(timer);
            child.off('message', onMessage);
            resolve(msg);
        }
    };
    child.on('message', onMessage);
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
    let child = null;
    try {
        const hello = await client.hello();
        assert.equal(hello.apiVersion, 1);
        const bound = await client.command('receive.setNic', { nic: NIC });
        assert.equal(bound.success, true, 'receivers bound on loopback');
        await client.command('receive.setUniverses', { universes: UNIVERSES.map((u) => `${u.protocol}-${u.universe}`) });

        child = fork(path.join(__dirname, 'test', 'playerChild.js'), [], {
            env: {
                ...process.env,
                PLAYER_DATA_DIR: playerDir,
                PLAYER_FIXTURE: fixturePath,
                PLAYER_PORT_ARTNET: String(ports.artnet),
                PLAYER_PORT_SACN: String(ports.sacn),
                PLAYER_DEST: NIC,
                PLAYER_NIC: NIC
            },
            stdio: ['ignore', 'ignore', 'inherit', 'ipc']
        });
        const ready = await waitFor(child, 'ready', 10000);
        assert.equal(ready.frames, expected.length, 'child loaded every fixture frame');

        const takePath = path.join(recorderDir, 'Shows', 'take.dmx');
        const started = await client.command('record.start', { filePath: takePath });
        assert.equal(started.success, true);
        child.send({ type: 'go' });
        await waitFor(child, 'ended', 15000);
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
        if (child) {
            child.send({ type: 'exit' });
            await new Promise((resolve) => {
                child.once('exit', resolve);
                setTimeout(() => {
                    child.kill();
                    resolve();
                }, 2000);
            });
        }
        client.close();
        engine.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
