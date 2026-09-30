const { ipcMain, dialog, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ArtNetSender = require('../../services/artnet/sender');
const { SacnOutput } = require('../../services/sacn/output');
const { parseRecording, writeRecording } = require('../../services/shared/dmxRecording');
const { buildTimelineOverviewFromFrames } = require('../../services/shared/timelineOverview');
const { runFileTask } = require('../fileTasks');
const {
    newId,
    mediaDurationMs,
    flattenToFrames,
    publicClips,
    splitClips,
    trimClip,
    moveClip,
    updateClip,
    rangeCutClips,
    serializeClips,
    serializeAudioClips,
    timelineDurationMs,
    trackCountOf,
    inspectClip,
    closeGap,
    cloneClipsToPlayhead,
    removeClipsById,
    pasteNeedsBump,
    normalizeTrackNames,
    remapTrackOrder,
    moveArrayItem,
    trackHasOverlap,
    liveFrameKey,
    blendLookAtWithLive
} = require('../../services/shared/compilationEdl');
const { describeWav } = require('../../services/shared/audioWav');
const {
    normalizeTriggerConfig,
    createWatch,
    feedArmed,
    beginRecordingWatch,
    feedRecording,
    pollStop,
    omitTriggerChannel,
    formatLookTimestamp,
    isRedundantCompilation
} = require('../../services/shared/recordTriggers');
const { convertToStudioWav, tempWavPath } = require('../audioConvert');
const { studioVisible } = require('../uiView');
const {
    ensureLibrary,
    uniqueDmxPath,
    uniqueCompPath,
    writeSidecar,
    sanitizeBaseName,
    listLibrary,
    assertInLibrary
} = require('./library');

const ZERO_DMX = new Uint8Array(512);

// Frames due within this many ms go out in the same tick (one frame's
// universes), instead of spinning setImmediate between 1 ms-apart packets.
const LOOKAHEAD_MS = 3;
// Sockets stay open this long after a blackout so the zeros leave the NIC.
const BLACKOUT_CLOSE_MS = 120;
// Media ids come from project.json; they name files under media/ and audio/.
const SAFE_MEDIA_ID = /^[A-Za-z0-9_-]{1,80}$/;

const safeMediaId = (id) => {
    const value = String(id || '');
    if (!SAFE_MEDIA_ID.test(value)) {
        throw new Error('Compilation has an invalid media id');
    }
    return value;
};

let audioVersionSeq = 0;
const AUDIO_FILTERS = [
    { name: 'Audio', extensions: ['wav', 'aiff', 'aif', 'mp3', 'm4a', 'flac', 'ogg'] }
];

function setupPlaybackHandlers(mainWindow, recordingHandler = null, liveOutput = null) {
    let playbackData = null;
    let playerData = null;
    let activeSource = 'studio';
    let isPlaying = false;
    let isPaused = false;
    let currentPlaybackFrame = 0;
    let playbackOriginNs = 0n;
    let pausedElapsed = 0;
    let lastSentFrame = null;
    let holdFrames = [];
    let playTimeout = null;
    let playImmediate = null;
    let pauseInterval = null;
    let discoveryInterval = null;
    let artnetSender = null;
    let sacnOutput = null;
    let loopEnabled = false;
    let activeNetwork = '0.0.0.0';
    let lastStatsSent = 0;
    let framesSentWindow = [];
    let seekToken = 0;
    let editSession = emptyEditSession();
    let undoStack = [];
    let redoStack = [];
    let clipClipboard = { light: [], audio: [] };
    let punchIn = null;
    let punchTimer = null;
    let lastPunchProgressAt = 0;
    let recordWatch = null;
    let watchTimer = null;
    let punchStopLock = null;
    let triggerOmit = null;
    let startingPlayback = false;
    let senderSeq = 0;
    let sentAudioVersion = -1;
    const HISTORY_CAP = 100;
    if (!liveOutput) {
        throw new Error('Playback needs the engine live output');
    }
    // Last frame sent per 'protocol:universe' while the sockets are open.
    const lastByUniverse = new Map();
    liveOutput.attachPlayback({
        owns: (proto, uni) => lastByUniverse.has(`${proto}:${uni}`),
        resend: (proto, uni) => {
            const frame = lastByUniverse.get(`${proto}:${uni}`);
            if (frame) {
                emitFrame(frame);
            }
        }
    });

    const resolvedTrackNames = () => normalizeTrackNames(
        Math.max(editSession.trackCount, trackCountOf(editSession.clips, 1)),
        editSession.trackNames
    );

    const syncTracks = () => {
        editSession.trackCount = Math.max(editSession.trackCount, trackCountOf(editSession.clips, 1));
        editSession.trackNames = normalizeTrackNames(editSession.trackCount, editSession.trackNames);
    };

    const snapshotEdl = () => ({
        clips: serializeClips(editSession.clips),
        audioClips: serializeAudioClips(editSession.audioClips),
        trackCount: editSession.trackCount,
        trackNames: resolvedTrackNames()
    });

    const pushHistory = () => {
        undoStack.push(snapshotEdl());
        if (undoStack.length > HISTORY_CAP) {
            undoStack.shift();
        }
        redoStack = [];
    };

    const restoreEdl = (snap) => {
        editSession.clips = snap.clips || [];
        editSession.audioClips = snap.audioClips || [];
        editSession.trackCount = Math.max(1, Number(snap.trackCount) || 1);
        editSession.trackNames = normalizeTrackNames(editSession.trackCount, snap.trackNames);
        editSession.dirty = true;
        playbackData = flattenToFrames(editSession.media, editSession.clips);
    };

    function emptyEditSession() {
        return {
            kind: null,
            name: '',
            notes: '',
            projectPath: null,
            dirty: false,
            media: {},
            mediaBytes: {},
            clips: [],
            skipped: [],
            trackCount: 1,
            trackNames: ['Track 1'],
            audioClips: [],
            audioMedia: {},
            audioBytes: {},
            audioVersion: ++audioVersionSeq
        };
    }

    const sendSafe = (channel, payload) => {
        if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
            return;
        }
        mainWindow.webContents.send(channel, payload);
    };

    const clipDurationMs = () => {
        if (!playbackData || playbackData.length === 0) {
            return 0;
        }
        return playbackData[playbackData.length - 1].timestamp;
    };

    const timelineEndMs = () => Math.max(
        clipDurationMs(),
        timelineDurationMs(editSession.clips, editSession.audioClips)
    );

    const activeFrames = () => (activeSource === 'player' ? playerData : playbackData);

    const activeEndMs = () => {
        if (activeSource === 'player') {
            if (!playerData || playerData.length === 0) {
                return 0;
            }
            return playerData[playerData.length - 1].timestamp;
        }
        return timelineEndMs();
    };

    const elapsedMs = () => Number((process.hrtime.bigint() - playbackOriginNs) / 1000000n);

    const playheadClockMs = () => (isPlaying ? elapsedMs() : pausedElapsed);

    const firstFrameAfter = (timeMs) => {
        const frames = activeFrames();
        if (!frames) {
            return 0;
        }
        let lo = 0;
        let hi = frames.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (frames[mid].timestamp <= timeMs) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        return lo;
    };

    const lookAt = (timeMs) => {
        const latest = new Map();
        const frames = activeFrames();
        if (!frames) {
            return [];
        }
        for (const frame of frames) {
            if (frame.timestamp > timeMs) {
                break;
            }
            latest.set(`${frame.protocol}:${frame.universe}:${frame.destIp || ''}`, frame);
        }
        return [...latest.values()];
    };

    const sacnUniversesInClip = () => {
        const universes = new Set();
        const frames = activeFrames();
        if (!frames) {
            return [];
        }
        for (const frame of frames) {
            if (frame.protocol === 'sacn') {
                universes.add(frame.universe);
            }
        }
        return [...universes];
    };

    // graceMs > 0 detaches the sockets now and closes them later, so packets
    // just queued (a blackout) still go out even if a new playback starts.
    const cleanupSenders = (graceMs = 0) => {
        senderSeq += 1;
        // Live levels go back to the Live output's own sockets.
        lastByUniverse.clear();
        liveOutput.kick();
        if (discoveryInterval) {
            clearInterval(discoveryInterval);
            discoveryInterval = null;
        }
        const art = artnetSender;
        const sacn = sacnOutput;
        artnetSender = null;
        sacnOutput = null;
        const close = () => {
            if (art) {
                art.stop();
            }
            if (sacn) {
                sacn.close();
            }
        };
        if (graceMs > 0 && (art || sacn)) {
            setTimeout(close, graceMs);
        } else {
            close();
        }
    };

    // Waveform peaks are large; send them once per audio change, not with
    // every edit. The renderer keeps the last audioMedia it was given.
    const audioPayload = () => {
        if (sentAudioVersion === editSession.audioVersion) {
            return undefined;
        }
        sentAudioVersion = editSession.audioVersion;
        return publicAudioMedia();
    };

    const publicAudioMedia = () => {
        const out = {};
        for (const [id, media] of Object.entries(editSession.audioMedia)) {
            out[id] = {
                durationMs: media.durationMs,
                peaksL: media.peaksL,
                peaksR: media.peaksR
            };
        }
        return out;
    };

    const emitStats = (extra = {}) => {
        const now = Date.now();
        const cutoff = now - 1000;
        framesSentWindow = framesSentWindow.filter((time) => time > cutoff);
        const lastTimestamp = lastSentFrame ? lastSentFrame.timestamp : 0;
        sendSafe('playback-stats', {
            currentFrame: currentPlaybackFrame,
            totalFrames: (activeFrames() || []).length,
            clipTime: lastTimestamp,
            totalPlayTime: isPlaying ? elapsedMs() : pausedElapsed,
            playheadMs: playheadClockMs(),
            fps: framesSentWindow.length,
            isPlaying,
            isPaused,
            loop: loopEnabled,
            source: activeSource,
            ...extra
        });
    };

    const sendDiscovery = () => {
        if (!sacnOutput) {
            return;
        }
        const universes = sacnUniversesInClip();
        if (universes.length === 0) {
            return;
        }
        sacnOutput.sendDiscovery(universes).catch((err) => {
            console.error('Playback discovery error:', err);
        });
    };

    // A later call (or cleanupSenders) supersedes an earlier one still
    // awaiting its sockets; the loser closes what it opened.
    const initializeSenders = async (playbackNetwork, options = {}) => {
        cleanupSenders();
        const seq = senderSeq;
        activeNetwork = playbackNetwork || '0.0.0.0';

        const art = new ArtNetSender();
        let sacn = null;
        try {
            await art.start(activeNetwork);
            const universes = sacnUniversesInClip();
            if (universes.length > 0 || options.forceSacn) {
                sacn = new SacnOutput({
                    sourceName: 'DMX whIP Playback',
                    iface: activeNetwork
                });
                await sacn.start();
            }
        } catch (err) {
            art.stop();
            if (sacn) {
                sacn.close();
            }
            throw err;
        }
        if (seq !== senderSeq) {
            art.stop();
            if (sacn) {
                sacn.close();
            }
            return false;
        }
        artnetSender = art;
        sacnOutput = sacn;
        if (sacnOutput) {
            sendDiscovery();
            discoveryInterval = setInterval(sendDiscovery, 10000);
        }
        return true;
    };

    const ensureSenders = async (playbackNetwork) => {
        if (artnetSender) {
            return;
        }
        await initializeSenders(playbackNetwork || activeNetwork);
    };

    // Every playback packet leaves here, with the Live tab's levels merged
    // in (HTP). While playback sends a universe it owns it, so the Live
    // output stays quiet there and nodes see one source.
    const emitFrame = (frame) => {
        const data = liveOutput.merge(frame.protocol, frame.universe, frame.data);
        if (frame.protocol === 'artnet') {
            if (artnetSender) {
                lastByUniverse.set(`artnet:${frame.universe}`, frame);
                artnetSender.send(frame.universe, data, frame.destIp).catch((err) => {
                    console.error('Art-Net playback send error:', err);
                });
            }
            return;
        }
        if (sacnOutput) {
            lastByUniverse.set(`sacn:${frame.universe}`, frame);
            sacnOutput.send(frame.universe, data, frame.destIp);
        }
    };

    const outputFrame = (frame, countFps) => {
        lastSentFrame = frame;
        if (countFps) {
            framesSentWindow.push(Date.now());
        }
        emitFrame(frame);
    };

    const sendFrame = (frame) => {
        outputFrame(frame, true);
    };

    const sendLookAt = (timeMs) => {
        holdFrames = lookAt(timeMs);
        for (const frame of holdFrames) {
            outputFrame(frame, false);
        }
    };

    const clearPlayTimeout = () => {
        if (playTimeout) {
            clearTimeout(playTimeout);
            playTimeout = null;
        }
        if (playImmediate) {
            clearImmediate(playImmediate);
            playImmediate = null;
        }
    };

    const armTick = (waitMs) => {
        if (waitMs <= 0) {
            playImmediate = setImmediate(scheduleTick);
            return;
        }
        playTimeout = setTimeout(scheduleTick, Math.max(1, waitMs - 1));
    };

    const stopHoldOutput = () => {
        if (pauseInterval) {
            clearInterval(pauseInterval);
            pauseInterval = null;
        }
    };

    const frameKey = (frame) => `${frame.protocol}:${frame.universe}:${frame.destIp || ''}`;

    const blackout = () => {
        if (!artnetSender && !sacnOutput) {
            return;
        }
        const latest = new Map();
        const frames = activeFrames();
        if (frames) {
            for (const frame of frames) {
                latest.set(frameKey(frame), frame);
            }
        }
        if (lastSentFrame) {
            latest.set(frameKey(lastSentFrame), lastSentFrame);
        }
        for (const frame of holdFrames) {
            latest.set(frameKey(frame), frame);
        }
        for (const frame of latest.values()) {
            outputFrame({
                protocol: frame.protocol,
                universe: frame.universe,
                destIp: frame.destIp,
                timestamp: frame.timestamp || 0,
                data: ZERO_DMX
            }, false);
        }
    };

    const haltTransport = ({ cleanup = false } = {}) => {
        isPlaying = false;
        isPaused = false;
        clearPlayTimeout();
        stopHoldOutput();
        currentPlaybackFrame = 0;
        lastSentFrame = null;
        holdFrames = [];
        framesSentWindow = [];
        pausedElapsed = 0;
        if (cleanup) {
            cleanupSenders();
        }
    };

    const beginPlayback = async (playbackNetwork, startMs = 0) => {
        const frames = activeFrames();
        if (!frames || frames.length === 0) {
            return false;
        }
        const duration = activeEndMs();
        let from = Math.max(0, Number(startMs) || 0);
        if (from >= duration) {
            from = 0;
        }
        currentPlaybackFrame = from > 0 ? firstFrameAfter(from) : 0;
        lastSentFrame = null;
        framesSentWindow = [];
        if (!await initializeSenders(playbackNetwork)) {
            return false;
        }
        isPlaying = true;
        isPaused = false;
        playbackOriginNs = process.hrtime.bigint() - BigInt(from) * 1000000n;
        if (from > 0) {
            sendLookAt(from);
        }
        scheduleTick();
        emitStats();
        return true;
    };

    const scheduleTick = () => {
        clearPlayTimeout();
        const frames = activeFrames();
        if (!isPlaying || !frames) {
            return;
        }

        const elapsed = elapsedMs();
        while (
            currentPlaybackFrame < frames.length &&
            frames[currentPlaybackFrame].timestamp <= elapsed + LOOKAHEAD_MS
        ) {
            sendFrame(frames[currentPlaybackFrame]);
            currentPlaybackFrame += 1;
        }

        const now = Date.now();
        if (now - lastStatsSent >= 100) {
            lastStatsSent = now;
            emitStats();
        }

        if (elapsed >= activeEndMs()) {
            if (loopEnabled) {
                currentPlaybackFrame = 0;
                lastSentFrame = null;
                holdFrames = [];
                playbackOriginNs = process.hrtime.bigint();
                emitStats({ playheadMs: 0 });
                armTick(0);
                return;
            }
            stopPlaybackInternal(true);
            return;
        }

        if (currentPlaybackFrame >= frames.length) {
            const remaining = activeEndMs() - elapsed;
            armTick(Math.min(100, Math.max(16, remaining)));
            return;
        }

        const wait = frames[currentPlaybackFrame].timestamp - LOOKAHEAD_MS - elapsed;
        armTick(wait);
    };

    const startHoldOutput = () => {
        stopHoldOutput();
        if (holdFrames.length === 0 && !lastSentFrame) {
            return;
        }
        pauseInterval = setInterval(() => {
            if (!isPaused) {
                stopHoldOutput();
                return;
            }
            if (holdFrames.length > 0) {
                for (const frame of holdFrames) {
                    outputFrame(frame, false);
                }
                return;
            }
            if (lastSentFrame) {
                outputFrame(lastSentFrame, false);
            }
        }, 100);
    };

    const applySeek = (timeMs) => {
        const duration = activeEndMs();
        const t = Math.max(0, Math.min(Math.round(Number(timeMs) || 0), duration));
        currentPlaybackFrame = firstFrameAfter(t);
        pausedElapsed = t;
        sendLookAt(t);
        if (isPlaying) {
            playbackOriginNs = process.hrtime.bigint() - BigInt(t) * 1000000n;
            scheduleTick();
        }
        return t;
    };

    const stopPlaybackInternal = (naturalEnd = false) => {
        const endedAt = isPlaying ? elapsedMs() : pausedElapsed;
        const source = activeSource;
        const frames = activeFrames();
        if (!naturalEnd || source === 'player') {
            blackout();
        }
        isPlaying = false;
        isPaused = false;
        clearPlayTimeout();
        stopHoldOutput();
        currentPlaybackFrame = 0;
        lastSentFrame = null;
        holdFrames = [];
        framesSentWindow = [];
        cleanupSenders(BLACKOUT_CLOSE_MS);
        if (naturalEnd) {
            pausedElapsed = endedAt;
            emitStats({
                source,
                isPlaying: false,
                isPaused: false,
                fps: 0,
                currentFrame: frames ? frames.length : 0,
                totalPlayTime: endedAt,
                playheadMs: endedAt,
                playerEnded: source === 'player'
            });
            return;
        }
        pausedElapsed = 0;
        emitStats({
            source,
            isPlaying: false,
            isPaused: false,
            isReset: true,
            fps: 0,
            currentFrame: 0,
            totalPlayTime: 0,
            playheadMs: 0
        });
    };

    const sessionPayload = (extra = {}) => ({
        success: true,
        kind: 'compilation',
        filePath: extra.filePath || editSession.projectPath || extra.sourcePath || null,
        projectPath: editSession.projectPath,
        displayName: editSession.name,
        frameCount: playbackData ? playbackData.length : 0,
        durationMs: timelineEndMs(),
        clips: publicClips(editSession.clips),
        audioClips: publicClips(editSession.audioClips),
        audioMedia: audioPayload(),
        trackCount: Math.max(editSession.trackCount, trackCountOf(editSession.clips, 1)),
        trackNames: resolvedTrackNames(),
        dirty: editSession.dirty,
        compilationSaveNeeded: Boolean(editSession.dirty) && !isRedundantCompilation(editSession),
        skipped: editSession.skipped,
        ...extra
    });

    const applyFlattenedPlayback = () => {
        playbackData = flattenToFrames(editSession.media, editSession.clips);
        if (activeSource === 'studio') {
            stopPlaybackInternal(false);
        }
        undoStack = [];
        redoStack = [];
    };

    const emitCompilationUpdated = () => {
        sendSafe('compilation-updated', {
            clips: publicClips(editSession.clips),
            audioClips: publicClips(editSession.audioClips),
            audioMedia: audioPayload(),
            trackCount: Math.max(editSession.trackCount, trackCountOf(editSession.clips, 1)),
            trackNames: resolvedTrackNames(),
            dirty: editSession.dirty,
            compilationSaveNeeded: Boolean(editSession.dirty) && !isRedundantCompilation(editSession),
            name: editSession.name,
            projectPath: editSession.projectPath,
            frameCount: playbackData ? playbackData.length : 0,
            durationMs: timelineEndMs()
        });
    };

    const addMediaFromBuffer = (fileData, name, startMs, trackId, extra = {}) => {
        const frames = parseRecording(fileData);
        const mediaId = newId();
        editSession.media[mediaId] = frames;
        editSession.mediaBytes[mediaId] = fileData;
        const duration = mediaDurationMs(frames);
        const start = startMs != null ? startMs : timelineDurationMs(editSession.clips);
        const clipId = newId();
        editSession.clips.push({
            id: clipId,
            name: name || 'Look',
            mediaId,
            trackId: Math.max(0, Math.round(Number(trackId) || 0)),
            startMs: start,
            sourceInMs: 0,
            sourceOutMs: duration,
            universeOffset: 0,
            channelOffset: 0,
            destIp: '',
            libraryPath: extra.libraryPath || ''
        });
        return { mediaId, clipId };
    };

    const rememberAudio = (mediaId, filePath, bytes) => {
        const info = describeWav(bytes);
        editSession.audioMedia[mediaId] = {
            durationMs: info.durationMs,
            peaksL: info.peaksL,
            peaksR: info.peaksR,
            filePath
        };
        editSession.audioBytes[mediaId] = bytes;
        editSession.audioVersion = ++audioVersionSeq;
        return info;
    };

    const resolveAudioPath = (mediaId) => {
        const media = editSession.audioMedia[mediaId];
        return media && media.filePath ? media.filePath : null;
    };

    const loadFromPath = async (filePath, displayName) => {
        const fileData = await fs.promises.readFile(filePath);
        const label = displayName || path.parse(filePath).name;
        editSession = emptyEditSession();
        editSession.kind = 'compilation';
        editSession.name = label;
        addMediaFromBuffer(fileData, label, 0);
        applyFlattenedPlayback();
        const result = sessionPayload({ filePath, sourcePath: filePath });
        sendSafe('file-loaded', result);
        return result;
    };

    const loadFromSources = async (sources = [], stackName) => {
        editSession = emptyEditSession();
        editSession.kind = 'compilation';
        editSession.name = stackName || 'Stack';
        const skipped = [];
        for (const source of sources) {
            if (!source || !source.filePath) {
                continue;
            }
            try {
                const fileData = await fs.promises.readFile(source.filePath);
                addMediaFromBuffer(fileData, source.name || path.parse(source.filePath).name);
            } catch (error) {
                skipped.push({ filePath: source.filePath, error: error.message });
            }
        }
        editSession.skipped = skipped;
        if (editSession.clips.length === 0) {
            throw new Error(skipped[0] ? skipped[0].error : 'No playable looks in this folder');
        }
        if (editSession.clips.length === 1) {
            editSession.name = editSession.clips[0].name;
        }
        applyFlattenedPlayback();
        const result = sessionPayload({
            filePath: editSession.projectPath,
            skipped
        });
        sendSafe('file-loaded', result);
        return result;
    };

    const canAppendToSession = () => (
        editSession.kind === 'compilation' && editSession.clips.length > 0
    );

    const flattenKeepHistory = () => {
        playbackData = flattenToFrames(editSession.media, editSession.clips);
        syncTracks();
        editSession.dirty = true;
    };

    const appendSources = async (sources = [], trackId = 0) => {
        const row = Math.max(0, Math.round(Number(trackId) || 0));
        if (row >= editSession.trackCount) {
            editSession.trackCount = row + 1;
        }
        pushHistory();
        let cursor = timelineDurationMs(editSession.clips, editSession.audioClips);
        const skipped = [];
        let added = 0;
        for (const source of sources) {
            if (!source || !source.filePath) {
                continue;
            }
            try {
                const fileData = await fs.promises.readFile(source.filePath);
                const created = addMediaFromBuffer(
                    fileData,
                    source.name || path.parse(source.filePath).name,
                    cursor,
                    row
                );
                const clip = editSession.clips.find((item) => item.id === created.clipId);
                const span = clip
                    ? Math.max(0, (clip.sourceOutMs || 0) - (clip.sourceInMs || 0))
                    : 0;
                cursor += span;
                added += 1;
            } catch (error) {
                skipped.push({ filePath: source.filePath, error: error.message });
            }
        }
        editSession.skipped = skipped;
        if (added === 0) {
            undoStack.pop();
            throw new Error(skipped[0] ? skipped[0].error : 'No playable looks to import');
        }
        flattenKeepHistory();
        const result = sessionPayload({ skipped, playheadMs: playheadClockMs() });
        sendSafe('file-loaded', result);
        return result;
    };

    const appendCompilationPackage = async (dirPath, trackId = 0) => {
        const row = Math.max(0, Math.round(Number(trackId) || 0));
        if (row >= editSession.trackCount) {
            editSession.trackCount = row + 1;
        }
        const projectFile = path.join(dirPath, 'project.json');
        const raw = JSON.parse(await fs.promises.readFile(projectFile, 'utf8'));
        const clips = Array.isArray(raw && raw.clips) ? raw.clips.slice() : [];
        clips.sort((a, b) => (Number(a.startMs) || 0) - (Number(b.startMs) || 0));
        if (clips.length === 0) {
            throw new Error('Compilation has no clips');
        }
        pushHistory();
        const end = timelineDurationMs(editSession.clips, editSession.audioClips);
        const mediaMap = {};
        let cursor = end;
        for (const clip of clips) {
            const oldId = safeMediaId(clip.mediaId);
            if (!mediaMap[oldId]) {
                const nextId = newId();
                const mediaPath = path.join(dirPath, 'media', `${oldId}.dmx`);
                const fileData = await fs.promises.readFile(mediaPath);
                editSession.media[nextId] = parseRecording(fileData);
                editSession.mediaBytes[nextId] = fileData;
                mediaMap[oldId] = nextId;
            }
            const sourceInMs = Number(clip.sourceInMs) || 0;
            const sourceOutMs = Number(clip.sourceOutMs) || mediaDurationMs(editSession.media[mediaMap[oldId]]);
            const duration = Math.max(0, sourceOutMs - sourceInMs);
            editSession.clips.push({
                id: newId(),
                name: clip.name || 'Look',
                mediaId: mediaMap[oldId],
                trackId: row,
                startMs: cursor,
                sourceInMs,
                sourceOutMs,
                universeOffset: Math.round(Number(clip.universeOffset) || 0),
                channelOffset: Math.round(Number(clip.channelOffset) || 0),
                destIp: typeof clip.destIp === 'string' ? clip.destIp : '',
                fadeInMs: Number(clip.fadeInMs) || 0,
                fadeOutMs: Number(clip.fadeOutMs) || 0,
                fadeCurve: clip.fadeCurve === 'smooth' ? 'smooth' : 'linear',
                libraryPath: typeof clip.libraryPath === 'string' ? clip.libraryPath : ''
            });
            cursor += duration;
        }
        const audioClips = Array.isArray(raw && raw.audioClips) ? raw.audioClips : [];
        for (const clip of audioClips) {
            const nextId = newId();
            const audioPath = path.join(dirPath, 'audio', `${safeMediaId(clip.mediaId)}.wav`);
            const bytes = await fs.promises.readFile(audioPath);
            rememberAudio(nextId, audioPath, bytes);
            const sourceInMs = Number(clip.sourceInMs) || 0;
            const sourceOutMs = Number(clip.sourceOutMs) || editSession.audioMedia[nextId].durationMs;
            editSession.audioClips.push({
                id: newId(),
                name: clip.name || 'Audio',
                mediaId: nextId,
                startMs: end + Math.max(0, Number(clip.startMs) || 0),
                sourceInMs,
                sourceOutMs
            });
        }
        flattenKeepHistory();
        const result = sessionPayload({ playheadMs: playheadClockMs() });
        sendSafe('file-loaded', result);
        return result;
    };

    const loadCompilationPackage = async (dirPath) => {
        const projectFile = path.join(dirPath, 'project.json');
        const raw = JSON.parse(await fs.promises.readFile(projectFile, 'utf8'));
        editSession = emptyEditSession();
        editSession.kind = 'compilation';
        editSession.name = (raw && raw.name) || path.basename(dirPath, '.comp');
        editSession.notes = (raw && raw.notes) || '';
        editSession.projectPath = dirPath;
        const clips = Array.isArray(raw && raw.clips) ? raw.clips : [];
        let cursor = 0;
        for (const clip of clips) {
            safeMediaId(clip.mediaId);
            const mediaPath = path.join(dirPath, 'media', `${clip.mediaId}.dmx`);
            const fileData = await fs.promises.readFile(mediaPath);
            editSession.media[clip.mediaId] = parseRecording(fileData);
            editSession.mediaBytes[clip.mediaId] = fileData;
            const sourceInMs = Number(clip.sourceInMs) || 0;
            const sourceOutMs = Number(clip.sourceOutMs) || mediaDurationMs(editSession.media[clip.mediaId]);
            const duration = Math.max(0, sourceOutMs - sourceInMs);
            const hasStart = clip.startMs != null && clip.startMs !== '';
            const startMs = hasStart ? Math.max(0, Number(clip.startMs) || 0) : cursor;
            editSession.clips.push({
                id: clip.id || newId(),
                name: clip.name || 'Look',
                mediaId: clip.mediaId,
                trackId: Math.max(0, Math.round(Number(clip.trackId) || 0)),
                startMs,
                sourceInMs,
                sourceOutMs,
                universeOffset: Math.round(Number(clip.universeOffset) || 0),
                channelOffset: Math.round(Number(clip.channelOffset) || 0),
                destIp: typeof clip.destIp === 'string' ? clip.destIp : '',
                fadeInMs: Number(clip.fadeInMs) || 0,
                fadeOutMs: Number(clip.fadeOutMs) || 0,
                fadeCurve: clip.fadeCurve === 'smooth' ? 'smooth' : 'linear',
                libraryPath: typeof clip.libraryPath === 'string' ? clip.libraryPath : ''
            });
            cursor = startMs + duration;
        }
        if (editSession.clips.length === 0) {
            throw new Error('Compilation has no clips');
        }
        editSession.trackCount = Math.max(
            Number(raw.trackCount) || 1,
            trackCountOf(editSession.clips, 1)
        );
        editSession.trackNames = normalizeTrackNames(editSession.trackCount, raw.trackNames);
        const audioClips = Array.isArray(raw && raw.audioClips) ? raw.audioClips : [];
        for (const clip of audioClips) {
            const audioPath = path.join(dirPath, 'audio', `${safeMediaId(clip.mediaId)}.wav`);
            const bytes = await fs.promises.readFile(audioPath);
            rememberAudio(clip.mediaId, audioPath, bytes);
            const sourceInMs = Number(clip.sourceInMs) || 0;
            const sourceOutMs = Number(clip.sourceOutMs) || editSession.audioMedia[clip.mediaId].durationMs;
            editSession.audioClips.push({
                id: clip.id || newId(),
                name: clip.name || 'Audio',
                mediaId: clip.mediaId,
                startMs: Math.max(0, Number(clip.startMs) || 0),
                sourceInMs,
                sourceOutMs
            });
        }
        editSession.dirty = false;
        applyFlattenedPlayback();
        const result = sessionPayload({ filePath: dirPath });
        sendSafe('file-loaded', result);
        return result;
    };

    const audioDurationMap = () => {
        const map = {};
        for (const [id, media] of Object.entries(editSession.audioMedia)) {
            map[id] = { durationMs: media.durationMs };
        }
        return map;
    };

    ipcMain.removeHandler('load-recording');
    ipcMain.handle('load-recording', async (event, payload = {}) => {
        try {
            let filePath = payload && payload.filePath;
            if (!filePath) {
                const { filePaths, canceled } = await dialog.showOpenDialog({
                    title: 'Load Recording',
                    filters: [{ name: 'DMX Recordings', extensions: ['dmx'] }],
                    properties: ['openFile']
                });

                if (canceled || !filePaths || !filePaths.length) {
                    const result = { success: false, error: 'No file selected' };
                    sendSafe('file-loaded', result);
                    return result;
                }
                filePath = filePaths[0];
            } else {
                const active = recordingHandler && recordingHandler.getRecordingPath
                    ? recordingHandler.getRecordingPath()
                    : null;
                if (!active || path.resolve(active) !== path.resolve(filePath)) {
                    assertInLibrary(filePath);
                }
            }

            return await loadFromPath(filePath, payload.displayName);
        } catch (error) {
            console.error('Error loading recording:', error);
            stopPlaybackInternal(false);
            playbackData = null;
            const result = { success: false, error: error.message };
            sendSafe('file-loaded', result);
            return result;
        }
    });

    ipcMain.removeHandler('timeline-overview');
    ipcMain.handle('timeline-overview', async (event, payload = {}) => {
        try {
            if (playbackData && playbackData.length && (!payload.filePath || editSession.kind === 'compilation')) {
                const overview = buildTimelineOverviewFromFrames(playbackData, {
                    bucketMs: payload && payload.bucketMs
                });
                return {
                    success: true,
                    ...overview,
                    durationMs: Math.max(overview.durationMs || 0, timelineEndMs()),
                    clips: publicClips(editSession.clips),
                    audioClips: publicClips(editSession.audioClips),
                    audioMedia: audioPayload(),
                    trackCount: Math.max(editSession.trackCount, trackCountOf(editSession.clips, 1)),
                    trackNames: resolvedTrackNames()
                };
            }
            const filePath = payload && payload.filePath;
            if (!filePath) {
                return { success: false, error: 'No file path' };
            }
            const overview = await runFileTask('overview', {
                filePath,
                options: { bucketMs: payload.bucketMs }
            });
            return { success: true, ...overview };
        } catch (error) {
            console.error('Error building timeline overview:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.removeHandler('load-compilation');
    ipcMain.handle('load-compilation', async (event, payload = {}) => {
        try {
            const trackId = Math.max(0, Math.round(Number(payload.trackId) || 0));
            const append = Boolean(payload.append) && canAppendToSession();
            if (payload.dirPath) {
                assertInLibrary(payload.dirPath);
            }
            for (const source of payload.sources || []) {
                if (source && source.filePath) {
                    assertInLibrary(source.filePath);
                }
            }
            if (payload.dirPath) {
                if (append) {
                    return await appendCompilationPackage(payload.dirPath, trackId);
                }
                return await loadCompilationPackage(payload.dirPath);
            }
            if (append) {
                return await appendSources(payload.sources || [], trackId);
            }
            return await loadFromSources(payload.sources || [], payload.name);
        } catch (error) {
            console.error('Error loading compilation:', error);
            stopPlaybackInternal(false);
            playbackData = null;
            editSession = emptyEditSession();
            const result = { success: false, error: error.message };
            sendSafe('file-loaded', result);
            return result;
        }
    });

    ipcMain.removeHandler('inspect-clip');
    ipcMain.handle('inspect-clip', async (event, payload = {}) => {
        try {
            const clip = editSession.clips.find((item) => item.id === payload.clipId);
            if (!clip) {
                throw new Error('Clip not found');
            }
            return { success: true, clip: inspectClip(editSession.media, clip) };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.removeHandler('import-audio');
    ipcMain.handle('import-audio', async (event, payload = {}) => {
        try {
            if (editSession.kind !== 'compilation' || editSession.clips.length === 0) {
                throw new Error('Load a look or compilation first');
            }
            // Audio always comes from the picker; the renderer never names a path.
            let filePath = null;
            {
                const { filePaths, canceled } = await dialog.showOpenDialog({
                    title: 'Import audio',
                    filters: AUDIO_FILTERS,
                    properties: ['openFile']
                });
                if (canceled || !filePaths || !filePaths.length) {
                    return { success: false, error: 'No file selected' };
                }
                filePath = filePaths[0];
            }
            const mediaId = newId();
            const dest = tempWavPath(mediaId);
            await convertToStudioWav(filePath, dest);
            const bytes = await fs.promises.readFile(dest);
            const info = rememberAudio(mediaId, dest, bytes);
            pushHistory();
            const startMs = Math.max(0, Math.round(Number(payload.startMs) || 0));
            editSession.audioClips.push({
                id: newId(),
                name: path.parse(filePath).name || 'Audio',
                mediaId,
                startMs,
                sourceInMs: 0,
                sourceOutMs: info.durationMs
            });
            editSession.dirty = true;
            emitCompilationUpdated();
            return { success: true, dirty: true };
        } catch (error) {
            console.error('Error importing audio:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.removeHandler('edit-compilation');
    ipcMain.handle('edit-compilation', async (event, payload = {}) => {
        try {
            if (editSession.kind !== 'compilation') {
                throw new Error('No compilation is loaded');
            }
            const op = payload.op;
            const target = payload.target === 'audio' ? 'audio' : 'light';
            const lightIds = Array.isArray(payload.clipIds)
                ? payload.clipIds
                : (target !== 'audio' && payload.clipId ? [payload.clipId] : []);
            const audioIds = Array.isArray(payload.audioIds)
                ? payload.audioIds
                : (target === 'audio' && payload.clipId ? [payload.clipId] : []);
            if (op === 'copy') {
                clipClipboard = {
                    light: serializeClips(editSession.clips.filter((clip) => lightIds.includes(clip.id))),
                    audio: serializeAudioClips(editSession.audioClips.filter((clip) => audioIds.includes(clip.id)))
                };
                return {
                    success: true,
                    copied: clipClipboard.light.length + clipClipboard.audio.length
                };
            }
            pushHistory();
            const hadClips = editSession.clips.length > 0;
            if (op === 'trim') {
                if (target === 'audio') {
                    editSession.audioClips = trimClip(
                        editSession.audioClips,
                        payload.clipId,
                        payload.edge,
                        payload.sourceMs,
                        audioDurationMap()
                    );
                } else {
                    editSession.clips = trimClip(
                        editSession.clips,
                        payload.clipId,
                        payload.edge,
                        payload.sourceMs,
                        editSession.media
                    );
                }
            } else if (op === 'split') {
                editSession.clips = splitClips(editSession.clips, payload.timeMs);
                editSession.audioClips = splitClips(editSession.audioClips, payload.timeMs);
            } else if (op === 'move') {
                if (target === 'audio') {
                    editSession.audioClips = moveClip(
                        editSession.audioClips,
                        payload.clipId,
                        payload.startMs,
                        0
                    );
                } else {
                    const nextTrack = Math.max(0, Math.round(Number(payload.trackId) || 0));
                    if (nextTrack >= editSession.trackCount) {
                        editSession.trackCount = nextTrack + 1;
                    }
                    editSession.clips = moveClip(
                        editSession.clips,
                        payload.clipId,
                        payload.startMs,
                        nextTrack
                    );
                }
            } else if (op === 'update') {
                const patch = payload.patch || {};
                if (typeof patch.name === 'string') {
                    const existing = editSession.clips.find((clip) => clip.id === payload.clipId);
                    if (existing && existing.libraryPath) {
                        let nextBase;
                        try {
                            nextBase = sanitizeBaseName(patch.name);
                        } catch (error) {
                            undoStack.pop();
                            throw error;
                        }
                        const currentBase = path.parse(existing.libraryPath).name;
                        if (nextBase !== currentBase) {
                            const dest = path.join(path.dirname(existing.libraryPath), `${nextBase}.dmx`);
                            if (fs.existsSync(dest)) {
                                undoStack.pop();
                                throw new Error('A show with that filename already exists');
                            }
                        }
                    }
                }
                editSession.clips = updateClip(editSession.clips, payload.clipId, patch);
                const renamed = editSession.clips.find((clip) => clip.id === payload.clipId);
                if (
                    renamed
                    && renamed.libraryPath
                    && typeof patch.name === 'string'
                ) {
                    try {
                        assertInLibrary(renamed.libraryPath);
                        writeSidecar(renamed.libraryPath, { name: patch.name });
                        const nextBase = sanitizeBaseName(patch.name);
                        const currentBase = path.parse(renamed.libraryPath).name;
                        if (nextBase !== currentBase) {
                            const dir = path.dirname(renamed.libraryPath);
                            const dest = path.join(dir, `${nextBase}.dmx`);
                            const oldSidecar = path.join(dir, `${currentBase}.json`);
                            const nextSidecar = path.join(dir, `${nextBase}.json`);
                            fs.renameSync(renamed.libraryPath, dest);
                            if (fs.existsSync(oldSidecar)) {
                                fs.renameSync(oldSidecar, nextSidecar);
                            }
                            renamed.libraryPath = dest;
                        }
                        sendSafe('library-updated', listLibrary());
                    } catch (error) {
                        console.error('Error updating look sidecar:', error);
                        throw error;
                    }
                }
            } else if (op === 'add-track') {
                editSession.trackCount += 1;
                editSession.trackNames = normalizeTrackNames(editSession.trackCount, editSession.trackNames);
            } else if (op === 'rename-track') {
                const id = Math.max(0, Math.round(Number(payload.trackId) || 0));
                editSession.trackNames = normalizeTrackNames(editSession.trackCount, editSession.trackNames);
                if (id < editSession.trackNames.length) {
                    const label = String(payload.name || '').trim();
                    editSession.trackNames[id] = label || `Track ${id + 1}`;
                }
            } else if (op === 'reorder-tracks') {
                const from = Math.max(0, Math.round(Number(payload.from) || 0));
                const to = Math.max(0, Math.round(Number(payload.to) || 0));
                const last = Math.max(0, editSession.trackCount - 1);
                if (from !== to && from <= last && to <= last) {
                    editSession.clips = remapTrackOrder(editSession.clips, from, to);
                    editSession.trackNames = moveArrayItem(
                        normalizeTrackNames(editSession.trackCount, editSession.trackNames),
                        from,
                        to
                    );
                }
            } else if (op === 'cut') {
                editSession.clips = rangeCutClips(editSession.clips, payload.fromMs, payload.toMs);
                editSession.audioClips = rangeCutClips(editSession.audioClips, payload.fromMs, payload.toMs);
            } else if (op === 'cut-clips') {
                clipClipboard = {
                    light: serializeClips(editSession.clips.filter((clip) => lightIds.includes(clip.id))),
                    audio: serializeAudioClips(editSession.audioClips.filter((clip) => audioIds.includes(clip.id)))
                };
                editSession.clips = removeClipsById(editSession.clips, lightIds);
                editSession.audioClips = removeClipsById(editSession.audioClips, audioIds);
            } else if (op === 'delete') {
                editSession.clips = removeClipsById(editSession.clips, lightIds);
                editSession.audioClips = removeClipsById(editSession.audioClips, audioIds);
            } else if (op === 'paste') {
                if (!clipClipboard.light.length && !clipClipboard.audio.length) {
                    undoStack.pop();
                    throw new Error('Clipboard is empty');
                }
                const at = Number(payload.timeMs);
                const bump = pasteNeedsBump(editSession.clips, clipClipboard.light, at) ? 1 : 0;
                const pastedLight = cloneClipsToPlayhead(
                    clipClipboard.light,
                    clipClipboard.light.map((clip) => clip.id),
                    at,
                    bump
                );
                const pastedAudio = cloneClipsToPlayhead(
                    clipClipboard.audio,
                    clipClipboard.audio.map((clip) => clip.id),
                    at,
                    0
                );
                if (!pastedLight.length && !pastedAudio.length) {
                    throw new Error('Clipboard is empty');
                }
                editSession.clips = [...editSession.clips, ...pastedLight];
                editSession.audioClips = [...editSession.audioClips, ...pastedAudio];
            } else if (op === 'close-gap') {
                const next = closeGap(
                    editSession.clips,
                    editSession.audioClips,
                    payload.gapLeft,
                    payload.gapRight
                );
                editSession.clips = next.clips;
                editSession.audioClips = next.audioClips;
            } else {
                throw new Error('Unknown edit');
            }
            if (hadClips && editSession.clips.length === 0 && op !== 'delete') {
                const prev = undoStack.pop();
                if (prev) {
                    editSession.clips = prev.clips;
                    editSession.audioClips = prev.audioClips;
                    editSession.trackCount = prev.trackCount;
                    editSession.trackNames = prev.trackNames;
                }
                throw new Error('That edit would remove every clip');
            }
            syncTracks();
            editSession.dirty = true;
            const keepMs = Number(payload.keepPlayheadMs);
            playbackData = flattenToFrames(editSession.media, editSession.clips);
            const seekOps = {
                trim: true,
                split: true,
                move: true,
                cut: true,
                'cut-clips': true,
                delete: true,
                paste: true,
                'close-gap': true,
                update: true
            };
            if (Number.isFinite(keepMs) && seekOps[op] && playbackData && playbackData.length) {
                applySeek(keepMs);
            }
            emitCompilationUpdated();
            return { success: true, dirty: editSession.dirty };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.removeHandler('undo-compilation');
    ipcMain.handle('undo-compilation', async () => {
        try {
            if (!undoStack.length) {
                return { success: false, error: 'Nothing to undo' };
            }
            redoStack.push(snapshotEdl());
            if (redoStack.length > HISTORY_CAP) {
                redoStack.shift();
            }
            restoreEdl(undoStack.pop());
            emitCompilationUpdated();
            return { success: true, dirty: editSession.dirty };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.removeHandler('redo-compilation');
    ipcMain.handle('redo-compilation', async () => {
        try {
            if (!redoStack.length) {
                return { success: false, error: 'Nothing to redo' };
            }
            undoStack.push(snapshotEdl());
            if (undoStack.length > HISTORY_CAP) {
                undoStack.shift();
            }
            restoreEdl(redoStack.pop());
            emitCompilationUpdated();
            return { success: true, dirty: editSession.dirty };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.removeHandler('confirm-unsaved-compilation');
    ipcMain.handle('confirm-unsaved-compilation', async (event, payload = {}) => {
        const win = event && event.sender
            ? BrowserWindow.fromWebContents(event.sender)
            : null;
        const reason = payload && payload.reason === 'leave' ? 'leave' : 'new';
        const options = {
            type: 'question',
            buttons: ['Save', "Don't Save", 'Cancel'],
            defaultId: 0,
            cancelId: 2,
            title: 'Unsaved compilation',
            message: 'The compilation has unsaved changes.',
            detail: reason === 'leave'
                ? 'Save it before leaving Studio?'
                : 'Save it before clearing Studio?'
        };
        const result = win
            ? await dialog.showMessageBox(win, options)
            : await dialog.showMessageBox(options);
        const choice = result.response === 0
            ? 'save'
            : (result.response === 1 ? 'discard' : 'cancel');
        return { choice };
    });

    ipcMain.removeHandler('save-compilation');
    ipcMain.handle('save-compilation', async (event, payload = {}) => {
        try {
            if (editSession.kind !== 'compilation' || editSession.clips.length === 0) {
                throw new Error('No compilation is loaded');
            }
            const dir = ensureLibrary();
            const name = sanitizeBaseName(payload.name || editSession.name || 'Stack');
            let dest = editSession.projectPath;
            if (!dest || !fs.existsSync(dest)) {
                dest = uniqueCompPath(dir, name);
            }
            fs.mkdirSync(path.join(dest, 'media'), { recursive: true });
            fs.mkdirSync(path.join(dest, 'audio'), { recursive: true });
            const mediaIds = new Set(editSession.clips.map((clip) => clip.mediaId));
            for (const mediaId of mediaIds) {
                const mediaPath = path.join(dest, 'media', `${safeMediaId(mediaId)}.dmx`);
                if (editSession.mediaBytes[mediaId]) {
                    fs.writeFileSync(mediaPath, editSession.mediaBytes[mediaId]);
                } else {
                    writeRecording(mediaPath, editSession.media[mediaId] || []);
                }
            }
            const audioIds = new Set(editSession.audioClips.map((clip) => clip.mediaId));
            for (const mediaId of audioIds) {
                const audioPath = path.join(dest, 'audio', `${safeMediaId(mediaId)}.wav`);
                if (editSession.audioBytes[mediaId]) {
                    fs.writeFileSync(audioPath, editSession.audioBytes[mediaId]);
                } else if (editSession.audioMedia[mediaId] && editSession.audioMedia[mediaId].filePath) {
                    fs.copyFileSync(editSession.audioMedia[mediaId].filePath, audioPath);
                }
                if (editSession.audioMedia[mediaId]) {
                    editSession.audioMedia[mediaId].filePath = audioPath;
                }
            }
            const project = {
                version: 1,
                kind: 'compilation',
                name,
                notes: typeof payload.notes === 'string' ? payload.notes : editSession.notes,
                trackCount: Math.max(editSession.trackCount, trackCountOf(editSession.clips, 1)),
                trackNames: resolvedTrackNames(),
                clips: serializeClips(editSession.clips),
                audioClips: serializeAudioClips(editSession.audioClips)
            };
            fs.writeFileSync(path.join(dest, 'project.json'), `${JSON.stringify(project, null, 2)}\n`);
            editSession.name = name;
            editSession.projectPath = dest;
            editSession.dirty = false;
            sendSafe('library-updated', listLibrary());
            const result = sessionPayload({
                filePath: dest,
                playheadMs: playheadClockMs()
            });
            sendSafe('file-loaded', result);
            return result;
        } catch (error) {
            console.error('Error saving compilation:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.removeHandler('export-flattened');
    ipcMain.handle('export-flattened', async (event, payload = {}) => {
        try {
            const frames = flattenToFrames(editSession.media, editSession.clips, { ignoreDest: true });
            if (!frames.length) {
                throw new Error('Nothing to export');
            }
            const dir = ensureLibrary();
            const name = sanitizeBaseName(payload.name || `${editSession.name || 'Stack'} flat`);
            const filePath = uniqueDmxPath(dir, name);
            writeRecording(filePath, frames);
            writeSidecar(filePath, { name, notes: payload.notes || '' });
            sendSafe('library-updated', listLibrary());
            return { success: true, filePath };
        } catch (error) {
            console.error('Error exporting flattened recording:', error);
            return { success: false, error: error.message };
        }
    });

    const stopPunchTimer = () => {
        if (punchTimer) {
            clearInterval(punchTimer);
            punchTimer = null;
        }
    };

    const ensureCompilationSession = () => {
        if (editSession.kind === 'compilation') {
            return false;
        }
        editSession = emptyEditSession();
        editSession.kind = 'compilation';
        editSession.name = 'Untitled';
        editSession.trackCount = 1;
        editSession.trackNames = ['Track 1'];
        playbackData = [];
        undoStack = [];
        redoStack = [];
        return true;
    };

    const bumpPunchTrack = (endMs) => {
        if (!punchIn) {
            return;
        }
        let guard = 0;
        while (
            trackHasOverlap(editSession.clips, punchIn.trackId, punchIn.startMs, endMs)
            && guard < 64
        ) {
            punchIn.trackId += 1;
            if (punchIn.trackId >= editSession.trackCount) {
                editSession.trackCount = punchIn.trackId + 1;
                editSession.trackNames = normalizeTrackNames(
                    editSession.trackCount,
                    editSession.trackNames
                );
            }
            guard += 1;
        }
    };

    const tickPunchIn = () => {
        if (!punchIn || !recordingHandler || !recordingHandler.isRecording()) {
            return;
        }
        const elapsed = recordingHandler.getElapsedMs();
        const endMs = punchIn.startMs + elapsed;
        bumpPunchTrack(Math.max(endMs, punchIn.startMs + 1));
        const looked = lookAt(endMs);
        const blended = omitTriggerChannel(
            blendLookAtWithLive(looked, punchIn.liveByKey),
            looked,
            triggerOmit
        );
        for (const frame of blended) {
            outputFrame(frame, false);
        }
        if (!studioVisible()) {
            return;
        }
        const now = Date.now();
        if (now - lastPunchProgressAt < 100) {
            return;
        }
        lastPunchProgressAt = now;
        sendSafe('punch-in-progress', {
            startMs: punchIn.startMs,
            trackId: punchIn.trackId,
            durationMs: elapsed,
            trackCount: editSession.trackCount,
            trackNames: resolvedTrackNames()
        });
    };

    const handleLivePunchFrame = (frame, timestamp) => {
        if (!punchIn) {
            return;
        }
        punchIn.liveByKey.set(liveFrameKey(frame), {
            protocol: frame.protocol === 'sacn' ? 'sacn' : 'artnet',
            universe: Number(frame.universe) || 0,
            destIp: '',
            data: frame.data || ZERO_DMX,
            timestamp
        });
    };

    const stopWatchTimer = () => {
        if (watchTimer) {
            clearInterval(watchTimer);
            watchTimer = null;
        }
    };

    const clearRecordWatch = () => {
        stopWatchTimer();
        recordWatch = null;
        triggerOmit = null;
        if (recordingHandler && recordingHandler.setSuppressChannel) {
            recordingHandler.setSuppressChannel(null);
        }
    };

    const clearPunchIn = ({ deleteTemp = false } = {}) => {
        stopPunchTimer();
        lastPunchProgressAt = 0;
        clearRecordWatch();
        if (recordingHandler && recordingHandler.isRecording && recordingHandler.isRecording()) {
            recordingHandler.stop({ emitSaved: false });
        }
        if (deleteTemp && punchIn && punchIn.tempPath && fs.existsSync(punchIn.tempPath)) {
            try {
                fs.unlinkSync(punchIn.tempPath);
            } catch (error) {
                console.error('Error removing punch-in temp:', error);
            }
        }
        punchIn = null;
        if (recordingHandler && recordingHandler.setOnLiveFrame) {
            recordingHandler.setOnLiveFrame(null);
        }
    };

    const openPunchFile = (request = {}) => {
        if (!recordingHandler || !recordingHandler.start) {
            throw new Error('Recording is unavailable');
        }
        if (recordingHandler.isRecording()) {
            throw new Error('Already recording');
        }
        const config = request.config || normalizeTriggerConfig(request);
        isPlaying = false;
        isPaused = false;
        clearPlayTimeout();
        stopHoldOutput();
        const created = ensureCompilationSession();
        let trackId = Math.max(0, Math.round(Number(request.trackId) || 0));
        const startMs = Math.max(0, Math.round(Number(request.startMs) || 0));
        if (trackId >= editSession.trackCount) {
            editSession.trackCount = trackId + 1;
        }
        syncTracks();
        const tempPath = path.join(
            os.tmpdir(),
            `dmxwhip-punch-${process.pid}-${Date.now()}.dmx`
        );
        punchIn = {
            startMs,
            trackId,
            tempPath,
            liveByKey: new Map()
        };
        bumpPunchTrack(startMs + 1);
        if (recordingHandler.setSuppressChannel) {
            recordingHandler.setSuppressChannel(config.startChannel);
        }
        triggerOmit = config.startChannel;
        const started = recordingHandler.start(tempPath);
        if (!started || !started.success) {
            clearPunchIn({ deleteTemp: true });
            throw new Error((started && started.error) || 'Could not start recording');
        }
        punchIn.tempPath = started.filePath || tempPath;
        recordingHandler.setOnLiveFrame(handleLivePunchFrame);
        const senderPromise = initializeSenders(request.playbackNetwork || activeNetwork, { forceSacn: true });
        lastPunchProgressAt = 0;
        stopPunchTimer();
        punchTimer = setInterval(tickPunchIn, 40);
        tickPunchIn();
        pausedElapsed = startMs;
        emitStats({
            isPlaying: false,
            isPaused: false,
            playheadMs: startMs
        });
        const result = sessionPayload({
            created,
            punchInStartMs: startMs,
            punchTrackId: punchIn.trackId
        });
        if (created) {
            sendSafe('file-loaded', result);
        }
        return { result, senderPromise };
    };

    const startWatchTimer = () => {
        stopWatchTimer();
        if (!recordWatch) {
            return;
        }
        const mode = recordWatch.config.stopMode;
        if (mode !== 'signal-cut' && mode !== 'blackout') {
            return;
        }
        watchTimer = setInterval(() => {
            if (!recordWatch || punchStopLock) {
                return;
            }
            if (pollStop(recordWatch, Date.now()) === 'stop') {
                finishPunchIn({ notify: true });
            }
        }, 200);
    };

    const finishPunchIn = ({ notify = false } = {}) => {
        if (punchStopLock) {
            return punchStopLock;
        }
        const run = (async () => {
            try {
                if (!punchIn || !recordingHandler) {
                    throw new Error('Not recording');
                }
                stopWatchTimer();
                recordWatch = null;
                const take = punchIn;
                stopPunchTimer();
                if (recordingHandler.setOnLiveFrame) {
                    recordingHandler.setOnLiveFrame(null);
                }
                if (recordingHandler.setSuppressChannel) {
                    recordingHandler.setSuppressChannel(null);
                }
                triggerOmit = null;
                const stopped = recordingHandler.stop({ emitSaved: false });
                const filePath = (stopped && stopped.filePath) || take.tempPath;
                punchIn = null;
                cleanupSenders();
                if (!stopped || !stopped.success || !stopped.totalFrames) {
                    if (filePath && fs.existsSync(filePath)) {
                        try {
                            fs.unlinkSync(filePath);
                        } catch (error) {
                            console.error('Error removing empty punch-in:', error);
                        }
                    }
                    throw new Error('Nothing was recorded');
                }
                const fileData = await fs.promises.readFile(filePath);
                const libraryPath = uniqueDmxPath(ensureLibrary(), formatLookTimestamp());
                const lookName = path.parse(libraryPath).name;
                fs.writeFileSync(libraryPath, fileData);
                writeSidecar(libraryPath, { name: lookName, notes: '' });
                pushHistory();
                const added = addMediaFromBuffer(fileData, lookName, take.startMs, take.trackId, {
                    libraryPath
                });
                try {
                    fs.unlinkSync(filePath);
                } catch (error) {
                    console.error('Error removing punch-in temp:', error);
                }
                sendSafe('library-updated', listLibrary());
                syncTracks();
                editSession.dirty = true;
                playbackData = flattenToFrames(editSession.media, editSession.clips);
                const endMs = take.startMs + mediaDurationMs(editSession.media[added.mediaId] || []);
                if (playbackData && playbackData.length) {
                    applySeek(endMs);
                } else {
                    pausedElapsed = endMs;
                }
                const result = sessionPayload({
                    namingClipId: added.clipId,
                    playheadMs: endMs
                });
                sendSafe('compilation-updated', {
                    ...result,
                    namingClipId: added.clipId
                });
                if (notify) {
                    sendSafe('punch-in-auto-stopped', result);
                }
                return result;
            } catch (error) {
                console.error('Error stopping punch-in:', error);
                clearPunchIn({ deleteTemp: true });
                const failure = { success: false, error: error.message };
                if (notify) {
                    sendSafe('punch-in-failed', failure);
                }
                return failure;
            } finally {
                punchStopLock = null;
            }
        })();
        punchStopLock = run;
        return run;
    };

    const handleTriggerFrame = (frame, meta) => {
        if (!recordWatch || punchStopLock) {
            return;
        }
        const selected = Boolean(meta && meta.selected);
        const now = Date.now();
        if (recordWatch.phase === 'armed') {
            if (feedArmed(recordWatch, frame, selected) !== 'start') {
                return;
            }
            const request = recordWatch.payload;
            beginRecordingWatch(recordWatch, frame, selected, now);
            try {
                const opened = openPunchFile(request);
                sendSafe('punch-in-started', opened.result);
                startWatchTimer();
                opened.senderPromise.catch((error) => {
                    console.error('Error opening punch-in output:', error);
                });
            } catch (error) {
                console.error('Error starting triggered recording:', error);
                clearPunchIn({ deleteTemp: true });
                sendSafe('punch-in-failed', { error: error.message });
            }
            return;
        }
        if (feedRecording(recordWatch, frame, selected, now) === 'stop') {
            finishPunchIn({ notify: true });
        }
    };

    if (recordingHandler && recordingHandler.setObserver) {
        recordingHandler.setObserver({
            wantsObserve: () => Boolean(
                recordWatch
                && (recordWatch.phase === 'armed' || recordWatch.config.stopMode !== 'none')
            ),
            watchesUniverse: (protocol, universe) => {
                if (!recordWatch) {
                    return false;
                }
                const spec = recordWatch.phase === 'recording'
                    ? recordWatch.config.stopChannel
                    : recordWatch.config.startChannel;
                if (!spec) {
                    return false;
                }
                const proto = protocol === 'sacn' ? 'sacn' : 'artnet';
                return spec.protocol === proto && spec.universe === (Number(universe) || 0);
            },
            observe: handleTriggerFrame
        });
    }

    ipcMain.removeHandler('start-punch-in');
    ipcMain.handle('start-punch-in', async (event, payload = {}) => {
        try {
            if (!recordingHandler || !recordingHandler.start) {
                throw new Error('Recording is unavailable');
            }
            if (recordingHandler.isRecording()) {
                throw new Error('Already recording');
            }
            if (recordWatch && recordWatch.phase === 'armed') {
                throw new Error('Already waiting for a trigger');
            }
            const config = normalizeTriggerConfig(payload);
            const request = {
                trackId: payload.trackId,
                startMs: payload.startMs,
                playbackNetwork: payload.playbackNetwork,
                config
            };
            if (config.startMode === 'none') {
                const opened = openPunchFile(request);
                if (config.stopMode !== 'none') {
                    recordWatch = createWatch(config, Date.now());
                    beginRecordingWatch(recordWatch, null, false, Date.now());
                    startWatchTimer();
                }
                try {
                    await opened.senderPromise;
                } catch (error) {
                    clearPunchIn({ deleteTemp: true });
                    cleanupSenders();
                    throw error;
                }
                return opened.result;
            }
            recordWatch = createWatch(config, Date.now());
            recordWatch.payload = request;
            return { success: true, armed: true };
        } catch (error) {
            console.error('Error starting punch-in:', error);
            const kept = error.message === 'Already recording'
                || error.message === 'Already waiting for a trigger'
                || error.message === 'Recording is unavailable';
            if (!kept) {
                clearPunchIn({ deleteTemp: true });
            }
            return { success: false, error: error.message };
        }
    });

    ipcMain.removeHandler('stop-punch-in');
    ipcMain.handle('stop-punch-in', async () => finishPunchIn({ notify: false }));

    ipcMain.removeHandler('cancel-punch-in');
    ipcMain.handle('cancel-punch-in', async () => {
        try {
            if (recordingHandler && recordingHandler.isRecording()) {
                recordingHandler.stop({ emitSaved: false });
            }
            clearPunchIn({ deleteTemp: true });
            cleanupSenders();
            return { success: true };
        } catch (error) {
            clearPunchIn({ deleteTemp: true });
            return { success: false, error: error.message };
        }
    });

    const onSetLoop = (event, payload = {}) => {
        loopEnabled = Boolean(payload.loop);
    };
    ipcMain.on('set-playback-loop', onSetLoop);

    const onToggle = async (event, { loop, playbackNetwork, source } = {}) => {
        const wanted = source === 'player' ? 'player' : 'studio';
        if (wanted === 'player' && (!playerData || playerData.length === 0)) {
            return;
        }
        if (wanted === 'studio' && (!playbackData || playbackData.length === 0)) {
            return;
        }

        loopEnabled = Boolean(loop);

        if (activeSource !== wanted) {
            if (isPlaying || isPaused) {
                emitStats({
                    source: activeSource,
                    isPlaying: false,
                    isPaused: false,
                    isReset: activeSource === 'player'
                });
            }
            haltTransport({ cleanup: true });
            activeSource = wanted;
        }

        if (isPaused) {
            stopHoldOutput();
            isPaused = false;
            isPlaying = true;
            playbackOriginNs = process.hrtime.bigint() - BigInt(pausedElapsed) * 1000000n;
            scheduleTick();
            emitStats();
            return;
        }

        if (isPlaying) {
            pausedElapsed = elapsedMs();
            isPlaying = false;
            isPaused = true;
            clearPlayTimeout();
            holdFrames = lookAt(pausedElapsed);
            startHoldOutput();
            emitStats();
            return;
        }

        if (startingPlayback) {
            return;
        }
        startingPlayback = true;
        try {
            await beginPlayback(playbackNetwork, pausedElapsed);
        } catch (error) {
            console.error('Error starting playback:', error);
            stopPlaybackInternal(false);
        } finally {
            startingPlayback = false;
        }
    };
    ipcMain.on('toggle-playback', onToggle);

    const onSeek = async (event, payload = {}) => {
        const wanted = payload.source === 'player' ? 'player' : 'studio';
        if (wanted !== activeSource) {
            return;
        }
        if (!activeFrames() || activeFrames().length === 0) {
            return;
        }

        const token = ++seekToken;
        try {
            if (payload.loop !== undefined) {
                loopEnabled = Boolean(payload.loop);
            }
            await ensureSenders(payload.playbackNetwork);
            if (token !== seekToken) {
                return;
            }
            const t = applySeek(payload.timeMs);
            if (!isPlaying) {
                isPaused = true;
                startHoldOutput();
            }
            emitStats({ playheadMs: t });
        } catch (error) {
            console.error('Error seeking playback:', error);
        }
    };
    ipcMain.on('seek-playback', onSeek);

    const onStop = (event, payload = {}) => {
        if (payload && payload.source && payload.source !== activeSource) {
            return;
        }
        stopPlaybackInternal(false);
    };
    ipcMain.on('stop-playback', onStop);

    ipcMain.removeHandler('player-play');
    ipcMain.handle('player-play', async (event, { filePath, playbackNetwork, loop } = {}) => {
        try {
            if (recordingHandler && recordingHandler.isRecording()) {
                return { success: false, error: 'Recording in progress' };
            }
            assertInLibrary(filePath);
            const fileData = await fs.promises.readFile(filePath);
            const frames = parseRecording(fileData);
            if (!frames.length) {
                return { success: false, error: 'Recording is empty' };
            }
            if (activeSource === 'studio' && (isPlaying || isPaused)) {
                emitStats({
                    source: 'studio',
                    isPlaying: false,
                    isPaused: false,
                    playheadMs: playheadClockMs()
                });
            }
            haltTransport({ cleanup: true });
            playerData = frames;
            activeSource = 'player';
            loopEnabled = Boolean(loop);
            pausedElapsed = 0;
            await beginPlayback(playbackNetwork || activeNetwork, 0);
            return {
                success: true,
                filePath,
                durationMs: frames[frames.length - 1].timestamp,
                displayName: path.parse(filePath).name
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    const onUnload = () => {
        if (recordingHandler && recordingHandler.isRecording()) {
            recordingHandler.stop({ emitSaved: false });
        }
        clearPunchIn({ deleteTemp: true });
        stopPlaybackInternal(false);
        playbackData = null;
        playerData = null;
        activeSource = 'studio';
        editSession = emptyEditSession();
        sendSafe('file-loaded', { success: true, filePath: null, cleared: true });
        undoStack = [];
        redoStack = [];
        clipClipboard = { light: [], audio: [] };
    };
    ipcMain.on('unload-recording', onUnload);

    const HANDLED = [
        'load-recording', 'timeline-overview', 'load-compilation', 'inspect-clip',
        'import-audio', 'edit-compilation', 'undo-compilation', 'redo-compilation',
        'confirm-unsaved-compilation', 'save-compilation', 'export-flattened',
        'start-punch-in', 'stop-punch-in', 'cancel-punch-in', 'player-play'
    ];

    const close = () => {
        clearPunchIn({ deleteTemp: true });
        haltTransport({ cleanup: true });
        liveOutput.attachPlayback(null);
        HANDLED.forEach((channel) => ipcMain.removeHandler(channel));
        ipcMain.removeListener('set-playback-loop', onSetLoop);
        ipcMain.removeListener('toggle-playback', onToggle);
        ipcMain.removeListener('seek-playback', onSeek);
        ipcMain.removeListener('stop-playback', onStop);
        ipcMain.removeListener('unload-recording', onUnload);
        if (recordingHandler && recordingHandler.setObserver) {
            recordingHandler.setObserver(null);
        }
    };

    return { resolveAudioPath, close };
}

module.exports = setupPlaybackHandlers;
