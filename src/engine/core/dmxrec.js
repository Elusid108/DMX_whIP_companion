// DMXREC `.dmx` codec (the firmware-shared format, see
// docs/ecosystem/CONTRACTS.md §1) and the pure helpers around it: burst
// stamping, woken-universe gating, woken spans and the scan accumulator.
// Reading and writing files happens in adapters and in
// src/services/shared/dmxRecording.js, which walks a file and feeds this.
//
// Header 10 B: "DMXREC" + frameCount u32 LE. Record 522 B: timestamp u32 LE
// ms, universe u32 LE, protocol u16 LE (0 Art-Net, 1 sACN), 512 levels.
const { readU16LE, readU32LE, writeU32LE, writeU16LE, writeLatin1, startsWith } = require('./bytes');

const MAGIC = 'DMXREC';
const HEADER_SIZE = 10;
const FRAME_SIZE = 522;
const CHUNK_TARGET = 64 * 1024;

const createHeader = (frameCount = 0) => {
    const buf = new Uint8Array(HEADER_SIZE);
    writeLatin1(buf, MAGIC, 0, 6);
    writeU32LE(buf, frameCount >>> 0, 6);
    return buf;
};

const encodeFrame = ({ timestamp, universe, protocol, data }) => {
    const buf = new Uint8Array(FRAME_SIZE);
    writeU32LE(buf, Math.min(Math.max(timestamp >>> 0, 0), 4294967295), 0);
    writeU32LE(buf, universe >>> 0, 4);
    writeU16LE(buf, protocol === 'artnet' ? 0 : 1, 8);
    if (data) {
        const n = Math.min(512, data.length);
        for (let i = 0; i < n; i += 1) {
            buf[10 + i] = data[i] || 0;
        }
    }
    return buf;
};

// The three header fields of one 522-byte record.
const frameInfo = (frameBytes) => ({
    timestamp: readU32LE(frameBytes, 0),
    universe: readU32LE(frameBytes, 4),
    protocol: readU16LE(frameBytes, 8) === 0 ? 'artnet' : 'sacn'
});

const parseRecording = (fileData) => {
    if (!fileData || fileData.length < HEADER_SIZE) {
        throw new Error('File is too small to be a recording');
    }
    if (!startsWith(fileData, MAGIC)) {
        throw new Error('Invalid file format');
    }
    const frameCount = readU32LE(fileData, 6);
    if (frameCount === 0) {
        throw new Error('Recording is empty');
    }
    const expected = HEADER_SIZE + frameCount * FRAME_SIZE;
    if (fileData.length !== expected) {
        throw new Error('File is truncated or invalid');
    }
    // data is a view into fileData (no per-frame array); keep fileData alive
    // as long as the frames are.
    const frames = new Array(frameCount);
    for (let i = 0; i < frameCount; i += 1) {
        const offset = HEADER_SIZE + i * FRAME_SIZE;
        frames[i] = {
            timestamp: readU32LE(fileData, offset),
            universe: readU32LE(fileData, offset + 4),
            protocol: readU16LE(fileData, offset + 8) === 0 ? 'artnet' : 'sacn',
            data: fileData.subarray(offset + 10, offset + FRAME_SIZE)
        };
    }
    return frames;
};

// Whole file in memory (small fixtures and tests; writers stream instead).
const encodeRecording = (frames = []) => {
    const out = new Uint8Array(HEADER_SIZE + frames.length * FRAME_SIZE);
    out.set(createHeader(frames.length), 0);
    frames.forEach((frame, i) => {
        out.set(encodeFrame(frame), HEADER_SIZE + i * FRAME_SIZE);
    });
    return out;
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

// A console sends every universe of one frame back to back, but each packet
// lands on its own millisecond. Records within windowMs share the burst's
// timestamp until a universe repeats, so a frame stays one frame on playback.
// The first stamped record is t=0.
const BURST_WINDOW_MS = 4;
const createBurstStamper = (windowMs = BURST_WINDOW_MS) => {
    let startMs = -1;
    let stamp = 0;
    let keys = new Set();
    return (elapsedMs, key) => {
        if (startMs >= 0 && elapsedMs - startMs < windowMs && !keys.has(key)) {
            keys.add(key);
            return stamp;
        }
        stamp = startMs < 0 ? 0 : elapsedMs;
        startMs = elapsedMs;
        keys = new Set([key]);
        return stamp;
    };
};

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
    return { universe, protocol, firstCh, lastCh, firstAddr, lastAddr };
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
    const activeChannels = live.reduce((sum, range) => sum + (range.lastAddr - range.firstAddr + 1), 0);
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

// Feed every record of a file (bytes + frameInfo) and finish with the file
// facts to get the inspector's scan result. The walk itself is I/O.
const createScanAccumulator = () => {
    const perUniverse = new Map();
    const protocols = new Set();
    let maxTs = 0;

    const add = (frameBuf, info) => {
        if (info.timestamp > maxTs) {
            maxTs = info.timestamp;
        }
        protocols.add(info.protocol);
        const key = `${info.protocol}:${info.universe}`;
        let entry = perUniverse.get(key);
        if (!entry) {
            entry = { id: info.universe, protocol: info.protocol, packets: 0, wokenChannels: 0, firstWoken: 0 };
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
    };

    // meta: { frameCount, walked, size, created, modified, error }
    const finish = (meta) => {
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
            rangesByProto[proto].push(rangeFromWoken(entry.id, proto, entry.firstWoken, entry.wokenChannels));
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

    return { add, finish };
};

module.exports = {
    MAGIC,
    HEADER_SIZE,
    FRAME_SIZE,
    CHUNK_TARGET,
    BURST_WINDOW_MS,
    createHeader,
    encodeFrame,
    frameInfo,
    parseRecording,
    encodeRecording,
    payloadHasSignal,
    universeKey,
    createBurstStamper,
    shouldRecordUniverseFrame,
    rangeFromWoken,
    spanFromRanges,
    spanFromAddrs,
    createScanAccumulator
};
