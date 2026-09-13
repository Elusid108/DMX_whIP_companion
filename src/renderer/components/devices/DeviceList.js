const React = require('react');

const DeviceList = ({ devices, selectedId, onSelect }) => {
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
            return React.createElement('button', {
                key: device.id,
                type: 'button',
                onClick: () => onSelect(device.id),
                className: `kv-row ${isSelected ? 'is-active' : ''}`
            },
                React.createElement('div', {
                    className: 'min-w-0 w-full'
                },
                    React.createElement('div', {
                        className: 'font-medium truncate text-sm'
                    }, device.longName || device.shortName || device.ip),
                    React.createElement('div', {
                        className: 'text-xs text-zinc-500 truncate'
                    }, `${device.ip}${device.stale ? ' · stale' : ''}`)
                )
            );
        })
    );
};

module.exports = DeviceList;
