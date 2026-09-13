const React = require('react');
const DmxCell = require('./DmxCell');

const GRID_STYLES = {
    '16x32': {
        display: 'grid',
        gridTemplateColumns: 'repeat(16, minmax(0, 1fr))'
    },
    '32x16': {
        display: 'grid',
        gridTemplateColumns: 'repeat(32, minmax(0, 1fr))'
    }
};

const DmxGrid = React.memo(({
    dmxData,
    selectedUniverse,
    selectedProtocol,
    displayFormat,
    gridDimensions = '16x32',
    showAnimations
}) => {
    const gridStyle = React.useMemo(() => 
        GRID_STYLES[gridDimensions], 
    [gridDimensions]);

    return React.createElement('div', { 
            className: 'flex-1 bg-white p-4 rounded-lg shadow-md overflow-auto min-h-0'
        },
        React.createElement('h3', { className: 'font-bold mb-2' },
            selectedUniverse !== null 
                ? `DMX Channels - ${selectedProtocol.toUpperCase()} Universe ${selectedUniverse}`
                : 'DMX Channels - No Universe Selected'
        ),
        React.createElement('div', { 
            className: 'gap-1 w-full',
            style: gridStyle
        },
            dmxData.map((value, index) =>
                React.createElement(DmxCell, {
                    key: `channel-${index}`,
                    index: index,
                    value: value,
                    displayFormat: displayFormat,
                    selectedUniverse: selectedUniverse,
                    showAnimations: showAnimations
                })
            )
        )
    );
}, (prev, next) => {
    // Custom comparison to prevent unnecessary re-renders
    return (
        prev.selectedUniverse === next.selectedUniverse &&
        prev.selectedProtocol === next.selectedProtocol &&
        prev.displayFormat === next.displayFormat &&
        prev.gridDimensions === next.gridDimensions &&
        prev.showAnimations === next.showAnimations &&
        JSON.stringify(prev.dmxData) === JSON.stringify(next.dmxData)
    );
});

module.exports = DmxGrid;