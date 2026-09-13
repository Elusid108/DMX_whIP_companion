const unsubscribers = new WeakMap();

const api = () => {
    if (!window.dmx) {
        throw new Error('Preload bridge is not available');
    }
    return window.dmx;
};

const ipc = {
    invoke: (channel, ...args) => api().invoke(channel, ...args),
    send: (channel, payload) => api().send(channel, payload),
    on: (channel, handler) => {
        const unsubscribe = api().on(channel, (...args) => handler(null, ...args));
        let byChannel = unsubscribers.get(handler);
        if (!byChannel) {
            byChannel = new Map();
            unsubscribers.set(handler, byChannel);
        }
        byChannel.set(channel, unsubscribe);
    },
    removeListener: (channel, handler) => {
        const byChannel = unsubscribers.get(handler);
        if (!byChannel) {
            return;
        }
        const unsubscribe = byChannel.get(channel);
        if (unsubscribe) {
            unsubscribe();
            byChannel.delete(channel);
        }
    }
};

module.exports = ipc;
