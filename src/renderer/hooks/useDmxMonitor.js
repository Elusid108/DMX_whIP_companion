const { useState, useEffect, useRef, useCallback } = require('react');
const ipcRenderer = require('../ipc');

const emptyGrid = () => new Array(512).fill(null);

// Monitor preferences, saved in settings.json (settings.js normalizeMonitor).
const DEFAULT_PREFS = {
    displayFormat: 'decimal',
    gridDimensions: 'auto',
    showAnimations: true,
    showNodes: true,
    colorBars: true,
    groupMode: {}
};

const useDmxMonitor = (selectedUniverse, selectedProtocol, { monitorVisible } = {}) => {
    const [dmxData, setDmxData] = useState(emptyGrid());
    const [networkInterfaces, setNetworkInterfaces] = useState([]);
    const [selectedNic, setSelectedNic] = useState('0.0.0.0');
    const [prefs, setPrefs] = useState(DEFAULT_PREFS);
    const visibleRef = useRef(true);
    visibleRef.current = monitorVisible !== false;

    useEffect(() => {
        let alive = true;
        ipcRenderer.invoke('get-settings').then((result) => {
            const saved = result && result.settings && result.settings.monitor;
            if (alive && saved) {
                setPrefs({ ...DEFAULT_PREFS, ...saved });
            }
        }).catch(() => {});
        return () => {
            alive = false;
        };
    }, []);

    const updatePrefs = useCallback((patch) => {
        setPrefs((prev) => ({ ...prev, ...patch }));
        ipcRenderer.invoke('set-ui-settings', { section: 'monitor', patch }).catch(() => {});
    }, []);

    useEffect(() => {
        const loadNetworkInterfaces = async () => {
            const interfaces = await ipcRenderer.invoke('get-network-interfaces');
            setNetworkInterfaces(interfaces || []);
        };

        loadNetworkInterfaces();
    }, []);

    useEffect(() => {
        setDmxData(emptyGrid());
    }, [selectedUniverse, selectedProtocol]);

    useEffect(() => {
        const handleDmxUpdate = (event, data) => {
            if (!visibleRef.current) {
                return;
            }
            if (data.protocol !== selectedProtocol || data.universe !== selectedUniverse) {
                return;
            }
            setDmxData(Array.isArray(data.data) ? data.data : emptyGrid());
        };

        const handleClearUniverses = () => {
            setDmxData(emptyGrid());
        };

        ipcRenderer.on('dmx-data-update', handleDmxUpdate);
        ipcRenderer.on('clear-universes', handleClearUniverses);

        return () => {
            ipcRenderer.removeListener('dmx-data-update', handleDmxUpdate);
            ipcRenderer.removeListener('clear-universes', handleClearUniverses);
        };
    }, [selectedUniverse, selectedProtocol]);

    useEffect(() => {
        setDmxData(emptyGrid());
        ipcRenderer.send('set-protocol', { interfaceIp: selectedNic });
    }, [selectedNic]);

    const handleNetworkChange = (nicIp) => {
        setSelectedNic(nicIp);
    };

    const handleDisplayFormatChange = (format) => updatePrefs({ displayFormat: format });
    const handleGridDimensionsChange = (dimensions) => updatePrefs({ gridDimensions: dimensions });
    const toggleAnimations = () => updatePrefs({ showAnimations: !prefs.showAnimations });
    const toggleNodes = () => updatePrefs({ showNodes: !prefs.showNodes });
    const toggleColorBars = () => updatePrefs({ colorBars: !prefs.colorBars });

    // Grouping is per universe; 'auto' is the default and is not stored.
    const universeKey = selectedUniverse !== null && selectedUniverse !== undefined
        ? `${selectedProtocol}:${selectedUniverse}`
        : '';
    const groupMode = (universeKey && prefs.groupMode[universeKey]) || 'auto';
    const handleGroupModeChange = (mode) => {
        if (!universeKey) {
            return;
        }
        const next = { ...prefs.groupMode };
        if (mode === 'auto') {
            delete next[universeKey];
        } else {
            next[universeKey] = mode;
        }
        updatePrefs({ groupMode: next });
    };

    return {
        dmxData,
        networkInterfaces,
        selectedNic,
        displayFormat: prefs.displayFormat,
        gridDimensions: prefs.gridDimensions,
        showAnimations: prefs.showAnimations,
        showNodes: prefs.showNodes,
        colorBars: prefs.colorBars,
        groupMode,
        handleNetworkChange,
        handleDisplayFormatChange,
        handleGridDimensionsChange,
        handleGroupModeChange,
        toggleAnimations,
        toggleNodes,
        toggleColorBars
    };
};

module.exports = useDmxMonitor;
