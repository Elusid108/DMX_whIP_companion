const React = require('react');
const { EmptyState, IconButton, Icons } = require('../ui');

const DeviceList = ({ devices, selectedId, onSelect, onOpenPortal }) => {
    if (!devices.length) {
        return React.createElement(EmptyState, {
            className: 'p-2'
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
                        className: 'text-xs text-muted truncate'
                    }, `${device.ip}${device.stale ? ' · stale' : ''}`)
                ),
                React.createElement(IconButton, {
                    label: 'Open portal',
                    icon: Icons.Popout,
                    disabled: !device.ip,
                    onClick: (event) => {
                        event.stopPropagation();
                        onOpenPortal(device);
                    }
                })
            );
        })
    );
};

module.exports = DeviceList;
