const React = require('react');

const formatDuration = (ms) => {
    const value = Number(ms) || 0;
    const minutes = Math.floor(value / 60000);
    const seconds = Math.floor((value % 60000) / 1000);
    const hundredths = Math.floor((value % 1000) / 10);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}:${hundredths.toString().padStart(2, '0')}`;
};

const formatBytes = (bytes) => {
    const value = Number(bytes) || 0;
    if (value < 1024) {
        return `${value} B`;
    }
    if (value < 1024 * 1024) {
        return `${(value / 1024).toFixed(1)} KB`;
    }
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDate = (ms) => {
    if (!ms) {
        return '—';
    }
    return new Date(ms).toLocaleString();
};

const formatRate = (rate) => {
    if (!rate) {
        return '0';
    }
    return Number(rate).toFixed(1);
};

const protocolLabel = (protocols) => {
    if (!protocols || protocols.length === 0) {
        return '—';
    }
    return protocols.map((protocol) => (protocol === 'artnet' ? 'Art-Net' : 'sACN')).join(', ');
};

const Field = ({ label, children }) => React.createElement('div', {
    className: 'flex flex-col gap-1'
},
    React.createElement('label', {
        className: 'text-xs font-medium text-zinc-500'
    }, label),
    children
);

const Kv = ({ label, value }) => React.createElement('div', {
    className: 'kv-row text-sm'
},
    React.createElement('span', { className: 'text-xs text-zinc-500 w-24 flex-none' }, label),
    React.createElement('span', { className: 'truncate' }, value)
);

const ShowInspector = ({
    show,
    name,
    notes,
    busy,
    devices,
    targetId,
    pushing,
    pushError,
    onNameChange,
    onNotesChange,
    onPlay,
    onRename,
    onDelete,
    onExport,
    onTargetChange,
    onPush
}) => {
    if (!show) {
        return React.createElement('div', {
            className: 'text-sm text-zinc-500 italic p-2'
        }, 'Select a show to see details.');
    }

    const playable = Boolean(show.playable);
    const targets = (devices || []).filter((device) => device && device.ip && !device.stale);
    const canPush = playable && Boolean(targetId) && targets.some((device) => device.id === targetId);

    return React.createElement('div', {
        className: 'overflow-y-auto h-full'
    },
        React.createElement('div', {
            className: 'flex flex-col gap-2 w-[60%] mx-auto'
        },
            React.createElement(Field, { label: 'Display name' },
                React.createElement('input', {
                    className: 'field',
                    value: name,
                    disabled: busy,
                    onChange: (event) => onNameChange(event.target.value)
                })
            ),
            React.createElement(Field, { label: 'Notes' },
                React.createElement('textarea', {
                    className: 'field min-h-[5rem]',
                    value: notes,
                    disabled: busy,
                    onChange: (event) => onNotesChange(event.target.value)
                })
            ),
            React.createElement('div', {
                className: 'grid grid-cols-2 gap-1.5'
            },
                React.createElement(Kv, { label: 'File', value: show.filename }),
                React.createElement(Kv, { label: 'Size', value: formatBytes(show.size) }),
                React.createElement(Kv, { label: 'Duration', value: formatDuration(show.duration) }),
                React.createElement(Kv, { label: 'Frames', value: String(show.frameCount || 0) }),
                React.createElement(Kv, { label: 'Packet rate', value: `${formatRate(show.packetRate)} /s` }),
                React.createElement(Kv, { label: 'Protocol', value: protocolLabel(show.protocols) }),
                React.createElement(Kv, { label: 'Created', value: formatDate(show.created) }),
                React.createElement(Kv, { label: 'Modified', value: formatDate(show.modified) })
            ),
            show.error && React.createElement('div', {
                className: 'text-sm text-red-500'
            }, show.error),
            show.perUniverse && show.perUniverse.length > 0 && React.createElement('div', {
                className: 'overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800'
            },
                React.createElement('table', {
                    className: 'w-full text-xs text-left'
                },
                    React.createElement('thead', null,
                        React.createElement('tr', {
                            className: 'text-zinc-500'
                        },
                            React.createElement('th', { className: 'py-1.5 px-2' }, 'Universe'),
                            React.createElement('th', { className: 'py-1.5 px-2' }, 'Protocol'),
                            React.createElement('th', { className: 'py-1.5 px-2' }, 'Packets'),
                            React.createElement('th', { className: 'py-1.5 px-2' }, 'Rate /s'),
                            React.createElement('th', { className: 'py-1.5 px-2' }, 'Woken ch')
                        )
                    ),
                    React.createElement('tbody', null,
                        show.perUniverse.map((row) => React.createElement('tr', {
                            key: `${row.protocol}-${row.id}`,
                            className: 'border-t border-zinc-200 dark:border-zinc-800'
                        },
                            React.createElement('td', { className: 'py-1.5 px-2' }, row.id),
                            React.createElement('td', { className: 'py-1.5 px-2' }, row.protocol === 'artnet' ? 'Art-Net' : 'sACN'),
                            React.createElement('td', { className: 'py-1.5 px-2' }, row.packets),
                            React.createElement('td', { className: 'py-1.5 px-2' }, formatRate(row.rate)),
                            React.createElement('td', { className: 'py-1.5 px-2' }, row.wokenChannels)
                        ))
                    )
                )
            ),
            React.createElement('div', {
                className: 'flex flex-wrap gap-1.5 pt-1'
            },
                React.createElement('button', {
                    type: 'button',
                    className: 'btn-primary',
                    disabled: busy || !playable,
                    onClick: onPlay
                }, 'Load on this PC'),
                React.createElement('button', {
                    type: 'button',
                    className: 'btn-quiet',
                    disabled: busy,
                    onClick: onExport
                }, 'Export'),
                React.createElement('button', {
                    type: 'button',
                    className: 'btn-quiet',
                    disabled: busy,
                    onClick: onRename
                }, 'Rename'),
                React.createElement('button', {
                    type: 'button',
                    className: 'btn-danger',
                    disabled: busy,
                    onClick: onDelete
                }, 'Delete')
            ),
            React.createElement('div', {
                className: 'flex flex-col gap-1.5 pt-2 border-t border-zinc-200 dark:border-zinc-800'
            },
                React.createElement(Field, { label: 'Target device' },
                    React.createElement('select', {
                        className: 'field',
                        value: targetId || '',
                        disabled: busy || pushing || targets.length === 0,
                        onChange: (event) => onTargetChange(event.target.value || null)
                    },
                        targets.length === 0
                            ? React.createElement('option', { value: '' }, 'No idle nodes on this NIC')
                            : [
                                React.createElement('option', { key: '', value: '' }, 'Select a node'),
                                ...targets.map((device) => React.createElement('option', {
                                    key: device.id,
                                    value: device.id
                                }, `${device.longName || device.shortName || 'dmxwhip'} (${device.ip})`))
                            ]
                    )
                ),
                React.createElement('button', {
                    type: 'button',
                    className: 'btn-primary self-start',
                    disabled: busy || pushing || !canPush,
                    onClick: onPush
                }, pushing ? 'Pushing…' : 'Push to SD'),
                React.createElement('p', {
                    className: 'text-xs text-zinc-500'
                }, 'Copies this .dmx onto the node SD. Load on this PC uses the toolbar; device Play/Stop live on Devices.'),
                pushError && React.createElement('div', {
                    className: pushError.startsWith('Pushed ') ? 'text-sm text-cyan-600 dark:text-cyan-400' : 'text-sm text-red-500'
                }, pushError)
            )
        )
    );
};

module.exports = ShowInspector;
