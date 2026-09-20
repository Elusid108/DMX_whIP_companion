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

const clampFade = (value, half) => Math.max(0, Math.min(half, Math.round(Number(value) || 0)));

const normalizeClip = (clip = {}) => {
    const durationMs = clipSpanMs(clip);
    const startMs = Math.max(0, Math.round(Number(clip.startMs) || 0));
    const half = Math.floor(durationMs / 2);
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
        destIp: typeof clip.destIp === 'string' ? clip.destIp.trim() : '',
        fadeInMs: clampFade(clip.fadeInMs, half),
        fadeOutMs: clampFade(clip.fadeOutMs, half),
        fadeCurve: clip.fadeCurve === 'smooth' ? 'smooth' : 'linear'
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

const fadeShape = (t, curve) => {
    const x = Math.max(0, Math.min(1, t));
    if (curve === 'smooth') {
        return x * x * (3 - (2 * x));
    }
    return x;
};

const fadeGainAt = (clip, timeMs) => {
    const local = timeMs - clip.startMs;
    const duration = clip.durationMs;
    if (duration <= 0) {
        return 0;
    }
    let gain = 1;
    if (clip.fadeInMs > 0 && local < clip.fadeInMs) {
        gain *= fadeShape(local / clip.fadeInMs, clip.fadeCurve);
    }
    if (clip.fadeOutMs > 0 && local > duration - clip.fadeOutMs) {
        gain *= fadeShape((duration - local) / clip.fadeOutMs, clip.fadeCurve);
    }
    return Math.max(0, Math.min(1, gain));
};

const scaleChannels = (data, gain) => {
    if (gain >= 0.999) {
        return data;
    }
    const out = new Array(512);
    for (let i = 0; i < 512; i += 1) {
        out[i] = Math.round((data[i] || 0) * gain);
    }
    return out;
};

const flattenToFrames = (media, clips = [], options = {}) => {
    const ignoreDest = Boolean(options.ignoreDest);
    const states = layoutClips(clips).map((clip) => {
        const events = [];
        for (const frame of media[clip.mediaId] || []) {
            if (frame.timestamp < clip.sourceInMs || frame.timestamp > clip.sourceOutMs) {
                continue;
            }
            const timestamp = clip.startMs + (frame.timestamp - clip.sourceInMs);
            const universe = (Number(frame.universe) || 0) + clip.universeOffset;
            if (universe < 0) {
                continue;
            }
            events.push({
                timestamp,
                universe,
                protocol: frame.protocol === 'sacn' ? 'sacn' : 'artnet',
                destIp: ignoreDest ? '' : (clip.destIp || ''),
                data: shiftChannels(frame.data, clip.channelOffset)
            });
        }
        events.sort((a, b) => a.timestamp - b.timestamp);
        return { clip, events, index: 0, latest: new Map() };
    });

    const times = new Set();
    for (const state of states) {
        for (const event of state.events) {
            times.add(event.timestamp);
        }
    }
    const sortedTimes = [...times].sort((a, b) => a - b);
    const buckets = new Map();

    for (const timestamp of sortedTimes) {
        for (const state of states) {
            while (
                state.index < state.events.length
                && state.events[state.index].timestamp <= timestamp
            ) {
                const event = state.events[state.index];
                state.latest.set(`${event.protocol}:${event.universe}:${event.destIp}`, event);
                state.index += 1;
            }
            if (timestamp < state.clip.startMs || timestamp > state.clip.endMs) {
                continue;
            }
            const gain = fadeGainAt(state.clip, timestamp);
            for (const event of state.latest.values()) {
                const key = `${timestamp}|${event.protocol}|${event.universe}|${event.destIp}`;
                let entry = buckets.get(key);
                if (!entry) {
                    entry = {
                        timestamp,
                        universe: event.universe,
                        protocol: event.protocol,
                        destIp: event.destIp || undefined,
                        sums: new Array(512).fill(0),
                        count: 0
                    };
                    buckets.set(key, entry);
                }
                const data = scaleChannels(event.data, gain);
                entry.count += 1;
                for (let i = 0; i < 512; i += 1) {
                    entry.sums[i] += data[i] || 0;
                }
            }
        }
    }

    return [...buckets.values()].map((entry) => {
        const data = new Array(512);
        const count = Math.max(1, entry.count);
        for (let i = 0; i < 512; i += 1) {
            data[i] = Math.round(entry.sums[i] / count);
        }
        return {
            timestamp: entry.timestamp,
            universe: entry.universe,
            protocol: entry.protocol,
            destIp: entry.destIp,
            data
        };
    }).sort((a, b) => {
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
    destIp: clip.destIp,
    fadeInMs: clip.fadeInMs,
    fadeOutMs: clip.fadeOutMs,
    fadeCurve: clip.fadeCurve
}));

const SNAP_GAP_MS = 80;

const findGapOnTrack = (clips, trackId, hoverMs) => {
    const t = Math.max(0, Number(hoverMs) || 0);
    const onTrack = layoutClips(clips)
        .filter((clip) => (clip.trackId || 0) === trackId)
        .sort((a, b) => a.startMs - b.startMs);
    let left = null;
    let right = null;
    for (const clip of onTrack) {
        if (clip.endMs <= t + 0.5) {
            left = clip;
        }
        if (clip.startMs >= t - 0.5 && !right) {
            right = clip;
        }
    }
    if (!left || !right) {
        return null;
    }
    const gapLeft = left.endMs;
    const gapRight = right.startMs;
    if (gapRight - gapLeft < SNAP_GAP_MS) {
        return null;
    }
    return { gapLeft, gapRight, trackId };
};

const shiftClipsFrom = (clips, gapRight, delta) => layoutClips(clips).map((clip) => {
    if (clip.startMs >= gapRight) {
        return copyFields({ ...clip, startMs: Math.max(0, clip.startMs - delta) });
    }
    return copyFields(clip);
});

const closeGap = (clips, audioClips, gapLeft, gapRight) => {
    const left = Math.max(0, Number(gapLeft) || 0);
    const right = Math.max(left, Number(gapRight) || 0);
    const delta = right - left;
    if (delta < SNAP_GAP_MS) {
        return {
            clips: layoutClips(clips).map(copyFields),
            audioClips: layoutClips(audioClips).map(copyFields)
        };
    }
    return {
        clips: shiftClipsFrom(clips, right, delta),
        audioClips: shiftClipsFrom(audioClips, right, delta)
    };
};

const cloneClipsToPlayhead = (clips, ids, playheadMs, trackBump = 0) => {
    const selected = layoutClips(clips).filter((clip) => ids.includes(clip.id));
    if (!selected.length) {
        return [];
    }
    const origin = Math.min(...selected.map((clip) => clip.startMs));
    const at = Math.max(0, Math.round(Number(playheadMs) || 0));
    return selected.map((clip) => copyFields({
        ...clip,
        id: newId(),
        startMs: at + (clip.startMs - origin),
        trackId: Math.max(0, clip.trackId + trackBump)
    }));
};

const removeClipsById = (clips, ids) => layoutClips(clips)
    .filter((clip) => !ids.includes(clip.id))
    .map(copyFields);

const pasteNeedsBump = (existing, incoming, playheadMs) => {
    const t = Math.max(0, Math.round(Number(playheadMs) || 0));
    return incoming.some((clip) => existing.some((other) => (
        (other.trackId || 0) === (clip.trackId || 0)
        && t >= other.startMs
        && t < other.endMs
    )));
};

const defaultTrackName = (index) => `Track ${Math.max(0, Number(index) || 0) + 1}`;

const normalizeTrackNames = (count, names = []) => {
    const size = Math.max(1, Math.round(Number(count) || 1));
    const next = [];
    for (let i = 0; i < size; i += 1) {
        const raw = names && names[i];
        const label = typeof raw === 'string' ? raw.trim() : '';
        next.push(label || defaultTrackName(i));
    }
    return next;
};

const remapTrackOrder = (clips, from, to) => {
    const src = Math.max(0, Math.round(Number(from) || 0));
    const dst = Math.max(0, Math.round(Number(to) || 0));
    if (src === dst) {
        return layoutClips(clips).map(copyFields);
    }
    return layoutClips(clips).map((clip) => {
        let id = clip.trackId || 0;
        if (src < dst) {
            if (id === src) {
                id = dst;
            } else if (id > src && id <= dst) {
                id -= 1;
            }
        } else if (id === src) {
            id = dst;
        } else if (id >= dst && id < src) {
            id += 1;
        }
        return copyFields({ ...clip, trackId: id });
    });
};

const moveArrayItem = (list, from, to) => {
    const src = Math.max(0, Math.round(Number(from) || 0));
    const dst = Math.max(0, Math.round(Number(to) || 0));
    const next = Array.isArray(list) ? list.slice() : [];
    if (src >= next.length || dst < 0 || src === dst) {
        return next;
    }
    const [item] = next.splice(src, 1);
    next.splice(Math.min(dst, next.length), 0, item);
    return next;
};

const trackHasOverlap = (clips, trackId, startMs, endMs) => {
    const start = Math.max(0, Number(startMs) || 0);
    const end = Math.max(start, Number(endMs) || 0);
    const row = Math.max(0, Math.round(Number(trackId) || 0));
    return layoutClips(clips).some((clip) => (
        (clip.trackId || 0) === row
        && clip.startMs < end
        && clip.endMs > start
    ));
};

const averageChannelData = (parts) => {
    if (!parts || parts.length === 0) {
        return new Array(512).fill(0);
    }
    if (parts.length === 1) {
        return parts[0];
    }
    const out = new Array(512);
    const count = parts.length;
    for (let i = 0; i < 512; i += 1) {
        let sum = 0;
        for (const data of parts) {
            sum += (data && data[i]) || 0;
        }
        out[i] = Math.round(sum / count);
    }
    return out;
};

const liveFrameKey = (frame) => `${frame.protocol === 'sacn' ? 'sacn' : 'artnet'}:${Number(frame.universe) || 0}`;

const blendLookAtWithLive = (lookAtFrames = [], liveByKey) => {
    const live = liveByKey instanceof Map ? liveByKey : new Map();
    const used = new Set();
    const out = [];
    for (const frame of lookAtFrames) {
        const key = liveFrameKey(frame);
        const incoming = live.get(key);
        if (incoming) {
            used.add(key);
            out.push({
                timestamp: frame.timestamp,
                universe: frame.universe,
                protocol: frame.protocol,
                destIp: frame.destIp || '',
                data: averageChannelData([frame.data, incoming.data])
            });
        } else {
            out.push(frame);
        }
    }
    for (const [key, frame] of live) {
        if (!used.has(key)) {
            out.push({
                timestamp: frame.timestamp || 0,
                universe: frame.universe,
                protocol: frame.protocol === 'sacn' ? 'sacn' : 'artnet',
                destIp: '',
                data: frame.data
            });
        }
    }
    return out;
};

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
    fadeGainAt,
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
    publicClips,
    SNAP_GAP_MS,
    findGapOnTrack,
    closeGap,
    cloneClipsToPlayhead,
    removeClipsById,
    pasteNeedsBump,
    defaultTrackName,
    normalizeTrackNames,
    remapTrackOrder,
    moveArrayItem,
    trackHasOverlap,
    averageChannelData,
    liveFrameKey,
    blendLookAtWithLive
};
