// Live tab state outside React: faders move at pointer rate and MIDI (5c)
// drives it from any tab, so neither should re-render the whole app.
// Layout is saved through live-save; levels go to the main process as
// changed addresses (HTP across controls sharing an address).
const ipcRenderer = require('./ipc');
const {
    defaultLive,
    diffLevels,
    emptyState,
    levelsByAddress,
    normalizeLive,
    patchSequential
} = require('../services/shared/liveControl');

const SAVE_MS = 400;

let layout = defaultLive();
let state = emptyState();
let snapshot = { layout, state, loaded: false };
let sent = new Map();
let flushQueued = false;
let saveTimer = null;
let loading = null;
const listeners = new Set();

const publish = () => {
    snapshot = { layout, state, loaded: snapshot.loaded };
    listeners.forEach((listener) => listener());
};

const flush = () => {
    flushQueued = false;
    const next = levelsByAddress(layout, state);
    const changes = diffLevels(sent, next);
    sent = next;
    if (changes.length) {
        ipcRenderer.send('live-set', changes);
    }
};

const queueFlush = () => {
    if (!flushQueued) {
        flushQueued = true;
        Promise.resolve().then(flush);
    }
};

const queueSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        ipcRenderer.invoke('live-save', { faders: layout.faders, pads: layout.pads, dest: layout.dest, midi: layout.midi })
            .catch(() => {});
    }, SAVE_MS);
};

const setLayout = (next) => {
    layout = normalizeLive({ ...layout, ...next });
    publish();
    queueFlush();
    queueSave();
};

const liveStore = {
    subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,

    // Once per app start: saved layout in, and the main process's levels
    // cleared so both sides start at 0.
    load: () => {
        if (!loading) {
            loading = ipcRenderer.invoke('live-get').then((result) => {
                if (result && result.live) {
                    layout = normalizeLive(result.live);
                }
                return ipcRenderer.invoke('live-release-all');
            }).catch(() => {}).then(() => {
                sent = levelsByAddress(layout, state);
                snapshot = { layout, state, loaded: true };
                listeners.forEach((listener) => listener());
            });
        }
        return loading;
    },

    setFader: (i, value) => {
        const v = Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
        if (state.faders[i] === v) {
            return;
        }
        const faders = state.faders.slice();
        faders[i] = v;
        state = { ...state, faders };
        publish();
        queueFlush();
    },

    // down: press (true) or release (false). Flash follows the finger;
    // toggle flips on press.
    pressPad: (i, down) => {
        const pad = layout.pads[i];
        if (!pad) {
            return;
        }
        const lit = pad.mode === 'flash' ? Boolean(down) : (down ? !state.pads[i] : state.pads[i]);
        if (lit === state.pads[i]) {
            return;
        }
        const pads = state.pads.slice();
        pads[i] = lit;
        state = { ...state, pads };
        publish();
        queueFlush();
    },

    releaseAll: () => {
        state = emptyState();
        publish();
        queueFlush();
        ipcRenderer.invoke('live-release-all').catch(() => {});
    },

    // kind: 'faders' | 'pads'
    updateControl: (kind, i, patch) => {
        const list = layout[kind].slice();
        list[i] = { ...list[i], ...patch };
        setLayout({ [kind]: list });
    },

    patchRow: (kind, from, count, address) => {
        setLayout({ [kind]: patchSequential(layout[kind], from, count, address) });
    },

    setDest: (dest) => {
        setLayout({ dest });
    },

    // MIDI mappings and per-device options (normalized with the layout).
    setMidi: (midi) => {
        setLayout({ midi: { ...layout.midi, ...midi } });
    }
};

module.exports = liveStore;
