// DMXREC file I/O. The codec itself (header, record layout, burst stamper,
// woken gating, spans, scan accumulator) is pure core code in
// src/engine/core/dmxrec.js and re-exported here, so this path (named by the
// firmware-compat rule) stays the companion's entry point. What is left
// here needs a file: writing a frame list and walking a file in blocks.
const fs = require('fs');
const core = require('../../engine/core/dmxrec');

const {
    MAGIC,
    HEADER_SIZE,
    FRAME_SIZE,
    CHUNK_TARGET,
    BURST_WINDOW_MS,
    createHeader,
    encodeFrame,
    frameInfo,
    parseRecording,
    payloadHasSignal,
    universeKey,
    createBurstStamper,
    shouldRecordUniverseFrame,
    rangeFromWoken,
    spanFromRanges,
    spanFromAddrs,
    createScanAccumulator
} = core;
// Walks read this many whole records per readSync.
const WALK_BLOCK_FRAMES = 4096;

const writeRecording = (filePath, frames = []) => {
    const fd = fs.openSync(filePath, 'w');
    try {
        fs.writeSync(fd, createHeader(frames.length));
        const block = new Uint8Array(FRAME_SIZE * 256);
        let used = 0;
        for (const frame of frames) {
            block.set(encodeFrame(frame), used);
            used += FRAME_SIZE;
            if (used === block.length) {
                fs.writeSync(fd, block, 0, used);
                used = 0;
            }
        }
        if (used) {
            fs.writeSync(fd, block, 0, used);
        }
    } finally {
        fs.closeSync(fd);
    }
};

const walkRecording = (filePath, onFrame) => {
    const stat = fs.statSync(filePath);
    const size = stat.size;
    if (size < HEADER_SIZE) {
        throw new Error('File is too small to be a recording');
    }

    const fd = fs.openSync(filePath, 'r');
    try {
        const header = new Uint8Array(HEADER_SIZE);
        fs.readSync(fd, header, 0, HEADER_SIZE, 0);
        if (String.fromCharCode(...header.subarray(0, 6)) !== MAGIC) {
            throw new Error('Invalid file format');
        }

        const frameCount = ((header[6] | (header[7] << 8) | (header[8] << 16)) + (header[9] * 0x1000000)) >>> 0;
        const expected = HEADER_SIZE + frameCount * FRAME_SIZE;
        const framesAvailable = Math.max(0, Math.floor((size - HEADER_SIZE) / FRAME_SIZE));
        const toRead = Math.min(frameCount, framesAvailable);
        // onFrame gets a view into a reused block: copy anything it keeps.
        const block = new Uint8Array(FRAME_SIZE * Math.max(1, Math.min(WALK_BLOCK_FRAMES, toRead)));
        let walked = 0;

        for (let first = 0; first < toRead; first += WALK_BLOCK_FRAMES) {
            const want = Math.min(WALK_BLOCK_FRAMES, toRead - first);
            const read = fs.readSync(fd, block, 0, want * FRAME_SIZE, HEADER_SIZE + first * FRAME_SIZE);
            const got = Math.floor(read / FRAME_SIZE);
            for (let k = 0; k < got; k += 1) {
                const frameBuf = block.subarray(k * FRAME_SIZE, (k + 1) * FRAME_SIZE);
                walked += 1;
                onFrame(frameBuf, { index: first + k, ...frameInfo(frameBuf) });
            }
            if (got < want) {
                break;
            }
        }

        let error = null;
        if (frameCount === 0) {
            error = 'Recording is empty';
        } else if (size !== expected) {
            error = 'File is truncated or invalid';
        }

        return {
            size,
            created: stat.birthtimeMs || stat.ctimeMs,
            modified: stat.mtimeMs,
            frameCount,
            walked,
            error
        };
    } finally {
        fs.closeSync(fd);
    }
};

const scanRecording = (filePath) => {
    const scan = createScanAccumulator();
    const meta = walkRecording(filePath, scan.add);
    return scan.finish(meta);
};

module.exports = {
    frameInfo,
    createScanAccumulator,
    MAGIC,
    HEADER_SIZE,
    FRAME_SIZE,
    CHUNK_TARGET,
    createHeader,
    encodeFrame,
    parseRecording,
    walkRecording,
    scanRecording,
    writeRecording,
    spanFromAddrs,
    spanFromRanges,
    rangeFromWoken,
    payloadHasSignal,
    shouldRecordUniverseFrame,
    universeKey,
    BURST_WINDOW_MS,
    createBurstStamper
};
