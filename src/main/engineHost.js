// The companion's engine host: creates the engine, and turns each renderer
// IPC channel into an engine command or query and each engine event back
// into the renderer channel it always used, with the same payload shape.
// Nothing in the renderer or preload changes.
const { app, ipcMain } = require('electron');
const { createEngine } = require('../engine');
const { createNodePorts } = require('../adapters/node');
const { decodeGridFrame } = require('../engine/core/receive');
const { getStore } = require('./settings');
const { getUiView, onUiViewChange } = require('./uiView');
const { INVOKE, SEND, EVENTS } = require('./engineChannels');

let engineInstance = null;

// One engine per process, created on first use so settings paths exist.
const getEngine = () => {
    if (!engineInstance) {
        engineInstance = createEngine({
            settings: getStore(),
            appVersion: app.getVersion(),
            // The companion shares one file worker between the engine and its
            // own library and push code, and adds what Electron brings.
            ports: createNodePorts({ kind: 'companion', sharedWorkers: true }),
            hostIo: { dialogs: true, ffmpeg: true, serial: true, cuebus: true }
        });
    }
    return engineInstance;
};

const failure = (error) => ({ success: false, error: error && error.message ? error.message : String(error) });

function createEngineHost(mainWindow) {
    const engine = getEngine();
    const client = engine.client({ client: 'companion' });
    const recordingHandler = engine.recording;
    const boundListeners = new Set();

    const sendToRenderer = (channel, payload) => {
        if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
            return;
        }
        mainWindow.webContents.send(channel, payload);
    };

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

    // Recording and punch-in progress reach the renderer only while Studio
    // is shown (forced recording stats always), as before.
    let studioSub = null;
    let statsSub = client.subscribe('record.stats', ({ forced, ...stats }) => {
        if (forced || getUiView().view === 'studio') {
            sendToRenderer('recording-stats-update', stats);
        }
    });

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
        const wantStudio = ui.view === 'studio';
        if (wantStudio && !studioSub) {
            studioSub = client.subscribe('punchIn.progress', (payload) => sendToRenderer('punch-in-progress', payload));
        } else if (!wantStudio && studioSub) {
            client.unsubscribe(studioSub);
            studioSub = null;
        }
        engine.receive.syncEmit();
    };
    const stopUiWatch = onUiViewChange(syncSubscriptions);
    const stopRecordWatch = recordingHandler.onStateChange(() => {
        syncSubscriptions();
        recordListeners.forEach((fn) => fn());
    });
    const recordListeners = new Set();
    syncSubscriptions();

    const close = () => {
        stopUiWatch();
        stopRecordWatch();
        if (statsSub) {
            client.unsubscribe(statsSub);
            statsSub = null;
        }
        if (studioSub) {
            client.unsubscribe(studioSub);
        }
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
    };

    return {
        engine,
        client,
        // Synchronous view of the take for file watching and library guards.
        recording: recordingHandler,
        // fn runs after a set-protocol rebind completes (devices restart polling).
        onReceiversBound: (fn) => {
            boundListeners.add(fn);
            return () => boundListeners.delete(fn);
        },
        // fn runs when the engine starts or stops a take.
        onRecordingChange: (fn) => {
            recordListeners.add(fn);
            return () => recordListeners.delete(fn);
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
