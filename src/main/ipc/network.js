const { ipcMain, shell } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ArtNetReceiver = require('../../services/artnet/receiver');
const SacnReceiver = require('../../services/sacn/receiver');
const { getNetworkInterfaces } = require('../../services/shared/networkUtils');
const { scanRecording } = require('../../services/shared/dmxRecording');
const { analyzePush, slicePlan } = require('../../services/shared/pushFit');
const { sliceRecording } = require('../../services/shared/dmxSlice');
const { getUiView, setUiView, onUiViewChange, devicesUiWanted } = require('../uiView');
const UniverseMonitor = require('../monitor/universeMonitor');
const { assertInLibrary, sanitizeBaseName, uniqueDmxPath, writeSidecar, ensureLibrary } = require('./library');
const {
    destUploadPath,
    downloadFile,
    fetchStatus,
    isIpv4,
    postForm,
    postIdentify,
    postReboot,
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
        if (!devicesUiWanted()) {
            return;
        }
        sendToRenderer('devices-update', snapshotDevices());
    };

    const quietRecord = () => Boolean(
        getUiView().recording || (recordingHandler && recordingHandler.isRecording())
    );

    const syncUiEmit = () => {
        const ui = getUiView();
        const quiet = quietRecord();
        const rail = !quiet && (ui.view === 'monitor' || ui.view === 'studio');
        monitor.setEmit({
            snapshot: rail,
            grid: !quiet && ui.view === 'monitor'
        });
        if (devicesUiWanted()) {
            startPoll();
        } else {
            stopPoll();
        }
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
        if (pollTimer) {
            return;
        }
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

            const observeDmx = (protocol, universe, dmxData) => {
                if (!recordingHandler || !recordingHandler.wantsObserve || !recordingHandler.wantsObserve()) {
                    return;
                }
                const selected = selectedUniverses.has(`${protocol}-${universe}`);
                const watched = recordingHandler.watchesUniverse
                    && recordingHandler.watchesUniverse(protocol, universe);
                if (!selected && !watched) {
                    return;
                }
                recordingHandler.observe({
                    protocol,
                    universe,
                    data: dmxData
                }, { selected });
            };

            const dispatchDmx = (protocol, universe, dmxData, ingest) => {
                const wasRecording = Boolean(recordingHandler && recordingHandler.isRecording());
                if (!wasRecording) {
                    observeDmx(protocol, universe, dmxData);
                }
                if (recordingHandler && recordingHandler.isRecording()) {
                    maybeRecord(protocol, universe, dmxData);
                    if (wasRecording) {
                        observeDmx(protocol, universe, dmxData);
                    }
                    return;
                }
                ingest();
            };

            artnetReceiver.onDmxData('main', (data) => {
                dispatchDmx('artnet', data.universe, data.dmxData, () => {
                    monitor.ingest({
                        protocol: 'artnet',
                        universe: data.universe,
                        sourceIp: data.sourceIp,
                        dmxData: data.dmxData
                    });
                });
            });

            artnetReceiver.onPollReply('main', ingestPollReply);

            sacnReceiver.onDmxData('main', (data) => {
                dispatchDmx('sacn', data.universe, data.dmxData, () => {
                    monitor.ingest({
                        protocol: 'sacn',
                        universe: data.universe,
                        sourceIp: data.sourceIp,
                        sourceName: data.sourceName,
                        dmxData: data.dmxData
                    });
                });
            });

            syncUiEmit();
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

    ipcMain.handle('device-reboot', async (event, { ip } = {}) => {
        return postReboot(ip);
    });

    ipcMain.handle('device-list', () => snapshotDevices());

    const inspectPushJobs = (jobs = []) => (jobs || []).map((job) => {
        assertInLibrary(job.filePath);
        let scan;
        try {
            scan = scanRecording(job.filePath);
        } catch (err) {
            scan = {
                error: err.message,
                playable: false,
                activeChannels: 0,
                spans: {},
                protocols: []
            };
        }
        return {
            filePath: job.filePath,
            name: job.name || path.parse(job.filePath).name,
            dest: job.dest || null,
            scan
        };
    });

    const loadPushDeviceStates = async (rows = []) => Promise.all((rows || []).map(async (device) => {
        const result = await fetchStatus(device.ip);
        if (result && result.success) {
            return {
                ...device,
                status: result.status,
                statusError: ''
            };
        }
        return {
            ...device,
            status: null,
            statusError: (result && result.error) || 'Unable to read /status'
        };
    }));

    const emitPushProgress = (progress) => {
        sendToRenderer('device-push-progress', progress);
    };

    ipcMain.handle('device-push-analyze', async (event, { jobs, devices: rows } = {}) => {
        try {
            const looks = inspectPushJobs(jobs);
            const states = await loadPushDeviceStates(rows);
            return { success: true, analysis: analyzePush(looks, states) };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('device-push-show', async (event, { ip, filePath, destPath } = {}) => {
        try {
            assertInLibrary(filePath);
            return await postUpload(ip, filePath, (progress) => {
                emitPushProgress(progress);
            }, destPath);
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('device-push-batch', async (event, { jobs, devices: rows } = {}) => {
        const temps = [];
        try {
            const looks = inspectPushJobs(jobs);
            const states = await loadPushDeviceStates(rows);
            const analysis = analyzePush(looks, states);
            if (!analysis.overall.canPush) {
                return { success: false, error: analysis.overall.label || 'Cannot push', analysis };
            }
            const results = [];
            for (const look of analysis.looks) {
                const receiving = (rows || []).filter((device) => slicePlan(look, device.id));
                if (!receiving.length) {
                    continue;
                }
                const group = crypto.randomUUID();
                const wantSync = receiving.length > 1;
                const members = JSON.stringify(receiving.map((device) => ({
                    n: device.longName || device.shortName || device.ip,
                    m: device.mac || ''
                })));
                for (const target of receiving) {
                    const plan = slicePlan(look, target.id);
                    if (!plan) {
                        continue;
                    }
                    const destPath = plan.destPath || destUploadPath(plan.filePath);
                    const tempPath = path.join(
                        os.tmpdir(),
                        `whip-push-${crypto.randomBytes(8).toString('hex')}.dmx`
                    );
                    temps.push(tempPath);
                    emitPushProgress({
                        phase: 'connecting',
                        sent: 0,
                        total: 0,
                        label: `${target.longName || target.ip} · ${look.name}`
                    });
                    sliceRecording(plan.filePath, tempPath, {
                        proto: plan.proto,
                        destProto: plan.destProto,
                        slideDelta: plan.slideDelta,
                        destFirstAddr: plan.destFirstAddr,
                        destLastAddr: plan.destLastAddr
                    });
                    const uploaded = await postUpload(target.ip, tempPath, (progress) => {
                        emitPushProgress({
                            ...progress,
                            label: `${target.longName || target.ip} · ${look.name}`
                        });
                    }, destPath, {
                        name: look.name,
                        titlePath: plan.filePath,
                        sync_group: wantSync ? group : undefined,
                        sync_members: wantSync ? members : undefined
                    });
                    try {
                        fs.unlinkSync(tempPath);
                    } catch (err) {
                        // ignore
                    }
                    if (!uploaded || !uploaded.success) {
                        results.push({
                            label: target.longName || target.ip,
                            dest: destPath,
                            error: (uploaded && uploaded.error) || 'Push failed'
                        });
                    } else {
                        const dest = (uploaded.result && uploaded.result.path) || destPath;
                        results.push({ label: target.longName || target.ip, dest });
                    }
                }
            }
            const failed = results.filter((item) => item.error);
            const ok = results.filter((item) => !item.error);
            if (failed.length && !ok.length) {
                return { success: false, error: failed[0].error, results, analysis };
            }
            return { success: true, results, analysis };
        } catch (error) {
            return { success: false, error: error.message };
        } finally {
            temps.forEach((tempPath) => {
                try {
                    if (fs.existsSync(tempPath)) {
                        fs.unlinkSync(tempPath);
                    }
                } catch (err) {
                    // ignore
                }
            });
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
        if (quietRecord()) {
            return;
        }
        if (artnetReceiver && artnetReceiver.sendPoll) {
            artnetReceiver.sendPoll();
        }
        emitDevices();
    };

    const handleUiView = (event, payload = {}) => {
        setUiView({
            view: payload.view,
            recording: payload.recording
        });
        syncUiEmit();
    };

    ipcMain.on('devices-scan', handleScan);
    ipcMain.on('set-ui-view', handleUiView);
    const stopUiView = onUiViewChange(() => {
        syncUiEmit();
    });

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
        ipcMain.removeHandler('device-reboot');
        ipcMain.removeHandler('device-list');
        ipcMain.removeHandler('device-push-analyze');
        ipcMain.removeHandler('device-push-show');
        ipcMain.removeHandler('device-push-batch');
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
        ipcMain.removeListener('set-ui-view', handleUiView);
        if (stopUiView) {
            stopUiView();
        }
    };
}

module.exports = setupNetworkHandlers;
