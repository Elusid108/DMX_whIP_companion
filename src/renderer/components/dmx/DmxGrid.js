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

const protocolTitle = (protocol) => {
    if (protocol === 'artnet') {
        return 'Art-Net';
    }
    if (protocol === 'sacn') {
        return 'sACN';
    }
    return protocol ? String(protocol).toUpperCase() : '';
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

    const title = selectedUniverse !== null
        ? `DMX Channels — ${protocolTitle(selectedProtocol)} Universe ${selectedUniverse}`
        : 'DMX Channels — No Universe Selected';

    return React.createElement('div', {
            className: 'flex-1 p-3 overflow-auto min-h-0 bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-800'
        },
        React.createElement('h3', { className: 'text-sm font-semibold mb-2' }, title),
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
