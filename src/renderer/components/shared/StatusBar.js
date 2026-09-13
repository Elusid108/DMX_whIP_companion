const React = require('react');

const StatusBar = ({ 
    selectedProtocol,
    selectedUniverse,
    activeChannels,
    fps,
    sourceIp,
    sourceName
}) => {
    return React.createElement('div', {
        className: 'bg-gray-800 text-white px-4 py-2 flex items-center gap-6'
    },
        React.createElement('div', { className: 'flex items-center gap-2' },
            React.createElement('span', { className: 'font-medium' }, 'Protocol:'),
            React.createElement('span', {
                className: selectedProtocol === 'artnet' ? 'text-blue-400' : 'text-green-400'
            }, selectedProtocol ? selectedProtocol.toUpperCase() : 'None')
        ),
        React.createElement('div', { className: 'flex items-center gap-2' },
            React.createElement('span', { className: 'font-medium' }, 'Universe:'),
            React.createElement('span', null, selectedUniverse || 'None')
        ),
        activeChannels !== undefined && React.createElement('div', { className: 'flex items-center gap-2' },
            React.createElement('span', { className: 'font-medium' }, 'Active Channels:'),
            React.createElement('span', null, activeChannels)
        ),
        fps !== undefined && React.createElement('div', { className: 'flex items-center gap-2' },
            React.createElement('span', { className: 'font-medium' }, 'FPS:'),
            React.createElement('span', null, fps)
        ),
        sourceIp && React.createElement('div', { className: 'flex items-center gap-2' },
            React.createElement('span', { className: 'font-medium' }, 'Source:'),
            React.createElement('span', null, sourceIp)
        ),
        sourceName && React.createElement('div', { className: 'flex items-center gap-2' },
            React.createElement('span', { className: 'font-medium' }, 'Name:'),
            React.createElement('span', null, sourceName)
        )
    );
};

module.exports = StatusBar;