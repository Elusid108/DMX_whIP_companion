// Renderer IPC channel <-> engine API name tables used by engineHost, kept
// Electron-free so a test can reconcile them with the preload allow-lists.
// Every channel in src/preload.js is either routed to the engine here or
// listed as companion-only with the reason it stays in the main process.

// Request/reply channels: ipc channel -> { kind, name, args?, result? }.
// args(payload) shapes the renderer's argument into the engine payload.
const INVOKE = {
    'live-release-all': { kind: 'command', name: 'live.releaseAll' },
    'live-get': { kind: 'query', name: 'live.get' },
    'live-save': { kind: 'command', name: 'live.save' },
    'set-output-nic': { kind: 'command', name: 'output.setNic' },
    'get-network-interfaces': { kind: 'query', name: 'network.interfaces' },
    'cancel-recording': { kind: 'command', name: 'record.cancel' },
    'timeline-overview': { kind: 'query', name: 'playback.overview' },
    'load-compilation': { kind: 'command', name: 'playback.loadCompilation' },
    'inspect-clip': { kind: 'query', name: 'studio.inspectClip' },
    'edit-compilation': { kind: 'command', name: 'studio.edit' },
    'undo-compilation': { kind: 'command', name: 'studio.undo' },
    'redo-compilation': { kind: 'command', name: 'studio.redo' },
    'save-compilation': { kind: 'command', name: 'studio.save' },
    'export-flattened': { kind: 'command', name: 'studio.exportFlattened' },
    'start-punch-in': { kind: 'command', name: 'punchIn.start' },
    'stop-punch-in': { kind: 'command', name: 'punchIn.stop' },
    'cancel-punch-in': { kind: 'command', name: 'punchIn.cancel' },
    'player-play': { kind: 'command', name: 'player.play' }
};

// Fire-and-forget channels: ipc channel -> { name, args? }.
const SEND = {
    'live-set': { name: 'live.set', args: (changes) => ({ changes }) },
    'set-protocol': { name: 'receive.setNic', args: (payload) => ({ nic: (payload && payload.interfaceIp) || '0.0.0.0' }) },
    'select-monitor-universe': { name: 'monitor.select', args: (payload) => ({ protocol: payload && payload.protocol, universe: payload && payload.universe }) },
    'update-selected-universes': { name: 'receive.setUniverses', args: (universes) => ({ universes }) },
    'start-recording': { name: 'record.start', args: () => ({}) },
    'stop-recording': { name: 'record.stop', args: () => ({ emitSaved: true }) },
    'toggle-playback': { name: 'playback.toggle' },
    'set-playback-loop': { name: 'playback.setLoop' },
    'stop-playback': { name: 'playback.stop' },
    'seek-playback': { name: 'playback.seek' },
    'unload-recording': { name: 'playback.unload', args: () => ({}) }
};

// Engine events -> renderer channels (payload passed through unless mapped).
const EVENTS = {
    'monitor.cleared': { channel: 'clear-universes', payload: () => undefined },
    'playback.stats': { channel: 'playback-stats' },
    'playback.fileLoaded': { channel: 'file-loaded' },
    'studio.compilationUpdated': { channel: 'compilation-updated' },
    'record.saved': { channel: 'recording-saved' },
    'record.error': { channel: 'recording-error' },
    'punchIn.started': { channel: 'punch-in-started' },
    'punchIn.autoStopped': { channel: 'punch-in-auto-stopped' },
    'punchIn.failed': { channel: 'punch-in-failed' },
    'library.updated': { channel: 'library-updated' }
};

// Renderer channels the engine host answers with its own subscriptions
// (gated by the visible tab and the take, as the main process always did).
const HOST_EVENTS = {
    'universes-snapshot': 'monitor.snapshot',
    'dmx-data-update': 'monitor.grid (stream)',
    'recording-stats-update': 'record.stats',
    'punch-in-progress': 'punchIn.progress'
};

// Channels handled in src/main outside the engine, with why.
const COMPANION_ONLY = {
    'get-settings': 'UI settings (same store)',
    'set-theme': 'window background',
    'set-ui-settings': 'UI settings',
    'open-external-url': 'shell',
    'set-ui-view': 'view state drives host subscriptions and devices polling',
    'devices-scan': 'devices (later phase); also sends artnet.poll',
    'load-recording': 'file picker, then playback.load',
    'import-audio': 'audio picker and ffmpeg, then studio.audio.add',
    'confirm-unsaved-compilation': 'message box',
    'library-list': 'library file ops over the engine store',
    'library-new-file': 'creates the file, then record.setPath',
    'library-inspect': 'library file ops',
    'library-save-meta': 'library file ops',
    'library-import': 'file dialog',
    'library-export': 'file dialog',
    'library-rename': 'library file ops',
    'library-delete': 'library file ops',
    'library-choose-dir': 'directory dialog',
    'library-create-folder': 'library index',
    'library-rename-folder': 'library index',
    'library-delete-folder': 'library index',
    'library-move': 'library index',
    'library-set-collapsed': 'library index',
    'library-save-compilation-meta': 'library file ops',
    'library-duplicate': 'library file ops',
    'universe-removed': 'never sent (dead channel)',
    'devices-update': 'devices (later phase)',
    'device-push-progress': 'push (later phase)',
    'device-ota-progress': 'OTA (later phase)',
    'cuebus-update': 'show sync (later phase)',
    'flash-progress': 'USB flash',
    'flash-log': 'USB flash'
};
const COMPANION_PREFIXES = [
    ['device-', 'devices, push and OTA (later phase)'],
    ['flash-', 'USB flash, esptool, sibling build'],
    ['cuebus-', 'show sync (later phase)']
];

const companionReason = (channel) => {
    if (COMPANION_ONLY[channel]) {
        return COMPANION_ONLY[channel];
    }
    const hit = COMPANION_PREFIXES.find(([prefix]) => channel.startsWith(prefix));
    return hit ? hit[1] : null;
};

module.exports = { INVOKE, SEND, EVENTS, HOST_EVENTS, COMPANION_ONLY, companionReason };
