// The headless DMX whIP engine. One createEngine() per process; hosts talk
// to it through router envelopes (createInProcessClient) and never reach
// into the parts directly except through the adapters in src/main.
//
// deps: { settings: settings store (see settingsStore.js), appVersion,
//         ports: { artnet, sacn } (defaults 6454 / 5568) }
const { createRouter } = require('./api/router');
const { createInProcessClient } = require('./api/inProcess');
const { ENGINE_API_VERSION } = require('./api/version');
const { createReceive } = require('./receive');
const { createDefaultLiveOutput } = require('./output/liveOutput');
const { getNetworkInterfaces } = require('../services/shared/networkUtils');

const CAPABILITIES = ['monitor', 'live', 'stream'];

const createEngine = ({ settings, appVersion = '0.0.0', ports = {} } = {}) => {
    if (!settings || typeof settings.load !== 'function' || typeof settings.save !== 'function') {
        throw new Error('createEngine needs a settings store');
    }
    const router = createRouter({ appVersion, capabilities: CAPABILITIES });
    const receive = createReceive({ router, ports });
    const live = createDefaultLiveOutput({ settings, ports });
    {
        const s = settings.load();
        live.configure({ nic: s.outputNic, dest: s.live.dest });
    }

    router.query('network.interfaces', () => getNetworkInterfaces());

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
        receive.close();
        live.shutdown();
        router.close();
    };

    return {
        apiVersion: ENGINE_API_VERSION,
        router,
        settings,
        ports,
        receive,
        live,
        client: (options) => createInProcessClient(router, options),
        close
    };
};

module.exports = { createEngine, CAPABILITIES };
