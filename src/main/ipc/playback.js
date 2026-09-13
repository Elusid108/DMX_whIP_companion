const { ipcMain, dialog } = require('electron');
const fs = require('fs');
const ArtNetSender = require('../../services/artnet/sender');
const SacnSender = require('../../services/sacn/sender');

let playbackData = null;
let isPlaying = false;
let isPaused = false;
let currentPlaybackFrame = 0;
let pausedFrame = null;
let playbackStartTime = null;
let artnetSender = null;
let sacnSender = null;
let pauseInterval = null;

function setupPlaybackHandlers(mainWindow) {
    const initializeSenders = async (playbackNetwork) => {
        artnetSender = new ArtNetSender();
        sacnSender = new SacnSender({ sourceName: 'DMX Monitor Playback' });
        
        await artnetSender.start(playbackNetwork);
        await sacnSender.start(playbackNetwork);
    };

    const cleanupSenders = async () => {
        if (artnetSender) artnetSender.stop();
        if (sacnSender) sacnSender.stop();
        artnetSender = null;
        sacnSender = null;
    };

    const handlePlayback = async (frames, loop = false, playbackNetwork, startFrame = 0) => {
        await initializeSenders(playbackNetwork);
        let lastFrameTime = startFrame > 0 ? frames[startFrame].timestamp : 0;
        currentPlaybackFrame = startFrame;
        playbackStartTime = Date.now() - (startFrame > 0 ? frames[startFrame].timestamp : 0);

        const playNextFrame = async () => {
            if (!isPlaying) return;

            if (currentPlaybackFrame >= frames.length) {
                if (loop) {
                    currentPlaybackFrame = 0;
                    lastFrameTime = 0;
                    playbackStartTime = Date.now();
                } else {
                    isPlaying = false;
                    await cleanupSenders();
                    mainWindow.webContents.send('playback-stats', {
                        currentFrame: frames.length,
                        totalFrames: frames.length,
                        clipTime: frames[frames.length - 1].timestamp,
                        totalPlayTime: Date.now() - playbackStartTime,
                        fps: 0,
                        isPlaying: false,
                        loop: false
                    });
                    return;
                }
            }

            const frame = frames[currentPlaybackFrame];
            const elapsedTime = Date.now() - playbackStartTime;
            const timeUntilNextFrame = frame.timestamp - lastFrameTime;

            try {
                if (frame.protocol === 'artnet') {
                    await artnetSender.send(frame.universe, frame.data);
                } else {
                    await sacnSender.send(frame.universe, frame.data);
                }

                if (currentPlaybackFrame % 5 === 0) {
                    mainWindow.webContents.send('playback-stats', {
                        currentFrame: currentPlaybackFrame + 1,
                        totalFrames: frames.length,
                        clipTime: frame.timestamp,
                        totalPlayTime: elapsedTime,
                        fps: Math.round(1000 / timeUntilNextFrame),
                        isPlaying: true,
                        loop
                    });
                }

                lastFrameTime = frame.timestamp;
                currentPlaybackFrame++;

                if (isPlaying) {
                    setTimeout(playNextFrame, Math.max(0, timeUntilNextFrame));
                }
            } catch (error) {
                console.error('Playback error:', error);
                if (isPlaying) {
                    setTimeout(playNextFrame, Math.max(0, timeUntilNextFrame));
                }
            }
        };

        return playNextFrame;
    };

    const continuePausedOutput = async (frame, playbackNetwork) => {
        if (!frame) return;
        
        await initializeSenders(playbackNetwork);
        
        pauseInterval = setInterval(async () => {
            if (!isPaused) {
                clearInterval(pauseInterval);
                await cleanupSenders();
                return;
            }

            try {
                if (frame.protocol === 'artnet') {
                    await artnetSender.send(frame.universe, frame.data);
                } else {
                    await sacnSender.send(frame.universe, frame.data);
                }
            } catch (error) {
                console.error('Pause output error:', error);
            }
        }, 100);
    };

    ipcMain.on('load-recording', async () => {
        const { filePaths } = await dialog.showOpenDialog({
            title: 'Load Recording',
            filters: [{ name: 'DMX Recordings', extensions: ['dmx'] }],
            properties: ['openFile']
        });

        if (filePaths.length > 0) {
            try {
                const fileData = fs.readFileSync(filePaths[0]);
                const header = fileData.slice(0, 6).toString();
                
                if (header !== 'DMXREC') {
                    throw new Error('Invalid file format');
                }

                const frameCount = fileData.readUInt32LE(6);
                let offset = 10;
                playbackData = [];

                for (let i = 0; i < frameCount; i++) {
                    playbackData.push({
                        timestamp: fileData.readUInt32LE(offset),
                        universe: fileData.readUInt32LE(offset + 4),
                        protocol: fileData.readUInt16LE(offset + 8) === 0 ? 'artnet' : 'sacn',
                        data: Array.from(fileData.slice(offset + 10, offset + 522))
                    });
                    offset += 522;
                }

                mainWindow.webContents.send('file-loaded', { success: true, filePath: filePaths[0] });
            } catch (error) {
                console.error('Error loading recording:', error);
                mainWindow.webContents.send('file-loaded', { success: false, error: error.message });
            }
        }
    });

    ipcMain.on('toggle-playback', async (event, { loop, playbackNetwork }) => {
        if (!playbackData) return;

        if (isPaused) {
            isPaused = false;
            isPlaying = true;
            if (pauseInterval) clearInterval(pauseInterval);
            const player = await handlePlayback(playbackData, loop, playbackNetwork, currentPlaybackFrame);
            if (player) await player();
        } else if (isPlaying) {
            isPaused = true;
            isPlaying = false;
            pausedFrame = playbackData[currentPlaybackFrame];
            if (pausedFrame) {
                continuePausedOutput(pausedFrame, playbackNetwork);
                mainWindow.webContents.send('playback-stats', {
                    currentFrame: currentPlaybackFrame + 1,
                    totalFrames: playbackData.length,
                    clipTime: pausedFrame.timestamp,
                    totalPlayTime: Date.now() - playbackStartTime,
                    fps: 0,
                    isPlaying: false,
                    isPaused: true,
                    loop
                });
            }
        } else {
            isPlaying = true;
            currentPlaybackFrame = 0;
            playbackStartTime = Date.now();
            const player = await handlePlayback(playbackData, loop, playbackNetwork);
            if (player) await player();
        }
    });

    ipcMain.handle('load-recording', async () => {
        console.log('Load recording request received'); // Debug log
        try {
            const { filePaths, canceled } = await dialog.showOpenDialog({
                title: 'Load Recording',
                filters: [{ name: 'DMX Recordings', extensions: ['dmx'] }],
                properties: ['openFile']
            });

            if (canceled || !filePaths || filePaths.length === 0) {
                console.log('File selection cancelled or no file selected');
                return { success: false, error: 'No file selected' };
            }

            console.log('Selected file:', filePaths[0]); // Debug log

            try {
                const fileData = await fs.promises.readFile(filePaths[0]);
                const header = fileData.slice(0, 6).toString();
                
                if (header !== 'DMXREC') {
                    throw new Error('Invalid file format');
                }

                const frameCount = fileData.readUInt32LE(6);
                let offset = 10;
                playbackData = [];

                console.log('Loading', frameCount, 'frames'); // Debug log

                for (let i = 0; i < frameCount; i++) {
                    playbackData.push({
                        timestamp: fileData.readUInt32LE(offset),
                        universe: fileData.readUInt32LE(offset + 4),
                        protocol: fileData.readUInt16LE(offset + 8) === 0 ? 'artnet' : 'sacn',
                        data: Array.from(fileData.slice(offset + 10, offset + 522))
                    });
                    offset += 522;
                }

                console.log('Successfully loaded', playbackData.length, 'frames'); // Debug log
                mainWindow.webContents.send('file-loaded', { 
                    success: true, 
                    filePath: filePaths[0] 
                });
                return { success: true };
            } catch (error) {
                console.error('Error loading recording:', error);
                mainWindow.webContents.send('file-loaded', { 
                    success: false, 
                    error: error.message 
                });
                return { success: false, error: error.message };
            }
        } catch (error) {
            console.error('Error in file dialog:', error);
            return { success: false, error: error.message };
        }
    });
}

module.exports = setupPlaybackHandlers;