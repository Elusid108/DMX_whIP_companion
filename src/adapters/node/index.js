// The Node port set: what the headless entry and the Electron main process
// hand to createEngine. A browser or native shell supplies its own.
const { createClock } = require('./clock');
const { createScheduler } = require('./scheduler');
const { createUdp } = require('./udp');
const { createStorage } = require('./storage');
const { createWorkers, sharedWorkers } = require('./workers');
const { createRandom } = require('./random');
const { createLog } = require('./log');

// options.sharedWorkers: reuse the process-wide file worker (companion).
const createNodePorts = (options = {}) => {
    const log = options.log || createLog();
    return {
        clock: createClock(),
        scheduler: createScheduler(),
        udp: createUdp(),
        storage: createStorage(),
        workers: options.sharedWorkers ? sharedWorkers() : createWorkers({ log }),
        random: createRandom(),
        log,
        midi: null,
        host: {
            kind: options.kind || 'headless',
            platform: process.platform,
            node: process.versions.node,
            electron: process.versions.electron || null
        }
    };
};

module.exports = { createNodePorts };
