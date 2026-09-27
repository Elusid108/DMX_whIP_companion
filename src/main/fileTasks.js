const path = require('path');
const { Worker } = require('worker_threads');
const { scanRecording } = require('../services/shared/dmxRecording');
const { sliceRecordingMulti } = require('../services/shared/dmxSlice');
const { buildTimelineOverview } = require('../services/shared/timelineOverview');

// One background worker, tasks queued in order. If the worker cannot start,
// the same functions run inline (correct, just on the main thread).
const inline = {
    scan: ({ filePath }) => scanRecording(filePath),
    slice: ({ srcPath, targets }) => sliceRecordingMulti(srcPath, targets),
    overview: ({ filePath, options }) => buildTimelineOverview(filePath, options || {})
};

let worker = null;
let workerFailed = false;
let nextId = 1;
const pending = new Map();

const failAll = (message) => {
    for (const { reject } of pending.values()) {
        reject(new Error(message));
    }
    pending.clear();
};

const ensureWorker = () => {
    if (worker || workerFailed) {
        return worker;
    }
    try {
        worker = new Worker(path.join(__dirname, 'fileWorker.js'));
        worker.on('message', ({ id, ok, result, error }) => {
            const job = pending.get(id);
            if (!job) {
                return;
            }
            pending.delete(id);
            if (ok) {
                job.resolve(result);
            } else {
                job.reject(new Error(error));
            }
        });
        worker.on('error', (err) => {
            console.error('File worker error:', err);
            failAll(err.message || 'File worker failed');
            worker = null;
        });
        worker.on('exit', (code) => {
            if (pending.size) {
                failAll(`File worker exited (${code})`);
            }
            worker = null;
        });
        worker.unref();
    } catch (err) {
        console.error('File worker unavailable, running file tasks inline:', err);
        workerFailed = true;
        worker = null;
    }
    return worker;
};

const runFileTask = (op, args) => {
    const w = ensureWorker();
    if (!w) {
        return new Promise((resolve, reject) => {
            try {
                resolve(inline[op](args));
            } catch (err) {
                reject(err);
            }
        });
    }
    const id = nextId++;
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        w.postMessage({ id, op, args });
    });
};

const stopFileTasks = () => {
    if (worker) {
        worker.terminate();
        worker = null;
    }
    failAll('File tasks stopped');
};

module.exports = {
    runFileTask,
    stopFileTasks
};
