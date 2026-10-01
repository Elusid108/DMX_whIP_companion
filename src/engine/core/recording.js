// DMXREC capture: one open file, frames encoded as they arrive from the
// receive path, chunked writes, stats at most every 100 ms. The file goes
// through the storage port (synchronously, on the UDP path, as before);
// origins come from the monotonic clock.
const {
    CHUNK_TARGET,
    createBurstStamper,
    createHeader,
    encodeFrame,
    shouldRecordUniverseFrame,
    universeKey
} = require('./dmxrec');
const { maskedRecordData } = require('./recordTriggers');
const { writeU32LE, concat } = require('./bytes');

// deps: { router, storage, clock, log }
function createRecording({ router, storage, clock, log }) {
    const emit = (name, payload) => router.emit(name, payload);
    const stateListeners = new Set();
    const notifyState = () => {
        stateListeners.forEach((fn) => {
            try {
                fn(isRecording);
            } catch (err) {
                log.error('Recording state listener error:', err);
            }
        });
    };
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
    let wokenUniverses = new Set();
    let suppressChannel = null;
    let observer = null;
    let burstTimestamp = createBurstStamper();

    const closeFd = () => {
        if (fd == null) {
            return;
        }
        try {
            storage.closeSync(fd);
        } catch (err) {
            log.error('Error closing recording file:', err);
        }
        fd = null;
    };

    const writeFrameCount = () => {
        if (fd == null) {
            return;
        }
        const countBuf = new Uint8Array(4);
        writeU32LE(countBuf, frameCount >>> 0, 0);
        storage.writeSync(fd, countBuf, 0, 4, 6);
    };

    const flushChunk = () => {
        if (fd == null || pendingBytes === 0) {
            return;
        }
        storage.writeSync(fd, concat(pending, pendingBytes));
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
        wokenUniverses = new Set();
        burstTimestamp = createBurstStamper();
    };

    const sendStats = (force = false) => {
        const now = clock.now();
        if (!force && now - lastStatsSent < 100) {
            return;
        }
        lastStatsSent = now;
        const cutoff = now - 1000;
        fpsTimes = fpsTimes.filter((time) => time > cutoff);
        emit('record.stats', {
            currentFps: fpsTimes.length,
            totalFrames: frameCount,
            droppedFrames,
            forced: Boolean(force)
        });
    };

    const startAt = (filePath) => {
        if (isRecording) {
            return { success: false, error: 'Already recording' };
        }
        const dest = filePath || recordingPath || storage.tempFile('dmxwhip-punch', '.dmx');
        closeFd();
        resetSession();
        fd = storage.openWriteSync(dest);
        storage.writeSync(fd, createHeader(0));
        recordingPath = dest;
        isRecording = true;
        recordingOriginNs = clock.monotonicNs();
        notifyState();
        sendStats(true);
        return { success: true, filePath: dest };
    };

    const stopAt = ({ emitSaved = true } = {}) => {
        if (!isRecording) {
            return { success: false, error: 'Not recording', filePath: recordingPath, totalFrames: frameCount };
        }
        isRecording = false;
        notifyState();
        suppressChannel = null;
        try {
            flushChunk();
            writeFrameCount();
        } catch (error) {
            log.error('Error finalizing recording:', error);
        }
        closeFd();
        sendStats(true);
        const result = {
            success: true,
            filePath: recordingPath,
            totalFrames: frameCount
        };
        if (emitSaved) {
            emit('record.saved', result);
        }
        return result;
    };

    // record.start: the renderer's fire-and-forget start; errors are events.
    router.command('record.start', ({ filePath } = {}) => {
        try {
            const result = startAt(typeof filePath === 'string' && filePath ? filePath : recordingPath);
            if (!result.success) {
                emit('record.error', { error: result.error });
            }
            return result;
        } catch (error) {
            closeFd();
            isRecording = false;
            log.error('Error starting recording:', error);
            emit('record.error', { error: error.message });
            return { success: false, error: error.message };
        }
    });
    router.command('record.stop', ({ emitSaved } = {}) => stopAt({ emitSaved: emitSaved !== false }));

    const cancel = () => {
        if (!isRecording) {
            return { success: false, error: 'Not recording', filePath: recordingPath };
        }
        const filePath = recordingPath;
        isRecording = false;
        notifyState();
        pending = [];
        pendingBytes = 0;
        closeFd();
        resetSession();
        return { success: true, filePath };
    };
    router.command('record.cancel', () => cancel());
    router.command('record.setPath', ({ filePath } = {}) => {
        if (isRecording) {
            return { success: false, error: 'Already recording' };
        }
        recordingPath = filePath || null;
        return { success: true, filePath: recordingPath };
    });
    router.query('record.state', () => ({
        recording: isRecording,
        filePath: recordingPath,
        elapsedMs: isRecording && recordingOriginNs != null
            ? Number((clock.monotonicNs() - recordingOriginNs) / 1000000n)
            : 0,
        totalFrames: frameCount
    }));

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

            const nowNs = clock.monotonicNs();
            const elapsed = Number((nowNs - recordingOriginNs) / 1000000n);
            const recordedData = maskedRecordData(frame, suppressChannel);
            const writeFrame = shouldRecordUniverseFrame(
                wokenUniverses,
                frame.protocol,
                frame.universe,
                recordedData
            );
            // The first written record is t=0; later ones share their burst's time.
            const timestamp = writeFrame
                ? burstTimestamp(elapsed, universeKey(frame.protocol, frame.universe))
                : (frameCount === 0 ? 0 : elapsed);

            if (writeFrame) {
                const encoded = encodeFrame({
                    timestamp,
                    universe: frame.universe,
                    protocol: frame.protocol,
                    data: recordedData
                });

                pending.push(encoded);
                pendingBytes += encoded.length;
                frameCount += 1;

                if (lastFrameNs && nowNs - lastFrameNs > 100000000n) {
                    droppedFrames += 1;
                }
                lastFrameNs = nowNs;
                fpsTimes.push(clock.now());

                if (pendingBytes >= CHUNK_TARGET) {
                    flushChunk();
                }

                sendStats(false);
            }

            if (onLiveFrame) {
                try {
                    onLiveFrame({
                        protocol: frame.protocol,
                        universe: frame.universe,
                        data: frame.data
                    }, timestamp);
                } catch (error) {
                    log.error('Live frame hook error:', error);
                }
            }
        },
        start: (filePath) => startAt(filePath),
        stop: (options) => stopAt(options),
        cancel,
        onStateChange: (fn) => {
            stateListeners.add(fn);
            return () => stateListeners.delete(fn);
        },
        getElapsedMs: () => {
            if (!isRecording || recordingOriginNs == null) {
                return 0;
            }
            return Number((clock.monotonicNs() - recordingOriginNs) / 1000000n);
        },
        setOnLiveFrame: (fn) => {
            onLiveFrame = typeof fn === 'function' ? fn : null;
        },
        setSuppressChannel: (mask) => {
            suppressChannel = mask && mask.channel ? mask : null;
        },
        setObserver: (next) => {
            observer = next && typeof next.observe === 'function' ? next : null;
        },
        wantsObserve: () => Boolean(observer && observer.wantsObserve && observer.wantsObserve()),
        watchesUniverse: (protocol, universe) => Boolean(
            observer
            && observer.watchesUniverse
            && observer.watchesUniverse(protocol, universe)
        ),
        observe: (frame, meta) => {
            if (!observer) {
                return;
            }
            try {
                observer.observe(frame, meta);
            } catch (error) {
                log.error('Record trigger error:', error);
            }
        },
        close: () => {
            if (isRecording) {
                isRecording = false;
                notifyState();
                try {
                    flushChunk();
                    writeFrameCount();
                } catch (error) {
                    log.error('Error closing recording:', error);
                }
            }
            closeFd();
            stateListeners.clear();
        }
    };
}

module.exports = { createRecording };
