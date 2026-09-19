const { ipcMain, app } = require('electron');
const crypto = require('crypto');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SerialPort } = require('serialport');
const { postForm, SOFTAP_IP } = require('./deviceHttp');
const { loadSettings, saveSettings } = require('./settings');
const NodeSerialDevice = require('./nodeSerialDevice');
const { buildNvsImage, shouldWriteNvs } = require('./nvsImage');
const { readWlan } = require('./wlanInfo');
const { clipName, resolveNodeName, normalizeNameOpts } = require('../services/shared/flashName');

const DOWNLOAD_HINT = 'Hold BOOT, tap RESET, release BOOT, then try again. Close any serial monitor first.';
const FLASH_CONCURRENCY = 4;

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

const siblingFirmwareRoot = () => {
    if (app && app.isPackaged) {
        throw new Error('Build firmware is only available when running from the companion source tree.');
    }
    const root = path.join(repoRoot(), '..', 'DMX_whIP_embedded');
    if (!fs.existsSync(path.join(root, 'platformio.ini'))) {
        throw new Error('DMX_whIP_embedded not found next to this repo (missing platformio.ini).');
    }
    return root;
};

const pioEnvName = (board) => {
    const raw = String((board && board.pioEnv) || 'matrix');
    const env = raw.replace(/[^a-zA-Z0-9_-]/g, '');
    return env || 'matrix';
};

const findOnPath = (names) => {
    const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
    const exts = process.platform === 'win32'
        ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean)
        : [''];
    for (const dir of dirs) {
        for (const name of names) {
            const base = path.join(dir, name);
            if (fs.existsSync(base)) {
                return base;
            }
            if (process.platform === 'win32' && !path.extname(name)) {
                for (const ext of exts) {
                    const full = base + ext;
                    if (fs.existsSync(full)) {
                        return full;
                    }
                }
            }
        }
    }
    return null;
};

const findPio = () => {
    const fromPath = findOnPath(['pio', 'platformio']);
    if (fromPath) {
        return fromPath;
    }
    const home = os.homedir();
    const extras = process.platform === 'win32'
        ? [
            path.join(home, '.platformio', 'penv', 'Scripts', 'pio.exe'),
            path.join(home, '.platformio', 'penv', 'Scripts', 'platformio.exe')
        ]
        : [
            path.join(home, '.platformio', 'penv', 'bin', 'pio'),
            path.join(home, '.platformio', 'penv', 'bin', 'platformio')
        ];
    const found = extras.find((file) => fs.existsSync(file));
    if (found) {
        return found;
    }
    throw new Error('PlatformIO CLI not found. Install PlatformIO Core or open a shell where pio works.');
};

const pipeLines = (stream, onLine) => {
    let rest = '';
    stream.on('data', (chunk) => {
        rest += String(chunk);
        const lines = rest.split(/\r?\n/);
        rest = lines.pop() || '';
        lines.forEach((line) => {
            const trimmed = line.replace(/\s+$/g, '');
            if (trimmed) {
                onLine(trimmed);
            }
        });
    });
    stream.on('end', () => {
        const trimmed = rest.replace(/\s+$/g, '');
        if (trimmed) {
            onLine(trimmed);
        }
    });
};

const runPioBuild = (pioPath, env, cwd, log) => {
    log(`${pioPath} run -e ${env}`);
    const child = spawn(pioPath, ['run', '-e', env], {
        cwd,
        windowsHide: true,
        shell: false,
        env: process.env
    });
    const done = new Promise((resolve, reject) => {
        pipeLines(child.stdout, log);
        pipeLines(child.stderr, log);
        child.on('error', reject);
        child.on('close', (code, signal) => {
            if (code === 0) {
                resolve();
                return;
            }
            if (signal) {
                reject(new Error(`pio run -e ${env} ended (${signal})`));
                return;
            }
            reject(new Error(`pio run -e ${env} exited ${code == null ? 'null' : code}`));
        });
    });
    return { child, done };
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

const portLocks = new Set();

const withPort = async (portPath, work) => {
    if (portLocks.has(portPath)) {
        throw new Error(`${portPath} is already busy`);
    }
    portLocks.add(portPath);
    try {
        return await work();
    } finally {
        portLocks.delete(portPath);
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

const failResult = (error) => {
    const downloadMode = looksLikeDownloadFail(error);
    return {
        success: false,
        error: downloadMode ? `${error.message}. ${DOWNLOAD_HINT}` : error.message,
        downloadMode
    };
};

function setupFirmwareFlashHandlers(mainWindow) {
    let buildInFlight = false;
    let buildChild = null;

    const send = (channel, payload) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(channel, payload);
        }
    };

    const logPort = (portPath, line) => {
        send('flash-log', { port: portPath, line: String(line || '') });
    };

    const progressPort = (portPath, payload) => {
        send('flash-progress', { port: portPath, ...payload });
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
            return { success: true, catalog, settings, artifacts, concurrency: FLASH_CONCURRENCY };
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

    ipcMain.handle('flash-wlan', async () => {
        try {
            return await readWlan();
        } catch (error) {
            return { success: false, error: error.message, current: null, networks: [] };
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
            return await withPort(portPath, async () => {
                logPort(portPath, `Identify ${portPath}`);
                const info = await runLoader(portPath, {
                    baudrate: 115200,
                    log: (line) => logPort(portPath, line),
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
            return failResult(error);
        }
    });

    ipcMain.handle('flash-run', async (event, {
        port,
        boardId,
        pins,
        ssid,
        password,
        namePattern,
        nameMode,
        nameStart,
        nameDigits,
        nameIndex,
        longName,
        shortName,
        clearWifi
    } = {}) => {
        const portPath = String(port || '').trim();
        if (!portPath) {
            return { success: false, error: 'Select a USB serial port' };
        }
        try {
            return await withPort(portPath, async () => {
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
                const ssidTrim = clipName(ssid, 32);
                const passTrim = password == null ? '' : String(password);
                const pattern = clipName(namePattern, 40);
                const nameOpts = normalizeNameOpts({
                    mode: nameMode,
                    start: nameStart,
                    digits: nameDigits
                });
                const seqIndex = Number.isFinite(Number(nameIndex)) ? Math.max(0, Math.round(Number(nameIndex))) : 0;
                const givenLong = clipName(longName, 63);
                saveSettings({
                    flashPort: portPath,
                    flashBoardId: board.id,
                    flashSdPins: sdPins,
                    flashNamePattern: pattern || 'Whip',
                    flashNameMode: nameOpts.mode,
                    flashNameStart: nameOpts.start,
                    flashNameDigits: nameOpts.digits,
                    ...(ssidTrim ? { flashSsid: ssidTrim, flashPassword: passTrim } : {})
                });
                logPort(portPath, `Using image from ${artifacts.source}`);
                progressPort(portPath, { percent: 0, label: 'Connecting' });

                const writeNvs = shouldWriteNvs({
                    ssid: ssidTrim,
                    clearWifi
                });
                let nvsWritten = false;

                const result = await runLoader(portPath, {
                    baudrate: 115200,
                    log: (line) => logPort(portPath, line),
                    work: async ({ loader }) => {
                        const chip = await loader.main('default_reset');
                        if (!isEsp32s3(chip) && !isEsp32s3(loader.chip && loader.chip.CHIP_NAME)) {
                            throw new Error(`This flasher only supports ESP32-S3 (detected ${chip || 'unknown'})`);
                        }
                        let mac = '';
                        try {
                            mac = await loader.chip.readMac(loader);
                        } catch (err) {
                            mac = '';
                        }
                        const names = pattern
                            ? resolveNodeName(pattern, mac, seqIndex, nameOpts)
                            : (givenLong
                                ? { long: givenLong, short: clipName(shortName || givenLong, 17) }
                                : { long: '', short: '' });
                        const fileArray = [
                            { data: readBin(artifacts.files.bootloader), address: Number(flash.bootloader) || 0 },
                            { data: readBin(artifacts.files.partitions), address: Number(flash.partitions) || 0x8000 }
                        ];
                        if (writeNvs) {
                            const nvsSize = Number(flash.nvsSize) || 20480;
                            const nvsAddr = Number(flash.nvs) || 0x9000;
                            const nvsOpts = {
                                board: { pins: sdPins }
                            };
                            if (ssidTrim && !clearWifi) {
                                nvsOpts.wifi = { ssid: ssidTrim, pass: passTrim };
                                logPort(portPath, `Provisioning STA ssid=${ssidTrim}`);
                            } else if (clearWifi) {
                                logPort(portPath, 'NVS omits Wi-Fi (clear requested)');
                            }
                            if (names.long) {
                                nvsOpts.node = names;
                                logPort(portPath, `Provisioning name=${names.long}`);
                            }
                            fileArray.push({
                                data: buildNvsImage(nvsOpts, nvsSize),
                                address: nvsAddr
                            });
                            nvsWritten = true;
                        }
                        fileArray.push({
                            data: readBin(artifacts.files.firmware),
                            address: Number(flash.app) || 0x10000
                        });
                        const totals = fileArray.map((file) => file.data.length);
                        const grand = totals.reduce((sum, n) => sum + n, 0);
                        await loader.writeFlash({
                            fileArray,
                            flashMode: flash.mode || 'dio',
                            flashFreq: flash.freq || '80m',
                            flashSize: flash.size || '4MB',
                            eraseAll: false,
                            compress: true,
                            calculateMD5Hash: md5hex,
                            reportProgress: (fileIndex, written) => {
                                const before = totals.slice(0, fileIndex).reduce((sum, n) => sum + n, 0);
                                const percent = grand ? Math.min(100, Math.round(((before + written) / grand) * 100)) : 0;
                                progressPort(portPath, {
                                    percent,
                                    label: `Writing ${fileIndex + 1}/${fileArray.length}`
                                });
                            }
                        });
                        progressPort(portPath, { percent: 100, label: 'Resetting' });
                        await loader.after('hard_reset');
                        return { chip, mac, names };
                    }
                });

                let pinsResult = { success: true, skipped: true };
                if (!nvsWritten && !ssidTrim && pinsDiffer(sdPins, board.defaults && board.defaults.sd)) {
                    pinsResult = await applyPinsSoftAp(sdPins, (line) => logPort(portPath, line));
                }
                return {
                    success: true,
                    chip: result.chip,
                    mac: result.mac,
                    name: result.names && result.names.long,
                    artifacts: artifacts.source,
                    provisioned: Boolean(nvsWritten && ssidTrim && !clearWifi),
                    nvsWritten,
                    pinsApplied: Boolean(pinsResult.success && !pinsResult.skipped),
                    pinsError: pinsResult.success ? '' : pinsResult.error
                };
            });
        } catch (error) {
            progressPort(portPath, { percent: 0, label: 'Failed' });
            return failResult(error);
        }
    });

    ipcMain.handle('flash-build', async (event, { boardId } = {}) => {
        if (buildInFlight) {
            return { success: false, error: 'A firmware build is already running' };
        }
        buildInFlight = true;
        const log = (line) => logPort('build', line);
        try {
            const catalog = loadCatalog();
            const board = boardById(catalog, boardId);
            const env = pioEnvName(board);
            const sibling = siblingFirmwareRoot();
            const pioPath = findPio();
            log(`Building [env:${env}] in ${sibling}`);
            const started = runPioBuild(pioPath, env, sibling, log);
            buildChild = started.child;
            await started.done;
            const flashClass = board.artifact || board.flashClass;
            const bundled = allBins(path.join(repoRoot(), 'firmware', 'artifacts', flashClass));
            let artifacts = null;
            try {
                artifacts = resolveArtifacts(board);
            } catch (err) {
                return {
                    success: true,
                    env,
                    source: '',
                    bundledPreferred: Boolean(bundled),
                    warning: err.message
                };
            }
            const warning = bundled
                ? `Flash still uses firmware/artifacts/${flashClass} (copies take priority over this PIO build).`
                : '';
            if (warning) {
                log(warning);
            } else {
                log(`Build succeeded. Image: ${artifacts.source}`);
            }
            return {
                success: true,
                env,
                source: artifacts.source,
                bundledPreferred: Boolean(bundled),
                warning
            };
        } catch (error) {
            log(error.message);
            return { success: false, error: error.message };
        } finally {
            buildInFlight = false;
            buildChild = null;
        }
    });

    return () => {
        if (buildChild) {
            try {
                buildChild.kill();
            } catch (err) {
                // already exited
            }
            buildChild = null;
        }
        ipcMain.removeHandler('flash-catalog');
        ipcMain.removeHandler('flash-ports');
        ipcMain.removeHandler('flash-wlan');
        ipcMain.removeHandler('flash-set-settings');
        ipcMain.removeHandler('flash-identify');
        ipcMain.removeHandler('flash-run');
        ipcMain.removeHandler('flash-build');
    };
}

module.exports = setupFirmwareFlashHandlers;
