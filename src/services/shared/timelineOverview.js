const fs = require('fs');
const { HEADER_SIZE, walkRecording } = require('./dmxRecording');

const BANDS = 8;
const CHANNELS_PER_BAND = 64;
const DEFAULT_BUCKET_MS = 50;
const MAX_BUCKETS = 120000;

const ensureBands = (entry, bucket) => {
    const needed = (bucket + 1) * BANDS;
    if (entry.bands.length >= needed) {
        return;
    }
    const next = new Uint8Array(needed);
    next.set(entry.bands);
    entry.bands = next;
};

const ingestSample = (tracks, timestamp, universe, protocol, sample, bucketMs) => {
    if (timestamp > tracks.maxTs) {
        tracks.maxTs = timestamp;
    }
    tracks.frameCount += 1;

    const key = `${protocol}:${universe}`;
    let entry = tracks.map.get(key);
    if (!entry) {
        entry = {
            protocol,
            universe,
            packets: 0,
            wokenChannels: 0,
            bands: new Uint8Array(0)
        };
        tracks.map.set(key, entry);
    }
    entry.packets += 1;

    const bucket = Math.min(Math.floor(timestamp / bucketMs), MAX_BUCKETS - 1);
    ensureBands(entry, bucket);
    const base = bucket * BANDS;
    for (let band = 0; band < BANDS; band += 1) {
        let peak = 0;
        const chBase = band * CHANNELS_PER_BAND;
        for (let ch = 0; ch < CHANNELS_PER_BAND; ch += 1) {
            const value = sample(chBase + ch);
            if (value > peak) {
                peak = value;
            }
        }
        if (peak > entry.bands[base + band]) {
            entry.bands[base + band] = peak;
        }
    }

    for (let ch = 511; ch >= entry.wokenChannels; ch -= 1) {
        if (sample(ch) > 0) {
            entry.wokenChannels = ch + 1;
            break;
        }
    }
};

const finalizeTracks = (tracks, bucketMs) => {
    const maxTs = tracks.maxTs;
    const bucketCount = Math.max(1, Math.min(Math.floor(maxTs / bucketMs) + 1, MAX_BUCKETS));
    const list = [...tracks.map.values()].map((entry) => {
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

    const protocolTracks = ['artnet', 'sacn'].map((protocol) => {
        const members = list.filter((track) => track.protocol === protocol);
        if (members.length === 0) {
            return null;
        }
        const bands = new Array(bucketCount * BANDS).fill(0);
        let packets = 0;
        let wokenChannels = 0;
        for (const track of members) {
            packets += track.packets;
            if (track.wokenChannels > wokenChannels) {
                wokenChannels = track.wokenChannels;
            }
            for (let i = 0; i < bands.length; i += 1) {
                const value = track.bands[i] || 0;
                if (value > bands[i]) {
                    bands[i] = value;
                }
            }
        }
        return {
            protocol,
            universe: null,
            packets,
            wokenChannels,
            bands
        };
    }).filter(Boolean);

    return {
        durationMs: maxTs,
        bucketMs,
        bucketCount,
        bandsPerBucket: BANDS,
        frameCount: tracks.frameCount,
        tracks: list,
        protocolTracks
    };
};

const emptyTracks = () => ({ map: new Map(), maxTs: 0, frameCount: 0 });

const buildTimelineOverviewFromFrames = (frames = [], options = {}) => {
    const bucketMs = Math.max(1, Number(options.bucketMs) || DEFAULT_BUCKET_MS);
    const tracks = emptyTracks();
    for (const frame of frames) {
        const data = frame.data || [];
        ingestSample(
            tracks,
            Number(frame.timestamp) || 0,
            frame.universe,
            frame.protocol === 'sacn' ? 'sacn' : 'artnet',
            (ch) => data[ch] || 0,
            bucketMs
        );
    }
    return finalizeTracks(tracks, bucketMs);
};

const buildTimelineOverview = (filePath, options = {}) => {
    const bucketMs = Math.max(1, Number(options.bucketMs) || DEFAULT_BUCKET_MS);
    const stat = fs.statSync(filePath);
    const size = stat.size;

    if (size < HEADER_SIZE) {
        throw new Error('File is too small to be a recording');
    }

    const tracks = emptyTracks();
    walkRecording(filePath, (frameBuf, info) => {
        ingestSample(
            tracks,
            info.timestamp,
            info.universe,
            info.protocol,
            (ch) => frameBuf[10 + ch],
            bucketMs
        );
    });
    return finalizeTracks(tracks, bucketMs);
};

module.exports = {
    BANDS,
    CHANNELS_PER_BAND,
    DEFAULT_BUCKET_MS,
    MAX_BUCKETS,
    buildTimelineOverview,
    buildTimelineOverviewFromFrames
};
