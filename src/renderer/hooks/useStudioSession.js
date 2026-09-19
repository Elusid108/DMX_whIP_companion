const { useState, useEffect, useRef } = require('react');
const ipcRenderer = require('../ipc');

const neighborStarts = (clips, audioClips, timeMs) => {
    const t = Math.max(0, Number(timeMs) || 0);
    const starts = [...new Set([
        ...(clips || []).map((clip) => Number(clip.startMs) || 0),
        ...(audioClips || []).map((clip) => Number(clip.startMs) || 0)
    ])].sort((a, b) => a - b);
    if (starts.length === 0) {
        return { back: 0, next: 0 };
    }
    let back = 0;
    let next = starts[starts.length - 1];
    for (const start of starts) {
        if (start < t - 1) {
            back = start;
        }
        if (start > t + 1) {
            next = start;
            break;
        }
    }
    return { back, next };
};

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
    const [clips, setClips] = useState([]);
    const [audioClips, setAudioClips] = useState([]);
    const [audioMedia, setAudioMedia] = useState({});
    const [trackCount, setTrackCount] = useState(1);
    const [inspector, setInspector] = useState(null);
    const [compilationDirty, setCompilationDirty] = useState(false);
    const [compilationName, setCompilationName] = useState('');
    const [projectPath, setProjectPath] = useState(null);
    const [saveNaming, setSaveNaming] = useState(false);
    const [saveDraft, setSaveDraft] = useState('');
    const [exportNaming, setExportNaming] = useState(false);
    const [exportDraft, setExportDraft] = useState('');
    const recordingStartTime = useRef(null);
    const durationTimer = useRef(null);
    const overviewReq = useRef(0);
    const audioRef = useRef(null);

    useEffect(() => {
        setPlaybackNetwork((current) => current || selectedNic || '0.0.0.0');
    }, [selectedNic]);

    useEffect(() => {
        const fetchOverview = async (filePath) => {
            const requestId = overviewReq.current + 1;
            overviewReq.current = requestId;
            try {
                const result = await ipcRenderer.invoke('timeline-overview', filePath ? { filePath } : {});
                if (requestId !== overviewReq.current) {
                    return;
                }
                if (result && result.success) {
                    setTimelineOverview(result);
                    if (Array.isArray(result.clips)) {
                        setClips(result.clips);
                    }
                    if (Array.isArray(result.audioClips)) {
                        setAudioClips(result.audioClips);
                    }
                    if (result.audioMedia) {
                        setAudioMedia(result.audioMedia);
                    }
                    if (result.trackCount) {
                        setTrackCount(result.trackCount);
                    }
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

        const applyCompilation = (result = {}) => {
            if (Array.isArray(result.clips)) {
                setClips(result.clips);
            }
            if (Array.isArray(result.audioClips)) {
                setAudioClips(result.audioClips);
            }
            if (result.audioMedia) {
                setAudioMedia(result.audioMedia);
            }
            if (result.trackCount) {
                setTrackCount(result.trackCount);
            }
            setCompilationDirty(Boolean(result.dirty));
            const label = result.displayName || result.name;
            if (label) {
                setCompilationName(label);
                setLoadedFileName(label);
            }
            if (result.projectPath !== undefined) {
                setProjectPath(result.projectPath || null);
            }
        };

        const handleFileLoaded = (event, result = {}) => {
            setIsLoading(false);
            if (result.success && (result.filePath || (result.clips && result.clips.length))) {
                setIsFileLoaded(true);
                setLoadedFileName(result.displayName || fileNameFromPath(result.filePath) || 'Stack');
                setPlayheadMs(0);
                setLoadError('');
                applyCompilation(result);
                fetchOverview(result.kind === 'compilation' ? null : result.filePath);
                return;
            }
            if (result.cleared || (result.success && !result.filePath && !(result.clips && result.clips.length))) {
                overviewReq.current += 1;
                clearPlaybackUi(setIsFileLoaded, setLoadedFileName, setTimelineOverview, setPlayheadMs);
                setClips([]);
                setAudioClips([]);
                setAudioMedia({});
                setTrackCount(1);
                setInspector(null);
                setCompilationDirty(false);
                setCompilationName('');
                setProjectPath(null);
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

        const handleCompilationUpdated = (event, payload = {}) => {
            applyCompilation(payload);
            fetchOverview(null);
        };

        ipcRenderer.on('file-loaded', handleFileLoaded);
        ipcRenderer.on('compilation-updated', handleCompilationUpdated);
        ipcRenderer.on('playback-stats', handlePlaybackStats);
        ipcRenderer.on('recording-stats-update', handleFrameRecorded);
        ipcRenderer.on('recording-error', handleRecordingError);
        ipcRenderer.on('recording-saved', handleRecordingSaved);

        return () => {
            ipcRenderer.removeListener('file-loaded', handleFileLoaded);
            ipcRenderer.removeListener('compilation-updated', handleCompilationUpdated);
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
        setClips([]);
        setAudioClips([]);
        setAudioMedia({});
        setTrackCount(1);
        setInspector(null);
        setCompilationDirty(false);
        setCompilationName('');
        setProjectPath(null);
    };

    const handleSplit = (timeMs) => {
        ipcRenderer.invoke('edit-compilation', {
            op: 'split',
            timeMs,
            keepPlayheadMs: playheadMs
        }).then((result) => {
            if (result && !result.success && result.error) {
                setLoadError(result.error);
            }
        });
    };

    const handleCutRange = (fromMs, toMs) => {
        ipcRenderer.invoke('edit-compilation', {
            op: 'cut',
            fromMs,
            toMs,
            keepPlayheadMs: playheadMs
        }).then((result) => {
            if (result && !result.success && result.error) {
                setLoadError(result.error);
            }
        });
    };

    const handleMoveClip = (clipId, startMs, trackId, target) => {
        ipcRenderer.invoke('edit-compilation', {
            op: 'move',
            clipId,
            startMs,
            trackId,
            target,
            keepPlayheadMs: playheadMs
        }).then((result) => {
            if (result && !result.success && result.error) {
                setLoadError(result.error);
            }
        });
    };

    const handleTrimClip = (clipId, edge, sourceMs, target) => {
        ipcRenderer.invoke('edit-compilation', {
            op: 'trim',
            clipId,
            edge,
            sourceMs,
            target,
            keepPlayheadMs: playheadMs
        }).then((result) => {
            if (result && !result.success && result.error) {
                setLoadError(result.error);
            }
        });
    };

    const handleAddTrack = () => {
        ipcRenderer.invoke('edit-compilation', {
            op: 'add-track',
            keepPlayheadMs: playheadMs
        }).then((result) => {
            if (result && !result.success && result.error) {
                setLoadError(result.error);
            }
        });
    };

    const handleInspectClip = (clip, pos) => {
        ipcRenderer.invoke('inspect-clip', { clipId: clip.id }).then((result) => {
            if (result && result.success) {
                setInspector({
                    clip: result.clip,
                    x: pos && pos.x,
                    y: pos && pos.y
                });
                return;
            }
            if (result && result.error) {
                setLoadError(result.error);
            }
        });
    };

    const handleInspectApply = (patch) => {
        if (!inspector || !inspector.clip) {
            return;
        }
        ipcRenderer.invoke('edit-compilation', {
            op: 'update',
            clipId: inspector.clip.id,
            patch,
            keepPlayheadMs: playheadMs
        }).then((result) => {
            if (result && !result.success && result.error) {
                setLoadError(result.error);
                return;
            }
            setInspector(null);
        });
    };

    const handleImportAudio = (startMs) => {
        ipcRenderer.invoke('import-audio', { startMs }).then((result) => {
            if (result && result.error && result.error !== 'No file selected') {
                setLoadError(result.error);
            }
        });
    };

    const handlePlay = () => {
        if (!isFileLoaded || isPlaying) {
            return;
        }
        ipcRenderer.send('toggle-playback', {
            loop: isLoopEnabled,
            playbackNetwork
        });
    };

    const handlePause = () => {
        if (!isPlaying) {
            return;
        }
        ipcRenderer.send('toggle-playback', {
            loop: isLoopEnabled,
            playbackNetwork
        });
    };

    const handleBack = () => {
        const { back } = neighborStarts(clips, audioClips, playheadMs);
        handleSeek(back);
    };

    const handleNext = () => {
        const { next } = neighborStarts(clips, audioClips, playheadMs);
        handleSeek(next);
    };

    const handleSaveCompilation = () => {
        setSaveDraft(compilationName || loadedFileName || 'Stack');
        setSaveNaming(true);
        setExportNaming(false);
    };

    const handleSaveCompilationConfirm = async () => {
        const name = String(saveDraft || '').trim();
        if (!name) {
            return;
        }
        const result = await ipcRenderer.invoke('save-compilation', { name });
        if (result && result.success) {
            setSaveNaming(false);
            setCompilationDirty(false);
            setCompilationName(name);
            setLoadedFileName(name);
        } else if (result && result.error) {
            setLoadError(result.error);
        }
    };

    const handleExportFlattened = () => {
        setExportDraft(`${compilationName || loadedFileName || 'Stack'} flat`);
        setExportNaming(true);
        setSaveNaming(false);
    };

    const handleExportFlattenedConfirm = async () => {
        const name = String(exportDraft || '').trim();
        if (!name) {
            return;
        }
        const result = await ipcRenderer.invoke('export-flattened', { name });
        if (result && result.success) {
            setExportNaming(false);
        } else if (result && result.error) {
            setLoadError(result.error);
        }
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

    useEffect(() => {
        const el = audioRef.current;
        if (!el) {
            return;
        }
        const clip = (audioClips || []).find((item) => (
            playheadMs >= (item.startMs || 0)
            && playheadMs < ((item.startMs || 0) + Math.max(0, (item.sourceOutMs || 0) - (item.sourceInMs || 0)))
        ));
        if (!clip || !isPlaying) {
            el.pause();
            if (!isPlaying && !isPaused) {
                el.currentTime = 0;
            }
            return;
        }
        const src = `compmedia://${clip.mediaId}`;
        const mediaTime = ((clip.sourceInMs || 0) + (playheadMs - (clip.startMs || 0))) / 1000;
        if (el.getAttribute('src') !== src) {
            el.src = src;
        }
        if (Math.abs((el.currentTime || 0) - mediaTime) > 0.12) {
            el.currentTime = Math.max(0, mediaTime);
        }
        const play = el.play();
        if (play && play.catch) {
            play.catch(() => {});
        }
    }, [audioClips, isPaused, isPlaying, playheadMs]);

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
        handlePlay,
        handlePause,
        handleStopPlayback,
        handleSeek,
        handleBack,
        handleNext,
        clips,
        audioClips,
        audioMedia,
        trackCount,
        inspector,
        audioRef,
        compilationDirty,
        compilationName,
        projectPath,
        saveNaming,
        saveDraft,
        setSaveDraft,
        exportNaming,
        exportDraft,
        setExportDraft,
        handleSplit,
        handleCutRange,
        handleMoveClip,
        handleTrimClip,
        handleAddTrack,
        handleInspectClip,
        handleInspectApply,
        handleCloseInspector: () => setInspector(null),
        handleImportAudio,
        handleSaveCompilation,
        handleSaveCompilationConfirm,
        handleSaveCompilationCancel: () => setSaveNaming(false),
        handleExportFlattened,
        handleExportFlattenedConfirm,
        handleExportFlattenedCancel: () => setExportNaming(false)
    };
};

module.exports = useStudioSession;
