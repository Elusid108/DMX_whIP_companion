const React = require('react');
const UniverseCell = require('./UniverseCell');

const UniverseList = ({
    protocol,
    universes,
    selectedUniverse,
    selectedProtocol,
    selectedUniverses,
    onUniverseSelect,
    onUniverseClick,
    onSelectAll,
    recording
}) => {
    const protocolName = protocol === 'artnet' ? 'Art-Net' : 'sACN';
    const allSelected = universes.length > 0 && universes.every(universe =>
        selectedUniverses.has(`${protocol}-${universe.id ?? universe.universe}`)
    );

    return React.createElement('div', {
        className: 'flex-none p-2 border-b border-line'
    },
        React.createElement('div', { className: 'mb-1.5' },
            React.createElement('h3', {
                className: 'text-sm font-semibold text-accent'
            }, protocolName),
            React.createElement('div', {
                className: 'flex items-center gap-2 mt-1'
            },
                React.createElement('input', {
                    type: 'checkbox',
                    checked: allSelected,
                    onChange: () => onSelectAll(protocol),
                    className: 'check'
                }),
                React.createElement('span', {
                    className: 'text-xs text-muted'
                }, 'Select All')
            )
        ),
        universes.length > 0 ?
            React.createElement('div', { className: 'flex flex-col gap-1' },
                universes.map(universe => {
                    const universeId = universe.id ?? universe.universe;
                    return React.createElement(UniverseCell, {
                        key: `${protocol}-${universeId}`,
                        universe: universe,
                        protocol: protocol,
                        isSelected: selectedUniverse === universeId && selectedProtocol === protocol,
                        isChecked: selectedUniverses.has(`${protocol}-${universeId}`),
                        onSelect: () => onUniverseSelect(universeId, protocol),
                        onClick: () => onUniverseClick(universeId, protocol),
                        recording
                    });
                })
            ) :
            React.createElement('div', {
                className: 'text-muted text-xs italic'
            }, `No ${protocolName} universes detected`)
    );
};

module.exports = UniverseList;
