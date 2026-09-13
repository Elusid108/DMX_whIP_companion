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
        className: 'text-xs font-medium text-gray-600'
    }, label),
    children
);

const ShowInspector = ({
    show,
    name,
    notes,
    busy,
    onNameChange,
    onNotesChange,
    onPlay,
    onRename,
    onDelete,
    onExport
}) => {
    if (!show) {
        return React.createElement('div', {
            className: 'text-sm text-gray-500 italic p-3'
        }, 'Select a show to see details.');
    }

    const playable = Boolean(show.playable);

    return React.createElement('div', {
        className: 'flex flex-col gap-3 overflow-y-auto h-full'
    },
        React.createElement(Field, { label: 'Display name' },
            React.createElement('input', {
                className: 'border rounded p-2',
                value: name,
                disabled: busy,
                onChange: (event) => onNameChange(event.target.value)
            })
        ),
        React.createElement(Field, { label: 'Notes' },
            React.createElement('textarea', {
                className: 'border rounded p-2 min-h-[6rem]',
                value: notes,
                disabled: busy,
                onChange: (event) => onNotesChange(event.target.value)
            })
        ),
        React.createElement('div', {
            className: 'grid grid-cols-2 gap-2 text-sm'
        },
            React.createElement('div', null, `File: ${show.filename}`),
            React.createElement('div', null, `Size: ${formatBytes(show.size)}`),
            React.createElement('div', null, `Duration: ${formatDuration(show.duration)}`),
            React.createElement('div', null, `Frames: ${show.frameCount || 0}`),
            React.createElement('div', null, `Packet rate: ${formatRate(show.packetRate)} /s`),
            React.createElement('div', null, `Protocol: ${protocolLabel(show.protocols)}`),
            React.createElement('div', null, `Universes: ${show.universes && show.universes.length ? show.universes.join(', ') : '—'}`),
            React.createElement('div', null, `Created: ${formatDate(show.created)}`),
            React.createElement('div', { className: 'col-span-2' }, `Modified: ${formatDate(show.modified)}`)
        ),
        show.error && React.createElement('div', {
            className: 'text-sm text-red-600'
        }, show.error),
        show.perUniverse && show.perUniverse.length > 0 && React.createElement('div', {
            className: 'overflow-x-auto'
        },
            React.createElement('table', {
                className: 'w-full text-xs text-left'
            },
                React.createElement('thead', null,
                    React.createElement('tr', {
                        className: 'text-gray-600'
                    },
                        React.createElement('th', { className: 'py-1 pr-2' }, 'Universe'),
                        React.createElement('th', { className: 'py-1 pr-2' }, 'Protocol'),
                        React.createElement('th', { className: 'py-1 pr-2' }, 'Packets'),
                        React.createElement('th', { className: 'py-1 pr-2' }, 'Rate /s'),
                        React.createElement('th', { className: 'py-1 pr-2' }, 'Woken ch')
                    )
                ),
                React.createElement('tbody', null,
                    show.perUniverse.map((row) => React.createElement('tr', {
                        key: `${row.protocol}-${row.id}`
                    },
                        React.createElement('td', { className: 'py-1 pr-2' }, row.id),
                        React.createElement('td', { className: 'py-1 pr-2' }, row.protocol === 'artnet' ? 'Art-Net' : 'sACN'),
                        React.createElement('td', { className: 'py-1 pr-2' }, row.packets),
                        React.createElement('td', { className: 'py-1 pr-2' }, formatRate(row.rate)),
                        React.createElement('td', { className: 'py-1 pr-2' }, row.wokenChannels)
                    ))
                )
            )
        ),
        React.createElement('div', {
            className: 'flex flex-wrap gap-2 pt-2'
        },
            React.createElement('button', {
                type: 'button',
                className: 'px-3 py-2 rounded bg-blue-500 text-white disabled:opacity-50',
                disabled: busy || !playable,
                onClick: onPlay
            }, 'Play'),
            React.createElement('button', {
                type: 'button',
                className: 'px-3 py-2 rounded bg-gray-700 text-white disabled:opacity-50',
                disabled: busy,
                onClick: onExport
            }, 'Export'),
            React.createElement('button', {
                type: 'button',
                className: 'px-3 py-2 rounded bg-gray-500 text-white disabled:opacity-50',
                disabled: busy,
                onClick: onRename
            }, 'Rename'),
            React.createElement('button', {
                type: 'button',
                className: 'px-3 py-2 rounded bg-red-500 text-white disabled:opacity-50',
                disabled: busy,
                onClick: onDelete
            }, 'Delete')
        )
    );
};

module.exports = ShowInspector;
