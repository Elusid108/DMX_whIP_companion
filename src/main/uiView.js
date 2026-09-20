let view = 'monitor';
let recording = false;
const listeners = new Set();

const getUiView = () => ({ view, recording });

const setUiView = (next = {}) => {
    if (next.view != null) {
        view = String(next.view);
    }
    if (next.recording != null) {
        recording = Boolean(next.recording);
    }
    const state = getUiView();
    listeners.forEach((listener) => {
        try {
            listener(state);
        } catch (err) {
            console.error('uiView listener error:', err);
        }
    });
    return state;
};

const onUiViewChange = (listener) => {
    if (typeof listener !== 'function') {
        return () => {};
    }
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

const studioVisible = () => view === 'studio';

const devicesUiWanted = () => (
    !recording && (view === 'devices' || view === 'flash' || view === 'library')
);

module.exports = {
    getUiView,
    setUiView,
    onUiViewChange,
    studioVisible,
    devicesUiWanted
};
