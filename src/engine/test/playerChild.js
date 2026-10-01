// Forked by loopback.test.js: a second engine that plays the fixture to
// 127.0.0.1 so the recording engine in the parent does not see the packets
// as its own output (ownOutput is process-wide). Talks to the parent over
// process IPC: 'go' starts playback, 'ended' is sent when it finishes,
// 'exit' closes the engine.
const path = require('path');
const { createSettingsStore } = require('../settingsStore');
const { createEngine } = require('../index');

const dataDir = process.env.PLAYER_DATA_DIR;
const fixture = process.env.PLAYER_FIXTURE;
const ports = { artnet: Number(process.env.PLAYER_PORT_ARTNET), sacn: Number(process.env.PLAYER_PORT_SACN) };
const dest = process.env.PLAYER_DEST || '127.0.0.1';
const nic = process.env.PLAYER_NIC || '127.0.0.1';

const main = async () => {
    const settings = createSettingsStore({
        filePath: path.join(dataDir, 'settings.json'),
        defaultLibraryDir: path.dirname(fixture)
    });
    const engine = createEngine({ settings, appVersion: 'player-child', udpPorts: ports });
    const client = engine.client({ client: 'player-child' });
    await client.hello();
    const loaded = await client.command('playback.loadCompilation', {
        sources: [{ filePath: fixture, name: 'fixture' }],
        name: 'fixture'
    });
    if (!loaded.success) {
        throw new Error(loaded.error || 'load failed');
    }
    const edited = await client.command('studio.edit', {
        op: 'update',
        clipId: loaded.clips[0].id,
        patch: { destIp: dest }
    });
    if (!edited.success) {
        throw new Error(edited.error || 'edit failed');
    }
    let started = false;
    client.subscribe('playback.stats', (stats) => {
        if (stats.isPlaying) {
            started = true;
        } else if (started && !stats.isPaused) {
            started = false;
            process.send({ type: 'ended', playheadMs: stats.playheadMs });
        }
    });
    process.on('message', async (msg) => {
        if (msg && msg.type === 'go') {
            await client.command('playback.toggle', { source: 'studio', playbackNetwork: nic, loop: false });
        } else if (msg && msg.type === 'exit') {
            client.close();
            engine.close();
            process.exit(0);
        }
    });
    process.send({ type: 'ready', frames: loaded.frameCount, durationMs: loaded.durationMs });
};

main().catch((err) => {
    process.send({ type: 'error', message: err.message });
    process.exit(1);
});
