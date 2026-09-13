const { ipcMain, dialog, app } = require('electron');
const path = require('path');
const fs = require('fs');
const {
    CHUNK_TARGET,
    createHeader,
    encodeFrame
} = require('../../services/shared/dmxRecording');

const sendSafe = (mainWindow, channel, payload) => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
        return;
    }
    mainWindow.webContents.send(channel, payload);
};

const findNextScenePath = () => {
    let sceneNum = 1;
    while (true) {
        const testPath = path.join(app.getPath('documents'), `scene_${sceneNum}.dmx`);
        if (!fs.existsSync(testPath)) {
            return testPath;
        }
        sceneNum += 1;
    }
};

function setupRecordingHandlers(mainWindow) {
    let isRecording = false;
    let recordingPath = null;
    let fd = null;
    let frameCount = 0;
    let recordingStartTime = null;
    let pending = [];
    let pendingBytes = 0;
    let lastStatsSent = 0;
    let fpsTimes = [];
    let droppedFrames = 0;
    let lastFrameTime = null;

    const closeFd = () => {
        if (fd == null) {
            return;
        }
        try {
            fs.closeSync(fd);
        } catch (err) {
            console.error('Error closing recording file:', err);
        }
        fd = null;
    };

    const writeFrameCount = () => {
        if (fd == null) {
            return;
        }
        const countBuf = Buffer.alloc(4);
        countBuf.writeUInt32LE(frameCount >>> 0);
        fs.writeSync(fd, countBuf, 0, 4, 6);
    };

    const flushChunk = () => {
        if (fd == null || pendingBytes === 0) {
            return;
        }
        fs.writeSync(fd, Buffer.concat(pending, pendingBytes));
        pending = [];
        pendingBytes = 0;
        writeFrameCount();
    };

    const resetSession = () => {
        pending = [];
        pendingBytes = 0;
        frameCount = 0;
        recordingStartTime = null;
        lastStatsSent = 0;
        fpsTimes = [];
        droppedFrames = 0;
        lastFrameTime = null;
    };

    const sendStats = (force = false) => {
        const now = Date.now();
        if (!force && now - lastStatsSent < 100) {
            return;
        }
        lastStatsSent = now;
        const cutoff = now - 1000;
        fpsTimes = fpsTimes.filter((time) => time > cutoff);
        sendSafe(mainWindow, 'recording-stats-update', {
            currentFps: fpsTimes.length,
            totalFrames: frameCount,
            droppedFrames
        });
    };

    const createRecordingFile = (filePath) => {
        fs.writeFileSync(filePath, createHeader(0));
        recordingPath = filePath;
        return filePath;
    };

    ipcMain.handle('new-recording-file', async () => {
        if (isRecording) {
            return { success: false, error: 'Stop recording before creating a new file' };
        }

        try {
            const { filePath, canceled } = await dialog.showSaveDialog({
                title: 'New Recording',
                defaultPath: findNextScenePath(),
                filters: [{ name: 'DMX Recordings', extensions: ['dmx'] }]
            });

            if (canceled || !filePath) {
                return { success: false, error: 'No file selected' };
            }

            createRecordingFile(filePath);
            return { success: true, filePath };
        } catch (error) {
            console.error('Error creating recording file:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.on('start-recording', () => {
        if (isRecording) {
            return;
        }
        if (!recordingPath) {
            sendSafe(mainWindow, 'recording-error', { error: 'Create a recording file first' });
            return;
        }

        try {
            closeFd();
            resetSession();
            fd = fs.openSync(recordingPath, 'w');
            fs.writeSync(fd, createHeader(0));
            isRecording = true;
            recordingStartTime = Date.now();
            sendStats(true);
        } catch (error) {
            closeFd();
            isRecording = false;
            console.error('Error starting recording:', error);
            sendSafe(mainWindow, 'recording-error', { error: error.message });
        }
    });

    ipcMain.on('stop-recording', () => {
        if (!isRecording) {
            return;
        }

        isRecording = false;
        try {
            flushChunk();
            writeFrameCount();
        } catch (error) {
            console.error('Error finalizing recording:', error);
        }
        closeFd();
        sendStats(true);
        sendSafe(mainWindow, 'recording-saved', {
            filePath: recordingPath,
            totalFrames: frameCount
        });
    });

    return {
        isRecording: () => isRecording,
        addFrame: (frame) => {
            if (!isRecording || fd == null) {
                return;
            }

            const now = Date.now();
            const timestamp = frameCount === 0 ? 0 : now - recordingStartTime;
            const encoded = encodeFrame({
                timestamp,
                universe: frame.universe,
                protocol: frame.protocol,
                data: frame.data
            });

            pending.push(encoded);
            pendingBytes += encoded.length;
            frameCount += 1;

            if (lastFrameTime && now - lastFrameTime > 100) {
                droppedFrames += 1;
            }
            lastFrameTime = now;
            fpsTimes.push(now);

            if (pendingBytes >= CHUNK_TARGET) {
                flushChunk();
            }

            sendStats(false);
        },
        close: () => {
            if (isRecording) {
                isRecording = false;
                try {
                    flushChunk();
                    writeFrameCount();
                } catch (error) {
                    console.error('Error closing recording:', error);
                }
            }
            closeFd();
        }
    };
}

module.exports = setupRecordingHandlers;
