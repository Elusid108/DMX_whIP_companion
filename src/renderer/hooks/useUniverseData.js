const { useState, useEffect } = require('react');
const { ipcRenderer } = require('electron');

const useUniverseData = () => {
    const [artnetUniverses, setArtnetUniverses] = useState(new Map());
    const [sacnUniverses, setSacnUniverses] = useState(new Map());
    const [selectedUniverse, setSelectedUniverse] = useState(null);
    const [selectedProtocol, setSelectedProtocol] = useState(null);
    const [selectedUniverses, setSelectedUniverses] = useState(new Set());
    const [lastUpdate] = useState(new Map());

    // Clean stale universes that haven't been updated recently
    const cleanStaleUniverses = () => {
        const now = Date.now();
        const STALE_THRESHOLD = 250; // 250ms
        const REMOVE_THRESHOLD = 5000; // 5 seconds - only remove after longer period of no updates

        setArtnetUniverses(prev => {
            const newUniverses = new Map(prev);
            for (const [key, value] of newUniverses.entries()) {
                const timeSinceLastSeen = now - value.lastSeen;
                if (timeSinceLastSeen > REMOVE_THRESHOLD) {
                    newUniverses.delete(key);
                } else if (timeSinceLastSeen > STALE_THRESHOLD) {
                    // Mark as stale but preserve the maximum channel count
                    newUniverses.set(key, {
                        ...value,
                        sourceIp: 'Disconnected',
                        stale: true
                    });
                }
            }
            return newUniverses;
        });

        setSacnUniverses(prev => {
            const newUniverses = new Map(prev);
            for (const [key, value] of newUniverses.entries()) {
                const timeSinceLastSeen = now - value.lastSeen;
                if (timeSinceLastSeen > REMOVE_THRESHOLD) {
                    newUniverses.delete(key);
                } else if (timeSinceLastSeen > STALE_THRESHOLD) {
                    // Mark as stale but preserve the maximum channel count
                    newUniverses.set(key, {
                        ...value,
                        sourceIp: 'Disconnected',
                        stale: true
                    });
                }
            }
            return newUniverses;
        });
    };

    useEffect(() => {
        const cleanupInterval = setInterval(cleanStaleUniverses, 100);
        return () => clearInterval(cleanupInterval);
    }, []);

    useEffect(() => {
        const handleUniverseUpdated = (event, universeInfo) => {
            const { protocol, universe, sourceIp, sourceName, dmxData } = universeInfo;
            
            // Calculate active channels - find the highest channel with non-zero value
            const currentActiveChannels = dmxData ? 
                dmxData.reduce((highest, val, index) => val > 0 ? index + 1 : highest, 0) : 0;

            // Get existing universe data to compare with previous max channels
            const existingData = protocol === 'artnet' ? 
                artnetUniverses.get(universe) : 
                sacnUniverses.get(universe);

            // Keep the higher channel count
            const activeChannels = Math.max(
                currentActiveChannels,
                existingData?.activeChannels || 0
            );
            
            const universeData = {
                id: universe,
                universe,
                sourceIp,
                sourceName,
                activeChannels,
                protocol,
                lastSeen: Date.now()
            };

            if (protocol === 'artnet') {
                setArtnetUniverses(prev => {
                    const newUniverses = new Map(prev);
                    newUniverses.set(universe, universeData);
                    return newUniverses;
                });

                // Auto-select newly discovered universes
                setSelectedUniverses(prev => {
                    const newSet = new Set(prev);
                    newSet.add(`${protocol}-${universe}`);
                    return newSet;
                });
            } else if (protocol === 'sacn') {
                setSacnUniverses(prev => {
                    const newUniverses = new Map(prev);
                    newUniverses.set(universe, universeData);
                    return newUniverses;
                });

                // Auto-select newly discovered universes
                setSelectedUniverses(prev => {
                    const newSet = new Set(prev);
                    newSet.add(`${protocol}-${universe}`);
                    return newSet;
                });
            }
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
            setArtnetUniverses(new Map());
            setSacnUniverses(new Map());
            setSelectedUniverse(null);
            setSelectedProtocol(null);
            setSelectedUniverses(new Set());
        };

        ipcRenderer.on('universe-updated', handleUniverseUpdated);
        ipcRenderer.on('universe-removed', handleUniverseRemoved);
        ipcRenderer.on('clear-universes', handleClearUniverses);

        return () => {
            ipcRenderer.removeListener('universe-updated', handleUniverseUpdated);
            ipcRenderer.removeListener('universe-removed', handleUniverseRemoved);
            ipcRenderer.removeListener('clear-universes', handleClearUniverses);
        };
    }, []);

    useEffect(() => {
        // Auto-select first discovered universe if none is selected
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

        // Select all universes by default
        const newSelectedUniverses = new Set();
        artnetUniverses.forEach((_, universe) => {
            newSelectedUniverses.add(`artnet-${universe}`);
        });
        sacnUniverses.forEach((_, universe) => {
            newSelectedUniverses.add(`sacn-${universe}`);
        });
        
        // Only update if there are changes to avoid infinite loop
        if (newSelectedUniverses.size !== selectedUniverses.size) {
            setSelectedUniverses(newSelectedUniverses);
        }
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
                // Remove all universes of this protocol
                Array.from(newSet).forEach(key => {
                    if (key.startsWith(protocol)) {
                        newSet.delete(key);
                    }
                });
            } else {
                // Add all universes of this protocol
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