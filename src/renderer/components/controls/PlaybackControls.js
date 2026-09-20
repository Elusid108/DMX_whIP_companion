const React = require('react');
const TransportButtons = require('./TransportButtons');

const RepeatIcon = ({ on }) => React.createElement('svg', {
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className: `w-3.5 h-3.5 ${on ? 'text-cyan-500' : ''}`,
    'aria-hidden': true
},
    React.createElement('path', { d: 'M17 2l4 4-4 4' }),
    React.createElement('path', { d: 'M3 11V9a4 4 0 0 1 4-4h14' }),
    React.createElement('path', { d: 'M7 22l-4-4 4-4' }),
    React.createElement('path', { d: 'M21 13v2a4 4 0 0 1-4 4H3' })
);

const Chevron = ({ open }) => React.createElement('svg', {
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className: `w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`,
    'aria-hidden': true
}, React.createElement('path', { d: 'M9 6l6 6-6 6' }));

const IconBtn = ({ title, disabled, onClick, children }) => React.createElement('button', {
    type: 'button',
    className: 'flex-none p-0.5 rounded text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 disabled:opacity-30',
    title,
    'aria-label': title,
    disabled,
    onClick: (event) => {
        event.stopPropagation();
        if (onClick) {
            onClick();
        }
    }
}, children);

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
    onClear
}) => {
    const disabled = !isFileLoaded || isRecording;
    const duration = Math.max(0, Number(durationMs) || 0);
    const currentMs = Math.max(0, Math.min(duration, Number(playheadMs) || 0));
    const percent = duration > 0 ? (currentMs / duration) * 100 : 0;

    const seekFromEvent = (event) => {
        if (disabled || duration <= 0) {
            return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
        onSeek((x / rect.width) * duration);
    };

    return React.createElement('div', {
        className: 'flex-none flex flex-col gap-1.5 p-2 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900'
    },
        React.createElement('div', {
            className: 'flex items-center gap-1 min-w-0'
        },
            React.createElement('button', {
                type: 'button',
                className: 'flex items-center gap-1 min-w-0 flex-1 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200',
                onClick: onToggleCollapsed
            },
                React.createElement(Chevron, { open: !collapsed }),
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
                ? React.createElement('p', {
                    className: 'text-xs text-zinc-500 italic px-0.5'
                }, 'Play or + a look from Library.')
                : queue.map((item, index) => React.createElement('div', {
                    key: item.id,
                    className: `group flex items-center gap-0.5 text-xs px-1 py-0.5 rounded ${
                        index === currentIndex
                            ? 'bg-cyan-50 text-cyan-700 dark:bg-zinc-800 dark:text-cyan-400'
                            : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
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
                        React.createElement(IconBtn, {
                            title: 'Move up',
                            disabled: isRecording || index === 0,
                            onClick: () => onMove(index, -1)
                        }, '▲'),
                        React.createElement(IconBtn, {
                            title: 'Move down',
                            disabled: isRecording || index === queue.length - 1,
                            onClick: () => onMove(index, 1)
                        }, '▼'),
                        React.createElement(IconBtn, {
                            title: 'Remove',
                            disabled: isRecording,
                            onClick: () => onRemove(index)
                        }, '×')
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
            React.createElement('button', {
                type: 'button',
                className: `btn-quiet flex-none p-1.5 ${isLoopEnabled ? 'border-cyan-500 text-cyan-600 dark:text-cyan-400' : ''}`,
                title: isLoopEnabled ? 'Repeat on' : 'Repeat off',
                'aria-label': isLoopEnabled ? 'Repeat on' : 'Repeat off',
                'aria-pressed': isLoopEnabled,
                disabled,
                onClick: onToggleLoop
            }, React.createElement(RepeatIcon, { on: isLoopEnabled }))
        ),
        React.createElement('div', {
            className: 'flex items-center gap-1.5 min-w-0'
        },
            React.createElement('span', {
                className: 'readout flex-none w-3 text-right'
            }, '0'),
            React.createElement('button', {
                type: 'button',
                className: 'relative flex-1 h-3 rounded-full bg-zinc-200 dark:bg-zinc-800 disabled:opacity-50',
                disabled,
                title: 'Seek',
                'aria-label': 'Seek',
                onClick: seekFromEvent
            },
                React.createElement('span', {
                    className: 'absolute left-0 top-1/2 -translate-y-1/2 h-0.5 rounded-full bg-cyan-500',
                    style: { width: `${percent}%` }
                }),
                React.createElement('span', {
                    className: 'absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-2 w-2 rounded-full bg-cyan-500',
                    style: { left: `${percent}%` }
                })
            ),
            React.createElement('span', {
                className: 'readout flex-none min-w-[2.25rem] text-right'
            }, formatClock(duration))
        ),
        React.createElement('div', {
            className: 'flex items-center justify-between gap-2 min-w-0'
        },
            React.createElement('span', {
                className: 'text-xs text-zinc-500 truncate',
                title: current && current.name ? current.name : ''
            }, current && current.name ? current.name : 'No file'),
            React.createElement('span', {
                className: 'readout flex-none'
            }, formatClock(currentMs))
        )
    );
};

module.exports = PlaybackControls;
