class UniverseStore {
    constructor() {
        this.artnetUniverses = new Map();
        this.sacnUniverses = new Map();
        this.selectedUniverses = new Set();
        this.universeFrameTracking = new Map();
    }

    addUniverse(data) {
        const { protocol, universe, ...rest } = data;
        const store = protocol === 'artnet' ? this.artnetUniverses : this.sacnUniverses;
        
        store.set(universe, {
            ...rest,
            id: universe,
            protocol,
            lastSeen: Date.now()
        });
    }

    removeUniverse(protocol, universe) {
        const store = protocol === 'artnet' ? this.artnetUniverses : this.sacnUniverses;
        store.delete(universe);
    }

    getUniverses(protocol) {
        const store = protocol === 'artnet' ? this.artnetUniverses : this.sacnUniverses;
        return Array.from(store.values());
    }

    clearUniverses() {
        this.artnetUniverses.clear();
        this.sacnUniverses.clear();
    }

    isUniverseSelected(protocol, universe) {
        return this.selectedUniverses.has(`${protocol}-${universe}`);
    }

    setSelectedUniverses(universes) {
        this.selectedUniverses = new Set(universes);
    }

    toggleUniverseSelection(protocol, universe) {
        const key = `${protocol}-${universe}`;
        if (this.selectedUniverses.has(key)) {
            this.selectedUniverses.delete(key);
        } else {
            this.selectedUniverses.add(key);
        }
    }

    cleanStaleUniverses(timeout = 5000) {
        const now = Date.now();
        
        for (const [universe, data] of this.artnetUniverses) {
            if (now - data.lastSeen > timeout) {
                this.removeUniverse('artnet', universe);
            }
        }

        for (const [universe, data] of this.sacnUniverses) {
            if (now - data.lastSeen > timeout) {
                this.removeUniverse('sacn', universe);
            }
        }
    }

    getUniverseMetrics(protocol, universe) {
        const key = `${protocol}-${universe}`;
        return this.universeFrameTracking.get(key) || {
            fps: 0,
            droppedFrames: 0,
            activeChannels: 0
        };
    }

    updateUniverseMetrics(protocol, universe, metrics) {
        const key = `${protocol}-${universe}`;
        this.universeFrameTracking.set(key, {
            ...this.getUniverseMetrics(protocol, universe),
            ...metrics
        });
    }
}

module.exports = new UniverseStore();