const { ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
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

function setupRecordingHandlers(mainWindow) {
    let isRecording = false;
    let recordingPath = null;
    let fd = null;
    let frameCount = 0;
    let recordingOriginNs = null;
    let pending = [];
    let pendingBytes = 0;
    let lastStatsSent = 0;
    let fpsTimes = [];
    let droppedFrames = 0;
    let lastFrameNs = null;
    let onLiveFrame = null;

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
        recordingOriginNs = null;
        lastStatsSent = 0;
        fpsTimes = [];
        droppedFrames = 0;
        lastFrameNs = null;
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

    const startAt = (filePath) => {
        if (isRecording) {
            return { success: false, error: 'Already recording' };
        }
        const dest = filePath || recordingPath || path.join(
            os.tmpdir(),
            `dmxwhip-punch-${process.pid}-${Date.now()}.dmx`
        );
        closeFd();
        resetSession();
        fd = fs.openSync(dest, 'w');
        fs.writeSync(fd, createHeader(0));
        recordingPath = dest;
        isRecording = true;
        recordingOriginNs = process.hrtime.bigint();
        sendStats(true);
        return { success: true, filePath: dest };
    };

    const stopAt = ({ emitSaved = true } = {}) => {
        if (!isRecording) {
            return { success: false, error: 'Not recording', filePath: recordingPath, totalFrames: frameCount };
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
        const result = {
            success: true,
            filePath: recordingPath,
            totalFrames: frameCount
        };
        if (emitSaved) {
            sendSafe(mainWindow, 'recording-saved', result);
        }
        return result;
    };

    ipcMain.on('start-recording', () => {
        try {
            const result = startAt(recordingPath);
            if (!result.success) {
                sendSafe(mainWindow, 'recording-error', { error: result.error });
            }
        } catch (error) {
            closeFd();
            isRecording = false;
            console.error('Error starting recording:', error);
            sendSafe(mainWindow, 'recording-error', { error: error.message });
        }
    });

    ipcMain.on('stop-recording', () => {
        stopAt({ emitSaved: true });
    });

    ipcMain.removeHandler('cancel-recording');
    ipcMain.handle('cancel-recording', async () => {
        if (!isRecording) {
            return { success: false, error: 'Not recording', filePath: recordingPath };
        }
        const filePath = recordingPath;
        isRecording = false;
        pending = [];
        pendingBytes = 0;
        closeFd();
        resetSession();
        return { success: true, filePath };
    });

    return {
        isRecording: () => isRecording,
        getRecordingPath: () => recordingPath,
        setRecordingPath: (filePath) => {
            if (isRecording) {
                return false;
            }
            recordingPath = filePath || null;
            return true;
        },
        addFrame: (frame) => {
            if (!isRecording || fd == null) {
                return;
            }

            const nowNs = process.hrtime.bigint();
            const timestamp = frameCount === 0
                ? 0
                : Number((nowNs - recordingOriginNs) / 1000000n);
            const encoded = encodeFrame({
                timestamp,
                universe: frame.universe,
                protocol: frame.protocol,
                data: frame.data
            });

            pending.push(encoded);
            pendingBytes += encoded.length;
            frameCount += 1;

            if (lastFrameNs && nowNs - lastFrameNs > 100000000n) {
                droppedFrames += 1;
            }
            lastFrameNs = nowNs;
            fpsTimes.push(Date.now());

            if (pendingBytes >= CHUNK_TARGET) {
                flushChunk();
            }

            sendStats(false);
            if (onLiveFrame) {
                try {
                    onLiveFrame({
                        protocol: frame.protocol,
                        universe: frame.universe,
                        data: frame.data
                    }, timestamp);
                } catch (error) {
                    console.error('Live frame hook error:', error);
                }
            }
        },
        start: (filePath) => startAt(filePath),
        stop: (options) => stopAt(options),
        getElapsedMs: () => {
            if (!isRecording || recordingOriginNs == null) {
                return 0;
            }
            return Number((process.hrtime.bigint() - recordingOriginNs) / 1000000n);
        },
        setOnLiveFrame: (fn) => {
            onLiveFrame = typeof fn === 'function' ? fn : null;
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
            ipcMain.removeHandler('cancel-recording');
        }
    };
}

module.exports = setupRecordingHandlers;
