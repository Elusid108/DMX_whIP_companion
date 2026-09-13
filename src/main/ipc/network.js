const { ipcMain } = require('electron');
const ArtNetReceiver = require('../../services/artnet/receiver');
const SacnReceiver = require('../../services/sacn/receiver');
const { SacnOutput } = require('../../services/sacn/output');
const { getNetworkInterfaces } = require('../../services/shared/networkUtils');
const UniverseMonitor = require('../monitor/universeMonitor');

let artnetReceiver = null;
let sacnReceiver = null;
let testSacnOutput = null;
let testSendInterval = null;
let testDiscoveryInterval = null;
let testSacnUniverses = [];
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

    const clearTestSacnTimers = () => {
        if (testSendInterval) {
            clearInterval(testSendInterval);
            testSendInterval = null;
        }
        if (testDiscoveryInterval) {
            clearInterval(testDiscoveryInterval);
            testDiscoveryInterval = null;
        }
    };

    const startTestSacn = async (interfaceIp) => {
        const TOTAL_PIXELS = 256;
        const PIXELS_PER_UNIVERSE = 170;
        const INTENSITY = 13;
        const REFRESH_RATE = 40;
        const UNIVERSES_NEEDED = Math.ceil(TOTAL_PIXELS / PIXELS_PER_UNIVERSE);

        try {
            clearTestSacnTimers();
            if (testSacnOutput) {
                testSacnOutput.close();
                testSacnOutput = null;
            }

            const output = new SacnOutput({
                sourceName: 'Test sACN Sender',
                iface: interfaceIp,
                priority: 100
            });
            await output.start();

            testSacnOutput = output;
            testSacnUniverses = [];
            for (let universe = 1; universe <= UNIVERSES_NEEDED; universe++) {
                testSacnUniverses.push(universe);
                output.ensureSender(universe);
            }
            await output.ready();

            const sendDiscovery = () => {
                if (!testSacnOutput) {
                    return;
                }
                testSacnOutput.sendDiscovery(testSacnUniverses).catch((error) => {
                    console.error('Error sending sACN universe discovery:', error);
                });
            };

            sendDiscovery();
            testDiscoveryInterval = setInterval(sendDiscovery, 10000);

            testSendInterval = setInterval(() => {
                try {
                    if (!testSacnOutput) {
                        return;
                    }
                    for (const universe of testSacnUniverses) {
                        const channelData = new Uint8Array(512).fill(0);
                        const startPixel = (universe - 1) * PIXELS_PER_UNIVERSE;
                        const pixelsInThisUniverse = Math.min(
                            PIXELS_PER_UNIVERSE,
                            TOTAL_PIXELS - startPixel
                        );

                        for (let pixel = 0; pixel < pixelsInThisUniverse; pixel++) {
                            const baseChannel = (pixel * 3) + 1;
                            channelData[baseChannel] = INTENSITY;
                            channelData[baseChannel + 1] = INTENSITY;
                            channelData[baseChannel + 2] = INTENSITY;
                        }

                        testSacnOutput.send(universe, channelData);
                    }
                } catch (error) {
                    console.error('Error sending test sACN data:', error);
                }
            }, Math.floor(1000 / REFRESH_RATE));
        } catch (error) {
            console.error('Error initializing test sACN:', error);
            clearTestSacnTimers();
            if (testSacnOutput) {
                testSacnOutput.close();
                testSacnOutput = null;
            }
        }
    };

    const stopTestSacn = async () => {
        clearTestSacnTimers();

        if (testSacnOutput) {
            try {
                const zeroData = new Uint8Array(512).fill(0);
                for (const universe of testSacnUniverses) {
                    testSacnOutput.send(universe, zeroData, { priority: 0 });
                }
                await testSacnOutput.sendDiscovery([]);
            } catch (error) {
                console.error('Error closing test sACN sender:', error);
            }
            testSacnOutput.close();
            testSacnOutput = null;
            testSacnUniverses = [];
        }

        sendToRenderer('test-sacn-stopped');
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

    ipcMain.on('start-test-sacn', (event, { interfaceIp }) => {
        startTestSacn(interfaceIp);
    });

    ipcMain.on('stop-test-sacn', () => {
        stopTestSacn();
    });

    return () => {
        setupGeneration += 1;
        monitor.stop();
        if (artnetReceiver) artnetReceiver.stop();
        if (sacnReceiver) sacnReceiver.stop();
        clearTestSacnTimers();
        if (testSacnOutput) {
            testSacnOutput.close();
            testSacnOutput = null;
        }
    };
}

module.exports = setupNetworkHandlers;
