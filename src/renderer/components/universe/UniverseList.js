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
    onSelectAll
}) => {
    const protocolColor = protocol === 'artnet' ? 'blue' : 'green';
    const protocolName = protocol === 'artnet' ? 'Art-Net' : 'sACN';
    const allSelected = universes.length > 0 && universes.every(universe => 
        selectedUniverses.has(`${protocol}-${universe.id ?? universe.universe}`)
    );

    // Debug logging
    console.log('UniverseList render:', {
        protocol,
        universeCount: universes.length,
        universes,
        selectedUniverse,
        selectedProtocol
    });

    return React.createElement('div', { 
        className: 'bg-white p-4 rounded-lg shadow-md flex-none'
    },
        // Header
        React.createElement('div', { className: 'mb-2' },
            React.createElement('h3', { 
                className: `font-bold text-${protocolColor}-600`
            }, `${protocolName} Universes`),
            React.createElement('div', { 
                className: 'flex items-center gap-2 mt-1'
            },
                React.createElement('input', {
                    type: 'checkbox',
                    checked: allSelected,
                    onChange: () => onSelectAll(protocol),
                    className: 'h-4 w-4'
                }),
                React.createElement('span', { 
                    className: 'text-sm text-gray-600'
                }, 'Select All')
            )
        ),
        // Universe List
        universes.length > 0 ?
            React.createElement('div', { className: 'space-y-2' },
                universes.map(universe => {
                    const universeId = universe.id ?? universe.universe;
                    return React.createElement(UniverseCell, {
                        key: `${protocol}-${universeId}`,
                        universe: universe,
                        protocol: protocol,
                        isSelected: selectedUniverse === universeId && selectedProtocol === protocol,
                        isChecked: selectedUniverses.has(`${protocol}-${universeId}`),
                        onSelect: () => onUniverseSelect(universeId, protocol),
                        onClick: () => onUniverseClick(universeId, protocol)
                    });
                })
            ) :
            React.createElement('div', { 
                className: 'text-gray-500 text-sm italic'
            }, `No ${protocolName} universes detected`)
    );
};

module.exports = UniverseList;