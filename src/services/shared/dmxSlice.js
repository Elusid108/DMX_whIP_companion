const fs = require('fs');
const {
    HEADER_SIZE,
    FRAME_SIZE,
    createHeader,
    walkRecording
} = require('./dmxRecording');

const UNIVERSE_SIZE = 512;

const sliceRecording = (srcPath, destPath, options = {}) => {
    const destFirst = Math.max(0, Number(options.destFirstAddr) || 0);
    const destLast = Math.max(destFirst, Number(options.destLastAddr) || destFirst);
    const slideDelta = Math.round(Number(options.slideDelta) || 0);
    const destProto = options.destProto === 'sacn' ? 'sacn' : 'artnet';
    const sourceProto = options.proto === 'sacn' || options.proto === 'artnet'
        ? options.proto
        : destProto;
    const protoCode = destProto === 'artnet' ? 0 : 1;
    const firstUni = Math.floor(destFirst / UNIVERSE_SIZE);
    const lastUni = Math.floor(destLast / UNIVERSE_SIZE);

    if (destLast < destFirst) {
        throw new Error('Invalid slice window');
    }

    const out = fs.openSync(destPath, 'w');
    let written = 0;
    try {
        fs.writeSync(out, createHeader(0));

        let currentTs = null;
        const current = new Map();

        const writeDest = (timestamp, buckets) => {
            for (let uni = firstUni; uni <= lastUni; uni += 1) {
                const data = buckets.get(uni);
                if (!data) {
                    continue;
                }
                const frame = Buffer.alloc(FRAME_SIZE);
                frame.writeUInt32LE(timestamp >>> 0, 0);
                frame.writeUInt32LE(uni >>> 0, 4);
                frame.writeUInt16LE(protoCode, 8);
                data.copy(frame, 10, 0, UNIVERSE_SIZE);
                fs.writeSync(out, frame);
                written += 1;
            }
        };

        const flush = () => {
            if (currentTs == null || current.size === 0) {
                current.clear();
                return;
            }
            const buckets = new Map();
            current.forEach((data, universe) => {
                for (let ch = 0; ch < UNIVERSE_SIZE; ch += 1) {
                    const destAddr = (universe * UNIVERSE_SIZE + ch) + slideDelta;
                    if (destAddr < destFirst || destAddr > destLast) {
                        continue;
                    }
                    const destUni = Math.floor(destAddr / UNIVERSE_SIZE);
                    const destCh = destAddr % UNIVERSE_SIZE;
                    let bucket = buckets.get(destUni);
                    if (!bucket) {
                        bucket = Buffer.alloc(UNIVERSE_SIZE);
                        buckets.set(destUni, bucket);
                    }
                    bucket[destCh] = data[ch];
                }
            });
            writeDest(currentTs, buckets);
            current.clear();
        };

        const meta = walkRecording(srcPath, (frameBuf, info) => {
            if (info.protocol !== sourceProto) {
                return;
            }
            if (currentTs != null && info.timestamp !== currentTs) {
                flush();
            }
            currentTs = info.timestamp;
            current.set(info.universe, Buffer.from(frameBuf.slice(10, 10 + UNIVERSE_SIZE)));
        });

        flush();

        if (written === 0) {
            throw new Error('Slice produced no frames for this node');
        }
        if (meta.error && written === 0) {
            throw new Error(meta.error);
        }

        const header = createHeader(written);
        fs.writeSync(out, header, 0, HEADER_SIZE, 0);
        return { frameCount: written, destPath };
    } finally {
        fs.closeSync(out);
    }
};

module.exports = {
    sliceRecording
};
