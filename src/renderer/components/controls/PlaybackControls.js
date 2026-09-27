const React = require('react');
const TransportButtons = require('./TransportButtons');
const { EmptyState, IconButton, Icons, Slider } = require('../ui');

const RowAction = ({ label, icon, disabled, onClick }) => React.createElement(IconButton, {
    label,
    icon,
    iconClassName: 'w-3 h-3',
    variant: 'ghost',
    disabled,
    onClick: (event) => {
        event.stopPropagation();
        onClick();
    }
});

const PlaybackControls = ({
    queue,
    currentIndex,
    current,
    collapsed,
    onToggleCollapsed,
    isFileLoaded,
    isPlaying,
    isRecording,
    isLoopEnabled,
    playheadMs,
    durationMs,
    formatClock,
    onToggleLoop,
    onPlay,
    onPause,
    onStopPlayback,
    onBack,
    onNext,
    onSeek,
    onSelect,
    onMove,
    onRemove,
    onClear,
    error
}) => {
    const disabled = !isFileLoaded || isRecording;
    const duration = Math.max(0, Number(durationMs) || 0);
    const currentMs = Math.max(0, Math.min(duration, Number(playheadMs) || 0));
    // 0.5% steps: under a pixel on the rail, and a useful arrow-key jump.
    const seekStep = Math.max(1, duration / 200);

    return React.createElement('div', {
        className: 'flex-none flex flex-col gap-1.5 p-2 border-t border-line bg-surface'
    },
        error && React.createElement('p', {
            className: 'text-[11px] text-danger truncate',
            title: error,
            role: 'alert'
        }, error),
        React.createElement('div', {
            className: 'flex items-center gap-1 min-w-0'
        },
            React.createElement('button', {
                type: 'button',
                className: 'flex items-center gap-1 min-w-0 flex-1 text-xs text-muted hover:text-fg-strong',
                'aria-expanded': !collapsed,
                onClick: onToggleCollapsed
            },
                React.createElement(Icons.Chevron, {
                    className: `w-3 h-3 transition-transform ${collapsed ? '' : 'rotate-90'}`
                }),
                React.createElement('span', {
                    className: 'truncate'
                }, `Queue · ${queue.length}`)
            ),
            React.createElement('button', {
                type: 'button',
                className: 'btn-quiet flex-none px-1.5 py-0.5',
                disabled: queue.length === 0 || isRecording,
                onClick: onClear
            }, 'Clear queue')
        ),
        !collapsed && React.createElement('div', {
            className: 'max-h-14 overflow-y-auto flex flex-col gap-0.5'
        },
            queue.length === 0
                ? React.createElement(EmptyState, {
                    size: 'xs',
                    className: 'px-0.5'
                }, 'Play or + a look from Library.')
                : queue.map((item, index) => React.createElement('div', {
                    key: item.id,
                    className: `group flex items-center gap-0.5 text-xs px-1 py-0.5 rounded ${
                        index === currentIndex
                            ? 'bg-selected text-accent'
                            : 'text-fg-soft hover:bg-hover'
                    }`
                },
                    React.createElement('button', {
                        type: 'button',
                        className: 'truncate flex-1 min-w-0 text-left',
                        title: item.name,
                        disabled: isRecording,
                        onClick: () => onSelect(index)
                    }, item.name),
                    React.createElement('div', {
                        className: 'flex-none hidden group-hover:flex items-center'
                    },
                        React.createElement(RowAction, {
                            label: 'Move up',
                            icon: Icons.ArrowUp,
                            disabled: isRecording || index === 0,
                            onClick: () => onMove(index, -1)
                        }),
                        React.createElement(RowAction, {
                            label: 'Move down',
                            icon: Icons.ArrowDown,
                            disabled: isRecording || index === queue.length - 1,
                            onClick: () => onMove(index, 1)
                        }),
                        React.createElement(RowAction, {
                            label: 'Remove',
                            icon: Icons.Close,
                            disabled: isRecording,
                            onClick: () => onRemove(index)
                        })
                    )
                ))
        ),
        React.createElement('div', {
            className: 'flex items-center gap-1 min-w-0'
        },
            React.createElement(TransportButtons, {
                isPlaying,
                disabled,
                onPlay,
                onPause,
                onStop: onStopPlayback,
                onBack,
                onNext
            }),
            React.createElement(IconButton, {
                label: isLoopEnabled ? 'Repeat on' : 'Repeat off',
                icon: Icons.Repeat,
                pressed: isLoopEnabled,
                disabled,
                onClick: onToggleLoop
            })
        ),
        React.createElement('div', {
            className: 'flex items-center gap-1.5 min-w-0'
        },
            React.createElement('span', {
                className: 'readout flex-none w-3 text-right'
            }, '0'),
            React.createElement(Slider, {
                className: 'flex-1 min-w-0',
                label: 'Seek',
                value: currentMs,
                min: 0,
                max: Math.max(1, duration),
                step: seekStep,
                valueText: formatClock(currentMs),
                disabled: disabled || duration <= 0,
                onCommit: onSeek
            }),
            React.createElement('span', {
                className: 'readout flex-none min-w-[2.25rem] text-right'
            }, formatClock(duration))
        ),
        React.createElement('div', {
            className: 'flex items-center justify-between gap-2 min-w-0'
        },
            React.createElement('span', {
                className: 'text-xs text-muted truncate',
                title: current && current.name ? current.name : ''
            }, current && current.name ? current.name : 'No file'),
            React.createElement('span', {
                className: 'readout flex-none'
            }, formatClock(currentMs))
        )
    );
};

module.exports = PlaybackControls;
