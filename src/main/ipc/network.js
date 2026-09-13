const { ipcMain } = require('electron');
const ArtNetReceiver = require('../../services/artnet/receiver');
const SacnReceiver = require('../../services/sacn/receiver');
const { getNetworkInterfaces } = require('../../services/shared/networkUtils');
const UniverseMonitor = require('../monitor/universeMonitor');
const { fetchStatus, postIdentify } = require('../deviceHttp');

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

    const emitDevices = () => {
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
        sendToRenderer('devices-update', {
            nic: selectedNic,
            devices: rows
        });
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
        ipcMain.removeListener('devices-scan', handleScan);
    };
}

module.exports = setupNetworkHandlers;
