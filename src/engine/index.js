// The headless DMX whIP engine: core + ports. Hosts talk to it through
// router envelopes (createInProcessClient) and never reach into the parts
// directly except through the adapters in src/main.
//
// deps: { settings: settings store (see settingsStore.js), appVersion,
//         ports: the port set (src/engine/ports; defaults to the Node
//                adapters in src/adapters/node),
//         udpPorts: { artnet, sacn } (defaults 6454 / 5568),
//         hostIo: { dialogs, ffmpeg, serial, cuebus } what the host adds }
const { createRouter } = require('./api/router');
const { assertPorts } = require('./ports');
const { createInProcessClient } = require('./api/inProcess');
const { ENGINE_API_VERSION } = require('./api/version');
const { createReceive } = require('./core/receive');
const { createOwnOutput } = require('./core/ownOutput');
const { createArtNetSender, createSacnOutput } = require('./core/send');
const { createDiscovery } = require('./core/discovery');
const { createDefaultLiveOutput } = require('./output/liveOutput');
const { createRecording } = require('./recording');
const { createPlayback } = require('./playback');
const { createLibraryStore } = require('./library/store');

const CAPABILITIES = ['monitor', 'live', 'stream', 'record', 'playback', 'library'];

const createEngine = ({ settings, appVersion = '0.0.0', ports: portsIn, udpPorts = {}, hostIo = {} } = {}) => {
    if (!settings || typeof settings.load !== 'function' || typeof settings.save !== 'function') {
        throw new Error('createEngine needs a settings store');
    }
    const io = assertPorts(portsIn || require('../adapters/node').createNodePorts());
    const hostInfo = (portsIn && portsIn.host) || (io.host) || { kind: 'unknown' };
    const router = createRouter({
        appVersion,
        capabilities: CAPABILITIES,
        now: io.clock.now,
        setTimer: io.scheduler.setTimeout,
        clearTimer: io.scheduler.clearTimeout
    });
    const ports = udpPorts;
    const ownOutput = createOwnOutput({ localIps: io.udp.localIps, now: io.clock.now });
    // Senders for playback and Live: ephemeral sockets through the udp port.
    // Playback gets a new random sACN CID per Play, as before.
    const senders = {
        artnet: () => createArtNetSender({ udp: io.udp, ownOutput, log: io.log, port: udpPorts.artnet }),
        sacn: ({ sourceName, iface, cid, priority } = {}) => createSacnOutput({
            udp: io.udp,
            ownOutput,
            log: io.log,
            port: udpPorts.sacn,
            cid: cid || io.random.bytes(16),
            sourceName,
            iface,
            priority
        })
    };
    const receive = createReceive({
        router,
        udp: io.udp,
        clock: io.clock,
        scheduler: io.scheduler,
        log: io.log,
        ownOutput,
        udpPorts
    });
    const discovery = createDiscovery({
        router,
        clock: io.clock,
        scheduler: io.scheduler,
        log: io.log,
        settings,
        poll: (dest) => receive.sendPoll(dest),
        onPollReply: (fn) => receive.onPollReply(fn)
    });
    const live = createDefaultLiveOutput({ settings, io, senders });
    {
        const s = settings.load();
        live.configure({ nic: s.outputNic, dest: s.live.dest });
    }
    const library = createLibraryStore(settings);
    const recording = createRecording({ router });
    receive.setRecording(recording);
    recording.onStateChange(() => receive.syncEmit());
    const playback = createPlayback({ router, recording, liveOutput: live, library, ports, senders, io });

    router.query('network.interfaces', () => io.udp.interfaces());

    // What this host can do (docs/engine/API.md §8). Built from the ports the
    // host wired plus what it declares about itself; core never guesses.
    const describe = (port, fallback) => (port && typeof port.describe === 'function' ? port.describe() : fallback);
    router.query('engine.capabilities', () => ({
        apiVersion: ENGINE_API_VERSION,
        appVersion,
        host: hostInfo,
        features: CAPABILITIES.slice(),
        io: {
            udp: describe(io.udp, { artnet: true, sacn: true, broadcast: true, multicast: true }),
            storage: describe(io.storage, { library: true, watch: false, tmp: true }),
            workers: Boolean(describe(io.workers, true)),
            midi: Boolean(io.midi),
            dialogs: Boolean(hostIo.dialogs),
            ffmpeg: Boolean(hostIo.ffmpeg),
            serial: Boolean(hostIo.serial),
            cuebus: Boolean(hostIo.cuebus)
        },
        discovery: ['artpollBroadcast', 'unicastPoll', 'manual', 'knownNodes'],
        limits: { gridStreamHz: 20, snapshotHz: 5 }
    }));

    router.command('live.set', ({ changes } = {}) => {
        live.set(Array.isArray(changes) ? changes : []);
        return { success: true };
    });
    router.command('live.releaseAll', () => {
        live.releaseAll();
        return { success: true };
    });
    router.query('live.get', () => {
        const s = settings.load();
        return { success: true, live: s.live, outputNic: s.outputNic };
    });
    // patch: any of { faders, pads, dest, midi }; normalized by the store.
    router.command('live.save', (patch = {}) => {
        try {
            const current = settings.load().live;
            const next = settings.save({ live: { ...current, ...(patch || {}) } }).live;
            live.configure({ dest: next.dest });
            return { success: true, live: next };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });
    router.command('output.setNic', ({ nic } = {}) => {
        try {
            const saved = settings.save({ outputNic: String(nic || '0.0.0.0') }).outputNic;
            live.configure({ nic: saved });
            return { success: true, outputNic: saved };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });
    router.query('live.state', () => live.state());

    let closed = false;
    const close = () => {
        if (closed) {
            return;
        }
        closed = true;
        playback.close();
        discovery.close();
        receive.close();
        recording.close();
        live.shutdown();
        router.close();
    };

    return {
        apiVersion: ENGINE_API_VERSION,
        router,
        settings,
        io,
        ports,
        receive,
        discovery,
        ownOutput,
        live,
        library,
        recording,
        playback,
        client: (options) => createInProcessClient(router, options),
        close
    };
};

module.exports = { createEngine, CAPABILITIES };
