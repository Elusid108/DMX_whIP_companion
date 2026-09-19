const fs = require('fs');
const { MAGIC, HEADER_SIZE, FRAME_SIZE } = require('./dmxRecording');

const BANDS = 8;
const CHANNELS_PER_BAND = 64;
const DEFAULT_BUCKET_MS = 50;
const MAX_BUCKETS = 120000;

const protocolName = (code) => (code === 0 ? 'artnet' : 'sacn');

const ensureBands = (entry, bucket) => {
    const needed = (bucket + 1) * BANDS;
    if (entry.bands.length >= needed) {
        return;
    }
    const next = new Uint8Array(needed);
    next.set(entry.bands);
    entry.bands = next;
};

const buildTimelineOverview = (filePath, options = {}) => {
    const bucketMs = Math.max(1, Number(options.bucketMs) || DEFAULT_BUCKET_MS);
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
        const framesAvailable = Math.max(0, Math.floor((size - HEADER_SIZE) / FRAME_SIZE));
        const toRead = Math.min(frameCount, framesAvailable);
        const tracks = new Map();
        const frameBuf = Buffer.alloc(FRAME_SIZE);
        let maxTs = 0;

        for (let i = 0; i < toRead; i += 1) {
            const read = fs.readSync(fd, frameBuf, 0, FRAME_SIZE, HEADER_SIZE + i * FRAME_SIZE);
            if (read < FRAME_SIZE) {
                break;
            }

            const timestamp = frameBuf.readUInt32LE(0);
            const universe = frameBuf.readUInt32LE(4);
            const protocol = protocolName(frameBuf.readUInt16LE(8));
            if (timestamp > maxTs) {
                maxTs = timestamp;
            }

            const key = `${protocol}:${universe}`;
            let entry = tracks.get(key);
            if (!entry) {
                entry = {
                    protocol,
                    universe,
                    packets: 0,
                    wokenChannels: 0,
                    bands: new Uint8Array(0)
                };
                tracks.set(key, entry);
            }
            entry.packets += 1;

            const bucket = Math.min(Math.floor(timestamp / bucketMs), MAX_BUCKETS - 1);
            ensureBands(entry, bucket);
            const base = bucket * BANDS;
            for (let band = 0; band < BANDS; band += 1) {
                let peak = 0;
                const chBase = 10 + band * CHANNELS_PER_BAND;
                for (let ch = 0; ch < CHANNELS_PER_BAND; ch += 1) {
                    const value = frameBuf[chBase + ch];
                    if (value > peak) {
                        peak = value;
                    }
                }
                if (peak > entry.bands[base + band]) {
                    entry.bands[base + band] = peak;
                }
            }

            for (let ch = 511; ch >= entry.wokenChannels; ch -= 1) {
                if (frameBuf[10 + ch] > 0) {
                    entry.wokenChannels = ch + 1;
                    break;
                }
            }
        }

        const bucketCount = Math.max(1, Math.min(Math.floor(maxTs / bucketMs) + 1, MAX_BUCKETS));
        const list = [...tracks.values()].map((entry) => {
            const bands = new Array(bucketCount * BANDS);
            for (let i = 0; i < bands.length; i += 1) {
                bands[i] = i < entry.bands.length ? entry.bands[i] : 0;
            }
            return {
                protocol: entry.protocol,
                universe: entry.universe,
                packets: entry.packets,
                wokenChannels: entry.wokenChannels,
                bands
            };
        });

        list.sort((a, b) => {
            if (a.protocol !== b.protocol) {
                return a.protocol.localeCompare(b.protocol);
            }
            return a.universe - b.universe;
        });

        return {
            durationMs: maxTs,
            bucketMs,
            bucketCount,
            bandsPerBucket: BANDS,
            frameCount: toRead,
            tracks: list
        };
    } finally {
        fs.closeSync(fd);
    }
};

module.exports = {
    BANDS,
    CHANNELS_PER_BAND,
    DEFAULT_BUCKET_MS,
    MAX_BUCKETS,
    buildTimelineOverview
};
