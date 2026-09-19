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
    reorderClips,
    rangeCutClips,
    serializeClips
} = require('../../services/shared/compilationEdl');
const {
    ensureLibrary,
    uniqueDmxPath,
    uniqueCompPath,
    writeSidecar,
    sanitizeBaseName,
    listLibrary
} = require('./library');

const IMMEDIATE_MS = 4;

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
            skipped: []
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
            latest.set(`${frame.protocol}:${frame.universe}`, frame);
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
                artnetSender.send(frame.universe, frame.data).catch((err) => {
                    console.error('Art-Net playback send error:', err);
                });
            }
            return;
        }
        if (sacnOutput) {
            sacnOutput.send(frame.universe, frame.data);
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

        if (currentPlaybackFrame >= playbackData.length) {
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
        const duration = clipDurationMs();
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
        clips: publicClips(editSession.clips),
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
            dirty: editSession.dirty,
            name: editSession.name,
            projectPath: editSession.projectPath,
            frameCount: playbackData ? playbackData.length : 0
        });
    };

    const addMediaFromBuffer = (fileData, name) => {
        const frames = parseRecording(fileData);
        const mediaId = newId();
        editSession.media[mediaId] = frames;
        editSession.mediaBytes[mediaId] = fileData;
        editSession.clips.push({
            id: newId(),
            name: name || 'Look',
            mediaId,
            sourceInMs: 0,
            sourceOutMs: mediaDurationMs(frames)
        });
        return mediaId;
    };

    const loadFromPath = async (filePath, displayName) => {
        const fileData = await fs.promises.readFile(filePath);
        const label = displayName || path.parse(filePath).name;
        editSession = emptyEditSession();
        editSession.kind = 'compilation';
        editSession.name = label;
        addMediaFromBuffer(fileData, label);
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
        for (const clip of clips) {
            const mediaPath = path.join(dirPath, 'media', `${clip.mediaId}.dmx`);
            const fileData = await fs.promises.readFile(mediaPath);
            editSession.media[clip.mediaId] = parseRecording(fileData);
            editSession.mediaBytes[clip.mediaId] = fileData;
            editSession.clips.push({
                id: clip.id || newId(),
                name: clip.name || 'Look',
                mediaId: clip.mediaId,
                sourceInMs: Number(clip.sourceInMs) || 0,
                sourceOutMs: Number(clip.sourceOutMs) || mediaDurationMs(editSession.media[clip.mediaId])
            });
        }
        if (editSession.clips.length === 0) {
            throw new Error('Compilation has no clips');
        }
        editSession.dirty = false;
        applyFlattenedPlayback();
        const result = sessionPayload({ filePath: dirPath });
        sendSafe('file-loaded', result);
        return result;
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

                if (canceled || !filePaths || filePaths.length === 0) {
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
                    clips: publicClips(editSession.clips)
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

    ipcMain.removeHandler('edit-compilation');
    ipcMain.handle('edit-compilation', async (event, payload = {}) => {
        try {
            if (editSession.kind !== 'compilation' || editSession.clips.length === 0) {
                throw new Error('No compilation is loaded');
            }
            const op = payload.op;
            if (op === 'trim') {
                editSession.clips = trimClip(
                    editSession.clips,
                    payload.clipId,
                    payload.edge,
                    payload.sourceMs,
                    editSession.media
                );
            } else if (op === 'split') {
                editSession.clips = splitClips(editSession.clips, payload.timeMs);
            } else if (op === 'reorder') {
                editSession.clips = reorderClips(
                    editSession.clips,
                    payload.fromIndex,
                    payload.toIndex
                );
            } else if (op === 'cut') {
                editSession.clips = rangeCutClips(editSession.clips, payload.fromMs, payload.toMs);
            } else {
                throw new Error('Unknown edit');
            }
            if (editSession.clips.length === 0) {
                throw new Error('That edit would remove every clip');
            }
            editSession.dirty = true;
            const keepMs = Number(payload.keepPlayheadMs);
            playbackData = flattenToFrames(editSession.media, editSession.clips);
            if (Number.isFinite(keepMs)) {
                applySeek(keepMs);
            }
            emitCompilationUpdated();
            return { success: true, clips: publicClips(editSession.clips), dirty: true };
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
                fs.mkdirSync(path.join(dest, 'media'), { recursive: true });
            } else {
                fs.mkdirSync(path.join(dest, 'media'), { recursive: true });
            }
            const mediaIds = new Set(editSession.clips.map((clip) => clip.mediaId));
            for (const mediaId of mediaIds) {
                const mediaPath = path.join(dest, 'media', `${mediaId}.dmx`);
                if (editSession.mediaBytes[mediaId]) {
                    fs.writeFileSync(mediaPath, editSession.mediaBytes[mediaId]);
                } else {
                    writeRecording(mediaPath, editSession.media[mediaId] || []);
                }
            }
            const project = {
                version: 1,
                kind: 'compilation',
                name,
                notes: typeof payload.notes === 'string' ? payload.notes : editSession.notes,
                clips: serializeClips(editSession.clips)
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
            if (!playbackData || playbackData.length === 0) {
                throw new Error('Nothing to export');
            }
            const dir = ensureLibrary();
            const name = sanitizeBaseName(payload.name || `${editSession.name || 'Stack'} flat`);
            const filePath = uniqueDmxPath(dir, name);
            writeRecording(filePath, playbackData);
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
            const duration = clipDurationMs();
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
}

module.exports = setupPlaybackHandlers;
