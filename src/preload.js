const { contextBridge, ipcRenderer } = require('electron');

const INVOKE = new Set([
    'get-network-interfaces',
    'get-settings',
    'set-theme',
    'library-list',
    'library-new-file',
    'library-inspect',
    'library-save-meta',
    'library-import',
    'library-export',
    'library-rename',
    'library-delete',
    'library-choose-dir',
    'load-recording',
    'device-status',
    'device-identify',
    'device-list',
    'device-push-show',
    'device-play',
    'device-stop',
    'device-set-brightness',
    'device-set-live',
    'device-wifi-scan',
    'device-wifi-connect',
    'device-wifi-forget',
    'device-set-name',
    'device-rename-show',
    'device-open-portal',
    'device-pull-show'
]);

const SEND = new Set([
    'set-protocol',
    'select-monitor-universe',
    'update-selected-universes',
    'start-recording',
    'stop-recording',
    'toggle-playback',
    'stop-playback',
    'devices-scan'
]);

const RECEIVE = new Set([
    'universes-snapshot',
    'universe-removed',
    'clear-universes',
    'dmx-data-update',
    'file-loaded',
    'playback-stats',
    'recording-stats-update',
    'recording-error',
    'library-updated',
    'devices-update'
]);

contextBridge.exposeInMainWorld('dmx', {
    invoke: (channel, ...args) => {
        if (!INVOKE.has(channel)) {
            return Promise.reject(new Error(`Blocked invoke: ${channel}`));
        }
        return ipcRenderer.invoke(channel, ...args);
    },
    send: (channel, payload) => {
        if (!SEND.has(channel)) {
            return;
        }
        ipcRenderer.send(channel, payload);
    },
    on: (channel, callback) => {
        if (!RECEIVE.has(channel) || typeof callback !== 'function') {
            return () => {};
        }
        const listener = (_event, ...args) => callback(...args);
        ipcRenderer.on(channel, listener);
        return () => ipcRenderer.removeListener(channel, listener);
    }
});
