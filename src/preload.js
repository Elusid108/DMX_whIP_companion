const { contextBridge, ipcRenderer } = require('electron');

const INVOKE = new Set([
    'get-network-interfaces',
    'get-settings',
    'set-ui-settings',
    'live-release-all',
    'live-get',
    'live-save',
    'set-output-nic',
    'set-theme',
    'open-external-url',
    'library-list',
    'library-new-file',
    'library-inspect',
    'library-save-meta',
    'library-import',
    'library-export',
    'library-rename',
    'library-delete',
    'library-choose-dir',
    'library-create-folder',
    'library-rename-folder',
    'library-delete-folder',
    'library-move',
    'library-set-collapsed',
    'cancel-recording',
    'load-recording',
    'load-compilation',
    'player-play',
    'edit-compilation',
    'undo-compilation',
    'redo-compilation',
    'inspect-clip',
    'import-audio',
    'library-duplicate',
    'confirm-unsaved-compilation',
    'save-compilation',
    'start-punch-in',
    'stop-punch-in',
    'cancel-punch-in',
    'export-flattened',
    'timeline-overview',
    'library-save-compilation-meta',
    'device-status',
    'device-identify',
    'device-reboot',
    'device-ota-plan',
    'device-fixture-get',
    'device-fixture-set',
    'device-fixture-locate',
    'device-ota-run',
    'device-list',
    'device-push-analyze',
    'device-push-show',
    'device-push-batch',
    'device-push-distribute',
    'device-push-stream',
    'device-stream-stop',
    'device-play',
    'device-stop',
    'device-set-brightness',
    'device-set-live',
    'device-wifi-scan',
    'device-wifi-connect',
    'device-wifi-forget',
    'device-set-name',
    'device-set-shownet',
    'device-rename-show',
    'device-open-portal',
    'device-pull-show',
    'flash-catalog',
    'flash-ports',
    'flash-set-settings',
    'flash-identify',
    'flash-run',
    'flash-wlan',
    'flash-build',
    'cuebus-state',
    'cuebus-refresh',
    'cuebus-launch',
    'cuebus-pause',
    'cuebus-resume',
    'cuebus-stop',
    'cuebus-seek'
]);

const SEND = new Set([
    'set-ui-view',
    'set-protocol',
    'select-monitor-universe',
    'update-selected-universes',
    'start-recording',
    'stop-recording',
    'toggle-playback',
    'set-playback-loop',
    'stop-playback',
    'seek-playback',
    'unload-recording',
    'devices-scan',
    'live-set'
]);

const RECEIVE = new Set([
    'universes-snapshot',
    'universe-removed',
    'clear-universes',
    'dmx-data-update',
    'file-loaded',
    'compilation-updated',
    'playback-stats',
    'recording-stats-update',
    'recording-error',
    'recording-saved',
    'punch-in-progress',
    'punch-in-started',
    'punch-in-auto-stopped',
    'punch-in-failed',
    'library-updated',
    'devices-update',
    'device-push-progress',
    'device-ota-progress',
    'flash-progress',
    'flash-log',
    'cuebus-update'
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
