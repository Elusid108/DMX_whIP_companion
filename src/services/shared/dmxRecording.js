const fs = require('fs');

const MAGIC = 'DMXREC';
const HEADER_SIZE = 10;
const FRAME_SIZE = 522;
const CHUNK_TARGET = 64 * 1024;

const createHeader = (frameCount = 0) => {
    const buf = Buffer.alloc(HEADER_SIZE);
    buf.write(MAGIC, 0, 6, 'ascii');
    buf.writeUInt32LE(frameCount >>> 0, 6);
    return buf;
};

const encodeFrame = ({ timestamp, universe, protocol, data }) => {
    const buf = Buffer.alloc(FRAME_SIZE);
    buf.writeUInt32LE(Math.min(Math.max(timestamp >>> 0, 0), 4294967295), 0);
    buf.writeUInt32LE(universe >>> 0, 4);
    buf.writeUInt16LE(protocol === 'artnet' ? 0 : 1, 8);

    if (data) {
        const src = Buffer.isBuffer(data) ? data : Buffer.from(data);
        src.copy(buf, 10, 0, Math.min(512, src.length));
    }

    return buf;
};

const parseRecording = (fileData) => {
    if (!fileData || fileData.length < HEADER_SIZE) {
        throw new Error('File is too small to be a recording');
    }

    if (fileData.slice(0, 6).toString('ascii') !== MAGIC) {
        throw new Error('Invalid file format');
    }

    const frameCount = fileData.readUInt32LE(6);
    if (frameCount === 0) {
        throw new Error('Recording is empty');
    }

    const expected = HEADER_SIZE + frameCount * FRAME_SIZE;
    if (fileData.length !== expected) {
        throw new Error('File is truncated or invalid');
    }

    const frames = [];
    for (let i = 0; i < frameCount; i++) {
        const offset = HEADER_SIZE + i * FRAME_SIZE;
        frames.push({
            timestamp: fileData.readUInt32LE(offset),
            universe: fileData.readUInt32LE(offset + 4),
            protocol: fileData.readUInt16LE(offset + 8) === 0 ? 'artnet' : 'sacn',
            data: Array.from(fileData.slice(offset + 10, offset + FRAME_SIZE))
        });
    }
    return frames;
};

const scanRecording = (filePath) => {
    const stat = fs.statSync(filePath);
    const created = stat.birthtimeMs || stat.ctimeMs;
    const modified = stat.mtimeMs;
    const size = stat.size;

    if (size < HEADER_SIZE) {
        throw new Error('File is too small to be a recording');
    }

    const fd = fs.openSync(filePath, 'r');
    try {
        const header = Buffer.alloc(HEADER_SIZE);
        fs.readSync(fd, header, 0, HEADER_SIZE, 0);
        if (header.slice(0, 6).toString('ascii') !== MAGIC) {
            throw new Error('Invalid file format');
        }

        const frameCount = header.readUInt32LE(6);
        const expected = HEADER_SIZE + frameCount * FRAME_SIZE;
        const framesAvailable = Math.max(0, Math.floor((size - HEADER_SIZE) / FRAME_SIZE));
        const toRead = Math.min(frameCount, framesAvailable);
        const perUniverse = new Map();
        const protocols = new Set();
        let maxTs = 0;
        const frameBuf = Buffer.alloc(FRAME_SIZE);

        for (let i = 0; i < toRead; i += 1) {
            const read = fs.readSync(fd, frameBuf, 0, FRAME_SIZE, HEADER_SIZE + i * FRAME_SIZE);
            if (read < FRAME_SIZE) {
                break;
            }

            const timestamp = frameBuf.readUInt32LE(0);
            const universe = frameBuf.readUInt32LE(4);
            const protocol = frameBuf.readUInt16LE(8) === 0 ? 'artnet' : 'sacn';
            if (timestamp > maxTs) {
                maxTs = timestamp;
            }
            protocols.add(protocol);

            const key = `${protocol}:${universe}`;
            let entry = perUniverse.get(key);
            if (!entry) {
                entry = { id: universe, protocol, packets: 0, wokenChannels: 0 };
                perUniverse.set(key, entry);
            }
            entry.packets += 1;

            for (let ch = 511; ch >= entry.wokenChannels; ch -= 1) {
                if (frameBuf[10 + ch] > 0) {
                    entry.wokenChannels = ch + 1;
                    break;
                }
            }
        }

        const duration = maxTs;
        const durationSec = duration / 1000;
        const perUniverseList = [...perUniverse.values()].map((entry) => ({
            ...entry,
            rate: durationSec > 0 ? entry.packets / durationSec : 0
        }));
        perUniverseList.sort((a, b) => {
            if (a.protocol !== b.protocol) {
                return a.protocol.localeCompare(b.protocol);
            }
            return a.id - b.id;
        });

        let error = null;
        if (frameCount === 0) {
            error = 'Recording is empty';
        } else if (size !== expected) {
            error = 'File is truncated or invalid';
        }

        return {
            duration,
            frameCount,
            size,
            created,
            modified,
            universes: [...new Set(perUniverseList.map((entry) => entry.id))],
            protocols: [...protocols],
            packetRate: durationSec > 0 ? (frameCount || toRead) / durationSec : 0,
            perUniverse: perUniverseList,
            error,
            playable: !error
        };
    } finally {
        fs.closeSync(fd);
    }
};

module.exports = {
    MAGIC,
    HEADER_SIZE,
    FRAME_SIZE,
    CHUNK_TARGET,
    createHeader,
    encodeFrame,
    parseRecording,
    scanRecording
};
