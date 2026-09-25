const { mediaDurationMs } = require('./compilationEdl');

const BLACKOUT_MS = 5000;
const SIGNAL_CUT_MS = 2500;
const SPAN_SLACK_MS = 20;

const START_MODES = new Set(['none', 'signal-start', 'signal-modified', 'channel']);
const STOP_MODES = new Set(['none', 'blackout', 'signal-cut', 'channel']);

const protocolOf = (protocol) => (protocol === 'sacn' ? 'sacn' : 'artnet');

const frameKey = (frame) => `${protocolOf(frame && frame.protocol)}:${Number(frame && frame.universe) || 0}`;

const copyLevels = (data) => {
    const out = Buffer.alloc(512);
    if (!data) {
        return out;
    }
    const len = Math.min(512, data.length);
    for (let i = 0; i < len; i += 1) {
        out[i] = data[i];
    }
    return out;
};

const levelsEqual = (baseline, data) => {
    for (let i = 0; i < 512; i += 1) {
        const value = data && i < data.length ? data[i] : 0;
        if (baseline[i] !== value) {
            return false;
        }
    }
    return true;
};

const isAllZero = (data) => {
    if (!data) {
        return true;
    }
    const end = Math.min(512, data.length);
    for (let i = 0; i < end; i += 1) {
        if (data[i] > 0) {
            return false;
        }
    }
    return true;
};

const channelIndex = (channel) => {
    const index = Math.round(Number(channel) || 1) - 1;
    if (index < 0) {
        return 0;
    }
    if (index > 511) {
        return 511;
    }
    return index;
};

const channelValue = (data, channel) => {
    const index = channelIndex(channel);
    if (!data || index >= data.length) {
        return 0;
    }
    return data[index];
};

const normalizeChannel = (raw) => {
    if (!raw) {
        return null;
    }
    let channel = Math.round(Number(raw.channel) || 1);
    if (channel < 1) {
        channel = 1;
    }
    if (channel > 512) {
        channel = 512;
    }
    return {
        protocol: protocolOf(raw.protocol),
        universe: Math.max(0, Math.round(Number(raw.universe) || 0)),
        channel
    };
};

const normalizeTriggerConfig = (payload = {}) => {
    const startMode = START_MODES.has(payload.startMode) ? payload.startMode : 'none';
    const stopMode = STOP_MODES.has(payload.stopMode) ? payload.stopMode : 'none';
    return {
        startMode,
        stopMode,
        startChannel: startMode === 'channel' ? normalizeChannel(payload.startChannel) : null,
        stopChannel: stopMode === 'channel' ? normalizeChannel(payload.stopChannel) : null
    };
};

const channelMatches = (frame, spec) => {
    if (!frame || !spec) {
        return false;
    }
    return protocolOf(frame.protocol) === spec.protocol
        && (Number(frame.universe) || 0) === spec.universe;
};

const zeroChannel = (data, channel) => {
    const out = copyLevels(data);
    out[channelIndex(channel)] = 0;
    return out;
};

const maskedRecordData = (frame, mask) => {
    if (!mask || !channelMatches(frame, mask)) {
        return frame ? frame.data : null;
    }
    return zeroChannel(frame.data, mask.channel);
};

const createWatch = (config, now = 0) => ({
    config,
    phase: 'armed',
    baselines: new Map(),
    startSeen: false,
    startValue: 0,
    stopSeen: false,
    stopValue: 0,
    latest: new Map(),
    seenSelected: false,
    blackoutSince: null,
    lastSelectedPacketAt: now
});

const noteSelected = (watch, frame, now) => {
    watch.latest.set(frameKey(frame), copyLevels(frame.data));
    watch.seenSelected = true;
    watch.lastSelectedPacketAt = now;
};

const allLatestZero = (watch) => {
    if (!watch.seenSelected || watch.latest.size === 0) {
        return false;
    }
    for (const data of watch.latest.values()) {
        if (!isAllZero(data)) {
            return false;
        }
    }
    return true;
};

const updateBlackout = (watch, now) => {
    if (watch.config.stopMode !== 'blackout') {
        return null;
    }
    if (!allLatestZero(watch)) {
        watch.blackoutSince = null;
        return null;
    }
    if (watch.blackoutSince == null) {
        watch.blackoutSince = now;
        return null;
    }
    if (now - watch.blackoutSince >= BLACKOUT_MS) {
        return 'stop';
    }
    return null;
};

const feedArmed = (watch, frame, selected) => {
    const { startMode, startChannel } = watch.config;
    if (startMode === 'signal-start') {
        return selected ? 'start' : null;
    }
    if (startMode === 'signal-modified') {
        if (!selected) {
            return null;
        }
        const key = frameKey(frame);
        const prior = watch.baselines.get(key);
        if (!prior) {
            watch.baselines.set(key, copyLevels(frame.data));
            return null;
        }
        return levelsEqual(prior, frame.data) ? null : 'start';
    }
    if (startMode === 'channel' && channelMatches(frame, startChannel)) {
        const value = channelValue(frame.data, startChannel.channel);
        if (!watch.startSeen) {
            watch.startSeen = true;
            watch.startValue = value;
            return null;
        }
        if (value !== watch.startValue) {
            return 'start';
        }
    }
    return null;
};

const beginRecordingWatch = (watch, frame, selected, now) => {
    watch.phase = 'recording';
    watch.lastSelectedPacketAt = now;
    if (frame && selected) {
        noteSelected(watch, frame, now);
    }
    if (watch.config.stopChannel && frame && channelMatches(frame, watch.config.stopChannel)) {
        watch.stopSeen = true;
        watch.stopValue = channelValue(frame.data, watch.config.stopChannel.channel);
    }
    if (watch.config.stopMode === 'blackout' && allLatestZero(watch)) {
        watch.blackoutSince = now;
    }
};

const feedRecording = (watch, frame, selected, now) => {
    if (watch.phase !== 'recording') {
        return null;
    }
    if (selected) {
        noteSelected(watch, frame, now);
        const blackout = updateBlackout(watch, now);
        if (blackout) {
            return blackout;
        }
    }
    if (
        watch.config.stopMode === 'channel'
        && channelMatches(frame, watch.config.stopChannel)
    ) {
        const value = channelValue(frame.data, watch.config.stopChannel.channel);
        if (!watch.stopSeen) {
            watch.stopSeen = true;
            watch.stopValue = value;
            return null;
        }
        if (value !== watch.stopValue) {
            return 'stop';
        }
    }
    return null;
};

const pollStop = (watch, now) => {
    if (!watch || watch.phase !== 'recording') {
        return null;
    }
    if (
        watch.config.stopMode === 'signal-cut'
        && watch.lastSelectedPacketAt
        && now - watch.lastSelectedPacketAt >= SIGNAL_CUT_MS
    ) {
        return 'stop';
    }
    if (
        watch.config.stopMode === 'blackout'
        && watch.blackoutSince != null
        && now - watch.blackoutSince >= BLACKOUT_MS
    ) {
        return 'stop';
    }
    return null;
};

const omitTriggerChannel = (frames, lookAtFrames, mask) => {
    if (!mask || !frames) {
        return frames;
    }
    const key = `${protocolOf(mask.protocol)}:${Number(mask.universe) || 0}`;
    const index = channelIndex(mask.channel);
    const look = (lookAtFrames || []).find((frame) => frameKey(frame) === key);
    const kept = look && look.data && index < look.data.length ? (look.data[index] || 0) : 0;
    return frames.map((frame) => {
        if (frameKey(frame) !== key || !frame.data) {
            return frame;
        }
        const data = Array.isArray(frame.data) ? frame.data.slice() : Array.from(copyLevels(frame.data));
        data[index] = kept;
        return { ...frame, data };
    });
};

const formatLookTimestamp = (date) => {
    const when = date instanceof Date ? date : new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}-${pad(when.getMinutes())}-${pad(when.getSeconds())}`;
};

const isRedundantCompilation = (session) => {
    if (!session || session.kind !== 'compilation') {
        return true;
    }
    if (session.audioClips && session.audioClips.length > 0) {
        return false;
    }
    const clips = session.clips || [];
    if (clips.length !== 1) {
        return false;
    }
    const clip = clips[0];
    if (!clip || !clip.libraryPath) {
        return false;
    }
    if ((Number(clip.sourceInMs) || 0) !== 0) {
        return false;
    }
    if ((Number(clip.fadeInMs) || 0) > 0 || (Number(clip.fadeOutMs) || 0) > 0) {
        return false;
    }
    if ((Number(clip.universeOffset) || 0) !== 0) {
        return false;
    }
    if ((Number(clip.channelOffset) || 0) !== 0) {
        return false;
    }
    if (clip.destIp && String(clip.destIp).trim()) {
        return false;
    }
    const frames = session.media && session.media[clip.mediaId];
    const full = mediaDurationMs(frames || []);
    if (Math.abs((Number(clip.sourceOutMs) || 0) - full) > SPAN_SLACK_MS) {
        return false;
    }
    return true;
};

module.exports = {
    BLACKOUT_MS,
    SIGNAL_CUT_MS,
    normalizeTriggerConfig,
    channelMatches,
    zeroChannel,
    maskedRecordData,
    createWatch,
    feedArmed,
    beginRecordingWatch,
    feedRecording,
    pollStop,
    omitTriggerChannel,
    formatLookTimestamp,
    isRedundantCompilation
};
