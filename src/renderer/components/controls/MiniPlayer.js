const React = require('react');
const TransportButtons = require('./TransportButtons');
const { IconButton, Icons } = require('../ui');

// Player strip for narrow windows (the full player lives in the left column
// on wide ones). Expand opens the whole player with its queue as a sheet.
const MiniPlayer = ({
    current,
    isFileLoaded,
    isPlaying,
    isRecording,
    playheadMs,
    durationMs,
    formatClock,
    queueLength,
    onPlay,
    onPause,
    onStop,
    onBack,
    onNext,
    onExpand
}) => {
    const disabled = !isFileLoaded || isRecording;
    const duration = Math.max(0, Number(durationMs) || 0);
    const at = Math.max(0, Math.min(duration, Number(playheadMs) || 0));
    const percent = duration > 0 ? (at / duration) * 100 : 0;
    return React.createElement('div', {
        className: 'flex-none relative border-t border-line bg-surface'
    },
        React.createElement('div', {
            className: 'absolute left-0 top-0 h-0.5 bg-accent',
            style: { width: `${percent}%` },
            'aria-hidden': true
        }),
        React.createElement('div', { className: 'flex items-center gap-2 px-2 py-1 min-w-0' },
            React.createElement(TransportButtons, {
                isPlaying,
                disabled,
                onPlay,
                onPause,
                onStop,
                onBack,
                onNext
            }),
            React.createElement('button', {
                type: 'button',
                className: 'flex-1 min-w-0 text-left',
                onClick: onExpand
            },
                React.createElement('div', { className: 'text-xs truncate' },
                    current && current.name ? current.name : (queueLength ? 'Queue ready' : 'No file')),
                React.createElement('div', { className: 'readout mt-0' },
                    `${formatClock(at)} / ${formatClock(duration)}${queueLength ? ` · ${queueLength} in queue` : ''}`)
            ),
            React.createElement(IconButton, {
                label: 'Open player and queue',
                icon: Icons.ChevronUp,
                variant: 'ghost',
                className: 'p-1.5',
                onClick: onExpand
            })
        )
    );
};

module.exports = MiniPlayer;
