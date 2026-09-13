const { ipcMain } = require('electron');
const ArtNetReceiver = require('../../services/artnet/receiver');
const SacnReceiver = require('../../services/sacn/receiver');
const SacnSender = require('../../services/sacn/sender');
const { getNetworkInterfaces } = require('../../services/shared/networkUtils');

let artnetReceiver = null;
let sacnReceiver = null;
let testSacnSender = null;
let testSendInterval = null;
let selectedUniverses = new Set();

function setupNetworkHandlers(mainWindow) {
    const setupReceivers = async (interfaceIp) => {
        // Clean up existing receivers
        if (artnetReceiver) artnetReceiver.stop();
        if (sacnReceiver) sacnReceiver.stop();

        // Initialize new receivers
        artnetReceiver = new ArtNetReceiver();
        sacnReceiver = new SacnReceiver();

        try {
            await artnetReceiver.start(interfaceIp);
            await sacnReceiver.start(interfaceIp);

            // Set up callbacks
            artnetReceiver.onDmxData('main', (data) => {
                mainWindow.webContents.send('universe-updated', data);
                mainWindow.webContents.send('dmx-data-update', {
                    protocol: 'artnet',
                    universe: data.universe,
                    sourceIp: data.sourceIp,
                    data: data.dmxData
                });
            });

            sacnReceiver.onDmxData('main', (data) => {
                mainWindow.webContents.send('universe-updated', data);
                mainWindow.webContents.send('dmx-data-update', {
                    protocol: 'sacn',
                    universe: data.universe,
                    sourceIp: data.sourceIp,
                    sourceName: data.sourceName,
                    data: data.dmxData,
                    priority: data.priority
                });
            });
        } catch (error) {
            console.error('Error setting up receivers:', error);
        }
    };

    const startTestSacn = async (interfaceIp) => {
        const TOTAL_PIXELS = 256;
        const PIXELS_PER_UNIVERSE = 170;
        const INTENSITY = 13;
        const REFRESH_RATE = 40;
        const UNIVERSES_NEEDED = Math.ceil(TOTAL_PIXELS / PIXELS_PER_UNIVERSE);

        try {
            if (testSacnSender) {
                clearInterval(testSendInterval);
                for (const [universe, sender] of testSacnSender) {
                    await sender.close();
                }
                testSacnSender = null;
            }

            let senders = new Map();
            for (let universe = 1; universe <= UNIVERSES_NEEDED; universe++) {
                const sender = new SacnSender({
                    sourceName: 'Test sACN Sender',
                    priority: 100
                });
                await sender.start(interfaceIp);
                senders.set(universe, sender);
            }

            testSacnSender = senders;

            testSendInterval = setInterval(() => {
                try {
                    for (let [universe, sender] of senders) {
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

                        sender.send(universe, channelData);
                    }
                } catch (error) {
                    console.error('Error sending test sACN data:', error);
                }
            }, Math.floor(1000 / REFRESH_RATE));

        } catch (error) {
            console.error('Error initializing test sACN:', error);
            if (testSacnSender) {
                clearInterval(testSendInterval);
                testSacnSender = null;
            }
        }
    };

    const stopTestSacn = async () => {
        if (testSendInterval) {
            clearInterval(testSendInterval);
            testSendInterval = null;
        }

        if (testSacnSender) {
            try {
                const zeroData = new Uint8Array(512).fill(0);
                for (const [universe, sender] of testSacnSender) {
                    for (let i = 0; i < 3; i++) {
                        await sender.send(universe, zeroData, { priority: 0 });
                    }
                    await sender.stop();
                }
            } catch (error) {
                console.error('Error closing test sACN sender:', error);
            }
            testSacnSender = null;
        }

        mainWindow.webContents.send('test-sacn-stopped');
    };

    // IPC Handlers
    ipcMain.handle('get-network-interfaces', () => {
        return getNetworkInterfaces();
    });

    ipcMain.on('set-protocol', async (event, { interfaceIp }) => {
        await setupReceivers(interfaceIp);
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

    ipcMain.on('set-protocol', async (event, { interfaceIp }) => {
        mainWindow.webContents.send('network-interface-changed', { interfaceIp });
        await setupReceivers(interfaceIp);
    });

    // Clean up function
    return () => {
        if (artnetReceiver) artnetReceiver.stop();
        if (sacnReceiver) sacnReceiver.stop();
        if (testSacnSender) {
            clearInterval(testSendInterval);
            for (const [_, sender] of testSacnSender) {
                sender.stop();
            }
        }
    };
}

module.exports = setupNetworkHandlers;