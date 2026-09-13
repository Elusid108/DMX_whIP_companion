const { ipcMain } = require('electron');
const ArtNetReceiver = require('../../services/artnet/receiver');
const SacnReceiver = require('../../services/sacn/receiver');
const { getNetworkInterfaces } = require('../../services/shared/networkUtils');
const UniverseMonitor = require('../monitor/universeMonitor');

let artnetReceiver = null;
let sacnReceiver = null;
let selectedUniverses = new Set();
let setupGeneration = 0;

function setupNetworkHandlers(mainWindow, recordingHandler) {
    const monitor = new UniverseMonitor();

    const sendToRenderer = (channel, payload) => {
        if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
            return;
        }
        mainWindow.webContents.send(channel, payload);
    };

    monitor.start(
        (snapshot) => sendToRenderer('universes-snapshot', snapshot),
        (grid) => sendToRenderer('dmx-data-update', grid)
    );

    const setupReceivers = async (interfaceIp) => {
        const generation = ++setupGeneration;

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
        } catch (error) {
            nextArtnet.stop();
            nextSacn.stop();
            console.error('Error setting up receivers:', error);
        }
    };

    ipcMain.handle('get-network-interfaces', () => {
        return getNetworkInterfaces();
    });

    ipcMain.on('set-protocol', async (event, { interfaceIp }) => {
        await setupReceivers(interfaceIp);
    });

    ipcMain.on('select-monitor-universe', (event, { protocol, universe } = {}) => {
        monitor.setSelected(protocol, universe);
    });

    ipcMain.on('update-selected-universes', (event, universes) => {
        selectedUniverses = new Set(universes);
    });

    return () => {
        setupGeneration += 1;
        monitor.stop();
        if (artnetReceiver) artnetReceiver.stop();
        if (sacnReceiver) sacnReceiver.stop();
    };
}

module.exports = setupNetworkHandlers;
