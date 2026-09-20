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

const writeRecording = (filePath, frames = []) => {
    const parts = [createHeader(frames.length)];
    for (const frame of frames) {
        parts.push(encodeFrame(frame));
    }
    fs.writeFileSync(filePath, Buffer.concat(parts));
};

const payloadHasSignal = (data, offset = 0) => {
    if (!data) {
        return false;
    }
    const start = Math.max(0, offset);
    const end = Math.min(start + 512, data.length);
    for (let i = start; i < end; i += 1) {
        if (data[i] > 0) {
            return true;
        }
    }
    return false;
};

const universeKey = (protocol, universe) => `${protocol || 'artnet'}:${universe >>> 0}`;

const shouldRecordUniverseFrame = (woken, protocol, universe, data, offset = 0) => {
    if (payloadHasSignal(data, offset)) {
        woken.add(universeKey(protocol, universe));
        return true;
    }
    return woken.has(universeKey(protocol, universe));
};

const rangeFromWoken = (universe, protocol, firstWoken, lastWoken) => {
    const firstCh = Math.max(1, Number(firstWoken) || 1);
    const lastCh = Math.max(firstCh, Number(lastWoken) || firstCh);
    const firstAddr = (universe * 512) + (firstCh - 1);
    const lastAddr = (universe * 512) + (lastCh - 1);
    return {
        universe,
        protocol,
        firstCh,
        lastCh,
        firstAddr,
        lastAddr
    };
};

const spanFromRanges = (ranges = []) => {
    const live = (ranges || []).filter((range) => (
        range
        && range.firstAddr != null
        && range.lastAddr != null
        && range.lastAddr >= range.firstAddr
    ));
    if (!live.length) {
        return null;
    }
    const firstAddr = Math.min(...live.map((range) => range.firstAddr));
    const lastAddr = Math.max(...live.map((range) => range.lastAddr));
    const activeChannels = live.reduce((sum, range) => (
        sum + (range.lastAddr - range.firstAddr + 1)
    ), 0);
    const sorted = live.slice().sort((a, b) => {
        if (a.protocol !== b.protocol) {
            return String(a.protocol || '').localeCompare(String(b.protocol || ''));
        }
        return a.universe - b.universe;
    });
    return {
        startUniverse: Math.floor(firstAddr / 512),
        startChannel: (firstAddr % 512) + 1,
        endUniverse: Math.floor(lastAddr / 512),
        endChannel: (lastAddr % 512) + 1,
        activeChannels,
        firstAddr,
        lastAddr,
        ranges: sorted
    };
};

const spanFromAddrs = (firstAddr, lastAddr, ranges) => {
    if (ranges && ranges.length) {
        return spanFromRanges(ranges);
    }
    if (firstAddr == null || lastAddr == null || lastAddr < firstAddr) {
        return null;
    }
    return spanFromRanges([{
        universe: Math.floor(firstAddr / 512),
        protocol: 'artnet',
        firstCh: (firstAddr % 512) + 1,
        lastCh: (lastAddr % 512) + 1,
        firstAddr,
        lastAddr
    }]);
};

const walkRecording = (filePath, onFrame) => {
    const stat = fs.statSync(filePath);
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
        const frameBuf = Buffer.alloc(FRAME_SIZE);
        let walked = 0;

        for (let i = 0; i < toRead; i += 1) {
            const read = fs.readSync(fd, frameBuf, 0, FRAME_SIZE, HEADER_SIZE + i * FRAME_SIZE);
            if (read < FRAME_SIZE) {
                break;
            }
            walked += 1;
            onFrame(frameBuf, {
                index: i,
                timestamp: frameBuf.readUInt32LE(0),
                universe: frameBuf.readUInt32LE(4),
                protocol: frameBuf.readUInt16LE(8) === 0 ? 'artnet' : 'sacn'
            });
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
    const perUniverse = new Map();
    const protocols = new Set();
    let maxTs = 0;

    const meta = walkRecording(filePath, (frameBuf, info) => {
        if (info.timestamp > maxTs) {
            maxTs = info.timestamp;
        }
        protocols.add(info.protocol);

        const key = `${info.protocol}:${info.universe}`;
        let entry = perUniverse.get(key);
        if (!entry) {
            entry = {
                id: info.universe,
                protocol: info.protocol,
                packets: 0,
                wokenChannels: 0,
                firstWoken: 0
            };
            perUniverse.set(key, entry);
        }
        entry.packets += 1;

        for (let ch = 0; ch < 512; ch += 1) {
            if (frameBuf[10 + ch] <= 0) {
                continue;
            }
            const channel = ch + 1;
            if (!entry.firstWoken || channel < entry.firstWoken) {
                entry.firstWoken = channel;
            }
            if (channel > entry.wokenChannels) {
                entry.wokenChannels = channel;
            }
        }
    });

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

    const rangesByProto = { artnet: [], sacn: [] };
    perUniverseList.forEach((entry) => {
        if (!entry.wokenChannels || !entry.firstWoken) {
            return;
        }
        const proto = entry.protocol === 'sacn' ? 'sacn' : 'artnet';
        rangesByProto[proto].push(rangeFromWoken(
            entry.id,
            proto,
            entry.firstWoken,
            entry.wokenChannels
        ));
    });
    const spans = {
        artnet: spanFromRanges(rangesByProto.artnet),
        sacn: spanFromRanges(rangesByProto.sacn)
    };
    const spanList = [spans.artnet, spans.sacn].filter(Boolean);
    spanList.sort((a, b) => b.activeChannels - a.activeChannels);
    const primary = spanList[0] || null;

    return {
        duration,
        frameCount: meta.frameCount,
        size: meta.size,
        created: meta.created,
        modified: meta.modified,
        universes: [...new Set(perUniverseList.map((entry) => entry.id))],
        protocols: [...protocols],
        packetRate: durationSec > 0 ? (meta.frameCount || meta.walked) / durationSec : 0,
        perUniverse: perUniverseList,
        spans,
        startUniverse: primary ? primary.startUniverse : 0,
        startChannel: primary ? primary.startChannel : 1,
        endUniverse: primary ? primary.endUniverse : 0,
        endChannel: primary ? primary.endChannel : 1,
        activeChannels: primary ? primary.activeChannels : 0,
        error: meta.error,
        playable: !meta.error
    };
};

module.exports = {
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
    universeKey
};
