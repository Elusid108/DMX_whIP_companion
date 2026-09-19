const newId = () => `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

const mediaDurationMs = (frames) => {
    if (!frames || frames.length === 0) {
        return 0;
    }
    let maxTs = 0;
    for (const frame of frames) {
        if (frame.timestamp > maxTs) {
            maxTs = frame.timestamp;
        }
    }
    return maxTs;
};

const clipSpanMs = (clip) => Math.max(0, (Number(clip.sourceOutMs) || 0) - (Number(clip.sourceInMs) || 0));

const wrapChannel = (value) => {
    const n = Math.round(Number(value) || 0);
    return ((n % 512) + 512) % 512;
};

const normalizeClip = (clip = {}) => {
    const durationMs = clipSpanMs(clip);
    const startMs = Math.max(0, Math.round(Number(clip.startMs) || 0));
    return {
        id: clip.id,
        name: clip.name || 'Clip',
        mediaId: clip.mediaId,
        trackId: Math.max(0, Math.round(Number(clip.trackId) || 0)),
        startMs,
        endMs: startMs + durationMs,
        durationMs,
        sourceInMs: Number(clip.sourceInMs) || 0,
        sourceOutMs: Number(clip.sourceOutMs) || 0,
        universeOffset: Math.round(Number(clip.universeOffset) || 0),
        channelOffset: wrapChannel(clip.channelOffset),
        destIp: typeof clip.destIp === 'string' ? clip.destIp.trim() : ''
    };
};

const layoutClips = (clips = []) => clips.map((clip) => normalizeClip(clip));

const timelineDurationMs = (clips = [], audioClips = []) => {
    let maxEnd = 0;
    for (const clip of layoutClips(clips)) {
        if (clip.endMs > maxEnd) {
            maxEnd = clip.endMs;
        }
    }
    for (const clip of layoutClips(audioClips)) {
        if (clip.endMs > maxEnd) {
            maxEnd = clip.endMs;
        }
    }
    return maxEnd;
};

const trackCountOf = (clips = [], fallback = 1) => {
    let max = 0;
    for (const clip of clips) {
        const id = Math.round(Number(clip.trackId) || 0);
        if (id > max) {
            max = id;
        }
    }
    return Math.max(fallback, max + 1);
};

const shiftChannels = (data, channelOffset) => {
    const shift = wrapChannel(channelOffset);
    const out = new Array(512);
    for (let i = 0; i < 512; i++) {
        out[(i + shift) % 512] = data && data[i] ? data[i] : 0;
    }
    return out;
};

const flattenToFrames = (media, clips = [], options = {}) => {
    const ignoreDest = Boolean(options.ignoreDest);
    const buckets = new Map();
    for (const clip of layoutClips(clips)) {
        const frames = media[clip.mediaId] || [];
        const inMs = clip.sourceInMs;
        const outMs = clip.sourceOutMs;
        for (const frame of frames) {
            if (frame.timestamp < inMs || frame.timestamp > outMs) {
                continue;
            }
            const timestamp = clip.startMs + (frame.timestamp - inMs);
            const universe = (Number(frame.universe) || 0) + clip.universeOffset;
            if (universe < 0) {
                continue;
            }
            const protocol = frame.protocol === 'sacn' ? 'sacn' : 'artnet';
            const destIp = ignoreDest ? '' : (clip.destIp || '');
            const data = shiftChannels(frame.data, clip.channelOffset);
            const key = `${timestamp}|${protocol}|${universe}|${destIp}`;
            const existing = buckets.get(key);
            if (!existing) {
                buckets.set(key, {
                    timestamp,
                    universe,
                    protocol,
                    destIp: destIp || undefined,
                    data
                });
                continue;
            }
            for (let i = 0; i < 512; i++) {
                if (data[i] > existing.data[i]) {
                    existing.data[i] = data[i];
                }
            }
        }
    }
    return [...buckets.values()].sort((a, b) => {
        if (a.timestamp !== b.timestamp) {
            return a.timestamp - b.timestamp;
        }
        if (a.protocol !== b.protocol) {
            return a.protocol.localeCompare(b.protocol);
        }
        return a.universe - b.universe;
    });
};

const clipAtTime = (clips, timeMs) => {
    const t = Math.max(0, Number(timeMs) || 0);
    const laid = layoutClips(clips);
    return laid.find((clip) => t >= clip.startMs && t < clip.endMs)
        || laid.filter((clip) => t >= clip.startMs).sort((a, b) => b.startMs - a.startMs)[0]
        || null;
};

const neighborClipStarts = (clips, timeMs) => {
    const t = Math.max(0, Number(timeMs) || 0);
    const starts = [...new Set(layoutClips(clips).map((clip) => clip.startMs))].sort((a, b) => a - b);
    if (starts.length === 0) {
        return { back: 0, next: 0 };
    }
    let back = 0;
    let next = starts[starts.length - 1];
    for (const start of starts) {
        if (start < t - 1) {
            back = start;
        }
        if (start > t + 1) {
            next = start;
            break;
        }
    }
    return { back, next };
};

const copyFields = (clip) => normalizeClip(clip);

const splitClips = (clips, timeMs) => {
    const t = Math.max(0, Number(timeMs) || 0);
    const laid = layoutClips(clips);
    const hit = laid.find((clip) => t > clip.startMs && t < clip.endMs);
    if (!hit) {
        return laid.map(copyFields);
    }
    const mid = hit.sourceInMs + (t - hit.startMs);
    const next = [];
    for (const clip of laid) {
        if (clip.id !== hit.id) {
            next.push(copyFields(clip));
            continue;
        }
        next.push(copyFields({ ...clip, sourceOutMs: mid }));
        next.push(copyFields({
            ...clip,
            id: newId(),
            startMs: t,
            sourceInMs: mid,
            sourceOutMs: clip.sourceOutMs
        }));
    }
    return next;
};

const mediaMaxMs = (media, mediaId, fallback) => {
    const item = media && media[mediaId];
    if (item && typeof item.durationMs === 'number') {
        return item.durationMs;
    }
    if (Array.isArray(item)) {
        return mediaDurationMs(item);
    }
    return fallback;
};

const trimClip = (clips, clipId, edge, nextSourceMs, media) => {
    return layoutClips(clips).map((clip) => {
        if (clip.id !== clipId) {
            return copyFields(clip);
        }
        const maxOut = mediaMaxMs(media, clip.mediaId, clip.sourceOutMs);
        let sourceInMs = clip.sourceInMs;
        let sourceOutMs = clip.sourceOutMs;
        let startMs = clip.startMs;
        const value = Math.max(0, Math.min(maxOut, Math.round(Number(nextSourceMs) || 0)));
        if (edge === 'in') {
            const nextIn = Math.min(value, sourceOutMs);
            startMs = Math.max(0, startMs + (nextIn - sourceInMs));
            sourceInMs = nextIn;
        } else {
            sourceOutMs = Math.max(value, sourceInMs);
        }
        return copyFields({ ...clip, sourceInMs, sourceOutMs, startMs });
    });
};

const moveClip = (clips, clipId, startMs, trackId) => {
    return layoutClips(clips).map((clip) => {
        if (clip.id !== clipId) {
            return copyFields(clip);
        }
        return copyFields({
            ...clip,
            startMs: Math.max(0, Math.round(Number(startMs) || 0)),
            trackId: Math.max(0, Math.round(Number(trackId) || 0))
        });
    });
};

const updateClip = (clips, clipId, patch = {}) => {
    return layoutClips(clips).map((clip) => {
        if (clip.id !== clipId) {
            return copyFields(clip);
        }
        return copyFields({ ...clip, ...patch, id: clip.id, mediaId: clip.mediaId });
    });
};

const rangeCutClips = (clips, fromMs, toMs) => {
    const start = Math.min(Number(fromMs) || 0, Number(toMs) || 0);
    const end = Math.max(Number(fromMs) || 0, Number(toMs) || 0);
    if (end <= start) {
        return layoutClips(clips).map(copyFields);
    }
    let next = splitClips(clips, start);
    next = splitClips(next, end);
    return layoutClips(next)
        .filter((clip) => clip.endMs <= start + 0.5 || clip.startMs >= end - 0.5)
        .map(copyFields);
};

const inspectMedia = (frames = []) => {
    const protocols = new Set();
    const universes = new Set();
    let woken = 0;
    let packets = 0;
    const times = [];
    for (const frame of frames) {
        packets += 1;
        protocols.add(frame.protocol === 'sacn' ? 'sacn' : 'artnet');
        universes.add(Number(frame.universe) || 0);
        times.push(frame.timestamp);
        const data = frame.data || [];
        for (let ch = 511; ch >= woken; ch -= 1) {
            if (data[ch] > 0) {
                woken = ch + 1;
                break;
            }
        }
    }
    const duration = mediaDurationMs(frames);
    const sorted = [...universes].sort((a, b) => a - b);
    return {
        protocols: [...protocols],
        universes: sorted,
        universeCount: sorted.length,
        startUniverse: sorted.length ? sorted[0] : 0,
        endUniverse: sorted.length ? sorted[sorted.length - 1] : 0,
        wokenChannels: woken,
        packets,
        fps: duration > 0 ? Math.round((packets / (duration / 1000)) * 10) / 10 : 0,
        durationMs: duration
    };
};

const inspectClip = (media, clip) => {
    const laid = normalizeClip(clip);
    const frames = (media && media[laid.mediaId]) || [];
    const windowed = frames.filter((frame) => (
        frame.timestamp >= laid.sourceInMs && frame.timestamp <= laid.sourceOutMs
    ));
    const stats = inspectMedia(windowed);
    return {
        ...laid,
        ...stats,
        durationMs: laid.durationMs,
        sourceDurationMs: stats.durationMs,
        outputStartUniverse: stats.startUniverse + laid.universeOffset,
        outputStartChannel: 1 + laid.channelOffset
    };
};

const serializeClips = (clips = []) => layoutClips(clips).map((clip) => ({
    id: clip.id,
    name: clip.name,
    mediaId: clip.mediaId,
    trackId: clip.trackId,
    startMs: clip.startMs,
    sourceInMs: clip.sourceInMs,
    sourceOutMs: clip.sourceOutMs,
    universeOffset: clip.universeOffset,
    channelOffset: clip.channelOffset,
    destIp: clip.destIp
}));

const publicClips = (clips = []) => layoutClips(clips);

const serializeAudioClips = (clips = []) => layoutClips(clips).map((clip) => ({
    id: clip.id,
    name: clip.name,
    mediaId: clip.mediaId,
    startMs: clip.startMs,
    sourceInMs: clip.sourceInMs,
    sourceOutMs: clip.sourceOutMs
}));

module.exports = {
    newId,
    mediaDurationMs,
    clipSpanMs,
    layoutClips,
    timelineDurationMs,
    trackCountOf,
    flattenToFrames,
    clipAtTime,
    neighborClipStarts,
    splitClips,
    trimClip,
    moveClip,
    updateClip,
    rangeCutClips,
    inspectMedia,
    inspectClip,
    serializeClips,
    serializeAudioClips,
    publicClips
};
