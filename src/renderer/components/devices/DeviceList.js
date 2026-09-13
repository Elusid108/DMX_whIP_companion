const React = require('react');

const PopoutIcon = () => React.createElement('svg', {
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className: 'w-3.5 h-3.5',
    'aria-hidden': true
},
    React.createElement('path', { d: 'M15 3h6v6' }),
    React.createElement('path', { d: 'M10 14L21 3' }),
    React.createElement('path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' })
);

const DeviceList = ({ devices, selectedId, onSelect, onOpenPortal }) => {
    if (!devices.length) {
        return React.createElement('div', {
            className: 'text-sm text-zinc-500 italic p-2'
        }, 'No nodes yet. Pick a specific NIC if All Interfaces shows nothing. sACN-only nodes do not reply to ArtPoll.');
    }

    return React.createElement('div', {
        className: 'flex flex-col gap-1 overflow-y-auto'
    },
        devices.map((device) => {
            const isSelected = device.id === selectedId;
            return React.createElement('div', {
                key: device.id,
                className: `kv-row ${isSelected ? 'is-active' : ''}`
            },
                React.createElement('button', {
                    type: 'button',
                    className: 'min-w-0 flex-1 text-left',
                    onClick: () => onSelect(device.id)
                },
                    React.createElement('div', {
                        className: 'font-medium truncate text-sm'
                    }, device.longName || device.shortName || device.ip),
                    React.createElement('div', {
                        className: 'text-xs text-zinc-500 truncate'
                    }, `${device.ip}${device.stale ? ' · stale' : ''}`)
                ),
                React.createElement('button', {
                    type: 'button',
                    className: 'btn-quiet flex-none p-1.5',
                    title: 'Open portal',
                    'aria-label': 'Open portal',
                    disabled: !device.ip,
                    onClick: (event) => {
                        event.stopPropagation();
                        onOpenPortal(device);
                    }
                },
                    React.createElement(PopoutIcon)
                )
            );
        })
    );
};

module.exports = DeviceList;
