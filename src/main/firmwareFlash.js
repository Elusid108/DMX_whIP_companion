const { ipcMain } = require('electron');
const crypto = require('crypto');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SerialPort } = require('serialport');
const { postForm, SOFTAP_IP } = require('./deviceHttp');
const { loadSettings, saveSettings } = require('./settings');
const NodeSerialDevice = require('./nodeSerialDevice');
const { repoRoot, siblingRoot, loadCatalog, boardById } = require('./firmwareCatalog');
const { describeImage, readImageFile, resolveImage } = require('./firmwareImages');
const { whipQuery } = require('./portProbe');
const { matchBoard, usbClass } = require('../services/shared/boardDetect');
const { buildNvsImage, shouldWriteNvs } = require('./nvsImage');
const { readWlan } = require('./wlanInfo');
const { clipName, resolveNodeName, normalizeNameOpts } = require('../services/shared/flashName');
const {
    addressAt,
    chipByName,
    validatePixels,
    buildPmapBlob
} = require('../services/shared/pixelMap');

const DOWNLOAD_HINT = 'Hold BOOT, tap RESET, release BOOT, then try again. Close any serial monitor first.';
const FLASH_CONCURRENCY = 4;

const chipKey = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const detectedChipName = (chip, loader) =>
    chip || (loader && loader.chip && loader.chip.CHIP_NAME) || '';

const chipMatchesBoard = (board, detected) => {
    const want = chipKey(board && board.chip);
    const got = chipKey(detected);
    if (!want || !got) {
        return false;
    }
    return got === want || got.startsWith(want) || want.startsWith(got);
};

const looksLikeDownloadFail = (err) => {
    const m = String((err && err.message) || err || '');
    return /timeout|Failed to connect|No serial data|Invalid head|download|Serial data stream/i.test(m);
};

const md5hex = (image) => crypto.createHash('md5').update(Buffer.from(image)).digest('hex');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const siblingFirmwareRoot = () => {
    const { app } = require('electron');
    if (app && app.isPackaged) {
        throw new Error('Build all is only available when running from the companion source tree.');
    }
    const root = siblingRoot();
    if (!fs.existsSync(path.join(root, 'platformio.ini'))) {
        throw new Error('DMX_whIP_embedded not found next to this repo (missing platformio.ini).');
    }
    return root;
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

// release.py needs Python; PlatformIO's own (next to pio) always exists.
const findPython = (pioPath) => {
    const dir = path.dirname(pioPath);
    const beside = ['python.exe', 'python3', 'python'].map((name) => path.join(dir, name));
    const found = beside.find((file) => fs.existsSync(file));
    return found || findOnPath(['python', 'python3', 'py']) || null;
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

// python scripts/release.py: builds every release env, writes dist/whip-<ver>/.
const runRelease = (pythonPath, cwd, log) => {
    const script = path.join('scripts', 'release.py');
    log(`${pythonPath} ${script}`);
    const child = spawn(pythonPath, ['-u', script], {
        cwd,
        windowsHide: true,
        shell: false,
        env: { ...process.env, PYTHONUTF8: '1' }
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
            reject(new Error(signal ? `release build ended (${signal})` : `release build exited ${code == null ? 'null' : code}`));
        });
    });
    return { child, done };
};

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

// USB vendor/product id of a port as numbers. esptool-js picks its reset
// sequence from the product id (0x1001 = the chip's own USB-Serial/JTAG).
const usbIdsFor = async (portPath) => {
    try {
        const port = (await SerialPort.list()).find((item) => item.path === portPath);
        const hex = (value) => (value ? parseInt(String(value), 16) : undefined);
        return port ? { vendorId: hex(port.vendorId), productId: hex(port.productId) } : {};
    } catch (err) {
        return {};
    }
};

const runLoader = async (portPath, { baudrate, log, work }) => {
    const { ESPLoader, Transport } = await loadEsptool();
    const device = new NodeSerialDevice(portPath, await usbIdsFor(portPath));
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

    ipcMain.handle('flash-catalog', async (event, { boardId } = {}) => {
        try {
            const catalog = loadCatalog();
            const settings = loadSettings();
            let artifacts = null;
            try {
                const image = resolveImage(boardById(catalog, boardId || settings.flashBoardId));
                artifacts = { source: describeImage(image), version: image.version };
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

    // Chip, MAC and flash size from the ROM bootloader. resetAfter boots the
    // app again (a probe); Identify leaves it for the flash that follows.
    const esptoolIdentify = (portPath, { resetAfter = false } = {}) => runLoader(portPath, {
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
            if (resetAfter) {
                try {
                    await loader.after('hard_reset');
                } catch (err) {
                    // the next flash resets it anyway
                }
            }
            return {
                chip: detectedChipName(chip, loader) || 'unknown',
                mac,
                flashSize
            };
        }
    });

    // Which board is on a port. First asks running whIP firmware ("whip id",
    // no reset); with deep, a port that does not answer is read by esptool
    // (resets into the bootloader and back) and matched against the catalog.
    // source: fw | chip | guess | rp | '' (unknown).
    ipcMain.handle('flash-probe', async (event, { port, deep } = {}) => {
        const portPath = String(port || '').trim();
        if (!portPath) {
            return { success: false, error: 'Select a USB serial port' };
        }
        try {
            return await withPort(portPath, async () => {
                const catalog = loadCatalog();
                const listed = (await SerialPort.list()).find((item) => item.path === portPath) || {};
                const usb = usbClass(listed.vendorId, listed.productId);
                const base = { success: true, port: portPath, usb };
                const reply = await whipQuery(portPath, 'id');
                if (reply && reply.ok) {
                    const known = catalog.boards.some((board) => board.id === reply.board);
                    logPort(portPath, `Firmware answered: ${reply.board} v${reply.ver} ${reply.name || ''}`.trim());
                    return {
                        ...base,
                        source: 'fw',
                        boardId: known ? reply.board : '',
                        fwBoard: reply.board || '',
                        fam: reply.fam || 'esp',
                        chip: reply.chip || '',
                        mac: reply.mac || '',
                        name: reply.name || '',
                        ver: reply.ver || ''
                    };
                }
                if (usb === 'rp') {
                    return { ...base, source: 'rp', fam: 'rp', boardId: '' };
                }
                if (!deep) {
                    return { ...base, source: '', boardId: '' };
                }
                logPort(portPath, `No firmware answer on ${portPath}; reading the chip`);
                const info = await esptoolIdentify(portPath, { resetAfter: true });
                const match = matchBoard(catalog.boards, {
                    chip: info.chip,
                    flashSize: info.flashSize,
                    vendorId: listed.vendorId,
                    productId: listed.productId
                });
                return {
                    ...base,
                    source: match ? match.source : '',
                    boardId: match ? match.boardId : '',
                    fam: 'esp',
                    chip: info.chip,
                    mac: info.mac,
                    flashSize: info.flashSize
                };
            });
        } catch (error) {
            return failResult(error);
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
                const info = await esptoolIdentify(portPath);
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
        clearWifi,
        pixels,
        keepNvs,
        show
    } = {}) => {
        const portPath = String(port || '').trim();
        if (!portPath) {
            return { success: false, error: 'Select a USB serial port' };
        }
        const keepExisting = Boolean(keepNvs);
        try {
            return await withPort(portPath, async () => {
                const catalog = loadCatalog();
                const board = boardById(catalog, boardId);
                if (!board) {
                    throw new Error('Select a board profile');
                }
                const artifacts = resolveImage(board);
                const { offsets, layout } = artifacts;
                const sdPins = {
                    cs: Number(pins && pins.cs),
                    mosi: Number(pins && pins.mosi),
                    clk: Number(pins && pins.clk),
                    miso: Number(pins && pins.miso)
                };
                const ssidTrim = keepExisting ? '' : clipName(ssid, 32);
                const passTrim = keepExisting || password == null ? '' : String(password);
                const pattern = keepExisting ? '' : clipName(namePattern, 40);
                const nameOpts = normalizeNameOpts({
                    mode: nameMode,
                    start: nameStart,
                    digits: nameDigits
                });
                const seqIndex = Number.isFinite(Number(nameIndex)) ? Math.max(0, Math.round(Number(nameIndex))) : 0;
                const givenLong = keepExisting ? '' : clipName(longName, 63);
                let pixelMap = null;
                let pixelChip = null;
                let addr = null;
                if (!keepExisting) {
                    const pixelCheck = validatePixels(pixels, sdPins, seqIndex + 1, board.gpio);
                    if (!pixelCheck.ok) {
                        throw new Error(pixelCheck.error);
                    }
                    pixelMap = pixelCheck.pixels;
                    pixelChip = pixelCheck.chip || chipByName(pixelMap.chip);
                    addr = addressAt(pixelMap, seqIndex);
                    saveSettings({
                        flashPort: portPath,
                        flashBoardId: board.id,
                        flashSdPins: sdPins,
                        flashPixels: pixelMap,
                        flashNamePattern: pattern || 'Whip',
                        flashNameMode: nameOpts.mode,
                        flashNameStart: nameOpts.start,
                        flashNameDigits: nameOpts.digits,
                        ...(ssidTrim ? { flashSsid: ssidTrim, flashPassword: passTrim } : {})
                    });
                }
                logPort(portPath, `Using image from ${describeImage(artifacts)}`);
                if (keepExisting) {
                    logPort(portPath, 'Keeping existing NVS (name, start address, Wi-Fi)');
                }
                progressPort(portPath, { percent: 0, label: 'Connecting' });

                const writeNvs = !keepExisting && shouldWriteNvs({
                    ssid: ssidTrim,
                    clearWifi,
                    pixels: pixelMap
                });
                let nvsWritten = false;

                const result = await runLoader(portPath, {
                    baudrate: 115200,
                    log: (line) => logPort(portPath, line),
                    work: async ({ loader }) => {
                        const chip = await loader.main('default_reset');
                        const detected = detectedChipName(chip, loader);
                        if (!chipMatchesBoard(board, detected)) {
                            throw new Error(
                                `Selected ${board.name} (${board.chip}) but port is ${detected || 'unknown'}`
                            );
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
                            { data: readImageFile(artifacts, 'bootloader'), address: offsets.bootloader },
                            { data: readImageFile(artifacts, 'partitions'), address: offsets.partitions }
                        ];
                        // Blank otadata so the node boots the app written below
                        // (app0), even if an earlier OTA left it on app1.
                        if (layout.otadata) {
                            fileArray.push({
                                data: new Uint8Array(Number(layout.otadataSize) || 0x2000).fill(0xff),
                                address: Number(layout.otadata)
                            });
                            logPort(portPath, 'Resetting the OTA boot slot');
                        }
                        if (writeNvs) {
                            const nvsSize = Number(layout.nvsSize) || 20480;
                            const nvsAddr = Number(layout.nvs) || 0x9000;
                            const nvsOpts = {
                                board: { pins: sdPins },
                                pmap: {
                                    chip: pixelChip.id,
                                    ords: pixelMap.order,
                                    data: pixelMap.data,
                                    clk: pixelChip.needsClock ? pixelMap.clk : 0,
                                    count: pixelMap.count,
                                    uni: addr.uni,
                                    ch: addr.ch,
                                    white: pixelMap.white ? 1 : 0,
                                    cct: pixelMap.cct ? 1 : 0,
                                    proto: 0,
                                    bri: pixelMap.bri,
                                    n: 1,
                                    blob: buildPmapBlob([{
                                        ...pixelMap,
                                        startUni: addr.uni,
                                        startCh: addr.ch
                                    }])
                                },
                                led: { bri: pixelMap.bri }
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
                            const showRole = show && ({ host: 1, member: 2 })[show.role];
                            if (showRole && show.ssid) {
                                nvsOpts.show = {
                                    role: showRole,
                                    ssid: clipName(show.ssid, 32),
                                    pass: String(show.pass || ''),
                                    ch: Math.max(1, Math.min(13, Number(show.ch) || 6))
                                };
                                logPort(portPath, `Provisioning show network ${show.role} ssid=${nvsOpts.show.ssid}`);
                            }
                            logPort(
                                portPath,
                                `Provisioning map chip=${pixelChip.name} count=${pixelMap.count} uni=${addr.uni} ch=${addr.ch}`
                            );
                            fileArray.push({
                                data: buildNvsImage(nvsOpts, nvsSize),
                                address: nvsAddr
                            });
                            nvsWritten = true;
                        }
                        fileArray.push({
                            data: readImageFile(artifacts, 'firmware'),
                            address: offsets.app
                        });
                        const totals = fileArray.map((file) => file.data.length);
                        const grand = totals.reduce((sum, n) => sum + n, 0);
                        await loader.writeFlash({
                            fileArray,
                            // Each image is built by its own PIO env, so its
                            // header already has the right mode/freq/size.
                            // esptool-js rewrites freq from one table for every
                            // chip (80m -> 0xF), which is wrong for the C6
                            // (80m = 0x0) and leaves its ROM in a WDT reset loop.
                            flashMode: 'keep',
                            flashFreq: 'keep',
                            flashSize: 'keep',
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
                if (!keepExisting && !nvsWritten && !ssidTrim && pinsDiffer(sdPins, board.defaults && board.defaults.sd)) {
                    pinsResult = await applyPinsSoftAp(sdPins, (line) => logPort(portPath, line));
                }
                return {
                    success: true,
                    chip: result.chip,
                    mac: result.mac,
                    name: keepExisting ? '' : (result.names && result.names.long),
                    artifacts: describeImage(artifacts),
                    provisioned: Boolean(!keepExisting && nvsWritten && ssidTrim && !clearWifi),
                    keptNvs: keepExisting,
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

    // Build all: scripts/release.py in the sibling checkout builds every
    // release board and writes one dist/whip-<ver>/ bundle.
    ipcMain.handle('flash-build', async (event, { boardId } = {}) => {
        if (buildInFlight) {
            return { success: false, error: 'A firmware build is already running' };
        }
        buildInFlight = true;
        const log = (line) => logPort('build', line);
        try {
            const sibling = siblingFirmwareRoot();
            const python = findPython(findPio());
            if (!python) {
                throw new Error('Python not found (PlatformIO normally brings one). Run python scripts/release.py in DMX_whIP_embedded.');
            }
            log(`Building every release board in ${sibling} (the first build after a platformio.ini change takes about 10 minutes)`);
            const started = runRelease(python, sibling, log);
            buildChild = started.child;
            await started.done;
            let source = '';
            let warning = '';
            try {
                const image = resolveImage(boardById(loadCatalog(), boardId));
                source = describeImage(image);
                log(`Build succeeded. Image: ${source}`);
            } catch (err) {
                warning = err.message;
                log(warning);
            }
            return { success: true, source, warning };
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
        ipcMain.removeHandler('flash-probe');
        ipcMain.removeHandler('flash-run');
        ipcMain.removeHandler('flash-build');
    };
}

module.exports = setupFirmwareFlashHandlers;
module.exports.loadCatalog = loadCatalog;
module.exports.repoRoot = repoRoot;
