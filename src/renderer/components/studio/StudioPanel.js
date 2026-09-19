const React = require('react');
const UniverseSidebar = require('../universe/UniverseSidebar');
const RecordingControls = require('../controls/RecordingControls');
const PlaybackControls = require('../controls/PlaybackControls');
const useStudioSession = require('../../hooks/useStudioSession');

const Kv = ({ label, value, danger }) => React.createElement('div', {
    className: 'kv-row text-sm'
},
    React.createElement('span', {
        className: 'text-xs text-zinc-500 w-28 flex-none'
    }, label),
    React.createElement('span', {
        className: danger ? 'text-red-500 truncate' : 'truncate'
    }, value)
);

const StudioPanel = ({
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
    const session = useStudioSession(selectedUniverses, selectedNic);

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
                    isLoading: session.isLoading,
                    recordingPath: session.recordingPath,
                    naming: session.naming,
                    nameDraft: session.nameDraft,
                    onNameDraftChange: session.setNameDraft,
                    onNewFile: session.handleNewFile,
                    onNewFileCancel: session.handleNewFileCancel,
                    onNewFileConfirm: session.handleNewFileConfirm,
                    showLoad: session.showLoad,
                    onStartRecording: session.handleStartRecording,
                    onStopRecording: session.handleStopRecording,
                    onCancelRecording: session.handleCancelRecording,
                    onLoadFile: session.handleLoadFile
                }),
                session.showPlaybackControls && React.createElement(PlaybackControls, {
                    networkInterfaces,
                    isFileLoaded: session.isFileLoaded,
                    isPlaying: session.isPlaying,
                    isRecording: session.isRecording,
                    isLoopEnabled: session.isLoopEnabled,
                    playbackNetwork: session.playbackNetwork,
                    displayFileName: session.displayFileName,
                    onLoopChange: session.setIsLoopEnabled,
                    onPlaybackNetworkChange: session.setPlaybackNetwork,
                    onPlayback: session.handlePlayback,
                    onStopPlayback: session.handleStopPlayback
                })
            ),
            React.createElement('div', {
                className: 'flex-1 p-3 min-h-0 overflow-auto bg-white dark:bg-zinc-900'
            },
                session.loadError && React.createElement('p', {
                    className: 'text-sm text-red-500 mb-3'
                }, session.loadError),
                session.isIdle && React.createElement('p', {
                    className: 'text-sm text-zinc-500'
                }, 'Select universes, create or load a file, then record or play.'),
                !session.isIdle && React.createElement('div', {
                    className: 'flex flex-col gap-1.5 max-w-xl'
                },
                    session.displayFileName && React.createElement(Kv, {
                        label: session.isFileLoaded ? 'File' : 'Armed',
                        value: session.displayFileName
                    }),
                    session.isRecording && React.createElement(React.Fragment, null,
                        React.createElement(Kv, {
                            label: 'Duration',
                            value: session.formatDuration(session.recordingDuration)
                        }),
                        React.createElement(Kv, {
                            label: 'Rate',
                            value: `${session.recordingFps} fps`
                        }),
                        React.createElement(Kv, {
                            label: 'Frames',
                            value: String(session.frameCount)
                        }),
                        React.createElement(Kv, {
                            label: 'Dropped',
                            value: String(session.droppedFrames),
                            danger: session.droppedFrames > 0
                        })
                    ),
                    session.showPlaybackStats && React.createElement(React.Fragment, null,
                        React.createElement(Kv, {
                            label: 'Clip',
                            value: session.formatDuration(session.playbackStats.clipTime)
                        }),
                        React.createElement(Kv, {
                            label: 'Total',
                            value: session.formatDuration(session.playbackStats.totalPlayTime)
                        }),
                        React.createElement(Kv, {
                            label: 'Frame',
                            value: `${session.playbackStats.currentFrame}/${session.playbackStats.totalFrames}`
                        }),
                        React.createElement(Kv, {
                            label: 'Rate',
                            value: `${session.playbackStats.fps} fps`
                        })
                    )
                )
            )
        )
    );
};

module.exports = StudioPanel;
