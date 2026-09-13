const { useState, useEffect, useRef } = require('react');
const { ipcRenderer } = require('electron');

const toUniverseMap = (rows = []) => {
    const next = new Map();
    for (const row of rows) {
        const id = row.id ?? row.universe;
        next.set(id, row);
    }
    return next;
};

const useUniverseData = () => {
    const [artnetUniverses, setArtnetUniverses] = useState(new Map());
    const [sacnUniverses, setSacnUniverses] = useState(new Map());
    const [selectedUniverse, setSelectedUniverse] = useState(null);
    const [selectedProtocol, setSelectedProtocol] = useState(null);
    const [selectedUniverses, setSelectedUniverses] = useState(new Set());
    const knownUniversesRef = useRef(new Set());

    useEffect(() => {
        ipcRenderer.send('select-monitor-universe', {
            protocol: selectedProtocol,
            universe: selectedUniverse
        });
    }, [selectedProtocol, selectedUniverse]);

    useEffect(() => {
        const handleSnapshot = (event, snapshot = {}) => {
            setArtnetUniverses(toUniverseMap(snapshot.artnet));
            setSacnUniverses(toUniverseMap(snapshot.sacn));
        };

        const handleUniverseRemoved = (event, { protocol, id }) => {
            if (protocol === 'artnet') {
                setArtnetUniverses(prev => {
                    const newUniverses = new Map(prev);
                    newUniverses.delete(id);
                    return newUniverses;
                });
            } else if (protocol === 'sacn') {
                setSacnUniverses(prev => {
                    const newUniverses = new Map(prev);
                    newUniverses.delete(id);
                    return newUniverses;
                });
            }
        };

        const handleClearUniverses = () => {
            knownUniversesRef.current = new Set();
            setArtnetUniverses(new Map());
            setSacnUniverses(new Map());
            setSelectedUniverse(null);
            setSelectedProtocol(null);
            setSelectedUniverses(new Set());
        };

        ipcRenderer.on('universes-snapshot', handleSnapshot);
        ipcRenderer.on('universe-removed', handleUniverseRemoved);
        ipcRenderer.on('clear-universes', handleClearUniverses);

        return () => {
            ipcRenderer.removeListener('universes-snapshot', handleSnapshot);
            ipcRenderer.removeListener('universe-removed', handleUniverseRemoved);
            ipcRenderer.removeListener('clear-universes', handleClearUniverses);
        };
    }, []);

    useEffect(() => {
        if (!selectedUniverse && !selectedProtocol) {
            const artnetUniverseIds = Array.from(artnetUniverses.keys());
            const sacnUniverseIds = Array.from(sacnUniverses.keys());

            if (artnetUniverseIds.length > 0) {
                setSelectedUniverse(artnetUniverseIds[0]);
                setSelectedProtocol('artnet');
            } else if (sacnUniverseIds.length > 0) {
                setSelectedUniverse(sacnUniverseIds[0]);
                setSelectedProtocol('sacn');
            }
        }

        const presentKeys = new Set();
        artnetUniverses.forEach((_, universe) => presentKeys.add(`artnet-${universe}`));
        sacnUniverses.forEach((_, universe) => presentKeys.add(`sacn-${universe}`));

        for (const key of [...knownUniversesRef.current]) {
            if (!presentKeys.has(key)) {
                knownUniversesRef.current.delete(key);
            }
        }

        setSelectedUniverses(prev => {
            const next = new Set(prev);
            let changed = false;
            for (const key of presentKeys) {
                if (!knownUniversesRef.current.has(key)) {
                    knownUniversesRef.current.add(key);
                    next.add(key);
                    changed = true;
                }
            }
            return changed ? next : prev;
        });
    }, [artnetUniverses, sacnUniverses, selectedUniverse, selectedProtocol]);

    const handleUniverseSelect = (universeId, protocol) => {
        setSelectedUniverses(prev => {
            const newSet = new Set(prev);
            const key = `${protocol}-${universeId}`;
            if (newSet.has(key)) {
                newSet.delete(key);
            } else {
                newSet.add(key);
            }
            return newSet;
        });
    };

    const handleSelectAll = (protocol) => {
        setSelectedUniverses(prev => {
            const newSet = new Set(prev);
            const universes = protocol === 'artnet' ? artnetUniverses : sacnUniverses;

            const allSelected = Array.from(universes.keys()).every(id =>
                newSet.has(`${protocol}-${id}`)
            );

            if (allSelected) {
                Array.from(newSet).forEach(key => {
                    if (key.startsWith(protocol)) {
                        newSet.delete(key);
                    }
                });
            } else {
                universes.forEach((_, id) => {
                    newSet.add(`${protocol}-${id}`);
                });
            }

            return newSet;
        });
    };

    return {
        artnetUniverses,
        sacnUniverses,
        selectedUniverse,
        selectedProtocol,
        selectedUniverses,
        setSelectedUniverse,
        setSelectedProtocol,
        handleUniverseSelect,
        handleSelectAll
    };
};

module.exports = useUniverseData;
