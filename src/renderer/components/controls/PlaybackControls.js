const React = require('react');
const TransportButtons = require('./TransportButtons');

const PlaybackControls = ({
    networkInterfaces,
    isFileLoaded,
    isPlaying,
    isRecording,
    canRecord,
    isLoopEnabled,
    playbackNetwork,
    displayFileName,
    onLoopChange,
    onPlaybackNetworkChange,
    onPlay,
    onPause,
    onStopPlayback,
    onBack,
    onNext,
    onRecord
}) => React.createElement(React.Fragment, null,
    React.createElement(TransportButtons, {
        isPlaying,
        isRecording,
        disabled: !isFileLoaded || isRecording,
        recordDisabled: isRecording ? false : !canRecord,
        onPlay,
        onPause,
        onStop: onStopPlayback,
        onBack,
        onNext,
        onRecord
    }),

    React.createElement('label', {
        className: 'flex items-center gap-1.5 text-xs text-zinc-500'
    },
        React.createElement('input', {
            type: 'checkbox',
            checked: isLoopEnabled,
            disabled: !isFileLoaded || isRecording,
            onChange: (event) => onLoopChange(event.target.checked),
            className: 'h-3.5 w-3.5 accent-cyan-400'
        }),
        'Loop'
    ),

    React.createElement('select', {
        value: playbackNetwork,
        disabled: !isFileLoaded || isRecording,
        onChange: (event) => onPlaybackNetworkChange(event.target.value),
        className: 'field w-auto min-w-[8rem] py-1',
        title: 'Playback Network'
    },
        (networkInterfaces || []).map((nic) =>
            React.createElement('option', {
                key: nic.ip,
                value: nic.ip
            }, `${nic.name} (${nic.ip})`)
        )
    ),

    React.createElement('span', {
        className: 'text-xs text-zinc-500 truncate max-w-[12rem]',
        title: displayFileName || ''
    }, displayFileName || 'No file')
);

module.exports = PlaybackControls;
