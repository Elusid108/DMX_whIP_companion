const React = require('react');
const UniverseList = require('./UniverseList');
const NetworkSelect = require('../controls/NetworkSelect');

const UniverseSidebar = ({
    artnetUniverses,
    sacnUniverses,
    selectedUniverse,
    selectedProtocol,
    selectedUniverses,
    selectedNic,
    networkInterfaces,
    onNetworkChange,
    onUniverseSelect,
    onSelectAll,
    onUniverseClick
}) => React.createElement(React.Fragment, null,
    React.createElement('div', {
        className: 'flex-none p-2 border-b border-zinc-200 dark:border-zinc-800'
    },
        React.createElement(NetworkSelect, {
            selectedNic,
            networkInterfaces: networkInterfaces || [],
            onChange: onNetworkChange
        })
    ),
    React.createElement(UniverseList, {
        protocol: 'artnet',
        universes: Array.from(artnetUniverses.values()),
        selectedUniverse,
        selectedProtocol,
        selectedUniverses,
        onUniverseSelect,
        onUniverseClick: (id) => onUniverseClick(id, 'artnet'),
        onSelectAll
    }),
    React.createElement(UniverseList, {
        protocol: 'sacn',
        universes: Array.from(sacnUniverses.values()),
        selectedUniverse,
        selectedProtocol,
        selectedUniverses,
        onUniverseSelect,
        onUniverseClick: (id) => onUniverseClick(id, 'sacn'),
        onSelectAll
    })
);

module.exports = UniverseSidebar;
