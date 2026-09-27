const fs = require('fs');
const {
    HEADER_SIZE,
    FRAME_SIZE,
    createHeader,
    walkRecording
} = require('./dmxRecording');

const UNIVERSE_SIZE = 512;
// Records within this window (until a universe repeats) are one source frame.
const FRAME_WINDOW_MS = 4;
const WRITE_BLOCK_FRAMES = 256;

const targetState = (options = {}) => {
    const destFirst = Math.max(0, Number(options.destFirstAddr) || 0);
    const destLast = Math.max(destFirst, Number(options.destLastAddr) || destFirst);
    const destProto = options.destProto === 'sacn' ? 'sacn' : 'artnet';
    const sourceProto = options.proto === 'sacn' || options.proto === 'artnet'
        ? options.proto
        : destProto;
    if (destLast < destFirst) {
        throw new Error('Invalid slice window');
    }
    return {
        destPath: options.destPath,
        destFirst,
        destLast,
        slideDelta: Math.round(Number(options.slideDelta) || 0),
        // Window addresses are in the source protocol's universe numbering;
        // the node numbers destProto universes from its own start.
        destUniShift: Math.round(Number(options.destUniShift) || 0),
        sourceProto,
        protoCode: destProto === 'artnet' ? 0 : 1,
        firstUni: Math.floor(destFirst / UNIVERSE_SIZE),
        lastUni: Math.floor(destLast / UNIVERSE_SIZE),
        // Last value of every source universe, carried across frames so a
        // universe that did not arrive this frame is not written as zero.
        current: new Map(),
        dirtyDest: new Set(),
        seen: new Set(),
        groupTs: null,
        fd: null,
        block: Buffer.alloc(FRAME_SIZE * WRITE_BLOCK_FRAMES),
        used: 0,
        written: 0
    };
};

const flushBlock = (t) => {
    if (t.used) {
        fs.writeSync(t.fd, t.block, 0, t.used);
        t.used = 0;
    }
};

// Dest universes that source universe `uni` feeds after the slide.
const markDirty = (t, uni) => {
    const first = Math.max(uni * UNIVERSE_SIZE + t.slideDelta, t.destFirst);
    const last = Math.min(uni * UNIVERSE_SIZE + UNIVERSE_SIZE - 1 + t.slideDelta, t.destLast);
    if (first > last) {
        return;
    }
    for (let du = Math.floor(first / UNIVERSE_SIZE); du <= Math.floor(last / UNIVERSE_SIZE); du += 1) {
        t.dirtyDest.add(du);
    }
};

const flushGroup = (t) => {
    if (t.groupTs == null || !t.dirtyDest.size) {
        t.dirtyDest.clear();
        t.seen.clear();
        return;
    }
    const unis = [...t.dirtyDest].sort((a, b) => a - b);
    for (const du of unis) {
        if (t.used === t.block.length) {
            flushBlock(t);
        }
        const rec = t.block.subarray(t.used, t.used + FRAME_SIZE);
        rec.fill(0);
        rec.writeUInt32LE(t.groupTs >>> 0, 0);
        rec.writeUInt32LE((du + t.destUniShift) >>> 0, 4);
        rec.writeUInt16LE(t.protoCode, 8);
        const base = du * UNIVERSE_SIZE;
        const from = Math.max(base, t.destFirst);
        const to = Math.min(base + UNIVERSE_SIZE - 1, t.destLast);
        for (let destAddr = from; destAddr <= to; destAddr += 1) {
            const srcAddr = destAddr - t.slideDelta;
            if (srcAddr < 0) {
                continue;
            }
            const src = t.current.get(Math.floor(srcAddr / UNIVERSE_SIZE));
            if (src) {
                rec[10 + (destAddr - base)] = src[srcAddr % UNIVERSE_SIZE];
            }
        }
        t.used += FRAME_SIZE;
        t.written += 1;
    }
    t.dirtyDest.clear();
    t.seen.clear();
};

const feed = (t, frameBuf, info) => {
    if (info.protocol !== t.sourceProto) {
        return;
    }
    const uni = info.universe;
    if (t.groupTs != null
        && (info.timestamp < t.groupTs
            || info.timestamp - t.groupTs >= FRAME_WINDOW_MS
            || t.seen.has(uni))) {
        flushGroup(t);
        t.groupTs = null;
    }
    if (t.groupTs == null) {
        t.groupTs = info.timestamp;
    }
    t.seen.add(uni);
    let data = t.current.get(uni);
    if (!data) {
        data = Buffer.alloc(UNIVERSE_SIZE);
        t.current.set(uni, data);
    }
    frameBuf.copy(data, 0, 10, 10 + UNIVERSE_SIZE);
    markDirty(t, uni);
};

// One pass over the source for any number of node slices. Each target is
// { destPath, proto, destProto, slideDelta, destFirstAddr, destLastAddr,
// destUniShift }. Returns [{ destPath, frameCount }] in target order; throws
// if any target would be empty.
const sliceRecordingMulti = (srcPath, targets = []) => {
    const states = targets.map((options) => targetState(options));
    try {
        for (const t of states) {
            t.fd = fs.openSync(t.destPath, 'w');
            fs.writeSync(t.fd, createHeader(0));
        }
        const meta = walkRecording(srcPath, (frameBuf, info) => {
            for (const t of states) {
                feed(t, frameBuf, info);
            }
        });
        for (const t of states) {
            flushGroup(t);
            flushBlock(t);
            if (t.written === 0) {
                throw new Error(meta.error || 'Slice produced no frames for this node');
            }
            fs.writeSync(t.fd, createHeader(t.written), 0, HEADER_SIZE, 0);
        }
        return states.map((t) => ({ destPath: t.destPath, frameCount: t.written }));
    } finally {
        for (const t of states) {
            if (t.fd != null) {
                fs.closeSync(t.fd);
            }
        }
    }
};

const sliceRecording = (srcPath, destPath, options = {}) => {
    const [result] = sliceRecordingMulti(srcPath, [{ ...options, destPath }]);
    return result;
};

module.exports = {
    sliceRecording,
    sliceRecordingMulti
};
