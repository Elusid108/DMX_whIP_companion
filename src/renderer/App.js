const React = require('react');
const DmxGrid = require('./components/dmx/DmxGrid');
const UniverseSidebar = require('./components/universe/UniverseSidebar');
const LibraryPanel = require('./components/library/LibraryPanel');
const DevicesPanel = require('./components/devices/DevicesPanel');
const FlashPanel = require('./components/flash/FlashPanel');
const StudioPanel = require('./components/studio/StudioPanel');
const SettingsMenu = require('./components/controls/SettingsMenu');
const PlaybackControls = require('./components/controls/PlaybackControls');
const useUniverseData = require('./hooks/useUniverseData');
const useDmxMonitor = require('./hooks/useDmxMonitor');
const useStudioSession = require('./hooks/useStudioSession');
const usePlayerQueue = require('./hooks/usePlayerQueue');
const ipcRenderer = require('./ipc');

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

    const [mainView, setMainView] = React.useState('monitor');
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
    } = useDmxMonitor(selectedUniverse, selectedProtocol, {
        monitorVisible: mainView === 'monitor'
    });

    const [theme, setTheme] = React.useState('dark');
    const [focusDeviceId, setFocusDeviceId] = React.useState(null);
    const session = useStudioSession(selectedUniverses, selectedNic, {
        studioVisible: mainView === 'studio'
    });
    const player = usePlayerQueue({
        playbackNetwork: session.playbackNetwork,
        isRecording: session.isRecording
    });
    const libraryRef = React.useRef(null);
    const [libraryRail, setLibraryRail] = React.useState(null);
    const [devicesRail, setDevicesRail] = React.useState(null);
    const [flashRail, setFlashRail] = React.useState(null);

    const isEditableTarget = (target) => Boolean(
        target && target.closest && target.closest('input, textarea, select, [contenteditable="true"]')
    );

    React.useEffect(() => {
        const onKeyDown = (event) => {
            if (isEditableTarget(event.target)) {
                return;
            }
            if ((event.key === 'Delete' || event.key === 'Backspace')
                && mainView !== 'library'
                && session.isFileLoaded
                && !session.isRecording
            ) {
                event.preventDefault();
                session.handleDeleteClips();
                return;
            }
            if (!(event.ctrlKey || event.metaKey)) {
                return;
            }
            const key = String(event.key || '').toLowerCase();
            if (mainView === 'library') {
                if (key === 'c' && libraryRef.current) {
                    event.preventDefault();
                    libraryRef.current.copy();
                }
                if (key === 'v' && libraryRef.current) {
                    event.preventDefault();
                    libraryRef.current.paste();
                }
                return;
            }
            if (!session.isFileLoaded || session.isRecording) {
                return;
            }
            if (key === 'c') {
                event.preventDefault();
                session.handleCopyClips();
                return;
            }
            if (key === 'x') {
                event.preventDefault();
                session.handleCutClips();
                return;
            }
            if (key === 'v') {
                event.preventDefault();
                session.handlePasteClips();
                return;
            }
            if (key === 'z' && !event.shiftKey) {
                event.preventDefault();
                session.handleUndo();
                return;
            }
            if (key === 'y' || (key === 'z' && event.shiftKey)) {
                event.preventDefault();
                session.handleRedo();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [mainView, session]);

    const handleUniverseClick = (id, protocol) => {
        setSelectedUniverse(id);
        setSelectedProtocol(protocol);
    };

    const requestView = async (next) => {
        if (next === mainView) {
            return;
        }
        if (mainView === 'studio' && next !== 'studio') {
            const ok = await session.requestLeaveStudio();
            if (!ok) {
                return;
            }
        }
        setMainView(next);
    };

    React.useEffect(() => {
        ipcRenderer.send('set-ui-view', {
            view: mainView,
            recording: session.isRecording
        });
    }, [mainView, session.isRecording]);

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
        onUniverseSelect: handleUniverseSelect,
        onSelectAll: handleSelectAll,
        onUniverseClick: handleUniverseClick,
        recording: session.isRecording
    };

    return React.createElement('div', {
        className: 'h-screen flex flex-col font-sans bg-zinc-100 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-200'
    },
        React.createElement('div', {
            className: 'flex-none relative z-10 flex items-center gap-1 px-3 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900'
        },
            React.createElement('button', {
                type: 'button',
                className: `tab-btn ${mainView === 'monitor' ? 'is-active' : ''}`,
                onClick: () => requestView('monitor')
            }, 'Monitor'),
            React.createElement('button', {
                type: 'button',
                className: `tab-btn ${mainView === 'studio' ? 'is-active' : ''}`,
                onClick: () => requestView('studio')
            }, 'Studio'),
            React.createElement('button', {
                type: 'button',
                className: `tab-btn ${mainView === 'library' ? 'is-active' : ''}`,
                onClick: () => requestView('library')
            }, 'Library'),
            React.createElement('button', {
                type: 'button',
                className: `tab-btn ${mainView === 'devices' ? 'is-active' : ''}`,
                onClick: () => requestView('devices')
            }, 'Devices'),
            React.createElement('button', {
                type: 'button',
                className: `tab-btn ${mainView === 'flash' ? 'is-active' : ''}`,
                onClick: () => requestView('flash')
            }, 'Flash'),
            React.createElement(SettingsMenu, {
                theme,
                onToggleTheme: handleToggleTheme,
                networkInterfaces,
                selectedNic,
                onInputNicChange: handleNetworkChange,
                playbackNetwork: session.playbackNetwork,
                onOutputNicChange: session.setPlaybackNetwork
            })
        ),
        React.createElement('div', {
            className: 'flex flex-1 min-h-0'
        },
            React.createElement('div', {
                className: 'app-sidebar overflow-hidden'
            },
                (mainView === 'monitor' || mainView === 'studio') && React.createElement('div', {
                    className: 'flex-1 min-h-0 overflow-y-auto'
                },
                    React.createElement(UniverseSidebar, universeSidebar)
                ),
                mainView === 'library' && React.createElement('div', {
                    ref: setLibraryRail,
                    className: 'flex-1 min-h-0 flex flex-col'
                }),
                mainView === 'devices' && React.createElement('div', {
                    ref: setDevicesRail,
                    className: 'flex-1 min-h-0 flex flex-col'
                }),
                mainView === 'flash' && React.createElement('div', {
                    ref: setFlashRail,
                    className: 'flex-1 min-h-0 flex flex-col'
                }),
                React.createElement(PlaybackControls, {
                    queue: player.queue,
                    currentIndex: player.currentIndex,
                    current: player.current,
                    collapsed: player.collapsed,
                    onToggleCollapsed: () => player.setCollapsed((value) => !value),
                    isFileLoaded: player.isFileLoaded,
                    isPlaying: player.isPlaying,
                    isRecording: session.isRecording,
                    isLoopEnabled: player.loop,
                    playheadMs: player.playheadMs,
                    durationMs: player.durationMs,
                    formatClock: player.formatClock,
                    onToggleLoop: player.handleToggleLoop,
                    onPlay: player.handlePlay,
                    onPause: player.handlePause,
                    onStopPlayback: player.handleStop,
                    onBack: player.handleBack,
                    onNext: player.handleNext,
                    onSeek: player.handleSeek,
                    onSelect: player.handleSelect,
                    onMove: player.moveItem,
                    onRemove: player.removeItem,
                    onClear: player.clearQueue
                })
            ),
            React.createElement('div', {
                className: 'flex flex-1 min-w-0 min-h-0 flex-col'
            },
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
                    React.createElement(DmxGrid, {
                        dmxData,
                        selectedUniverse,
                        selectedProtocol,
                        displayFormat,
                        gridDimensions,
                        showAnimations
                    })
                ),
                React.createElement('div', {
                    className: mainView === 'studio' ? 'flex flex-1 min-h-0 flex-col' : 'hidden'
                },
                    React.createElement(StudioPanel, {
                        session,
                        selectedUniverses
                    })
                ),
                mainView === 'library' && React.createElement(LibraryPanel, {
                    ref: libraryRef,
                    railHost: libraryRail,
                    studioTrackId: session.selectedTrackId,
                    studioHasClips: Boolean(session.clips && session.clips.length),
                    onQueuePlay: player.playExclusive,
                    onQueueAdd: player.enqueueLooks
                }),
                mainView === 'devices' && React.createElement(DevicesPanel, {
                    focusDeviceId,
                    selectedNic,
                    networkInterfaces,
                    onNetworkChange: handleNetworkChange,
                    railHost: devicesRail
                }),
                mainView === 'flash' && React.createElement(FlashPanel, {
                    railHost: flashRail,
                    onOpenDevice: (id) => {
                        setFocusDeviceId(id);
                        setMainView('devices');
                    }
                })
            )
        )
    );
};

module.exports = App;
