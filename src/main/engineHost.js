// The companion's engine host: creates the engine, and turns each renderer
// IPC channel into an engine command or query and each engine event back
// into the renderer channel it always used, with the same payload shape.
// Nothing in the renderer or preload changes.
const { app, ipcMain } = require('electron');
const { createEngine } = require('../engine');
const { decodeGridFrame } = require('../engine/receive');
const { getStore } = require('./settings');
const { getUiView, onUiViewChange } = require('./uiView');

let engineInstance = null;

// One engine per process, created on first use so settings paths exist.
const getEngine = () => {
    if (!engineInstance) {
        engineInstance = createEngine({
            settings: getStore(),
            appVersion: app.getVersion()
        });
    }
    return engineInstance;
};

const failure = (error) => ({ success: false, error: error && error.message ? error.message : String(error) });

// Request/reply channels: ipc channel -> { kind, name, args?, result? }.
// args(payload) shapes the renderer's argument into the engine payload.
const INVOKE = {
    'live-release-all': { kind: 'command', name: 'live.releaseAll' },
    'live-get': { kind: 'query', name: 'live.get' },
    'live-save': { kind: 'command', name: 'live.save' },
    'set-output-nic': { kind: 'command', name: 'output.setNic' },
    'get-network-interfaces': { kind: 'query', name: 'network.interfaces' }
};

// Fire-and-forget channels: ipc channel -> { name, args? }.
const SEND = {
    'live-set': { name: 'live.set', args: (changes) => ({ changes }) },
    'set-protocol': { name: 'receive.setNic', args: (payload) => ({ nic: (payload && payload.interfaceIp) || '0.0.0.0' }) },
    'select-monitor-universe': { name: 'monitor.select', args: (payload) => ({ protocol: payload && payload.protocol, universe: payload && payload.universe }) },
    'update-selected-universes': { name: 'receive.setUniverses', args: (universes) => ({ universes }) }
};

// Engine events -> renderer channels (payload passed through unless mapped).
const EVENTS = {
    'monitor.cleared': { channel: 'clear-universes', payload: () => undefined }
};

function createEngineHost(mainWindow, { recordingHandler = null } = {}) {
    const engine = getEngine();
    const client = engine.client({ client: 'companion' });
    const boundListeners = new Set();

    const sendToRenderer = (channel, payload) => {
        if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
            return;
        }
        mainWindow.webContents.send(channel, payload);
    };

    engine.receive.setRecording(recordingHandler);

    const invokeHandlers = new Map();
    for (const [channel, spec] of Object.entries(INVOKE)) {
        const handler = async (event, payload) => {
            try {
                const args = spec.args ? spec.args(payload) : (payload || {});
                const result = spec.kind === 'query'
                    ? await client.query(spec.name, args)
                    : await client.command(spec.name, args);
                return spec.result ? spec.result(result) : result;
            } catch (error) {
                return failure(error);
            }
        };
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, handler);
        invokeHandlers.set(channel, handler);
    }

    const sendHandlers = new Map();
    for (const [channel, spec] of Object.entries(SEND)) {
        const handler = (event, payload) => {
            const args = spec.args ? spec.args(payload) : (payload || {});
            const done = client.command(spec.name, args).catch((error) => {
                console.error(`${channel} failed:`, error.message);
            });
            if (channel === 'set-protocol') {
                done.then(() => boundListeners.forEach((fn) => fn()));
            }
        };
        ipcMain.on(channel, handler);
        sendHandlers.set(channel, handler);
    }

    const subscriptions = [];
    for (const [name, spec] of Object.entries(EVENTS)) {
        subscriptions.push(client.subscribe(name, (payload) => {
            sendToRenderer(spec.channel, spec.payload ? spec.payload(payload) : payload);
        }));
    }

    // The monitor rail and grid are subscribed only while a tab shows them
    // and no take is running, exactly as the main process throttled them.
    let snapshotSub = null;
    let gridSub = null;
    const quietRecord = () => Boolean(
        getUiView().recording || (recordingHandler && recordingHandler.isRecording && recordingHandler.isRecording())
    );
    const syncSubscriptions = () => {
        const ui = getUiView();
        const quiet = quietRecord();
        const wantSnapshot = !quiet && (ui.view === 'monitor' || ui.view === 'studio');
        const wantGrid = !quiet && ui.view === 'monitor';
        if (wantSnapshot && !snapshotSub) {
            snapshotSub = client.subscribe('monitor.snapshot', (payload) => sendToRenderer('universes-snapshot', payload));
        } else if (!wantSnapshot && snapshotSub) {
            client.unsubscribe(snapshotSub);
            snapshotSub = null;
        }
        if (wantGrid && !gridSub) {
            gridSub = client.subscribe('monitor.grid', ({ header, bytes }) => {
                sendToRenderer('dmx-data-update', {
                    protocol: header.protocol,
                    universe: header.universe,
                    sourceIp: header.sourceIp,
                    sourceName: header.sourceName,
                    data: decodeGridFrame(bytes)
                });
            }, { stream: true });
        } else if (!wantGrid && gridSub) {
            client.unsubscribe(gridSub);
            gridSub = null;
        }
        engine.receive.syncEmit();
    };
    const stopUiWatch = onUiViewChange(syncSubscriptions);
    syncSubscriptions();

    const close = () => {
        stopUiWatch();
        if (snapshotSub) {
            client.unsubscribe(snapshotSub);
        }
        if (gridSub) {
            client.unsubscribe(gridSub);
        }
        subscriptions.forEach((id) => client.unsubscribe(id));
        for (const [channel] of invokeHandlers) {
            ipcMain.removeHandler(channel);
        }
        for (const [channel, handler] of sendHandlers) {
            ipcMain.removeListener(channel, handler);
        }
        boundListeners.clear();
        client.close();
        engine.receive.setRecording(null);
    };

    return {
        engine,
        client,
        // fn runs after a set-protocol rebind completes (devices restart polling).
        onReceiversBound: (fn) => {
            boundListeners.add(fn);
            return () => boundListeners.delete(fn);
        },
        syncSubscriptions,
        close
    };
}

const shutdownEngine = () => {
    if (engineInstance) {
        engineInstance.close();
        engineInstance = null;
    }
};

module.exports = { createEngineHost, getEngine, shutdownEngine };
