const React = require('react');
const UniverseSidebar = require('../universe/UniverseSidebar');
const RecordingControls = require('../controls/RecordingControls');
const ShowTimeline = require('./ShowTimeline');

const StudioPanel = ({
    session,
    selectedUniverses,
    networkInterfaces,
    selectedNic,
    onNetworkChange,
    artnetUniverses,
    sacnUniverses,
    selectedUniverse,
    selectedProtocol,
    onUniverseSelect,
    onSelectAll,
    onUniverseClick
}) => {
    const durationMs = session.isRecording
        ? session.recordingDuration
        : (session.timelineOverview && session.timelineOverview.durationMs) || 0;
    const playheadMs = session.isRecording
        ? session.recordingDuration
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
        className: 'flex-1 min-h-0 flex overflow-hidden bg-zinc-50 dark:bg-zinc-950'
    },
        React.createElement('div', {
            className: 'app-sidebar overflow-y-auto'
        },
            React.createElement(UniverseSidebar, {
                artnetUniverses,
                sacnUniverses,
                selectedUniverse,
                selectedProtocol,
                selectedUniverses,
                selectedNic,
                networkInterfaces,
                onNetworkChange,
                onUniverseSelect,
                onSelectAll,
                onUniverseClick
            })
        ),
        React.createElement('div', {
            className: 'flex flex-1 min-w-0 min-h-0 flex-col'
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
                })
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
                onSeek: session.handleSeek
            }),
            React.createElement('div', {
                className: 'timeline-footer'
            },
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
        )
    );
};

module.exports = StudioPanel;
