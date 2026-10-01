/**
 * Workers port: whole-file DMXREC walks (scan, slice, overview) off the
 * thread that receives UDP and schedules playback.
 * @typedef {Object} WorkersPort
 * @property {(op: 'scan' | 'slice' | 'overview', args: Object) => Promise<any>} run
 * @property {() => void} stop
 */
const assertWorkers = (workers) => {
    if (!workers || typeof workers.run !== 'function' || typeof workers.stop !== 'function') {
        throw new Error('ports.workers needs run() and stop()');
    }
    return workers;
};

module.exports = { assertWorkers };
