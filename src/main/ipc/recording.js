const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { dialog, app } = require('electron');

function setupRecordingHandlers(mainWindow) {
    let isRecording = false;
    let recordingBuffer = [];
    let recordingStartTime = null;
    let lastFrameTime = null;
    let droppedFrames = 0;

    // Enhanced frame tracking system
    const frameTracker = {
        frames: [],
        lastCalculation: 0,
        currentFps: 0,
        maxFps: 0,
        minInterval: 1000 / 200, // Support up to 200 FPS
        calculationInterval: 50,
        intervals: [],
        maxIntervalSamples: 50,

        addFrame(timestamp) {
            const now = timestamp || Date.now();
            
            // Track frame intervals for adaptive timing
            if (lastFrameTime) {
                const interval = now - lastFrameTime;
                this.intervals.push(interval);
                if (this.intervals.length > this.maxIntervalSamples) {
                    this.intervals.shift();
                }
                
                // Calculate average interval
                const avgInterval = this.intervals.reduce((a, b) => a + b, 0) / this.intervals.length;
                
                // Only count dropped frames if we have enough samples
                if (this.intervals.length >= 10 && interval > avgInterval * 2) {
                    const expectedFrames = Math.round(interval / avgInterval);
                    droppedFrames += expectedFrames - 1;
                    console.log('Dropped frames detected:', {
                        interval,
                        avgInterval,
                        expectedFrames: expectedFrames - 1
                    });
                }
            }
            lastFrameTime = now;
            
            // Track frames for FPS calculation
            this.frames.push(now);
            const oneSecondAgo = now - 1000;
            this.frames = this.frames.filter(time => time > oneSecondAgo);
            
            // Update FPS calculations
            if (now - this.lastCalculation >= this.calculationInterval) {
                const instantFps = this.frames.length;
                this.currentFps = instantFps;
                this.maxFps = Math.max(this.maxFps, instantFps);
                this.lastCalculation = now;
                
                // Debug logging
                console.log('Frame stats:', {
                    currentFps: this.currentFps,
                    maxFps: this.maxFps,
                    droppedFrames,
                    bufferSize: recordingBuffer.length
                });
            }
            
            return this.currentFps;
        },

        reset() {
            console.log('Resetting frame tracker');
            this.frames = [];
            this.intervals = [];
            this.lastCalculation = 0;
            this.currentFps = 0;
            this.maxFps = 0;
            lastFrameTime = null;
            droppedFrames = 0;
        }
    };

    ipcMain.on('start-recording', () => {
        console.log('Starting recording...');
        isRecording = true;
        recordingStartTime = Date.now();
        recordingBuffer = [];
        frameTracker.reset();
    });

    ipcMain.on('stop-recording', async () => {
        console.log('Stopping recording...');
        if (!isRecording) return;
        
        isRecording = false;
        
        const findNextSceneNumber = () => {
            let sceneNum = 1;
            while (true) {
                const testPath = path.join(app.getPath('documents'), `scene_${sceneNum}.dmx`);
                if (!fs.existsSync(testPath)) {
                    return sceneNum;
                }
                sceneNum++;
            }
        };

        try {
            const nextScene = findNextSceneNumber();
            const { filePath, canceled } = await dialog.showSaveDialog({
                title: 'Save Recording',
                defaultPath: path.join(app.getPath('documents'), `scene_${nextScene}.dmx`),
                filters: [{ name: 'DMX Recordings', extensions: ['dmx'] }]
            });

            if (!canceled && filePath) {
                console.log('Saving recording to:', filePath);
                console.log('Frame count:', recordingBuffer.length);
                
                const header = Buffer.from('DMXREC');
                const countBuffer = Buffer.alloc(4);
                countBuffer.writeUInt32LE(recordingBuffer.length);
                
                fs.writeFileSync(filePath, header);
                fs.appendFileSync(filePath, countBuffer);
                
                recordingBuffer.forEach((frame, index) => {
                    const frameBuffer = Buffer.alloc(4 + 4 + 2 + 512);
                    frameBuffer.writeUInt32LE(Math.min(frame.timestamp, 4294967295), 0);
                    frameBuffer.writeUInt32LE(frame.universe, 4);
                    frameBuffer.writeUInt16LE(frame.protocol === 'artnet' ? 0 : 1, 8);
                    Buffer.from(frame.data).copy(frameBuffer, 10);
                    fs.appendFileSync(filePath, frameBuffer);
                });

                console.log('Recording saved successfully');
                mainWindow.webContents.send('recording-saved', filePath);
            }
        } catch (error) {
            console.error('Error saving recording:', error);
        }
        
        recordingBuffer = [];
    });

    return {
        isRecording: () => isRecording,
        addFrame: (frame) => {
            if (isRecording) {
                const timestamp = recordingBuffer.length === 0 ? 0 : Date.now() - recordingStartTime;
                recordingBuffer.push({...frame, timestamp});
                const currentFps = frameTracker.addFrame(Date.now());
                mainWindow.webContents.send('recording-stats-update', {
                    currentFps,
                    totalFrames: recordingBuffer.length,
                    droppedFrames,
                    maxFps: frameTracker.maxFps
                });
            }
        }
    };
}

module.exports = setupRecordingHandlers;