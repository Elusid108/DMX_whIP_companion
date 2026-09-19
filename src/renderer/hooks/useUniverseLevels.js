const { useMemo } = require('react');
const ipcRenderer = require('../ipc');

let latest = { artnet: {}, sacn: {} };
const listeners = new Set();
let bound = false;

const emptyLevels = () => ({ artnet: {}, sacn: {} });

const notify = () => {
    for (const listener of listeners) {
        listener(latest);
    }
};

const handleSnapshot = (event, snapshot = {}) => {
    if (!snapshot.levels || typeof snapshot.levels !== 'object') {
        return;
    }
    latest = snapshot.levels;
    notify();
};

const handleClear = () => {
    latest = emptyLevels();
    notify();
};

const ensureBound = () => {
    if (bound) {
        return;
    }
    bound = true;
    ipcRenderer.on('universes-snapshot', handleSnapshot);
    ipcRenderer.on('clear-universes', handleClear);
};

const pickLevels = (levels, protocol, universeId) => {
    if (!levels || universeId == null) {
        return null;
    }
    const group = levels[protocol];
    if (!group) {
        return null;
    }
    return group[universeId] ?? group[String(universeId)] ?? null;
};

const toBytes = (raw) => {
    if (!raw) {
        return null;
    }
    if (raw instanceof Uint8Array) {
        return raw;
    }
    if (ArrayBuffer.isView(raw)) {
        return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    }
    if (Array.isArray(raw) || raw.length === 512) {
        const out = new Uint8Array(512);
        for (let i = 0; i < 512; i++) {
            out[i] = raw[i] || 0;
        }
        return out;
    }
    return null;
};

const subscribeUniverseLevels = (listener) => {
    ensureBound();
    listeners.add(listener);
    listener(latest);
    return () => {
        listeners.delete(listener);
    };
};

const subscribeUniverseBuffer = (protocol, universeId, onBuffer) => {
    return subscribeUniverseLevels((levels) => {
        onBuffer(toBytes(pickLevels(levels, protocol, universeId)));
    });
};

const useUniverseLevels = (protocol, universeId) => useMemo(() => ({
    subscribe: (onBuffer) => subscribeUniverseBuffer(protocol, universeId, onBuffer)
}), [protocol, universeId]);

module.exports = {
    useUniverseLevels,
    subscribeUniverseBuffer,
    subscribeUniverseLevels
};
