const { useState, useEffect, useRef } = require('react');
const ipcRenderer = require('../ipc');

const formatDuration = (ms) => {
    if (!ms && ms !== 0) {
        return '00:00:00';
    }
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const hundredths = Math.floor((ms % 1000) / 10);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}:${hundredths.toString().padStart(2, '0')}`;
};

const fileNameFromPath = (filePath) => {
    if (!filePath) {
        return '';
    }
    return String(filePath).split(/[\\/]/).pop();
};

const clearPlaybackUi = (setIsFileLoaded, setLoadedFileName, setTimelineOverview, setPlayheadMs) => {
    setIsFileLoaded(false);
    setLoadedFileName('');
    if (setTimelineOverview) {
        setTimelineOverview(null);
    }
    if (setPlayheadMs) {
        setPlayheadMs(0);
    }
};

const useStudioSession = (selectedUniverses, selectedNic) => {
    const [isRecording, setIsRecording] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isFileLoaded, setIsFileLoaded] = useState(false);
    const [recordingPath, setRecordingPath] = useState(null);
    const [loadedFileName, setLoadedFileName] = useState('');
    const [loadError, setLoadError] = useState('');
    const [recordingDuration, setRecordingDuration] = useState(0);
    const [frameCount, setFrameCount] = useState(0);
    const [recordingFps, setRecordingFps] = useState(0);
    const [droppedFrames, setDroppedFrames] = useState(0);
    const [naming, setNaming] = useState(false);
    const [nameDraft, setNameDraft] = useState('');
    const [isLoopEnabled, setIsLoopEnabled] = useState(false);
    const [playbackNetwork, setPlaybackNetwork] = useState(selectedNic || '0.0.0.0');
    const [playbackStats, setPlaybackStats] = useState({
        currentFrame: null,
        totalFrames: 0,
        clipTime: 0,
        totalPlayTime: 0,
        playheadMs: 0,
        fps: 0
    });
    const [timelineOverview, setTimelineOverview] = useState(null);
    const [playheadMs, setPlayheadMs] = useState(0);
    const recordingStartTime = useRef(null);
    const durationTimer = useRef(null);
    const overviewReq = useRef(0);

    useEffect(() => {
        setPlaybackNetwork((current) => current || selectedNic || '0.0.0.0');
    }, [selectedNic]);

    useEffect(() => {
        const fetchOverview = async (filePath) => {
            const requestId = overviewReq.current + 1;
            overviewReq.current = requestId;
            try {
                const result = await ipcRenderer.invoke('timeline-overview', { filePath });
                if (requestId !== overviewReq.current) {
                    return;
                }
                if (result && result.success) {
                    setTimelineOverview(result);
                    return;
                }
                setTimelineOverview(null);
            } catch (error) {
                if (requestId !== overviewReq.current) {
                    return;
                }
                setTimelineOverview(null);
            }
        };

        const handleFileLoaded = (event, result = {}) => {
            setIsLoading(false);
            if (result.success && result.filePath) {
                setIsFileLoaded(true);
                setLoadedFileName(fileNameFromPath(result.filePath));
                setPlayheadMs(0);
                setLoadError('');
                fetchOverview(result.filePath);
                return;
            }
            if (result.cleared || (result.success && !result.filePath)) {
                overviewReq.current += 1;
                clearPlaybackUi(setIsFileLoaded, setLoadedFileName, setTimelineOverview, setPlayheadMs);
                return;
            }
            if (result.error && result.error !== 'No file selected') {
                overviewReq.current += 1;
                clearPlaybackUi(setIsFileLoaded, setLoadedFileName, setTimelineOverview, setPlayheadMs);
                setLoadError(result.error);
            }
        };

        const handlePlaybackStats = (event, stats = {}) => {
            setPlaybackStats(stats);
            setIsPlaying(Boolean(stats.isPlaying));
            setIsPaused(Boolean(stats.isPaused));
            if (stats.isReset) {
                setIsPlaying(false);
                setIsPaused(false);
                setPlayheadMs(0);
                return;
            }
            if (typeof stats.playheadMs === 'number') {
                setPlayheadMs(stats.playheadMs);
            }
        };

        const handleFrameRecorded = (event, stats = {}) => {
            setFrameCount(stats.totalFrames || 0);
            setRecordingFps(stats.currentFps || 0);
            setDroppedFrames(stats.droppedFrames || 0);
        };

        const handleRecordingError = (event, result = {}) => {
            setIsRecording(false);
            clearInterval(durationTimer.current);
            setLoadError(result.error || 'Recording failed');
        };

        const handleRecordingSaved = async (event, result = {}) => {
            const filePath = result.filePath;
            if (!filePath) {
                return;
            }
            try {
                setIsLoading(true);
                const loaded = await ipcRenderer.invoke('load-recording', { filePath });
                if (loaded && !loaded.success && loaded.error && loaded.error !== 'No file selected') {
                    setLoadError(loaded.error);
                }
            } catch (error) {
                setLoadError(error.message);
            } finally {
                setIsLoading(false);
            }
        };

        ipcRenderer.on('file-loaded', handleFileLoaded);
        ipcRenderer.on('playback-stats', handlePlaybackStats);
        ipcRenderer.on('recording-stats-update', handleFrameRecorded);
        ipcRenderer.on('recording-error', handleRecordingError);
        ipcRenderer.on('recording-saved', handleRecordingSaved);

        return () => {
            ipcRenderer.removeListener('file-loaded', handleFileLoaded);
            ipcRenderer.removeListener('playback-stats', handlePlaybackStats);
            ipcRenderer.removeListener('recording-stats-update', handleFrameRecorded);
            ipcRenderer.removeListener('recording-error', handleRecordingError);
            ipcRenderer.removeListener('recording-saved', handleRecordingSaved);
            clearInterval(durationTimer.current);
        };
    }, []);

    const unloadPlayback = () => {
        overviewReq.current += 1;
        ipcRenderer.send('stop-playback');
        ipcRenderer.send('unload-recording');
        clearPlaybackUi(setIsFileLoaded, setLoadedFileName, setTimelineOverview, setPlayheadMs);
    };

    const handleNewFile = () => {
        if (isRecording) {
            return;
        }
        setNameDraft('');
        setNaming(true);
        setLoadError('');
    };

    const handleNewFileCancel = () => {
        setNaming(false);
        setNameDraft('');
    };

    const handleNewFileConfirm = async () => {
        if (isRecording) {
            return;
        }
        const name = String(nameDraft || '').trim();
        if (!name) {
            return;
        }
        try {
            const result = await ipcRenderer.invoke('library-new-file', { name });
            if (result && result.success) {
                unloadPlayback();
                setRecordingPath(result.filePath);
                setNaming(false);
                setNameDraft('');
                setLoadError('');
            } else if (result && result.error && result.error !== 'No file selected') {
                setLoadError(result.error);
            }
        } catch (error) {
            setLoadError(error.message);
        }
    };

    const handleStartRecording = () => {
        if (!recordingPath) {
            return;
        }
        setIsRecording(true);
        recordingStartTime.current = Date.now();
        setRecordingDuration(0);
        setFrameCount(0);
        setDroppedFrames(0);
        setLoadError('');
        durationTimer.current = setInterval(() => {
            setRecordingDuration(Date.now() - recordingStartTime.current);
        }, 10);
        ipcRenderer.send('start-recording');
    };

    const handleStopRecording = () => {
        setIsRecording(false);
        clearInterval(durationTimer.current);
        ipcRenderer.send('stop-recording');
    };

    const handleCancelRecording = async () => {
        if (!isRecording) {
            return;
        }
        if (!window.confirm('Discard this recording? It will not be saved.')) {
            return;
        }
        const filePath = recordingPath;
        try {
            const result = await ipcRenderer.invoke('cancel-recording');
            setIsRecording(false);
            clearInterval(durationTimer.current);
            const toDelete = (result && result.filePath) || filePath;
            if (toDelete) {
                await ipcRenderer.invoke('library-delete', { filePath: toDelete });
            }
            setRecordingPath(null);
            setRecordingDuration(0);
            setFrameCount(0);
            setRecordingFps(0);
            setDroppedFrames(0);
            setLoadError('');
        } catch (error) {
            setLoadError(error.message);
        }
    };

    const handleLoadFile = async () => {
        if (isLoading) {
            return;
        }
        try {
            setIsLoading(true);
            setLoadError('');
            const result = await ipcRenderer.invoke('load-recording');
            if (result && !result.success && result.error && result.error !== 'No file selected') {
                setLoadError(result.error);
            }
        } catch (error) {
            setLoadError(error.message);
        } finally {
            setIsLoading(false);
        }
    };

    const handlePlayback = () => {
        if (!isFileLoaded) {
            return;
        }
        ipcRenderer.send('toggle-playback', {
            loop: isLoopEnabled,
            playbackNetwork
        });
    };

    const handleStopPlayback = () => {
        ipcRenderer.send('stop-playback');
        setPlayheadMs(0);
    };

    const handleSeek = (timeMs) => {
        if (!isFileLoaded || isRecording) {
            return;
        }
        const next = Math.max(0, Number(timeMs) || 0);
        setPlayheadMs(next);
        ipcRenderer.send('seek-playback', {
            timeMs: next,
            playbackNetwork,
            loop: isLoopEnabled
        });
    };

    const recordingFileName = fileNameFromPath(recordingPath);
    const displayFileName = loadedFileName || recordingFileName;
    const canRecord = Boolean(recordingPath) && (isRecording || (selectedUniverses && selectedUniverses.size > 0));
    const showPlaybackStats = (isPlaying || isPaused) && playbackStats.currentFrame !== null;
    const showPlaybackControls = isFileLoaded && !isRecording;
    const showLoad = !isRecording && !(recordingPath && !isFileLoaded);
    const isIdle = !isRecording && !showPlaybackStats && !recordingPath && !isFileLoaded && !loadError;

    return {
        isRecording,
        isPlaying,
        isPaused,
        isLoading,
        isFileLoaded,
        recordingPath,
        recordingFileName,
        loadedFileName,
        displayFileName,
        loadError,
        recordingDuration,
        frameCount,
        recordingFps,
        droppedFrames,
        naming,
        nameDraft,
        setNameDraft,
        isLoopEnabled,
        setIsLoopEnabled,
        playbackNetwork,
        setPlaybackNetwork,
        playbackStats,
        timelineOverview,
        playheadMs,
        canRecord,
        showPlaybackStats,
        showPlaybackControls,
        showLoad,
        isIdle,
        formatDuration,
        handleNewFile,
        handleNewFileCancel,
        handleNewFileConfirm,
        handleStartRecording,
        handleStopRecording,
        handleCancelRecording,
        handleLoadFile,
        handlePlayback,
        handleStopPlayback,
        handleSeek
    };
};

module.exports = useStudioSession;
