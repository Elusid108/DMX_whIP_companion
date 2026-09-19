const { ipcMain, dialog } = require('electron');
const fs = require('fs');
const ArtNetSender = require('../../services/artnet/sender');
const { SacnOutput } = require('../../services/sacn/output');
const { parseRecording } = require('../../services/shared/dmxRecording');

const IMMEDIATE_MS = 4;

function setupPlaybackHandlers(mainWindow) {
    let playbackData = null;
    let isPlaying = false;
    let isPaused = false;
    let currentPlaybackFrame = 0;
    let playbackOriginNs = 0n;
    let pausedElapsed = 0;
    let lastSentFrame = null;
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

    const sendSafe = (channel, payload) => {
        if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
            return;
        }
        mainWindow.webContents.send(channel, payload);
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

    const elapsedMs = () => Number((process.hrtime.bigint() - playbackOriginNs) / 1000000n);

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

    const sendFrame = (frame) => {
        lastSentFrame = frame;
        framesSentWindow.push(Date.now());
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
                playbackOriginNs = process.hrtime.bigint();
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
        if (!lastSentFrame) {
            return;
        }
        pauseInterval = setInterval(() => {
            if (!isPaused || !lastSentFrame) {
                stopHoldOutput();
                return;
            }
            sendFrame(lastSentFrame);
        }, 100);
    };

    const stopPlaybackInternal = (naturalEnd = false) => {
        const endedAt = isPlaying ? elapsedMs() : pausedElapsed;
        isPlaying = false;
        isPaused = false;
        clearPlayTimeout();
        stopHoldOutput();
        currentPlaybackFrame = 0;
        pausedElapsed = 0;
        lastSentFrame = null;
        framesSentWindow = [];
        cleanupSenders();
        emitStats({
            isPlaying: false,
            isPaused: false,
            isReset: true,
            fps: 0,
            currentFrame: naturalEnd && playbackData ? playbackData.length : 0,
            totalPlayTime: naturalEnd ? endedAt : 0
        });
    };

    const loadFromPath = async (filePath) => {
        const fileData = await fs.promises.readFile(filePath);
        playbackData = parseRecording(fileData);
        stopPlaybackInternal(false);

        const result = {
            success: true,
            filePath,
            frameCount: playbackData.length
        };
        sendSafe('file-loaded', result);
        return result;
    };

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

            return await loadFromPath(filePath);
        } catch (error) {
            console.error('Error loading recording:', error);
            stopPlaybackInternal(false);
            playbackData = null;
            const result = { success: false, error: error.message };
            sendSafe('file-loaded', result);
            return result;
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
            startHoldOutput();
            emitStats();
            return;
        }

        try {
            currentPlaybackFrame = 0;
            lastSentFrame = null;
            pausedElapsed = 0;
            framesSentWindow = [];
            await initializeSenders(playbackNetwork);
            isPlaying = true;
            isPaused = false;
            playbackOriginNs = process.hrtime.bigint();
            scheduleTick();
            emitStats();
        } catch (error) {
            console.error('Error starting playback:', error);
            stopPlaybackInternal(false);
        }
    });

    ipcMain.on('stop-playback', () => {
        stopPlaybackInternal(false);
    });

    ipcMain.on('unload-recording', () => {
        stopPlaybackInternal(false);
        playbackData = null;
        sendSafe('file-loaded', { success: true, filePath: null, cleared: true });
    });
}

module.exports = setupPlaybackHandlers;
