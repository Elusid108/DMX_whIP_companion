const { ipcMain, app } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { SerialPort } = require('serialport');
const { postForm, SOFTAP_IP } = require('./deviceHttp');
const { loadSettings, saveSettings } = require('./settings');
const NodeSerialDevice = require('./nodeSerialDevice');

const DOWNLOAD_HINT = 'Hold BOOT, tap RESET, release BOOT, then try again. Close any serial monitor first.';

const repoRoot = () => {
    if (app && app.isPackaged) {
        return process.resourcesPath;
    }
    return path.join(__dirname, '../..');
};

const catalogPath = () => path.join(repoRoot(), 'firmware', 'catalog.json');

const loadCatalog = () => {
    const raw = JSON.parse(fs.readFileSync(catalogPath(), 'utf8'));
    if (!raw || !Array.isArray(raw.boards) || !raw.boards.length) {
        throw new Error('firmware/catalog.json has no boards');
    }
    return raw;
};

const boardById = (catalog, id) => {
    const wanted = id || (catalog.boards[0] && catalog.boards[0].id);
    return catalog.boards.find((board) => board.id === wanted) || catalog.boards[0];
};

const chipKey = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const isEsp32s3 = (name) => chipKey(name).startsWith('esp32s3');

const looksLikeDownloadFail = (err) => {
    const m = String((err && err.message) || err || '');
    return /timeout|Failed to connect|No serial data|Invalid head|download|Serial data stream/i.test(m);
};

const md5hex = (image) => crypto.createHash('md5').update(Buffer.from(image)).digest('hex');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const allBins = (dir) => {
    const files = {
        bootloader: path.join(dir, 'bootloader.bin'),
        partitions: path.join(dir, 'partitions.bin'),
        firmware: path.join(dir, 'firmware.bin')
    };
    return Object.values(files).every((file) => fs.existsSync(file)) ? files : null;
};

const resolveArtifacts = (board) => {
    const flashClass = board.artifact || board.flashClass;
    const bundled = allBins(path.join(repoRoot(), 'firmware', 'artifacts', flashClass));
    if (bundled) {
        return { files: bundled, source: `firmware/artifacts/${flashClass}` };
    }
    const env = board.pioEnv || 'matrix';
    const sibling = allBins(path.join(repoRoot(), '..', 'DMX_whIP_embedded', '.pio', 'build', env));
    if (sibling) {
        return { files: sibling, source: `DMX_whIP_embedded/.pio/build/${env}` };
    }
    throw new Error(
        `No firmware image for ${flashClass}. Build [env:${env}] in DMX_whIP_embedded or copy bootloader.bin, partitions.bin, and firmware.bin into firmware/artifacts/${flashClass}/.`
    );
};

const readBin = (filePath) => Uint8Array.from(fs.readFileSync(filePath));

const pinsDiffer = (pins, defaults) => {
    if (!pins || !defaults) {
        return false;
    }
    return Number(pins.cs) !== Number(defaults.cs)
        || Number(pins.mosi) !== Number(defaults.mosi)
        || Number(pins.clk) !== Number(defaults.clk)
        || Number(pins.miso) !== Number(defaults.miso);
};

const applyPinsSoftAp = async (pins, log) => {
    const fields = {
        cs: pins.cs,
        mosi: pins.mosi,
        clk: pins.clk,
        miso: pins.miso
    };
    log('Waiting for SoftAP http://4.3.2.1 to apply SD pins…');
    let lastError = 'SoftAP did not accept /pins';
    for (let i = 0; i < 15; i += 1) {
        await sleep(2000);
        const result = await postForm(SOFTAP_IP, '/pins', fields, 2500);
        if (result && result.success) {
            log('SD pins written over SoftAP.');
            return { success: true, status: result.status };
        }
        lastError = (result && result.error) || lastError;
    }
    return { success: false, error: `${lastError}. Join SSID dmxwhip and retry from Devices, or flash again.` };
};

let busy = false;

const withJob = async (work) => {
    if (busy) {
        throw new Error('USB flash is already running');
    }
    busy = true;
    try {
        return await work();
    } finally {
        busy = false;
    }
};

const loadEsptool = () => {
    try {
        return require('./generated/esptool.cjs');
    } catch (err) {
        throw new Error('esptool bundle missing — run npm start (or npm run build:esptool)');
    }
};

const runLoader = async (portPath, { baudrate, log, work }) => {
    const { ESPLoader, Transport } = await loadEsptool();
    const device = new NodeSerialDevice(portPath);
    const transport = new Transport(device, false);
    const loader = new ESPLoader({
        transport,
        baudrate: baudrate || 115200,
        romBaudrate: 115200,
        terminal: {
            clean() {},
            writeLine(data) {
                if (log) {
                    log(String(data || '').replace(/\s+$/g, ''));
                }
            },
            write(data) {
                if (log) {
                    const line = String(data || '').replace(/\s+$/g, '');
                    if (line) {
                        log(line);
                    }
                }
            }
        }
    });
    try {
        return await work({ loader, transport, device });
    } finally {
        try {
            await transport.disconnect();
        } catch (err) {
            try {
                await device.close();
            } catch (closeErr) {
                // port already released
            }
        }
    }
};

const listPorts = async () => {
    const ports = await SerialPort.list();
    return ports.map((port) => ({
        path: port.path,
        manufacturer: port.manufacturer || '',
        serialNumber: port.serialNumber || '',
        vendorId: port.vendorId || '',
        productId: port.productId || '',
        friendlyName: port.friendlyName || port.path
    }));
};

function setupFirmwareFlashHandlers(mainWindow) {
    const send = (channel, payload) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(channel, payload);
        }
    };

    const logToRenderer = (line) => {
        send('flash-log', { line: String(line || '') });
    };

    ipcMain.handle('flash-catalog', async () => {
        try {
            const catalog = loadCatalog();
            const settings = loadSettings();
            let artifacts = null;
            try {
                artifacts = resolveArtifacts(boardById(catalog, settings.flashBoardId));
            } catch (err) {
                artifacts = { error: err.message };
            }
            return { success: true, catalog, settings, artifacts };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('flash-ports', async () => {
        try {
            return { success: true, ports: await listPorts() };
        } catch (error) {
            return { success: false, error: error.message, ports: [] };
        }
    });

    ipcMain.handle('flash-set-settings', async (event, patch = {}) => {
        try {
            const settings = saveSettings(patch);
            return { success: true, settings };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('flash-identify', async (event, { port } = {}) => {
        const portPath = String(port || '').trim();
        if (!portPath) {
            return { success: false, error: 'Select a USB serial port' };
        }
        try {
            return await withJob(async () => {
                logToRenderer(`Identify ${portPath}`);
                const info = await runLoader(portPath, {
                    baudrate: 115200,
                    log: logToRenderer,
                    work: async ({ loader }) => {
                        const chip = await loader.main('default_reset');
                        let mac = '';
                        let flashSize = '';
                        try {
                            mac = await loader.chip.readMac(loader);
                        } catch (err) {
                            mac = '';
                        }
                        try {
                            flashSize = await loader.detectFlashSize();
                        } catch (err) {
                            flashSize = '';
                        }
                        if (!isEsp32s3(chip) && !isEsp32s3(loader.chip && loader.chip.CHIP_NAME)) {
                            throw new Error(`This flasher only supports ESP32-S3 (detected ${chip || 'unknown'})`);
                        }
                        return {
                            chip: chip || (loader.chip && loader.chip.CHIP_NAME) || 'ESP32-S3',
                            mac,
                            flashSize
                        };
                    }
                });
                saveSettings({ flashPort: portPath });
                return { success: true, ...info, port: portPath };
            });
        } catch (error) {
            const downloadMode = looksLikeDownloadFail(error);
            return {
                success: false,
                error: downloadMode ? `${error.message}. ${DOWNLOAD_HINT}` : error.message,
                downloadMode
            };
        }
    });

    ipcMain.handle('flash-run', async (event, {
        port,
        boardId,
        pins,
        eraseNvs
    } = {}) => {
        const portPath = String(port || '').trim();
        if (!portPath) {
            return { success: false, error: 'Select a USB serial port' };
        }
        try {
            return await withJob(async () => {
                const catalog = loadCatalog();
                const board = boardById(catalog, boardId);
                if (!board || board.chip !== 'esp32s3') {
                    throw new Error('Select the Waveshare ESP32-S3-Matrix board profile');
                }
                const artifacts = resolveArtifacts(board);
                const flash = board.flash || {};
                const sdPins = {
                    cs: Number(pins && pins.cs),
                    mosi: Number(pins && pins.mosi),
                    clk: Number(pins && pins.clk),
                    miso: Number(pins && pins.miso)
                };
                saveSettings({
                    flashPort: portPath,
                    flashBoardId: board.id,
                    flashSdPins: sdPins
                });
                logToRenderer(`Using image from ${artifacts.source}`);
                send('flash-progress', { percent: 0, label: 'Connecting' });

                const result = await runLoader(portPath, {
                    baudrate: 115200,
                    log: logToRenderer,
                    work: async ({ loader }) => {
                        const chip = await loader.main('default_reset');
                        if (!isEsp32s3(chip) && !isEsp32s3(loader.chip && loader.chip.CHIP_NAME)) {
                            throw new Error(`This flasher only supports ESP32-S3 (detected ${chip || 'unknown'})`);
                        }
                        const fileArray = [];
                        if (eraseNvs) {
                            const nvsSize = Number(flash.nvsSize) || 20480;
                            const nvsAddr = Number(flash.nvs) || 0x9000;
                            logToRenderer(`Erasing NVS at 0x${nvsAddr.toString(16)} (${nvsSize} bytes)`);
                            fileArray.push({
                                data: new Uint8Array(nvsSize).fill(0xff),
                                address: nvsAddr
                            });
                        }
                        fileArray.push(
                            { data: readBin(artifacts.files.bootloader), address: Number(flash.bootloader) || 0 },
                            { data: readBin(artifacts.files.partitions), address: Number(flash.partitions) || 0x8000 },
                            { data: readBin(artifacts.files.firmware), address: Number(flash.app) || 0x10000 }
                        );
                        const totals = fileArray.map((file) => file.data.length);
                        const grand = totals.reduce((sum, n) => sum + n, 0);
                        let writtenAll = 0;
                        await loader.writeFlash({
                            fileArray,
                            flashMode: flash.mode || 'dio',
                            flashFreq: flash.freq || '80m',
                            flashSize: flash.size || '4MB',
                            eraseAll: false,
                            compress: true,
                            calculateMD5Hash: md5hex,
                            reportProgress: (fileIndex, written, total) => {
                                const before = totals.slice(0, fileIndex).reduce((sum, n) => sum + n, 0);
                                writtenAll = before + written;
                                const percent = grand ? Math.min(100, Math.round((writtenAll / grand) * 100)) : 0;
                                send('flash-progress', {
                                    percent,
                                    label: `Writing ${fileIndex + 1}/${fileArray.length}`,
                                    written,
                                    total
                                });
                            }
                        });
                        send('flash-progress', { percent: 100, label: 'Resetting' });
                        await loader.after('hard_reset');
                        return { chip };
                    }
                });

                let pinsResult = { success: true, skipped: true };
                if (pinsDiffer(sdPins, board.defaults && board.defaults.sd)) {
                    pinsResult = await applyPinsSoftAp(sdPins, logToRenderer);
                }
                return {
                    success: true,
                    chip: result.chip,
                    artifacts: artifacts.source,
                    pinsApplied: Boolean(pinsResult.success && !pinsResult.skipped),
                    pinsError: pinsResult.success ? '' : pinsResult.error
                };
            });
        } catch (error) {
            const downloadMode = looksLikeDownloadFail(error);
            send('flash-progress', { percent: 0, label: 'Failed' });
            return {
                success: false,
                error: downloadMode ? `${error.message}. ${DOWNLOAD_HINT}` : error.message,
                downloadMode
            };
        }
    });

    return () => {
        ipcMain.removeHandler('flash-catalog');
        ipcMain.removeHandler('flash-ports');
        ipcMain.removeHandler('flash-set-settings');
        ipcMain.removeHandler('flash-identify');
        ipcMain.removeHandler('flash-run');
    };
}

module.exports = setupFirmwareFlashHandlers;
