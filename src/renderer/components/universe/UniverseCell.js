const React = require('react');

const UniverseCell = ({
    universe,
    protocol,
    isSelected,
    isChecked,
    onSelect,
    onClick
}) => {
    const protocolStyle = protocol === 'artnet' 
        ? { selected: 'bg-blue-100 border border-blue-300', normal: 'bg-gray-50' }
        : { selected: 'bg-green-100 border border-green-300', normal: 'bg-gray-50' };

    // Ensure we have valid universe data
    const universeId = universe?.id ?? universe?.universe ?? 'undefined';
    const channels = universe?.activeChannels ?? 0;
    const sourceIp = universe?.sourceIp ?? 'unknown';
    const sourceName = universe?.sourceName;
    const fps = universe?.fps;
    const isStale = universe?.stale;

    return React.createElement('div', {
        className: `p-2 rounded ${isSelected ? protocolStyle.selected : protocolStyle.normal}`
    },
        React.createElement('div', { 
            className: 'flex items-center gap-2'
        },
            // Checkbox
            React.createElement('input', {
                type: 'checkbox',
                checked: isChecked,
                onChange: onSelect,
                className: 'h-4 w-4'
            }),
            // Universe Info
            React.createElement('div', {
                className: 'flex-grow cursor-pointer',
                onClick: onClick
            },
                React.createElement('div', { 
                    className: 'font-medium'
                }, `Universe ${universeId}${isStale ? ' (Inactive)' : ''}`),
                React.createElement('div', { 
                    className: 'text-sm text-gray-500'
                }, `Channels: ${channels}`),
                React.createElement('div', { 
                    className: 'text-sm text-gray-500'
                }, `Source: ${sourceIp}`),
                sourceName && React.createElement('div', { 
                    className: 'text-sm text-gray-500'
                }, `Name: ${sourceName}`),
                fps && React.createElement('div', { 
                    className: 'text-sm text-gray-500'
                }, `FPS: ${fps}`)
            )
        )
    );
};

module.exports = UniverseCell;