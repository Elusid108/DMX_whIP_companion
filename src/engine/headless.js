#!/usr/bin/env node
// Headless entry: start the engine with no window. Used by the console
// service later and by the smoke test now. Adds no network listener: the
// only sockets are the Art-Net / sACN receivers, and only when a NIC is
// given (or receive.setNic is sent through a client).
//
//   node src/engine/headless.js [--nic 0.0.0.0] [--data-dir DIR] [--probe]
//
// DMXWHIP_DATA_DIR (default ~/.dmxwhip) holds settings.json; the library
// defaults to <data-dir>/Shows. DMXWHIP_PORT_ARTNET / DMXWHIP_PORT_SACN
// override the receive/send ports (tests).
const os = require('os');
const path = require('path');
const { createSettingsStore } = require('./settingsStore');
const { createEngine } = require('./index');
const { createNodePorts } = require('../adapters/node');
const { ENGINE_API_VERSION } = require('./api/version');

const appVersion = () => {
    try {
        return require('../../package.json').version;
    } catch (err) {
        return '0.0.0';
    }
};

// opts: { dataDir, nic, ports, log } -> { engine, client, dataDir, close() }
const startHeadless = async (opts = {}) => {
    const dataDir = opts.dataDir || process.env.DMXWHIP_DATA_DIR || path.join(os.homedir(), '.dmxwhip');
    const ports = {
        artnet: opts.ports && opts.ports.artnet ? opts.ports.artnet : Number(process.env.DMXWHIP_PORT_ARTNET) || undefined,
        sacn: opts.ports && opts.ports.sacn ? opts.ports.sacn : Number(process.env.DMXWHIP_PORT_SACN) || undefined
    };
    const settings = createSettingsStore({
        filePath: path.join(dataDir, 'settings.json'),
        defaultLibraryDir: path.join(dataDir, 'Shows')
    });
    const engine = createEngine({ settings, appVersion: appVersion(), udpPorts: ports, ports: createNodePorts({ kind: 'headless' }) });
    const client = engine.client({ client: 'headless' });
    const hello = await client.hello();
    if (opts.nic) {
        const bound = await client.command('receive.setNic', { nic: opts.nic });
        if (!bound.success) {
            client.close();
            engine.close();
            throw new Error(`could not bind receivers on ${opts.nic}`);
        }
    }
    const log = opts.log || (() => {});
    log(`engine ready api=${hello.apiVersion} version=${hello.appVersion} data=${dataDir} nic=${opts.nic || 'none'}`);
    return {
        engine,
        client,
        dataDir,
        hello,
        close: () => {
            client.close();
            engine.close();
            log('engine stopped');
        }
    };
};

const parseArgs = (argv) => {
    const out = { nic: '', dataDir: '', probe: false };
    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i];
        if (a === '--nic') {
            out.nic = argv[++i] || '0.0.0.0';
        } else if (a === '--data-dir') {
            out.dataDir = argv[++i] || '';
        } else if (a === '--probe') {
            out.probe = true;
        }
    }
    return out;
};

if (require.main === module) {
    const args = parseArgs(process.argv.slice(2));
    startHeadless({ nic: args.nic, dataDir: args.dataDir || undefined, log: (line) => console.log(line) })
        .then(async (run) => {
            if (args.probe) {
                console.log(JSON.stringify(await run.client.query('monitor.state')));
                run.close();
                return;
            }
            const stop = () => {
                run.close();
                process.exit(0);
            };
            process.on('SIGINT', stop);
            process.on('SIGTERM', stop);
        })
        .catch((err) => {
            console.error(`engine failed: ${err.message}`);
            process.exit(1);
        });
}

module.exports = { startHeadless, ENGINE_API_VERSION };
