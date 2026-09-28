const React = require('react');
const DmxGrid = require('./components/dmx/DmxGrid');
const UniverseSidebar = require('./components/universe/UniverseSidebar');
const LibraryPanel = require('./components/library/LibraryPanel');
const DevicesPanel = require('./components/devices/DevicesPanel');
const FlashPanel = require('./components/flash/FlashPanel');
const StudioPanel = require('./components/studio/StudioPanel');
const SettingsMenu = require('./components/controls/SettingsMenu');
const PlaybackControls = require('./components/controls/PlaybackControls');
const MiniPlayer = require('./components/controls/MiniPlayer');
const Gallery = require('./components/ui/Gallery');
const { LivePanel, LiveRail } = require('./components/live/LivePanel');
const liveStore = require('./liveStore');
const midiStore = require('./midiStore');
const { Dialog, IconButton, Icons, Select, Tabs, ToastProvider, cx } = require('./components/ui');
const useMediaQuery = require('./hooks/useMediaQuery');
const { applyTheme } = require('./theme');
const useUniverseData = require('./hooks/useUniverseData');
const useDmxMonitor = require('./hooks/useDmxMonitor');
const useDevices = require('./hooks/useDevices');
const { buildOverlay } = require('../services/shared/monitorOverlay');
const useStudioSession = require('./hooks/useStudioSession');
const usePlayerQueue = require('./hooks/usePlayerQueue');
const ipcRenderer = require('./ipc');

// rail: what the left column holds (the drawer button's label when narrow).
const VIEWS = [
    { id: 'monitor', label: 'Monitor', icon: Icons.ViewMonitor, rail: 'Universes' },
    // Control: the control surface setup (faders, pads, MIDI; later the
    // Raspberry Pi surface). Its id stays 'live' so saved settings carry over.
    { id: 'live', label: 'Control', icon: Icons.ViewLive, rail: 'Output' },
    { id: 'studio', label: 'Studio', icon: Icons.ViewStudio, rail: 'Universes' },
    { id: 'library', label: 'Library', icon: Icons.ViewLibrary, rail: 'Shows' },
    { id: 'devices', label: 'Devices', icon: Icons.ViewDevices, rail: 'Nodes' },
    { id: 'flash', label: 'Flash', icon: Icons.ViewFlash, rail: 'Ports' }
];

// Phones: views as a bottom tab bar.
const BottomNav = ({ value, onChange }) => React.createElement('nav', {
    className: 'flex-none grid grid-cols-6 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]',
    'aria-label': 'Views'
}, VIEWS.map((view) => React.createElement('button', {
    key: view.id,
    type: 'button',
    'aria-current': value === view.id ? 'page' : undefined,
    className: cx(
        'flex flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium',
        value === view.id ? 'text-accent' : 'text-muted'
    ),
    onClick: () => onChange(view.id)
}, React.createElement(view.icon, { className: 'w-5 h-5' }), view.label)));

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
        showNodes,
        colorBars,
        groupMode,
        handleNetworkChange,
        handleDisplayFormatChange,
        handleGridDimensionsChange,
        handleGroupModeChange,
        toggleAnimations,
        toggleNodes,
        toggleColorBars
    } = useDmxMonitor(selectedUniverse, selectedProtocol, {
        monitorVisible: mainView === 'monitor'
    });
    const monitorDevices = useDevices({ enabled: mainView === 'monitor' });
    // Which detected nodes use which channels of the shown universe.
    const overlay = React.useMemo(() => (
        selectedUniverse === null
            ? null
            : buildOverlay(monitorDevices, selectedProtocol, selectedUniverse, { group: groupMode })
    ), [monitorDevices, selectedProtocol, selectedUniverse, groupMode]);

    const [theme, setTheme] = React.useState('dark');
    // Layout: the left column docks at lg (1024 px) and is a drawer below;
    // below md (768 px) the views move to a bottom tab bar.
    const wide = useMediaQuery('lg');
    const tabsOnTop = useMediaQuery('md');
    const [railOpen, setRailOpen] = React.useState(false);
    const [playerSheet, setPlayerSheet] = React.useState(false);
    const [focusDeviceId, setFocusDeviceId] = React.useState(null);
    const session = useStudioSession(selectedUniverses, selectedNic, {
        studioVisible: mainView === 'studio'
    });
    const player = usePlayerQueue({
        playbackNetwork: session.playbackNetwork,
        isRecording: session.isRecording
    });
    const outputNic = (networkInterfaces || []).find((nic) => nic.ip === session.playbackNetwork);
    const outputNicLabel = outputNic && session.playbackNetwork !== '0.0.0.0'
        ? `${outputNic.name} (${outputNic.ip})`
        : 'Default adapter';
    const libraryRef = React.useRef(null);
    // Live layout loads at start (not on first visit) so its levels are in
    // step with the main process from the outset.
    React.useEffect(() => {
        liveStore.load().then(() => midiStore.start());
    }, []);
    const [libraryRail, setLibraryRail] = React.useState(null);
    const [devicesRail, setDevicesRail] = React.useState(null);
    const [flashRail, setFlashRail] = React.useState(null);

    const isEditableTarget = (target) => Boolean(
        target && target.closest && target.closest('input, textarea, select, [contenteditable="true"]')
    );

    const mainViewRef = React.useRef(mainView);
    const sessionRef = React.useRef(session);
    const requestViewRef = React.useRef(null);
    mainViewRef.current = mainView;
    sessionRef.current = session;

    React.useEffect(() => {
        const onKeyDown = (event) => {
            if (isEditableTarget(event.target)) {
                return;
            }
            const mainView = mainViewRef.current;
            const session = sessionRef.current;
            if ((event.key === 'Delete' || event.key === 'Backspace')
                && mainView !== 'library'
                && mainView !== 'live'
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
            // Ctrl+Shift+U: hidden UI-kit gallery.
            if (key === 'u' && event.shiftKey) {
                event.preventDefault();
                requestViewRef.current(mainView === 'gallery' ? 'monitor' : 'gallery');
                return;
            }
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
            if (mainView === 'live' || !session.isFileLoaded || session.isRecording) {
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
    }, []);

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
        setRailOpen(false);
    };
    requestViewRef.current = requestView;

    React.useEffect(() => {
        if (wide) {
            setRailOpen(false);
            setPlayerSheet(false);
        }
    }, [wide]);

    React.useEffect(() => {
        if (!railOpen) {
            return undefined;
        }
        const onKey = (event) => {
            if (event.key === 'Escape') {
                setRailOpen(false);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [railOpen]);

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
            applyTheme(next);
        }).catch(() => {});
        return () => {
            cancelled = true;
        };
    }, []);

    const handleToggleTheme = async () => {
        const next = theme === 'dark' ? 'light' : 'dark';
        setTheme(next);
        applyTheme(next);
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

    const view = VIEWS.find((item) => item.id === mainView) || null;
    const playerProps = {
        queue: player.queue,
        currentIndex: player.currentIndex,
        current: player.current,
        collapsed: player.collapsed,
        onToggleCollapsed: () => player.setCollapsed((value) => !value),
        isFileLoaded: player.isFileLoaded,
        isPlaying: player.isPlaying,
        isRecording: session.isRecording,
        isLoopEnabled: player.loop,
        error: player.error,
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
    };

    return React.createElement(ToastProvider, null, React.createElement('div', {
        className: 'h-full flex flex-col font-sans bg-app text-fg'
    },
        React.createElement('div', {
            className: 'flex-none relative z-10 flex items-center gap-1 px-2 sm:px-3 border-b border-line bg-surface min-h-[2.75rem]'
        },
            !wide && React.createElement('button', {
                type: 'button',
                className: 'btn-ghost gap-1.5 px-1.5 py-1 text-xs font-medium text-fg-soft',
                'aria-label': `Show ${view ? view.rail.toLowerCase() : 'side panel'}`,
                'aria-expanded': railOpen,
                onClick: () => setRailOpen((open) => !open)
            },
                React.createElement(Icons.PanelLeft, { className: 'w-4 h-4' }),
                React.createElement('span', { className: 'hidden sm:inline' }, view ? view.rail : 'Panel')
            ),
            tabsOnTop
                ? React.createElement(Tabs, {
                    label: 'Views',
                    tabs: VIEWS,
                    value: mainView,
                    onChange: requestView,
                    className: 'flex-1'
                })
                : React.createElement('h1', {
                    className: 'flex-1 min-w-0 truncate text-sm font-semibold px-1'
                }, view ? view.label : 'UI kit'),
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
            className: 'relative flex flex-1 min-h-0'
        },
            !wide && railOpen && React.createElement('div', {
                className: 'fixed inset-0 z-30 bg-black/40',
                'aria-hidden': true,
                onClick: () => setRailOpen(false)
            }),
            React.createElement('aside', {
                className: cx('app-sidebar overflow-hidden', railOpen && 'is-open'),
                'aria-label': view ? view.rail : 'Side panel'
            },
                !wide && React.createElement('div', {
                    className: 'flex-none flex items-center justify-between px-2 py-1.5 border-b border-line'
                },
                    React.createElement('span', { className: 'label-micro' }, view ? view.rail : 'Panel'),
                    React.createElement(IconButton, {
                        label: 'Close',
                        icon: Icons.Close,
                        variant: 'ghost',
                        className: 'p-1',
                        onClick: () => setRailOpen(false)
                    })
                ),
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
                mainView === 'live' && React.createElement('div', {
                    className: 'flex-1 min-h-0 overflow-y-auto'
                },
                    React.createElement(LiveRail, { outputNicLabel })
                ),
                mainView === 'gallery' && React.createElement('div', { className: 'flex-1' }),
                wide && React.createElement(PlaybackControls, playerProps)
            ),
            React.createElement('div', {
                className: 'flex flex-1 min-w-0 min-h-0 flex-col'
            },
                mainView === 'monitor' && React.createElement('div', {
                    className: 'flex flex-1 min-h-0 flex-col'
                },
                    React.createElement('div', {
                        className: 'app-toolbar items-end bg-panel'
                    },
                        React.createElement('div', { className: 'flex flex-col min-w-fit' },
                            React.createElement('label', { className: 'text-xs font-medium text-muted mb-0.5' },
                                'Format'
                            ),
                            React.createElement(Select, {
                                compact: true,
                                value: displayFormat,
                                onChange: (e) => handleDisplayFormatChange(e.target.value)
                            },
                                React.createElement('option', { value: 'decimal' }, '0-255'),
                                React.createElement('option', { value: 'percent' }, '0-100%'),
                                React.createElement('option', { value: 'hex' }, '0-FF')
                            )
                        ),
                        React.createElement('div', { className: 'flex flex-col min-w-fit' },
                            React.createElement('label', { className: 'text-xs font-medium text-muted mb-0.5' },
                                'Grid'
                            ),
                            React.createElement(Select, {
                                compact: true,
                                value: gridDimensions,
                                onChange: (e) => handleGridDimensionsChange(e.target.value)
                            },
                                React.createElement('option', { value: 'auto' }, 'Auto'),
                                React.createElement('option', { value: '8x64' }, '8 columns'),
                                React.createElement('option', { value: '16x32' }, '16 columns'),
                                React.createElement('option', { value: '32x16' }, '32 columns')
                            )
                        ),
                        React.createElement('div', { className: 'flex flex-col min-w-fit' },
                            React.createElement('label', { className: 'text-xs font-medium text-muted mb-0.5' },
                                'Bars'
                            ),
                            React.createElement('button', {
                                type: 'button',
                                onClick: toggleAnimations,
                                'aria-pressed': showAnimations,
                                className: 'btn-quiet'
                            }, showAnimations ? 'On' : 'Off')
                        ),
                        React.createElement('div', { className: 'flex flex-col min-w-fit' },
                            React.createElement('label', { className: 'text-xs font-medium text-muted mb-0.5' },
                                'Nodes'
                            ),
                            React.createElement('button', {
                                type: 'button',
                                onClick: toggleNodes,
                                'aria-pressed': showNodes,
                                title: 'Brackets over the channels each detected node uses',
                                className: 'btn-quiet'
                            }, showNodes ? 'On' : 'Off')
                        ),
                        React.createElement('div', { className: 'flex flex-col min-w-fit' },
                            React.createElement('label', { className: 'text-xs font-medium text-muted mb-0.5' },
                                'Group'
                            ),
                            React.createElement(Select, {
                                compact: true,
                                value: groupMode,
                                disabled: selectedUniverse === null,
                                title: 'Pixel grouping for this universe',
                                onChange: (e) => handleGroupModeChange(e.target.value)
                            },
                                React.createElement('option', { value: 'auto' }, 'Auto (nodes)'),
                                React.createElement('option', { value: 'off' }, 'Off'),
                                React.createElement('option', { value: '1' }, '1 ch'),
                                React.createElement('option', { value: '2' }, '2 ch'),
                                React.createElement('option', { value: '3' }, '3 ch'),
                                React.createElement('option', { value: '4' }, '4 ch'),
                                React.createElement('option', { value: '5' }, '5 ch')
                            )
                        ),
                        React.createElement('div', { className: 'flex flex-col min-w-fit' },
                            React.createElement('label', { className: 'text-xs font-medium text-muted mb-0.5' },
                                'Colour'
                            ),
                            React.createElement('button', {
                                type: 'button',
                                onClick: toggleColorBars,
                                'aria-pressed': colorBars,
                                title: 'Colour each bar by the node’s colour order',
                                className: 'btn-quiet'
                            }, colorBars ? 'On' : 'Off')
                        )
                    ),
                    React.createElement(DmxGrid, {
                        dmxData,
                        selectedUniverse,
                        selectedProtocol,
                        displayFormat,
                        gridDimensions,
                        showAnimations,
                        overlay,
                        showNodes,
                        colorBars
                    })
                ),
                React.createElement('div', {
                    className: mainView === 'studio' ? 'flex flex-1 min-h-0 flex-col' : 'hidden'
                },
                    React.createElement(StudioPanel, {
                        session,
                        selectedUniverses,
                        visible: mainView === 'studio'
                    })
                ),
                mainView === 'live' && React.createElement(LivePanel, { outputNicLabel }),
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
                }),
                mainView === 'gallery' && React.createElement(Gallery, {
                    onToggleTheme: handleToggleTheme
                }),
                !wide && React.createElement(MiniPlayer, {
                    current: player.current,
                    isFileLoaded: player.isFileLoaded,
                    isPlaying: player.isPlaying,
                    isRecording: session.isRecording,
                    playheadMs: player.playheadMs,
                    durationMs: player.durationMs,
                    formatClock: player.formatClock,
                    queueLength: player.queue.length,
                    onPlay: player.handlePlay,
                    onPause: player.handlePause,
                    onStop: player.handleStop,
                    onBack: player.handleBack,
                    onNext: player.handleNext,
                    onExpand: () => setPlayerSheet(true)
                })
            )
        ),
        !tabsOnTop && React.createElement(BottomNav, { value: mainView, onChange: requestView }),
        React.createElement(Dialog, {
            open: playerSheet && !wide,
            onClose: () => setPlayerSheet(false),
            title: 'Player',
            size: 'sm'
        }, React.createElement(PlaybackControls, playerProps))
    ));
};

module.exports = App;
