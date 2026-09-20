const React = require('react');
const UniverseList = require('./UniverseList');

const UniverseSidebar = ({
    artnetUniverses,
    sacnUniverses,
    selectedUniverse,
    selectedProtocol,
    selectedUniverses,
    onUniverseSelect,
    onSelectAll,
    onUniverseClick
}) => React.createElement(React.Fragment, null,
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
