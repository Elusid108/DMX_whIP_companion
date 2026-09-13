const React = require('react');
const UniverseList = require('./components/universe/UniverseList');
const DmxGrid = require('./components/dmx/DmxGrid');
const NetworkSelect = require('./components/controls/NetworkSelect');
const RecordingControls = require('./components/controls/RecordingControls');
const PlaybackControls = require('./components/controls/PlaybackControls');
const useUniverseData = require('./hooks/useUniverseData');
const useDmxMonitor = require('./hooks/useDmxMonitor');
const { version } = require('../../package.json');

const App = () => {
    const {
        artnetUniverses,
        sacnUniverses,
        selectedUniverse,
        selectedProtocol,
        selectedUniverses,
        setSelectedUniverse,
        setSelectedProtocol,
        handleUniverseSelect,
        handleSelectAll
    } = useUniverseData();

    const {
        dmxData,
        networkInterfaces,
        selectedNic,
        displayFormat,
        gridDimensions,
        showAnimations,
        handleNetworkChange,
        handleDisplayFormatChange,
        handleGridDimensionsChange,
        toggleAnimations
    } = useDmxMonitor(selectedUniverse, selectedProtocol);

    return React.createElement('div', { className: 'h-screen flex flex-col bg-gray-100 p-4' },
        // Options Bar
        React.createElement('div', { className: 'bg-white p-4 rounded-lg shadow-md mb-4 flex-none' },
            React.createElement('div', { className: 'flex flex-col gap-4' },
                // Controls Row
                React.createElement('div', { className: 'flex flex-wrap gap-8 items-start' },
                    React.createElement(NetworkSelect, {
                        selectedNic,
                        networkInterfaces,
                        onChange: handleNetworkChange
                    }),
                    React.createElement('div', { className: 'flex flex-col min-w-fit' },
                        React.createElement('label', { className: 'block text-sm font-medium text-gray-700 mb-1' },
                            'Display Format'
                        ),
                        React.createElement('select', {
                            value: displayFormat,
                            onChange: (e) => handleDisplayFormatChange(e.target.value),
                            className: 'border rounded p-2 w-fit'
                        },
                            React.createElement('option', { value: 'decimal' }, '0-255'),
                            React.createElement('option', { value: 'percent' }, '0-100%'),
                            React.createElement('option', { value: 'hex' }, '0-FF')
                        )
                    ),
                    React.createElement('div', { className: 'flex flex-col min-w-fit' },
                        React.createElement('label', { className: 'block text-sm font-medium text-gray-700 mb-1' },
                            'Grid Layout'
                        ),
                        React.createElement('select', {
                            value: gridDimensions,
                            onChange: (e) => handleGridDimensionsChange(e.target.value),
                            className: 'border rounded p-2 w-fit'
                        },
                            React.createElement('option', { value: '16x32' }, '16 × 32'),
                            React.createElement('option', { value: '32x16' }, '32 × 16')
                        )
                    ),
                    React.createElement('div', { className: 'flex flex-col min-w-fit' },
                        React.createElement('label', { className: 'block text-sm font-medium text-gray-700 mb-1' },
                            'Bar Animations'
                        ),
                        React.createElement('button', {
                            onClick: toggleAnimations,
                            className: `border rounded p-2 w-fit ${showAnimations ? 'bg-blue-100' : 'bg-gray-100'}`
                        }, showAnimations ? 'On' : 'Off')
                    ),
                    React.createElement('div', {
                        className: 'ml-auto text-sm text-gray-500 self-end'
                    }, `v${version}`)
                ),
                // Recording Controls Row
                React.createElement('div', { className: 'border-t pt-4' },
                    React.createElement(RecordingControls, {
                        selectedNic,
                        networkInterfaces,
                        selectedUniverses
                    }),
                    React.createElement(PlaybackControls, {
                        networkInterfaces,
                        selectedNic
                    })
                )
            )
        ),
        // Main Content
        React.createElement('div', { className: 'flex gap-4 flex-1 min-h-0' },
            // Universe Lists Container
            React.createElement('div', { className: 'w-64 flex flex-col gap-4 overflow-y-auto' },
                React.createElement(UniverseList, {
                    protocol: 'artnet',
                    universes: Array.from(artnetUniverses.values()),
                    selectedUniverse,
                    selectedProtocol,  // Ensuring selectedProtocol is passed
                    selectedUniverses,
                    onUniverseSelect: handleUniverseSelect,
                    onUniverseClick: (id, clickedProtocol) => {
                        setSelectedUniverse(id);
                        setSelectedProtocol('artnet');
                    },
                    onSelectAll: handleSelectAll
                }),
                React.createElement(UniverseList, {
                    protocol: 'sacn',
                    universes: Array.from(sacnUniverses.values()),
                    selectedUniverse,
                    selectedProtocol,  // Ensuring selectedProtocol is passed
                    selectedUniverses,
                    onUniverseSelect: handleUniverseSelect,
                    onUniverseClick: (id) => {
                        setSelectedUniverse(id);
                        setSelectedProtocol('sacn');
                    },
                    onSelectAll: handleSelectAll
                })
            ),
            // DMX Grid
            React.createElement(DmxGrid, {
                dmxData,
                selectedUniverse,
                selectedProtocol,
                displayFormat,
                gridDimensions,
                showAnimations
            })
        )
    );
};

module.exports = App;