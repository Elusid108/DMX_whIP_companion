// worker_threads entry: whole-file DMXREC walks run here so a large show
// never stalls the main process (UDP receive, playback timing, IPC).
const { parentPort } = require('worker_threads');
const { scanRecording } = require('../../services/shared/dmxRecording');
const { sliceRecordingMulti } = require('../../services/shared/dmxSlice');
const { buildTimelineOverview } = require('../../services/shared/timelineOverview');

const ops = {
    scan: ({ filePath }) => scanRecording(filePath),
    slice: ({ srcPath, targets }) => sliceRecordingMulti(srcPath, targets),
    overview: ({ filePath, options }) => buildTimelineOverview(filePath, options || {})
};

parentPort.on('message', ({ id, op, args }) => {
    try {
        const run = ops[op];
        if (!run) {
            throw new Error(`Unknown file task ${op}`);
        }
        parentPort.postMessage({ id, ok: true, result: run(args || {}) });
    } catch (err) {
        parentPort.postMessage({ id, ok: false, error: err && err.message ? err.message : String(err) });
    }
});
