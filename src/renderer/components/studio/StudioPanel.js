const React = require('react');
const RecordingControls = require('../controls/RecordingControls');
const ShowTimeline = require('./ShowTimeline');

const StudioPanel = ({
    session,
    selectedUniverses
}) => {
    const punchEndMs = (session.punchInStartMs || 0) + (session.recordingDuration || 0);
    const durationMs = session.isRecording
        ? Math.max(
            punchEndMs,
            (session.timelineOverview && session.timelineOverview.durationMs) || 0
        )
        : (session.timelineOverview && session.timelineOverview.durationMs) || 0;
    const playheadMs = session.isRecording
        ? punchEndMs
        : session.playheadMs;
    const fps = session.isRecording
        ? session.recordingFps
        : (session.playbackStats.fps || 0);
    const frames = session.isRecording
        ? session.frameCount
        : (session.playbackStats.totalFrames || 0);
    const frameIndex = session.isRecording
        ? session.frameCount
        : (session.playbackStats.currentFrame || 0);

    return React.createElement('div', {
        className: 'flex-1 min-h-0 flex flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-950'
    },
            React.createElement('div', {
                className: 'app-toolbar bg-zinc-50 dark:bg-zinc-900'
            },
                React.createElement(RecordingControls, {
                    selectedUniverses,
                    isRecording: session.isRecording,
                    isPlaying: session.isPlaying,
                    recordingPath: session.recordingPath,
                    naming: session.naming,
                    nameDraft: session.nameDraft,
                    onNameDraftChange: session.setNameDraft,
                    onNewFile: session.handleNewFile,
                    onNewFileCancel: session.handleNewFileCancel,
                    onNewFileConfirm: session.handleNewFileConfirm,
                    onStartRecording: session.handleStartRecording,
                    onStopRecording: session.handleStopRecording,
                    onCancelRecording: session.handleCancelRecording
                }),
                session.isFileLoaded && !session.isRecording && React.createElement(React.Fragment, null,
                    React.createElement('button', {
                        type: 'button',
                        className: 'btn-quiet',
                        onClick: session.handleSaveCompilation
                    }, session.compilationDirty ? 'Save compilation…' : 'Save compilation'),
                    React.createElement('button', {
                        type: 'button',
                        className: 'btn-quiet',
                        onClick: session.handleExportFlattened
                    }, 'Export flattened')
                ),
                session.saveNaming && React.createElement('div', {
                    className: 'flex items-center gap-1.5'
                },
                    React.createElement('input', {
                        className: 'field w-40',
                        value: session.saveDraft,
                        onChange: (event) => session.setSaveDraft(event.target.value)
                    }),
                    React.createElement('button', {
                        type: 'button',
                        className: 'btn-primary',
                        onClick: session.handleSaveCompilationConfirm
                    }, 'Save'),
                    React.createElement('button', {
                        type: 'button',
                        className: 'btn-quiet',
                        onClick: session.handleSaveCompilationCancel
                    }, 'Cancel')
                ),
                session.exportNaming && React.createElement('div', {
                    className: 'flex items-center gap-1.5'
                },
                    React.createElement('input', {
                        className: 'field w-40',
                        value: session.exportDraft,
                        onChange: (event) => session.setExportDraft(event.target.value)
                    }),
                    React.createElement('button', {
                        type: 'button',
                        className: 'btn-primary',
                        onClick: session.handleExportFlattenedConfirm
                    }, 'Export'),
                    React.createElement('button', {
                        type: 'button',
                        className: 'btn-quiet',
                        onClick: session.handleExportFlattenedCancel
                    }, 'Cancel')
                )
            ),
            React.createElement(ShowTimeline, {
                overview: session.timelineOverview,
                playheadMs,
                isRecording: session.isRecording,
                recordingDuration: session.recordingDuration,
                selectedUniverses,
                isLoopEnabled: session.isLoopEnabled,
                isFileLoaded: session.isFileLoaded,
                recordingPath: session.recordingPath,
                isIdle: session.isIdle,
                loadError: session.loadError,
                clips: session.clips,
                audioClips: session.audioClips,
                audioMedia: session.audioMedia,
                trackCount: session.trackCount,
                trackNames: session.trackNames,
                selectedTrackId: session.selectedTrackId,
                onSelectTrack: session.handleSelectTrack,
                onRenameTrack: session.handleRenameTrack,
                onReorderTracks: session.handleReorderTracks,
                punchClip: session.punchClip,
                namingClipId: session.namingClipId,
                onNameCommit: session.handleClipNameCommit,
                canRecord: session.canRecord,
                isPlaying: session.isPlaying,
                isPaused: session.isPaused,
                onSeek: session.handleSeek,
                onSplit: session.handleSplit,
                onCutRange: session.handleCutRange,
                onMoveClip: session.handleMoveClip,
                onTrimClip: session.handleTrimClip,
                onAddTrack: session.handleAddTrack,
                onInspectClip: session.handleInspectClip,
                onInspectApply: session.handleInspectApply,
                inspector: session.inspector,
                onCloseInspector: session.handleCloseInspector,
                selectedClipId: session.selectedClipId,
                onSelectClip: session.setSelectedClipId,
                onImportAudio: session.handleImportAudio,
                onCloseGap: session.handleCloseGap,
                onFadeClip: session.handleFadeClip,
                onPlay: session.handlePlay,
                onPause: session.handlePause,
                onStop: session.handleStopPlayback,
                onBack: session.handleBack,
                onNext: session.handleNext,
                onRecord: session.isRecording
                    ? session.handleStopRecording
                    : session.handleStartRecording,
                footer: React.createElement(React.Fragment, null,
                    React.createElement('span', {
                        className: 'readout text-zinc-700 dark:text-zinc-300'
                    }, `${session.formatDuration(playheadMs)}  /  ${session.formatDuration(durationMs)}`),
                    React.createElement('span', {
                        className: 'truncate max-w-[14rem]',
                        title: session.displayFileName || ''
                    }, session.displayFileName
                        ? `${session.isFileLoaded ? 'File' : 'Armed'} · ${session.displayFileName}`
                        : 'No file'),
                    React.createElement('span', { className: 'readout' }, `${fps} fps`),
                    React.createElement('span', { className: 'readout' },
                        frames > 0 ? `${frameIndex}/${frames}` : '0 frames'
                    ),
                    session.isRecording && session.droppedFrames > 0 && React.createElement('span', {
                        className: 'text-red-500'
                    }, `${session.droppedFrames} dropped`)
                )
            }),
        React.createElement('audio', {
            ref: session.audioRef,
            className: 'hidden',
            preload: 'auto'
        })
    );
};

module.exports = StudioPanel;
