const React = require('react');
const DmxGrid = require('./components/dmx/DmxGrid');
const UniverseSidebar = require('./components/universe/UniverseSidebar');
const LibraryPanel = require('./components/library/LibraryPanel');
const DevicesPanel = require('./components/devices/DevicesPanel');
const FlashPanel = require('./components/flash/FlashPanel');
const StudioPanel = require('./components/studio/StudioPanel');
const useUniverseData = require('./hooks/useUniverseData');
const useDmxMonitor = require('./hooks/useDmxMonitor');
const ipcRenderer = require('./ipc');
const { version } = require('../../package.json');

const applyThemeClass = (theme) => {
    const root = document.documentElement;
    root.classList.remove('dark', 'light');
    root.classList.add(theme === 'light' ? 'light' : 'dark');
};

const compactSelect = 'field w-auto min-w-[7rem] py-1';

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

    const [mainView, setMainView] = React.useState('monitor');
    const [theme, setTheme] = React.useState('dark');
    const [focusDeviceId, setFocusDeviceId] = React.useState(null);

    const handleUniverseClick = (id, protocol) => {
        setSelectedUniverse(id);
        setSelectedProtocol(protocol);
    };

    React.useEffect(() => {
        let cancelled = false;
        ipcRenderer.invoke('get-settings').then((result) => {
            if (cancelled || !result || !result.settings) {
                return;
            }
            const next = result.settings.theme === 'light' ? 'light' : 'dark';
            setTheme(next);
            applyThemeClass(next);
        }).catch(() => {});
        return () => {
            cancelled = true;
        };
    }, []);

    const handleToggleTheme = async () => {
        const next = theme === 'dark' ? 'light' : 'dark';
        setTheme(next);
        applyThemeClass(next);
        try {
            await ipcRenderer.invoke('set-theme', { theme: next });
        } catch (err) {
            // Theme still applies for this session if persist fails.
        }
    };

    const universeSidebar = {
        artnetUniverses,
        sacnUniverses,
        selectedUniverse,
        selectedProtocol,
        selectedUniverses,
        selectedNic,
        networkInterfaces,
        onNetworkChange: handleNetworkChange,
        onUniverseSelect: handleUniverseSelect,
        onSelectAll: handleSelectAll,
        onUniverseClick: handleUniverseClick
    };

    return React.createElement('div', {
        className: 'h-screen flex flex-col font-sans bg-zinc-100 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-200'
    },
        React.createElement('header', {
            className: 'h-11 flex-none flex items-center justify-between gap-3 px-3 border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900'
        },
            React.createElement('div', {
                className: 'flex items-baseline gap-2 min-w-0'
            },
                React.createElement('h1', {
                    className: 'text-sm font-semibold truncate'
                }, 'DMX whIP Companion'),
                React.createElement('span', {
                    className: 'text-xs text-zinc-500'
                }, `v${version}`)
            ),
            React.createElement('button', {
                type: 'button',
                className: 'btn-quiet',
                onClick: handleToggleTheme,
                title: theme === 'dark' ? 'Light mode' : 'Dark mode'
            }, theme === 'dark' ? 'Light mode' : 'Dark mode')
        ),
        React.createElement('div', {
            className: 'flex-none flex gap-1 px-3 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900'
        },
            React.createElement('button', {
                type: 'button',
                className: `tab-btn ${mainView === 'monitor' ? 'is-active' : ''}`,
                onClick: () => setMainView('monitor')
            }, 'Monitor'),
            React.createElement('button', {
                type: 'button',
                className: `tab-btn ${mainView === 'studio' ? 'is-active' : ''}`,
                onClick: () => setMainView('studio')
            }, 'Studio'),
            React.createElement('button', {
                type: 'button',
                className: `tab-btn ${mainView === 'library' ? 'is-active' : ''}`,
                onClick: () => setMainView('library')
            }, 'Library'),
            React.createElement('button', {
                type: 'button',
                className: `tab-btn ${mainView === 'devices' ? 'is-active' : ''}`,
                onClick: () => setMainView('devices')
            }, 'Devices'),
            React.createElement('button', {
                type: 'button',
                className: `tab-btn ${mainView === 'flash' ? 'is-active' : ''}`,
                onClick: () => setMainView('flash')
            }, 'Flash')
        ),
        mainView === 'monitor' && React.createElement('div', {
            className: 'flex flex-1 min-h-0 flex-col'
        },
            React.createElement('div', {
                className: 'app-toolbar items-end bg-zinc-50 dark:bg-zinc-900'
            },
                React.createElement('div', { className: 'flex flex-col min-w-fit' },
                    React.createElement('label', { className: 'text-xs font-medium text-zinc-500 mb-0.5' },
                        'Format'
                    ),
                    React.createElement('select', {
                        value: displayFormat,
                        onChange: (e) => handleDisplayFormatChange(e.target.value),
                        className: compactSelect
                    },
                        React.createElement('option', { value: 'decimal' }, '0-255'),
                        React.createElement('option', { value: 'percent' }, '0-100%'),
                        React.createElement('option', { value: 'hex' }, '0-FF')
                    )
                ),
                React.createElement('div', { className: 'flex flex-col min-w-fit' },
                    React.createElement('label', { className: 'text-xs font-medium text-zinc-500 mb-0.5' },
                        'Grid'
                    ),
                    React.createElement('select', {
                        value: gridDimensions,
                        onChange: (e) => handleGridDimensionsChange(e.target.value),
                        className: compactSelect
                    },
                        React.createElement('option', { value: '16x32' }, '16 × 32'),
                        React.createElement('option', { value: '32x16' }, '32 × 16')
                    )
                ),
                React.createElement('div', { className: 'flex flex-col min-w-fit' },
                    React.createElement('label', { className: 'text-xs font-medium text-zinc-500 mb-0.5' },
                        'Bars'
                    ),
                    React.createElement('button', {
                        type: 'button',
                        onClick: toggleAnimations,
                        className: 'btn-quiet'
                    }, showAnimations ? 'On' : 'Off')
                )
            ),
            React.createElement('div', {
                className: 'flex flex-1 min-h-0'
            },
                React.createElement('div', {
                    className: 'app-sidebar overflow-y-auto'
                },
                    React.createElement(UniverseSidebar, universeSidebar)
                ),
                React.createElement(DmxGrid, {
                    dmxData,
                    selectedUniverse,
                    selectedProtocol,
                    displayFormat,
                    gridDimensions,
                    showAnimations
                })
            )
        ),
        React.createElement('div', {
            className: mainView === 'studio' ? 'flex flex-1 min-h-0 flex-col' : 'hidden'
        },
            React.createElement(StudioPanel, {
                networkInterfaces,
                selectedNic,
                ...universeSidebar
            })
        ),
        mainView === 'library' && React.createElement(LibraryPanel),
        mainView === 'flash' && React.createElement(FlashPanel, {
            onOpenDevice: (id) => {
                setFocusDeviceId(id);
                setMainView('devices');
            }
        }),
        mainView === 'devices' && React.createElement(DevicesPanel, {
            focusDeviceId
        })
    );
};

module.exports = App;
