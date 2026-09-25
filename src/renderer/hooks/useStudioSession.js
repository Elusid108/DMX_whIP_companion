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

const useStudioSession = (selectedUniverses, selectedNic, { studioVisible } = {}) => {
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
    const [trackNames, setTrackNames] = useState(['Track 1']);
    const [selectedTrackId, setSelectedTrackId] = useState(0);
    const [punchInStartMs, setPunchInStartMs] = useState(0);
    const [punchTrackId, setPunchTrackId] = useState(0);
    const [namingClipId, setNamingClipId] = useState(null);
    const [inspector, setInspector] = useState(null);
    const [selectedClipId, setSelectedClipId] = useState(null);
    const [compilationDirty, setCompilationDirty] = useState(false);
    const [compilationSaveNeeded, setCompilationSaveNeeded] = useState(false);
    const [isArmed, setIsArmed] = useState(false);
    const [startMode, setStartMode] = useState('none');
    const [stopMode, setStopMode] = useState('none');
    const [startChannel, setStartChannel] = useState({ protocol: 'artnet', universe: 0, channel: 1 });
    const [stopChannel, setStopChannel] = useState({ protocol: 'artnet', universe: 0, channel: 1 });
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
    const punchStartRef = useRef(0);
    const lastSelectedTrackRef = useRef(0);
    const studioVisibleRef = useRef(true);
    const clearAfterSaveRef = useRef(false);
    const leaveResolveRef = useRef(null);
    studioVisibleRef.current = studioVisible !== false;

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
                    if (Array.isArray(result.trackNames)) {
                        setTrackNames(result.trackNames);
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
            if (Array.isArray(result.trackNames)) {
                setTrackNames(result.trackNames);
            }
            if (result.namingClipId) {
                setNamingClipId(result.namingClipId);
                setSelectedClipId(result.namingClipId);
            }
            setCompilationDirty(Boolean(result.dirty));
            setCompilationSaveNeeded(Boolean(result.compilationSaveNeeded));
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
            if (result.success && (result.filePath || result.kind === 'compilation' || (result.clips && result.clips.length))) {
                setIsFileLoaded(true);
                setLoadedFileName(result.displayName || fileNameFromPath(result.filePath) || 'Stack');
                setPlayheadMs(
                    typeof result.punchInStartMs === 'number'
                        ? result.punchInStartMs
                        : (typeof result.playheadMs === 'number' ? result.playheadMs : 0)
                );
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
                setTrackNames(['Track 1']);
                setSelectedTrackId(0);
                lastSelectedTrackRef.current = 0;
                setInspector(null);
                setSelectedClipId(null);
                setNamingClipId(null);
                setPunchInStartMs(0);
                setPunchTrackId(0);
                setCompilationDirty(false);
                setCompilationSaveNeeded(false);
                setCompilationName('');
                setProjectPath(null);
                setIsArmed(false);
                return;
            }
            if (result.error && result.error !== 'No file selected') {
                overviewReq.current += 1;
                clearPlaybackUi(setIsFileLoaded, setLoadedFileName, setTimelineOverview, setPlayheadMs);
                setLoadError(result.error);
            }
        };

        const handlePlaybackStats = (event, stats = {}) => {
            if (stats.source === 'player') {
                return;
            }
            setIsPlaying(Boolean(stats.isPlaying));
            setIsPaused(Boolean(stats.isPaused));
            if (stats.isReset) {
                setIsPlaying(false);
                setIsPaused(false);
                if (studioVisibleRef.current) {
                    setPlayheadMs(0);
                }
                return;
            }
            if (!studioVisibleRef.current) {
                return;
            }
            setPlaybackStats(stats);
            if (typeof stats.playheadMs === 'number') {
                setPlayheadMs(stats.playheadMs);
            }
        };

        const handleFrameRecorded = (event, stats = {}) => {
            if (!studioVisibleRef.current) {
                return;
            }
            setFrameCount(stats.totalFrames || 0);
            setRecordingFps(stats.currentFps || 0);
            setDroppedFrames(stats.droppedFrames || 0);
        };

        const handleRecordingError = (event, result = {}) => {
            setIsRecording(false);
            clearInterval(durationTimer.current);
            setLoadError(result.error || 'Recording failed');
        };

        const handlePunchInProgress = (event, payload = {}) => {
            if (!studioVisibleRef.current) {
                return;
            }
            if (typeof payload.trackId === 'number') {
                setPunchTrackId(payload.trackId);
                setSelectedTrackId(payload.trackId);
                lastSelectedTrackRef.current = payload.trackId;
            }
            if (payload.trackCount) {
                setTrackCount(payload.trackCount);
            }
            if (Array.isArray(payload.trackNames)) {
                setTrackNames(payload.trackNames);
            }
            if (typeof payload.durationMs === 'number') {
                setRecordingDuration(payload.durationMs);
                setPlayheadMs((payload.startMs || punchStartRef.current || 0) + payload.durationMs);
            }
        };

        const handleRecordingSaved = async (event, result = {}) => {
            if (result.punchIn) {
                return;
            }
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
        const handlePunchInStarted = (event, result = {}) => {
            setIsArmed(false);
            setIsRecording(true);
            recordingStartTime.current = Date.now();
            setRecordingDuration(0);
            setFrameCount(0);
            setDroppedFrames(0);
            setLoadError('');
            setIsFileLoaded(true);
            applyCompilation(result);
            if (typeof result.punchInStartMs === 'number') {
                setPunchInStartMs(result.punchInStartMs);
                setPlayheadMs(result.punchInStartMs);
            }
            if (typeof result.punchTrackId === 'number') {
                setPunchTrackId(result.punchTrackId);
                setSelectedTrackId(result.punchTrackId);
                lastSelectedTrackRef.current = result.punchTrackId;
            }
        };

        const handlePunchInAutoStopped = (event, result = {}) => {
            setIsRecording(false);
            setIsArmed(false);
            clearInterval(durationTimer.current);
            if (!result || !result.success) {
                setLoadError((result && result.error) || 'Could not stop recording');
                return;
            }
            applyCompilation(result);
            setIsFileLoaded(true);
            if (typeof result.playheadMs === 'number') {
                setPlayheadMs(result.playheadMs);
            }
        };

        const handlePunchInFailed = (event, result = {}) => {
            setIsRecording(false);
            setIsArmed(false);
            clearInterval(durationTimer.current);
            setRecordingDuration(0);
            setFrameCount(0);
            setLoadError((result && result.error) || 'Recording failed');
        };

        ipcRenderer.on('punch-in-progress', handlePunchInProgress);
        ipcRenderer.on('punch-in-started', handlePunchInStarted);
        ipcRenderer.on('punch-in-auto-stopped', handlePunchInAutoStopped);
        ipcRenderer.on('punch-in-failed', handlePunchInFailed);

        return () => {
            ipcRenderer.removeListener('file-loaded', handleFileLoaded);
            ipcRenderer.removeListener('compilation-updated', handleCompilationUpdated);
            ipcRenderer.removeListener('playback-stats', handlePlaybackStats);
            ipcRenderer.removeListener('recording-stats-update', handleFrameRecorded);
            ipcRenderer.removeListener('recording-error', handleRecordingError);
            ipcRenderer.removeListener('recording-saved', handleRecordingSaved);
            ipcRenderer.removeListener('punch-in-progress', handlePunchInProgress);
            ipcRenderer.removeListener('punch-in-started', handlePunchInStarted);
            ipcRenderer.removeListener('punch-in-auto-stopped', handlePunchInAutoStopped);
            ipcRenderer.removeListener('punch-in-failed', handlePunchInFailed);
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
        setTrackNames(['Track 1']);
        setSelectedTrackId(0);
        lastSelectedTrackRef.current = 0;
        setInspector(null);
        setSelectedClipId(null);
        setNamingClipId(null);
        setPunchInStartMs(0);
        setPunchTrackId(0);
        setCompilationDirty(false);
        setCompilationSaveNeeded(false);
        setIsArmed(false);
        setCompilationName('');
        setProjectPath(null);
    };

    const handleSelectTrack = (trackId) => {
        const next = Math.max(0, Math.round(Number(trackId) || 0));
        setSelectedTrackId(next);
        lastSelectedTrackRef.current = next;
    };

    const handleRenameTrack = (trackId, name) => {
        ipcRenderer.invoke('edit-compilation', {
            op: 'rename-track',
            trackId,
            name,
            keepPlayheadMs: playheadMs
        }).then((result) => {
            if (result && !result.success && result.error) {
                setLoadError(result.error);
            }
        });
    };

    const handleReorderTracks = (from, to) => {
        ipcRenderer.invoke('edit-compilation', {
            op: 'reorder-tracks',
            from,
            to,
            keepPlayheadMs: playheadMs
        }).then((result) => {
            if (result && !result.success && result.error) {
                setLoadError(result.error);
                return;
            }
            if (selectedTrackId === from) {
                handleSelectTrack(to);
            } else if (from < to && selectedTrackId > from && selectedTrackId <= to) {
                handleSelectTrack(selectedTrackId - 1);
            } else if (from > to && selectedTrackId >= to && selectedTrackId < from) {
                handleSelectTrack(selectedTrackId + 1);
            }
        });
    };

    const handleClipNameCommit = async (clipId, name) => {
        setNamingClipId(null);
        const trimmed = String(name || '').trim() || 'Clip';
        const updated = await ipcRenderer.invoke('edit-compilation', {
            op: 'update',
            clipId,
            patch: { name: trimmed },
            keepPlayheadMs: playheadMs
        });
        if (updated && !updated.success && updated.error) {
            setLoadError(updated.error);
        }
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

    const handleCloseGap = (gapLeft, gapRight) => {
        ipcRenderer.invoke('edit-compilation', {
            op: 'close-gap',
            gapLeft,
            gapRight,
            keepPlayheadMs: playheadMs
        }).then((result) => {
            if (result && !result.success && result.error) {
                setLoadError(result.error);
            }
        });
    };

    const handleFadeClip = (clipId, patch) => {
        ipcRenderer.invoke('edit-compilation', {
            op: 'update',
            clipId,
            patch,
            keepPlayheadMs: playheadMs
        }).then((result) => {
            if (result && !result.success && result.error) {
                setLoadError(result.error);
            }
        });
    };

    const selectedIds = () => {
        const light = (clips || []).some((clip) => clip.id === selectedClipId) ? [selectedClipId] : [];
        const audio = (audioClips || []).some((clip) => clip.id === selectedClipId) ? [selectedClipId] : [];
        return { light, audio };
    };

    const handleCopyClips = () => {
        const { light, audio } = selectedIds();
        if (!light.length && !audio.length) {
            return;
        }
        ipcRenderer.invoke('edit-compilation', {
            op: 'copy',
            clipIds: light,
            audioIds: audio
        });
    };

    const handleCutClips = () => {
        const { light, audio } = selectedIds();
        if (!light.length && !audio.length) {
            return;
        }
        ipcRenderer.invoke('edit-compilation', {
            op: 'cut-clips',
            clipIds: light,
            audioIds: audio,
            keepPlayheadMs: playheadMs
        }).then((result) => {
            if (result && result.success) {
                setSelectedClipId(null);
            } else if (result && result.error) {
                setLoadError(result.error);
            }
        });
    };

    const handleDeleteClips = () => {
        const { light, audio } = selectedIds();
        if (!light.length && !audio.length) {
            return;
        }
        ipcRenderer.invoke('edit-compilation', {
            op: 'delete',
            clipIds: light,
            audioIds: audio,
            keepPlayheadMs: playheadMs
        }).then((result) => {
            if (result && result.success) {
                setSelectedClipId(null);
            } else if (result && result.error) {
                setLoadError(result.error);
            }
        });
    };

    const handlePasteClips = () => {
        ipcRenderer.invoke('edit-compilation', {
            op: 'paste',
            timeMs: playheadMs,
            keepPlayheadMs: playheadMs
        }).then((result) => {
            if (result && !result.success && result.error) {
                setLoadError(result.error);
            }
        });
    };

    const handleUndo = () => {
        ipcRenderer.invoke('undo-compilation').then((result) => {
            if (result && !result.success && result.error && result.error !== 'Nothing to undo') {
                setLoadError(result.error);
            }
        });
    };

    const handleRedo = () => {
        ipcRenderer.invoke('redo-compilation').then((result) => {
            if (result && !result.success && result.error && result.error !== 'Nothing to redo') {
                setLoadError(result.error);
            }
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
            source: 'studio',
            loop: isLoopEnabled,
            playbackNetwork
        });
    };

    const handlePause = () => {
        if (!isPlaying) {
            return;
        }
        ipcRenderer.send('toggle-playback', {
            source: 'studio',
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

    const clearStudio = () => {
        unloadPlayback();
        setRecordingPath(null);
        setRecordingDuration(0);
        setFrameCount(0);
        setRecordingFps(0);
        setDroppedFrames(0);
        setSaveNaming(false);
        setExportNaming(false);
        setLoadError('');
        clearAfterSaveRef.current = false;
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
            setCompilationSaveNeeded(false);
            setCompilationName(name);
            setLoadedFileName(name);
            if (clearAfterSaveRef.current) {
                clearStudio();
            }
            if (leaveResolveRef.current) {
                const resolve = leaveResolveRef.current;
                leaveResolveRef.current = null;
                resolve(true);
            }
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

    const handleNewFile = async () => {
        if (isRecording) {
            return;
        }
        if (isArmed) {
            await ipcRenderer.invoke('cancel-punch-in');
            setIsArmed(false);
        }
        if (compilationSaveNeeded) {
            const result = await ipcRenderer.invoke('confirm-unsaved-compilation', { reason: 'new' });
            const choice = result && result.choice;
            if (choice === 'cancel' || !choice) {
                return;
            }
            if (choice === 'save') {
                const existing = String(compilationName || '').trim();
                if (existing && existing !== 'Untitled') {
                    const saved = await ipcRenderer.invoke('save-compilation', { name: existing });
                    if (!saved || !saved.success) {
                        setLoadError((saved && saved.error) || 'Could not save');
                        return;
                    }
                    setCompilationDirty(false);
                    clearStudio();
                    return;
                }
                clearAfterSaveRef.current = true;
                setSaveDraft(compilationName || loadedFileName || 'Stack');
                setSaveNaming(true);
                setExportNaming(false);
                return;
            }
        }
        clearStudio();
    };

    const namedCompilation = () => {
        const existing = String(compilationName || '').trim();
        return existing && existing !== 'Untitled' ? existing : '';
    };

    const requestLeaveStudio = async () => {
        if (isRecording) {
            return false;
        }
        if (isArmed) {
            await ipcRenderer.invoke('cancel-punch-in');
            setIsArmed(false);
        }
        if (!compilationSaveNeeded) {
            return true;
        }
        const result = await ipcRenderer.invoke('confirm-unsaved-compilation', { reason: 'leave' });
        const choice = result && result.choice;
        if (choice === 'cancel' || !choice) {
            return false;
        }
        if (choice === 'discard') {
            return true;
        }
        const existing = namedCompilation();
        if (existing) {
            const saved = await ipcRenderer.invoke('save-compilation', { name: existing });
            if (!saved || !saved.success) {
                setLoadError((saved && saved.error) || 'Could not save');
                return false;
            }
            setCompilationDirty(false);
            setCompilationSaveNeeded(false);
            return true;
        }
        return new Promise((resolve) => {
            leaveResolveRef.current = resolve;
            setSaveDraft(compilationName || loadedFileName || 'Stack');
            setSaveNaming(true);
            setExportNaming(false);
        });
    };

    const handleStartRecording = async () => {
        if (isRecording || isArmed) {
            return;
        }
        if (!selectedUniverses || selectedUniverses.size === 0) {
            setLoadError('Select at least one universe to record');
            return;
        }
        const trackId = selectedTrackId != null
            ? selectedTrackId
            : (lastSelectedTrackRef.current || 0);
        const startMs = isFileLoaded ? playheadMs : 0;
        punchStartRef.current = startMs;
        setPunchInStartMs(startMs);
        setPunchTrackId(trackId);
        setSelectedTrackId(trackId);
        lastSelectedTrackRef.current = trackId;
        setRecordingDuration(0);
        setFrameCount(0);
        setDroppedFrames(0);
        setLoadError('');
        try {
            const result = await ipcRenderer.invoke('start-punch-in', {
                trackId,
                startMs,
                playbackNetwork,
                startMode,
                stopMode,
                startChannel,
                stopChannel
            });
            if (!result || !result.success) {
                setIsRecording(false);
                setIsArmed(false);
                clearInterval(durationTimer.current);
                setLoadError((result && result.error) || 'Could not start recording');
                return;
            }
            if (result.armed) {
                setIsArmed(true);
                setIsRecording(false);
                return;
            }
            setIsRecording(true);
            recordingStartTime.current = Date.now();
            setIsFileLoaded(true);
            if (Array.isArray(result.clips)) {
                setClips(result.clips);
            }
            if (result.trackCount) {
                setTrackCount(result.trackCount);
            }
            if (Array.isArray(result.trackNames)) {
                setTrackNames(result.trackNames);
            }
            if (typeof result.punchTrackId === 'number') {
                setPunchTrackId(result.punchTrackId);
                setSelectedTrackId(result.punchTrackId);
                lastSelectedTrackRef.current = result.punchTrackId;
            }
            if (result.displayName) {
                setLoadedFileName(result.displayName);
                setCompilationName(result.displayName);
            }
        } catch (error) {
            setIsRecording(false);
            setIsArmed(false);
            clearInterval(durationTimer.current);
            setLoadError(error.message);
        }
    };

    const handleStopRecording = async () => {
        setIsRecording(false);
        clearInterval(durationTimer.current);
        try {
            const result = await ipcRenderer.invoke('stop-punch-in');
            if (result && result.success) {
                if (Array.isArray(result.clips)) {
                    setClips(result.clips);
                }
                if (result.trackCount) {
                    setTrackCount(result.trackCount);
                }
                if (Array.isArray(result.trackNames)) {
                    setTrackNames(result.trackNames);
                }
                setCompilationDirty(Boolean(result.dirty));
                setCompilationSaveNeeded(Boolean(result.compilationSaveNeeded));
                setIsFileLoaded(true);
                if (result.namingClipId) {
                    setNamingClipId(result.namingClipId);
                    setSelectedClipId(result.namingClipId);
                }
                if (typeof result.playheadMs === 'number') {
                    setPlayheadMs(result.playheadMs);
                }
                return;
            }
            if (result && result.error) {
                setLoadError(result.error);
            }
        } catch (error) {
            setLoadError(error.message);
        }
    };

    const handleCancelRecording = async () => {
        if (!isRecording && !isArmed) {
            return;
        }
        if (isRecording && !window.confirm('Discard this recording? It will not be saved.')) {
            return;
        }
        try {
            await ipcRenderer.invoke('cancel-punch-in');
            setIsRecording(false);
            setIsArmed(false);
            clearInterval(durationTimer.current);
            setRecordingDuration(0);
            setFrameCount(0);
            setRecordingFps(0);
            setDroppedFrames(0);
            setPunchInStartMs(0);
            setLoadError('');
            setPlayheadMs(punchStartRef.current || 0);
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
            source: 'studio',
            loop: isLoopEnabled,
            playbackNetwork
        });
    };

    const handleStopPlayback = () => {
        ipcRenderer.send('stop-playback', { source: 'studio' });
        setPlayheadMs(0);
    };

    const handleSeek = (timeMs) => {
        if (!isFileLoaded || isRecording) {
            return;
        }
        const next = Math.max(0, Number(timeMs) || 0);
        setPlayheadMs(next);
        ipcRenderer.send('seek-playback', {
            source: 'studio',
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
        if (!clip || !(isPlaying || isRecording)) {
            el.pause();
            if (!isPlaying && !isPaused && !isRecording) {
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
    }, [audioClips, isPaused, isPlaying, isRecording, playheadMs]);

    const recordingFileName = fileNameFromPath(recordingPath);
    const displayFileName = loadedFileName || recordingFileName;
    const canRecord = Boolean(isRecording || (selectedUniverses && selectedUniverses.size > 0));
    const punchClip = isRecording
        ? {
            id: '__punch__',
            name: 'Recording',
            live: true,
            trackId: punchTrackId,
            startMs: punchInStartMs,
            sourceInMs: 0,
            sourceOutMs: recordingDuration
        }
        : null;
    const showPlaybackStats = (isPlaying || isPaused) && playbackStats.currentFrame !== null;
    const showPlaybackControls = isFileLoaded && !isRecording;
    const showLoad = !isRecording && !(recordingPath && !isFileLoaded);
    const isIdle = !isRecording && !showPlaybackStats && !recordingPath && !isFileLoaded && !loadError;

    return {
        isRecording,
        isArmed,
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
        requestLeaveStudio,
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
        trackNames,
        selectedTrackId,
        punchInStartMs,
        punchClip,
        namingClipId,
        handleSelectTrack,
        handleRenameTrack,
        handleReorderTracks,
        handleClipNameCommit,
        inspector,
        selectedClipId,
        setSelectedClipId,
        audioRef,
        compilationDirty,
        compilationSaveNeeded,
        compilationName,
        startMode,
        setStartMode,
        stopMode,
        setStopMode,
        startChannel,
        setStartChannel,
        stopChannel,
        setStopChannel,
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
        handleCloseGap,
        handleFadeClip,
        handleCopyClips,
        handleCutClips,
        handleDeleteClips,
        handlePasteClips,
        handleUndo,
        handleRedo,
        handleImportAudio,
        handleSaveCompilation,
        handleSaveCompilationConfirm,
        handleSaveCompilationCancel: () => {
            clearAfterSaveRef.current = false;
            setSaveNaming(false);
            if (leaveResolveRef.current) {
                const resolve = leaveResolveRef.current;
                leaveResolveRef.current = null;
                resolve(false);
            }
        },
        handleExportFlattened,
        handleExportFlattenedConfirm,
        handleExportFlattenedCancel: () => setExportNaming(false)
    };
};

module.exports = useStudioSession;
