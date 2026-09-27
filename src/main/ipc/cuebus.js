const { ipcMain } = require('electron');
const CueBus = require('../../services/cuebus/cueBus');
const { hashGroup } = require('../../services/cuebus/protocol');
const { fetchStatus } = require('../deviceHttp');
const { getUiView, onUiViewChange } = require('../uiView');

// Show sync on the Devices tab: the companion's place on the cue bus v3, the
// roster and running group cues, and the groups that can be launched (read
// from each node's /status play.groups).

const PUSH_MS = 1000;
const CATALOG_MS = 10000;

function setupCueBusHandlers(mainWindow) {
    let pushTimer = null;
    let catalogTimer = null;
    let catalog = new Map();
    let shownetByIp = {};
    let streams = [];
    let catalogBusy = false;

    const sendToRenderer = (channel, payload) => {
        if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
            return;
        }
        mainWindow.webContents.send(channel, payload);
    };

    const visible = () => getUiView().view === 'devices';

    const state = () => ({
        ...bus.snapshot(),
        groups: [...catalog.values()].sort((a, b) => a.title.localeCompare(b.title)),
        shownet: shownetByIp,
        streams
    });

    const push = () => {
        if (visible()) {
            sendToRenderer('cuebus-update', state());
        }
    };

    const bus = new CueBus({ onChange: push });

    // group hash -> { hash, group, title, nodes: [{ name, ip, path }] }
    const refreshCatalog = async () => {
        if (catalogBusy) {
            return;
        }
        catalogBusy = true;
        try {
            const next = new Map();
            const nextShownet = {};
            const nextStreams = [];
            const peers = bus.snapshot().peers.filter((peer) => peer.role !== 2);
            await Promise.all(peers.map(async (peer) => {
                const result = await fetchStatus(peer.ip);
                const status = result && result.success ? result.status : null;
                if (status && status.shownet) {
                    nextShownet[peer.ip] = status.shownet;
                }
                if (status && status.stream && status.stream.on) {
                    nextStreams.push({
                        ip: peer.ip,
                        name: peer.name,
                        path: status.stream.path,
                        peers: status.stream.peers
                    });
                }
                const play = status && status.play;
                if (!play || !Array.isArray(play.groups)) {
                    return;
                }
                play.groups.forEach((group, i) => {
                    if (!group) {
                        return;
                    }
                    const hash = hashGroup(group);
                    const path = (play.files || [])[i] || '';
                    const title = (play.titles || [])[i] || path.split('/').pop().replace(/\.dmx$/i, '');
                    const entry = next.get(hash) || { hash, group, title, nodes: [] };
                    if (!entry.title && title) {
                        entry.title = title;
                    }
                    entry.nodes.push({ name: peer.name, ip: peer.ip, path });
                    next.set(hash, entry);
                });
            }));
            catalog = next;
            shownetByIp = nextShownet;
            streams = nextStreams;
            push();
        } finally {
            catalogBusy = false;
        }
    };

    const syncTimers = () => {
        if (visible()) {
            if (!pushTimer) {
                pushTimer = setInterval(push, PUSH_MS);
                push();
            }
            if (!catalogTimer) {
                catalogTimer = setInterval(refreshCatalog, CATALOG_MS);
                refreshCatalog();
            }
        } else {
            clearInterval(pushTimer);
            clearInterval(catalogTimer);
            pushTimer = null;
            catalogTimer = null;
        }
    };

    const onSetProtocol = async (event, payload = {}) => {
        try {
            await bus.start((payload && payload.interfaceIp) || '0.0.0.0');
        } catch (err) {
            console.error('Cue bus start failed:', err.message);
        }
    };
    ipcMain.on('set-protocol', onSetProtocol);
    const stopUiView = onUiViewChange(syncTimers);

    const withGroup = (payload, run) => {
        const hash = Number(payload && payload.hash) >>> 0;
        if (!hash) {
            return { success: false, error: 'No group' };
        }
        return { success: Boolean(run(hash)) };
    };

    ipcMain.handle('cuebus-state', () => state());
    ipcMain.handle('cuebus-refresh', async () => {
        await refreshCatalog();
        return state();
    });
    ipcMain.handle('cuebus-launch', (event, payload = {}) => withGroup(payload, (hash) => {
        bus.launch(hash, {
            loop: Boolean(payload.loop),
            startPos: Math.max(0, Number(payload.startPos) || 0)
        });
        return true;
    }));
    ipcMain.handle('cuebus-pause', (event, payload = {}) => withGroup(payload, (hash) => bus.pause(hash)));
    ipcMain.handle('cuebus-resume', (event, payload = {}) => withGroup(payload, (hash) => bus.resume(hash)));
    ipcMain.handle('cuebus-stop', (event, payload = {}) => withGroup(payload, (hash) => bus.stop(hash)));
    ipcMain.handle('cuebus-seek', (event, payload = {}) => withGroup(payload, (hash) => bus.seek(hash, Number(payload.posMs) || 0)));

    return () => {
        clearInterval(pushTimer);
        clearInterval(catalogTimer);
        bus.stop();
        ipcMain.removeListener('set-protocol', onSetProtocol);
        ['cuebus-state', 'cuebus-refresh', 'cuebus-launch', 'cuebus-pause', 'cuebus-resume', 'cuebus-stop', 'cuebus-seek']
            .forEach((channel) => ipcMain.removeHandler(channel));
        if (stopUiView) {
            stopUiView();
        }
    };
}

module.exports = setupCueBusHandlers;
