const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { startHeadless } = require('./headless');
const { ENGINE_API_VERSION } = require('./api/version');
const { testPorts } = require('./test/fixture');

// The engine starts with no window and answers through the in-process
// client. Verified in the Linux sandbox that built Phase J; the Pi 5 run
// is in docs/engine/MANUAL_CHECKLIST.md.

test('headless engine starts, answers the handshake, holds state, stops clean', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whip-headless-'));
    const ports = testPorts();
    const lines = [];
    const run = await startHeadless({
        dataDir: dir,
        nic: '127.0.0.1',
        ports: { artnet: ports.artnet + 10, sacn: ports.sacn + 10 },
        log: (line) => lines.push(line)
    });
    try {
        assert.equal(run.hello.apiVersion, ENGINE_API_VERSION);
        assert.match(lines[0], /^engine ready api=1 version=\S+ data=.* nic=127\.0\.0\.1$/);
        assert.ok(fs.existsSync(path.join(dir, 'settings.json')), 'settings written under the data dir');
        assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')).libraryDir, path.join(dir, 'Shows'));

        const state = await run.client.query('monitor.state');
        assert.equal(state.nic, '127.0.0.1');
        assert.equal(state.bound, true);
        assert.deepEqual(state.universes, []);

        const set = await run.client.command('live.set', { changes: [{ proto: 'artnet', uni: 3, ch: 2, value: 40 }] });
        assert.equal(set.success, true);
        const live = await run.client.query('live.state');
        assert.deepEqual(live.universes, [{ proto: 'artnet', uni: 3, owned: false }]);

        const caps = await run.client.query('engine.capabilities');
        assert.equal(caps.apiVersion, ENGINE_API_VERSION);
        assert.equal(caps.host.kind, 'headless');
        assert.deepEqual(caps.io.udp, { artnet: true, sacn: true, broadcast: true, multicast: true });
        assert.equal(caps.io.dialogs, false);
        assert.equal(caps.io.midi, false);
        assert.ok(caps.features.includes('playback'));

        // Lifecycle: suspend parks the sockets and keeps state; resume rebinds.
        const lifecycleEvents = [];
        run.client.subscribe('engine.lifecycle', (e) => lifecycleEvents.push(e.lifecycle));
        const suspended = await run.client.command('engine.suspend', { reason: 'test' });
        assert.deepEqual(suspended, { success: true, suspended: true });
        assert.equal((await run.client.query('engine.state')).lifecycle, 'suspended');
        assert.equal((await run.client.query('monitor.state')).bound, false, 'receivers closed');
        await assert.rejects(
            run.client.command('live.set', { changes: [{ proto: 'artnet', uni: 3, ch: 2, value: 1 }] }),
            (err) => err.code === 'conflict' && err.data.lifecycle === 'suspended'
        );
        assert.deepEqual((await run.client.query('live.state')).universes, [{ proto: 'artnet', uni: 3, owned: false }], 'levels kept');
        const resumed = await run.client.command('engine.resume');
        assert.deepEqual(resumed, { success: true, restored: { receive: true, live: true, playback: true } });
        assert.equal((await run.client.query('monitor.state')).bound, true, 'receivers back on the same NIC');
        assert.equal((await run.client.query('engine.state')).lifecycle, 'running');
        assert.deepEqual(lifecycleEvents, ['suspended', 'running']);

        const rec = await run.client.query('record.state');
        assert.equal(rec.recording, false);
        const pb = await run.client.query('playback.state');
        assert.equal(pb.isPlaying, false);
        assert.equal(pb.session, null);
    } finally {
        run.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
    assert.equal(lines[lines.length - 1], 'engine stopped');
});

test('headless CLI --probe runs and exits without a NIC or listener', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whip-headless-cli-'));
    const ports = testPorts();
    const { stdout, code } = await new Promise((resolve) => {
        execFile(process.execPath, [path.join(__dirname, 'headless.js'), '--probe', '--data-dir', dir], {
            env: { ...process.env, DMXWHIP_PORT_ARTNET: String(ports.artnet + 20), DMXWHIP_PORT_SACN: String(ports.sacn + 20) },
            timeout: 10000
        }, (err, out) => resolve({ stdout: out, code: err ? err.code : 0 }));
    });
    fs.rmSync(dir, { recursive: true, force: true });
    assert.equal(code, 0, stdout);
    const [ready, probe, stopped] = stdout.trim().split('\n');
    assert.match(ready, /^engine ready api=1 .* nic=none$/);
    assert.equal(JSON.parse(probe).bound, false);
    assert.equal(stopped, 'engine stopped');
});
