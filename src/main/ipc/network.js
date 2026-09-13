const { ipcMain, shell } = require('electron');
const ArtNetReceiver = require('../../services/artnet/receiver');
const SacnReceiver = require('../../services/sacn/receiver');
const { getNetworkInterfaces } = require('../../services/shared/networkUtils');
const UniverseMonitor = require('../monitor/universeMonitor');
const { assertInLibrary, sanitizeBaseName, uniqueDmxPath, writeSidecar, ensureLibrary } = require('./library');
const {
    downloadFile,
    fetchStatus,
    isIpv4,
    postForm,
    postIdentify,
    postUpload,
    scanWifi
} = require('../deviceHttp');

const ORDER_PREFIX = /^(\d{2})_/;

const sdBaseName = (sdPath) => String(sdPath || '').split('/').pop() || '';

const sdDisplayName = (sdPath) => sdBaseName(sdPath).replace(/\.dmx$/i, '').replace(ORDER_PREFIX, '');

let artnetReceiver = null;
let sacnReceiver = null;
let selectedUniverses = new Set();
let setupGeneration = 0;

const POLL_MS = 2500;
const STALE_MS = 9000;
const DROP_MS = 20000;

function nicInfo(interfaceIp) {
    const list = getNetworkInterfaces();
    const match = list.find((nic) => nic.ip === interfaceIp);
    return match || { name: 'Unknown', ip: interfaceIp || '0.0.0.0' };
}

function deviceId(reply) {
    if (reply.mac && reply.mac !== '00:00:00:00:00:00') {
        return reply.mac;
    }
    return reply.ip || reply.sourceIp;
}

const WHIP_OEM = 0x00FF;
const WHIP_REPORT = /^#0001 \[[0-9a-f]{4}\] .+ v\d+\.\d+\.\d+/i;

function isWhipPollReply(reply) {
    return !whipRejectReason(reply);
}

function whipRejectReason(reply) {
    if (!reply) {
        return 'no-reply';
    }
    if (reply.oem !== WHIP_OEM) {
        return `oem:${reply.oem}`;
    }
    if (reply.bindIndex !== 1) {
        return `bind:${reply.bindIndex}`;
    }
    if (reply.portType !== 0x80) {
        return `port:${reply.portType}`;
    }
    if (reply.style !== 0) {
        return `style:${reply.style}`;
    }
    if (!WHIP_REPORT.test(String(reply.nodeReport || ''))) {
        return `report:${reply.nodeReport || ''}`;
    }
    return '';
}

function setupNetworkHandlers(mainWindow, recordingHandler) {
    const monitor = new UniverseMonitor();
    const devices = new Map();
    let pollTimer = null;
    let selectedNic = nicInfo('0.0.0.0');

    const sendToRenderer = (channel, payload) => {
        if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
            return;
        }
        mainWindow.webContents.send(channel, payload);
    };

    const snapshotDevices = () => {
        const now = Date.now();
        const rows = [];
        for (const [id, node] of devices) {
            const age = now - node.lastSeen;
            if (age > DROP_MS) {
                devices.delete(id);
                continue;
            }
            rows.push({
                ...node,
                stale: age > STALE_MS
            });
        }
        rows.sort((a, b) => {
            if (a.stale !== b.stale) {
                return a.stale ? 1 : -1;
            }
            return (a.longName || a.ip).localeCompare(b.longName || b.ip);
        });
        return {
            nic: selectedNic,
            devices: rows
        };
    };

    const emitDevices = () => {
        sendToRenderer('devices-update', snapshotDevices());
    };

    const clearDevices = () => {
        devices.clear();
        emitDevices();
    };

    const ingestPollReply = (reply) => {
        const id = deviceId(reply);
        if (!id) {
            return;
        }
        if (!isWhipPollReply(reply)) {
            return;
        }
        devices.set(id, {
            id,
            ip: reply.ip,
            sourceIp: reply.sourceIp,
            mac: reply.mac,
            shortName: reply.shortName,
            longName: reply.longName,
            universe: reply.universe,
            universes: reply.universes,
            bindIndex: reply.bindIndex,
            nicName: selectedNic.name,
            nicIp: selectedNic.ip,
            lastSeen: Date.now(),
            stale: false
        });
        emitDevices();
    };

    const stopPoll = () => {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    };

    const startPoll = () => {
        stopPoll();
        const tick = () => {
            if (artnetReceiver && artnetReceiver.sendPoll) {
                artnetReceiver.sendPoll();
            }
            emitDevices();
        };
        tick();
        pollTimer = setInterval(tick, POLL_MS);
    };

    monitor.start(
        (snapshot) => sendToRenderer('universes-snapshot', snapshot),
        (grid) => sendToRenderer('dmx-data-update', grid)
    );

    const setupReceivers = async (interfaceIp) => {
        const generation = ++setupGeneration;
        selectedNic = nicInfo(interfaceIp);
        stopPoll();
        clearDevices();

        if (artnetReceiver) {
            artnetReceiver.stop();
            artnetReceiver = null;
        }
        if (sacnReceiver) {
            sacnReceiver.stop();
            sacnReceiver = null;
        }

        monitor.clear();
        sendToRenderer('clear-universes');

        const nextArtnet = new ArtNetReceiver();
        const nextSacn = new SacnReceiver();

        try {
            await nextArtnet.start(interfaceIp);
            if (generation !== setupGeneration) {
                nextArtnet.stop();
                return;
            }

            await nextSacn.start(interfaceIp);
            if (generation !== setupGeneration) {
                nextArtnet.stop();
                nextSacn.stop();
                return;
            }

            artnetReceiver = nextArtnet;
            sacnReceiver = nextSacn;

            const maybeRecord = (protocol, universe, dmxData) => {
                if (!recordingHandler || !recordingHandler.isRecording()) {
                    return;
                }
                if (!selectedUniverses.has(`${protocol}-${universe}`)) {
                    return;
                }
                recordingHandler.addFrame({
                    protocol,
                    universe,
                    data: dmxData
                });
            };

            artnetReceiver.onDmxData('main', (data) => {
                monitor.ingest({
                    protocol: 'artnet',
                    universe: data.universe,
                    sourceIp: data.sourceIp,
                    dmxData: data.dmxData
                });
                maybeRecord('artnet', data.universe, data.dmxData);
            });

            artnetReceiver.onPollReply('main', ingestPollReply);

            sacnReceiver.onDmxData('main', (data) => {
                monitor.ingest({
                    protocol: 'sacn',
                    universe: data.universe,
                    sourceIp: data.sourceIp,
                    sourceName: data.sourceName,
                    dmxData: data.dmxData
                });
                maybeRecord('sacn', data.universe, data.dmxData);
            });

            startPoll();
        } catch (error) {
            nextArtnet.stop();
            nextSacn.stop();
            console.error('Error setting up receivers:', error);
        }
    };

    ipcMain.handle('get-network-interfaces', () => {
        return getNetworkInterfaces();
    });

    ipcMain.handle('device-status', async (event, { ip } = {}) => {
        return fetchStatus(ip);
    });

    ipcMain.handle('device-identify', async (event, { ip, ms } = {}) => {
        return postIdentify(ip, ms);
    });

    ipcMain.handle('device-list', () => snapshotDevices());

    ipcMain.handle('device-push-show', async (event, { ip, filePath } = {}) => {
        try {
            assertInLibrary(filePath);
            return await postUpload(ip, filePath);
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('device-play', async (event, {
        ip,
        src = 'file',
        path: sdPath,
        file_loop,
        folder_rep,
        n
    } = {}) => {
        const playSrc = String(src || 'file');
        if (playSrc === 'stop') {
            return postForm(ip, '/play', { src: 'stop' });
        }
        const fields = { src: playSrc };
        if (playSrc === 'root') {
            fields.path = '/';
        } else if (playSrc === 'folder') {
            if (!sdPath || !String(sdPath).startsWith('/')) {
                return { success: false, error: 'Select a folder on the node SD' };
            }
            fields.path = sdPath;
        } else if (playSrc === 'file') {
            if (!sdPath || !String(sdPath).startsWith('/') || !/\.dmx$/i.test(sdPath)) {
                return { success: false, error: 'Select a .dmx on the node SD' };
            }
            fields.path = sdPath;
        } else {
            return { success: false, error: 'Bad play source' };
        }
        if (file_loop) {
            fields.file_loop = file_loop;
        }
        if (folder_rep) {
            fields.folder_rep = folder_rep;
        }
        if (n != null && n !== '') {
            fields.n = n;
        }
        return postForm(ip, '/play', fields);
    });

    ipcMain.handle('device-stop', async (event, { ip } = {}) => {
        return postForm(ip, '/play', { src: 'stop' });
    });

    ipcMain.handle('device-set-brightness', async (event, { ip, v } = {}) => {
        return postForm(ip, '/brightness', { v });
    });

    ipcMain.handle('device-set-live', async (event, { ip, proto, fps, buf, park } = {}) => {
        return postForm(ip, '/live', { proto, fps, buf, park });
    });

    ipcMain.handle('device-wifi-scan', async (event, { ip } = {}) => {
        return scanWifi(ip);
    });

    ipcMain.handle('device-wifi-connect', async (event, { ip, ssid, password } = {}) => {
        return postForm(ip, '/connect', { ssid, password: password || '' }, 8000);
    });

    ipcMain.handle('device-wifi-forget', async (event, { ip } = {}) => {
        return postForm(ip, '/forget', {});
    });

    ipcMain.handle('device-set-name', async (event, { ip, name, short } = {}) => {
        const longName = String(name || '').trim();
        if (!longName) {
            return { success: false, error: 'Enter a device name' };
        }
        return postForm(ip, '/name', { long: longName, short: short || '' });
    });

    ipcMain.handle('device-rename-show', async (event, { ip, from, name } = {}) => {
        try {
            if (!from || !String(from).startsWith('/') || !/\.dmx$/i.test(from)) {
                return { success: false, error: 'Select a .dmx on the node SD' };
            }
            const base = sdBaseName(from);
            const prefix = ORDER_PREFIX.test(base) ? base.slice(0, 3) : '';
            const cleaned = sanitizeBaseName(name);
            const to = `/${prefix}${cleaned}.dmx`;
            if (to.length > 63) {
                return { success: false, error: 'Name is too long for the node SD' };
            }
            return await postForm(ip, '/rename', { from, to });
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('device-open-portal', async (event, { ip } = {}) => {
        if (!isIpv4(ip)) {
            return { success: false, error: 'Invalid device IP' };
        }
        try {
            await shell.openExternal(`http://${String(ip).trim()}/`);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('device-pull-show', async (event, { ip, path: sdPath } = {}) => {
        try {
            const display = sdDisplayName(sdPath) || 'show';
            const dest = uniqueDmxPath(ensureLibrary(), sanitizeBaseName(display));
            const result = await downloadFile(ip, sdPath, dest);
            if (!result || !result.success) {
                return result || { success: false, error: 'Pull failed' };
            }
            writeSidecar(dest, { name: display, notes: '' });
            return { success: true, filePath: dest, via: result.via };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.on('set-protocol', async (event, { interfaceIp }) => {
        await setupReceivers(interfaceIp);
    });

    const handleScan = () => {
        if (artnetReceiver && artnetReceiver.sendPoll) {
            artnetReceiver.sendPoll();
        }
        emitDevices();
    };

    ipcMain.on('devices-scan', handleScan);

    ipcMain.on('select-monitor-universe', (event, { protocol, universe } = {}) => {
        monitor.setSelected(protocol, universe);
    });

    ipcMain.on('update-selected-universes', (event, universes) => {
        selectedUniverses = new Set(universes);
    });

    return () => {
        setupGeneration += 1;
        stopPoll();
        devices.clear();
        monitor.stop();
        if (artnetReceiver) artnetReceiver.stop();
        if (sacnReceiver) sacnReceiver.stop();
        ipcMain.removeHandler('get-network-interfaces');
        ipcMain.removeHandler('device-status');
        ipcMain.removeHandler('device-identify');
        ipcMain.removeHandler('device-list');
        ipcMain.removeHandler('device-push-show');
        ipcMain.removeHandler('device-play');
        ipcMain.removeHandler('device-stop');
        ipcMain.removeHandler('device-set-brightness');
        ipcMain.removeHandler('device-set-live');
        ipcMain.removeHandler('device-wifi-scan');
        ipcMain.removeHandler('device-wifi-connect');
        ipcMain.removeHandler('device-wifi-forget');
        ipcMain.removeHandler('device-set-name');
        ipcMain.removeHandler('device-rename-show');
        ipcMain.removeHandler('device-open-portal');
        ipcMain.removeHandler('device-pull-show');
        ipcMain.removeListener('devices-scan', handleScan);
    };
}

module.exports = setupNetworkHandlers;
