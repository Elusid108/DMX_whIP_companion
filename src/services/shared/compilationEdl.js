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

const layoutClips = (clips = []) => {
    let startMs = 0;
    return clips.map((clip) => {
        const durationMs = clipSpanMs(clip);
        const laid = {
            ...clip,
            startMs,
            endMs: startMs + durationMs,
            durationMs
        };
        startMs += durationMs;
        return laid;
    });
};

const timelineDurationMs = (clips = []) => {
    const laid = layoutClips(clips);
    if (laid.length === 0) {
        return 0;
    }
    return laid[laid.length - 1].endMs;
};

const flattenToFrames = (media, clips = []) => {
    const laid = layoutClips(clips);
    const out = [];
    for (const clip of laid) {
        const frames = media[clip.mediaId] || [];
        const inMs = Number(clip.sourceInMs) || 0;
        const outMs = Number(clip.sourceOutMs) || 0;
        for (const frame of frames) {
            if (frame.timestamp < inMs || frame.timestamp > outMs) {
                continue;
            }
            out.push({
                timestamp: clip.startMs + (frame.timestamp - inMs),
                universe: frame.universe,
                protocol: frame.protocol,
                data: frame.data
            });
        }
    }
    out.sort((a, b) => a.timestamp - b.timestamp);
    return out;
};

const clipAtTime = (clips, timeMs) => {
    const t = Math.max(0, Number(timeMs) || 0);
    return layoutClips(clips).find((clip) => t >= clip.startMs && t < clip.endMs)
        || layoutClips(clips).find((clip) => t === clip.endMs && clip.durationMs === 0)
        || null;
};

const splitClips = (clips, timeMs) => {
    const t = Math.max(0, Number(timeMs) || 0);
    const laid = layoutClips(clips);
    const hit = laid.find((clip) => t > clip.startMs && t < clip.endMs);
    if (!hit) {
        return clips.map((clip) => ({ ...clip }));
    }
    const offset = t - hit.startMs;
    const mid = hit.sourceInMs + offset;
    const next = [];
    for (const clip of clips) {
        if (clip.id !== hit.id) {
            next.push({ ...clip });
            continue;
        }
        next.push({
            ...clip,
            sourceOutMs: mid
        });
        next.push({
            id: newId(),
            name: clip.name,
            mediaId: clip.mediaId,
            sourceInMs: mid,
            sourceOutMs: clip.sourceOutMs
        });
    }
    return next;
};

const trimClip = (clips, clipId, edge, nextSourceMs, media) => {
    return clips.map((clip) => {
        if (clip.id !== clipId) {
            return { ...clip };
        }
        const frames = media && media[clip.mediaId];
        const maxOut = frames ? mediaDurationMs(frames) : clip.sourceOutMs;
        let sourceInMs = Number(clip.sourceInMs) || 0;
        let sourceOutMs = Number(clip.sourceOutMs) || 0;
        const value = Math.max(0, Math.min(maxOut, Math.round(Number(nextSourceMs) || 0)));
        if (edge === 'in') {
            sourceInMs = Math.min(value, sourceOutMs);
        } else {
            sourceOutMs = Math.max(value, sourceInMs);
        }
        return { ...clip, sourceInMs, sourceOutMs };
    });
};

const reorderClips = (clips, fromIndex, toIndex) => {
    const next = clips.map((clip) => ({ ...clip }));
    if (fromIndex < 0 || fromIndex >= next.length) {
        return next;
    }
    const [moved] = next.splice(fromIndex, 1);
    const dest = Math.max(0, Math.min(next.length, toIndex));
    next.splice(dest, 0, moved);
    return next;
};

const rangeCutClips = (clips, fromMs, toMs) => {
    const start = Math.min(Number(fromMs) || 0, Number(toMs) || 0);
    const end = Math.max(Number(fromMs) || 0, Number(toMs) || 0);
    if (end <= start) {
        return clips.map((clip) => ({ ...clip }));
    }
    let next = splitClips(clips, start);
    next = splitClips(next, end);
    return layoutClips(next)
        .filter((clip) => clip.endMs <= start + 0.5 || clip.startMs >= end - 0.5)
        .map((clip) => ({
            id: clip.id,
            name: clip.name,
            mediaId: clip.mediaId,
            sourceInMs: clip.sourceInMs,
            sourceOutMs: clip.sourceOutMs
        }));
};

const serializeClips = (clips = []) => clips.map((clip) => ({
    id: clip.id,
    name: clip.name,
    mediaId: clip.mediaId,
    sourceInMs: Number(clip.sourceInMs) || 0,
    sourceOutMs: Number(clip.sourceOutMs) || 0
}));

const publicClips = (clips = []) => layoutClips(serializeClips(clips));

module.exports = {
    newId,
    mediaDurationMs,
    clipSpanMs,
    layoutClips,
    timelineDurationMs,
    flattenToFrames,
    clipAtTime,
    splitClips,
    trimClip,
    reorderClips,
    rangeCutClips,
    serializeClips,
    publicClips
};
