const { ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const ArtNetSender = require('../../services/artnet/sender');
const { SacnOutput } = require('../../services/sacn/output');
const { parseRecording, writeRecording } = require('../../services/shared/dmxRecording');
const {
    buildTimelineOverview,
    buildTimelineOverviewFromFrames
} = require('../../services/shared/timelineOverview');
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
    inspectClip
} = require('../../services/shared/compilationEdl');
const { describeWav } = require('../../services/shared/audioWav');
const { convertToStudioWav, tempWavPath } = require('../audioConvert');
const {
    ensureLibrary,
    uniqueDmxPath,
    uniqueCompPath,
    writeSidecar,
    sanitizeBaseName,
    listLibrary
} = require('./library');

const IMMEDIATE_MS = 4;
const AUDIO_FILTERS = [
    { name: 'Audio', extensions: ['wav', 'aiff', 'aif', 'mp3', 'm4a', 'flac', 'ogg'] }
];

function setupPlaybackHandlers(mainWindow) {
    let playbackData = null;
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
            audioClips: [],
            audioMedia: {},
            audioBytes: {}
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

    const elapsedMs = () => Number((process.hrtime.bigint() - playbackOriginNs) / 1000000n);

    const playheadClockMs = () => (isPlaying ? elapsedMs() : pausedElapsed);

    const firstFrameAfter = (timeMs) => {
        if (!playbackData) {
            return 0;
        }
        let lo = 0;
        let hi = playbackData.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (playbackData[mid].timestamp <= timeMs) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        return lo;
    };

    const lookAt = (timeMs) => {
        const latest = new Map();
        if (!playbackData) {
            return [];
        }
        for (const frame of playbackData) {
            if (frame.timestamp > timeMs) {
                break;
            }
            latest.set(`${frame.protocol}:${frame.universe}:${frame.destIp || ''}`, frame);
        }
        return [...latest.values()];
    };

    const sacnUniversesInClip = () => {
        const universes = new Set();
        if (!playbackData) {
            return [];
        }
        for (const frame of playbackData) {
            if (frame.protocol === 'sacn') {
                universes.add(frame.universe);
            }
        }
        return [...universes];
    };

    const cleanupSenders = () => {
        if (discoveryInterval) {
            clearInterval(discoveryInterval);
            discoveryInterval = null;
        }
        if (artnetSender) {
            artnetSender.stop();
            artnetSender = null;
        }
        if (sacnOutput) {
            sacnOutput.close();
            sacnOutput = null;
        }
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
            totalFrames: playbackData ? playbackData.length : 0,
            clipTime: lastTimestamp,
            totalPlayTime: isPlaying ? elapsedMs() : pausedElapsed,
            playheadMs: playheadClockMs(),
            fps: framesSentWindow.length,
            isPlaying,
            isPaused,
            loop: loopEnabled,
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

    const initializeSenders = async (playbackNetwork) => {
        cleanupSenders();
        activeNetwork = playbackNetwork || '0.0.0.0';

        artnetSender = new ArtNetSender();
        await artnetSender.start(activeNetwork);

        const universes = sacnUniversesInClip();
        if (universes.length > 0) {
            sacnOutput = new SacnOutput({
                sourceName: 'DMX whIP Playback',
                iface: activeNetwork
            });
            await sacnOutput.start();
            for (const universe of universes) {
                sacnOutput.ensureSender(universe);
            }
            await sacnOutput.ready();
            sendDiscovery();
            discoveryInterval = setInterval(sendDiscovery, 10000);
        }
    };

    const ensureSenders = async (playbackNetwork) => {
        if (artnetSender) {
            return;
        }
        await initializeSenders(playbackNetwork || activeNetwork);
    };

    const outputFrame = (frame, countFps) => {
        lastSentFrame = frame;
        if (countFps) {
            framesSentWindow.push(Date.now());
        }
        if (frame.protocol === 'artnet') {
            if (artnetSender) {
                artnetSender.send(frame.universe, frame.data, frame.destIp).catch((err) => {
                    console.error('Art-Net playback send error:', err);
                });
            }
            return;
        }
        if (sacnOutput) {
            sacnOutput.send(frame.universe, frame.data, frame.destIp);
        }
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
        if (waitMs < IMMEDIATE_MS) {
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

    const scheduleTick = () => {
        clearPlayTimeout();
        if (!isPlaying || !playbackData) {
            return;
        }

        const elapsed = elapsedMs();
        while (
            currentPlaybackFrame < playbackData.length &&
            playbackData[currentPlaybackFrame].timestamp <= elapsed
        ) {
            sendFrame(playbackData[currentPlaybackFrame]);
            currentPlaybackFrame += 1;
        }

        const now = Date.now();
        if (now - lastStatsSent >= 100) {
            lastStatsSent = now;
            emitStats();
        }

        if (elapsed >= timelineEndMs()) {
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

        if (currentPlaybackFrame >= playbackData.length) {
            const remaining = timelineEndMs() - elapsed;
            armTick(Math.min(100, Math.max(16, remaining)));
            return;
        }

        const wait = playbackData[currentPlaybackFrame].timestamp - elapsed;
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
        const duration = timelineEndMs();
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
        isPlaying = false;
        isPaused = false;
        clearPlayTimeout();
        stopHoldOutput();
        currentPlaybackFrame = 0;
        lastSentFrame = null;
        holdFrames = [];
        framesSentWindow = [];
        cleanupSenders();
        if (naturalEnd) {
            pausedElapsed = endedAt;
            emitStats({
                isPlaying: false,
                isPaused: false,
                fps: 0,
                currentFrame: playbackData ? playbackData.length : 0,
                totalPlayTime: endedAt,
                playheadMs: endedAt
            });
            return;
        }
        pausedElapsed = 0;
        emitStats({
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
        audioMedia: publicAudioMedia(),
        trackCount: Math.max(editSession.trackCount, trackCountOf(editSession.clips, 1)),
        dirty: editSession.dirty,
        skipped: editSession.skipped,
        ...extra
    });

    const applyFlattenedPlayback = () => {
        playbackData = flattenToFrames(editSession.media, editSession.clips);
        stopPlaybackInternal(false);
    };

    const emitCompilationUpdated = () => {
        sendSafe('compilation-updated', {
            clips: publicClips(editSession.clips),
            audioClips: publicClips(editSession.audioClips),
            audioMedia: publicAudioMedia(),
            trackCount: Math.max(editSession.trackCount, trackCountOf(editSession.clips, 1)),
            dirty: editSession.dirty,
            name: editSession.name,
            projectPath: editSession.projectPath,
            frameCount: playbackData ? playbackData.length : 0,
            durationMs: timelineEndMs()
        });
    };

    const addMediaFromBuffer = (fileData, name, startMs) => {
        const frames = parseRecording(fileData);
        const mediaId = newId();
        editSession.media[mediaId] = frames;
        editSession.mediaBytes[mediaId] = fileData;
        const duration = mediaDurationMs(frames);
        const start = startMs != null ? startMs : timelineDurationMs(editSession.clips);
        editSession.clips.push({
            id: newId(),
            name: name || 'Look',
            mediaId,
            trackId: 0,
            startMs: start,
            sourceInMs: 0,
            sourceOutMs: duration,
            universeOffset: 0,
            channelOffset: 0,
            destIp: ''
        });
        return mediaId;
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
                destIp: typeof clip.destIp === 'string' ? clip.destIp : ''
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
        const audioClips = Array.isArray(raw && raw.audioClips) ? raw.audioClips : [];
        for (const clip of audioClips) {
            const audioPath = path.join(dirPath, 'audio', `${clip.mediaId}.wav`);
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
                    audioMedia: publicAudioMedia(),
                    trackCount: Math.max(editSession.trackCount, trackCountOf(editSession.clips, 1))
                };
            }
            const filePath = payload && payload.filePath;
            if (!filePath) {
                return { success: false, error: 'No file path' };
            }
            const overview = buildTimelineOverview(filePath, {
                bucketMs: payload.bucketMs
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
            if (payload.dirPath) {
                return await loadCompilationPackage(payload.dirPath);
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
            let filePath = payload && payload.filePath;
            if (!filePath) {
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
            return {
                success: true,
                audioClips: publicClips(editSession.audioClips),
                audioMedia: publicAudioMedia(),
                dirty: true
            };
        } catch (error) {
            console.error('Error importing audio:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.removeHandler('edit-compilation');
    ipcMain.handle('edit-compilation', async (event, payload = {}) => {
        try {
            if (editSession.kind !== 'compilation' || editSession.clips.length === 0) {
                throw new Error('No compilation is loaded');
            }
            const op = payload.op;
            const target = payload.target === 'audio' ? 'audio' : 'light';
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
                editSession.clips = updateClip(editSession.clips, payload.clipId, payload.patch || {});
            } else if (op === 'add-track') {
                editSession.trackCount += 1;
            } else if (op === 'cut') {
                editSession.clips = rangeCutClips(editSession.clips, payload.fromMs, payload.toMs);
                editSession.audioClips = rangeCutClips(editSession.audioClips, payload.fromMs, payload.toMs);
            } else {
                throw new Error('Unknown edit');
            }
            if (editSession.clips.length === 0) {
                throw new Error('That edit would remove every clip');
            }
            editSession.trackCount = Math.max(editSession.trackCount, trackCountOf(editSession.clips, 1));
            editSession.dirty = true;
            const keepMs = Number(payload.keepPlayheadMs);
            playbackData = flattenToFrames(editSession.media, editSession.clips);
            if (Number.isFinite(keepMs)) {
                applySeek(keepMs);
            }
            emitCompilationUpdated();
            return sessionPayload();
        } catch (error) {
            return { success: false, error: error.message };
        }
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
                const mediaPath = path.join(dest, 'media', `${mediaId}.dmx`);
                if (editSession.mediaBytes[mediaId]) {
                    fs.writeFileSync(mediaPath, editSession.mediaBytes[mediaId]);
                } else {
                    writeRecording(mediaPath, editSession.media[mediaId] || []);
                }
            }
            const audioIds = new Set(editSession.audioClips.map((clip) => clip.mediaId));
            for (const mediaId of audioIds) {
                const audioPath = path.join(dest, 'audio', `${mediaId}.wav`);
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
                clips: serializeClips(editSession.clips),
                audioClips: serializeAudioClips(editSession.audioClips)
            };
            fs.writeFileSync(path.join(dest, 'project.json'), `${JSON.stringify(project, null, 2)}\n`);
            editSession.name = name;
            editSession.projectPath = dest;
            editSession.dirty = false;
            sendSafe('library-updated', listLibrary());
            const result = sessionPayload({ filePath: dest });
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

    ipcMain.on('toggle-playback', async (event, { loop, playbackNetwork } = {}) => {
        if (!playbackData || playbackData.length === 0) {
            return;
        }

        loopEnabled = Boolean(loop);

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

        try {
            let startMs = pausedElapsed;
            const duration = timelineEndMs();
            if (startMs >= duration) {
                startMs = 0;
            }
            currentPlaybackFrame = startMs > 0 ? firstFrameAfter(startMs) : 0;
            lastSentFrame = null;
            framesSentWindow = [];
            await initializeSenders(playbackNetwork);
            isPlaying = true;
            isPaused = false;
            playbackOriginNs = process.hrtime.bigint() - BigInt(startMs) * 1000000n;
            if (startMs > 0) {
                sendLookAt(startMs);
            }
            scheduleTick();
            emitStats();
        } catch (error) {
            console.error('Error starting playback:', error);
            stopPlaybackInternal(false);
        }
    });

    ipcMain.on('seek-playback', async (event, payload = {}) => {
        if (!playbackData || playbackData.length === 0) {
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
    });

    ipcMain.on('stop-playback', () => {
        stopPlaybackInternal(false);
    });

    ipcMain.on('unload-recording', () => {
        stopPlaybackInternal(false);
        playbackData = null;
        editSession = emptyEditSession();
        sendSafe('file-loaded', { success: true, filePath: null, cleared: true });
    });

    return { resolveAudioPath };
}

module.exports = setupPlaybackHandlers;
