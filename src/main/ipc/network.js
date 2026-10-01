const { ipcMain, shell } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getNetworkInterfaces } = require('../../services/shared/networkUtils');
const { analyzePush, slicePlan } = require('../../services/shared/pushFit');
const { runFileTask } = require('../../engine/fileTasks');
const { getUiView, setUiView, onUiViewChange, devicesUiWanted } = require('../uiView');
const { assertInLibrary, sanitizeBaseName, uniqueDmxPath, writeSidecar, ensureLibrary } = require('./library');
const {
    destUploadPath,
    downloadFile,
    fetchStatus,
    getJson,
    isIpv4,
    postForm,
    postFirmware,
    postIdentify,
    postMeta,
    postReboot,
    postUpload,
    scanWifi
} = require('../deviceHttp');
const { listImages, verifyListedImage } = require('../firmwareImages');
const { otaVerdict } = require('../../services/shared/firmwareCompat');
const { patchFromStatus } = require('../../services/shared/monitorOverlay');

const ORDER_PREFIX = /^(\d{2})_/;

const sdBaseName = (sdPath) => String(sdPath || '').split('/').pop() || '';

const sdDisplayName = (sdPath) => sdBaseName(sdPath).replace(/\.dmx$/i, '').replace(ORDER_PREFIX, '');

const POLL_MS = 2500;
const PUSH_PARALLEL = 3;
const OTA_PARALLEL = 3;
// Firmware facts and the pixel patch (/status) for the list: every 4th
// ArtPoll tick while the Devices or Monitor view is open.
const FW_REFRESH_TICKS = 4;
const REPORT_VERSION = /\bv(\d+\.\d+\.\d+)\b/;

// The /status fields the update logic needs.
const fwFacts = (status) => {
    if (!status) {
        return null;
    }
    const ota = status.ota && typeof status.ota === 'object'
        ? {
            max: Number(status.ota.max) || 0,
            busy: Boolean(status.ota.busy),
            pending: Boolean(status.ota.pending),
            rolled_back: Boolean(status.ota.rolled_back)
        }
        : null;
    return {
        ver: String(status.ver || ''),
        api: Number(status.api) || 0,
        board: String(status.board || ''),
        ota
    };
};

// Run work(item) over items, at most limit at a time.
const runPool = async (items, limit, work) => {
    const results = new Array(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const index = next;
            next += 1;
            results[index] = await work(items[index], index);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
};
const STALE_MS = 9000;
const DROP_MS = 20000;

function nicInfo(interfaceIp) {
    const list = getNetworkInterfaces();
    const match = list.find((nic) => nic.ip === interfaceIp);
    return match || { name: 'Unknown', ip: interfaceIp || '0.0.0.0' };
}

// The pairing rule is core code (src/engine/core/artnet/pairing.js, owner:
// firmware artnet_rx.cpp); re-exported here under its long-standing name.
const { WHIP_OEM, WHIP_REPORT, whipRejectReason, isWhipPollReply, deviceId } = require('../../engine/core/artnet/pairing');

// Devices, push, OTA and node HTTP. Receive and the universe monitor live
// in the engine; this module hears ArtPollReply through the engine host.
function setupNetworkHandlers(mainWindow, engineHost) {
    const client = engineHost.client;
    const recordingHandler = engineHost.recording;
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
        const images = listImages();
        const now = Date.now();
        const rows = [];
        for (const [id, node] of devices) {
            const age = now - node.lastSeen;
            if (age > DROP_MS) {
                devices.delete(id);
                continue;
            }
            const fw = node.fw || null;
            rows.push({
                ...node,
                stale: age > STALE_MS,
                update: fw ? otaVerdict(fw, images[fw.board] || null) : null
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

    // Every ArtPollReply lands within a moment of the poll: send one list per
    // burst instead of one per reply.
    let emitTimer = null;
    const emitDevicesNow = () => {
        if (emitTimer) {
            clearTimeout(emitTimer);
            emitTimer = null;
        }
        if (!devicesWanted()) {
            return;
        }
        sendToRenderer('devices-update', snapshotDevices());
    };
    const emitDevices = () => {
        if (!emitTimer) {
            emitTimer = setTimeout(emitDevicesNow, 150);
        }
    };

    const quietRecord = () => Boolean(
        getUiView().recording || (recordingHandler && recordingHandler.isRecording())
    );
    // The engine owns the take now; a running take pauses device polling as
    // the recorder's UI flag used to.
    const devicesWanted = () => devicesUiWanted() && !quietRecord();

    const syncUiEmit = () => {
        if (devicesWanted()) {
            startPoll();
        } else {
            stopPoll();
        }
    };

    const clearDevices = () => {
        devices.clear();
        emitDevicesNow();
    };

    const ingestPollReply = (reply) => {
        const id = deviceId(reply);
        if (!id) {
            return;
        }
        if (!isWhipPollReply(reply)) {
            return;
        }
        const prev = devices.get(id);
        const reported = REPORT_VERSION.exec(String(reply.nodeReport || ''));
        devices.set(id, {
            id,
            fw: prev ? prev.fw : null,
            patch: prev ? prev.patch : null,
            ver: reported ? reported[1] : (prev && prev.ver) || '',
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
        if (!prev) {
            fetchOne(id);
        }
    };

    const setFw = (id, status) => {
        const node = devices.get(id);
        if (node && status) {
            node.fw = fwFacts(status);
            node.ver = node.fw.ver || node.ver;
            node.patch = patchFromStatus(status);
        }
    };

    const statusWanted = () => {
        const view = getUiView().view;
        return (view === 'devices' || view === 'monitor') && !quietRecord();
    };

    // A node seen for the first time gets its /status now rather than at the
    // next refresh, so the Monitor overlay appears straight away.
    const fetching = new Set();
    const fetchOne = async (id) => {
        const node = devices.get(id);
        if (!node || !node.ip || fetching.has(id) || !statusWanted()) {
            return;
        }
        fetching.add(id);
        try {
            const result = await fetchStatus(node.ip);
            if (result && result.success) {
                setFw(id, result.status);
                emitDevices();
            }
        } finally {
            fetching.delete(id);
        }
    };

    let fwRefreshing = false;
    const refreshFirmware = async () => {
        if (fwRefreshing || !statusWanted()) {
            return;
        }
        fwRefreshing = true;
        try {
            const rows = [...devices.values()].filter((node) => node.ip);
            await runPool(rows, 4, async (node) => {
                const result = await fetchStatus(node.ip);
                if (result && result.success) {
                    setFw(node.id, result.status);
                }
            });
            emitDevices();
        } finally {
            fwRefreshing = false;
        }
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
        let ticks = 0;
        const tick = () => {
            sendPoll();
            emitDevices();
            if (ticks % FW_REFRESH_TICKS === 1) {
                refreshFirmware();
            }
            ticks += 1;
        };
        tick();
        pollTimer = setInterval(tick, POLL_MS);
    };

    const sendPoll = () => {
        client.command('artnet.poll').catch((err) => {
            console.error('ArtPoll failed:', err.message);
        });
    };

    const pollReplySub = client.subscribe('artnet.pollReply', ingestPollReply);

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

    // Advanced patch (firmware 0.45+): GET/POST /fixture and pixel names.
    const FIXTURE_NAMES_CHUNK = 128;

    ipcMain.handle('device-fixture-get', async (event, { ip } = {}) => {
        try {
            const status = await fetchStatus(ip);
            if (!status || !status.success) {
                return { success: false, error: (status && status.error) || 'Unable to read /status' };
            }
            if (!status.status.fixture) {
                return { success: false, error: 'This node needs firmware 0.45 or newer for the advanced patch.' };
            }
            const fixture = await getJson(ip, '/fixture');
            if (!fixture || !fixture.success) {
                return { success: false, error: (fixture && fixture.error) || 'Unable to read /fixture' };
            }
            const count = Number(fixture.result && fixture.result.pixels) || 0;
            const names = [];
            for (let from = 0; from < count; from += FIXTURE_NAMES_CHUNK) {
                const chunk = await getJson(ip, `/fixture/names?from=${from}&n=${FIXTURE_NAMES_CHUNK}`);
                if (!chunk || !chunk.success) {
                    return { success: false, error: (chunk && chunk.error) || 'Unable to read pixel names' };
                }
                ((chunk.result && chunk.result.names) || []).forEach((name, i) => {
                    names[from + i] = String(name || '');
                });
            }
            return {
                success: true,
                fixture: fixture.result,
                outputs: status.status.outputs || [],
                names
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('device-fixture-set', async (event, { ip, fields, names } = {}) => {
        try {
            const saved = await postForm(ip, '/fixture', fields || {}, 6000);
            if (!saved || !saved.success) {
                return { success: false, error: (saved && saved.error) || 'Save failed' };
            }
            if (Array.isArray(names)) {
                for (let from = 0; from < names.length; from += FIXTURE_NAMES_CHUNK) {
                    const chunk = names.slice(from, from + FIXTURE_NAMES_CHUNK)
                        .map((name) => String(name || '').replace(/[\r\n]/g, ' '));
                    const result = await postForm(ip, '/fixture/names', { from, names: chunk.join('\n') }, 6000);
                    if (!result || !result.success) {
                        return {
                            success: false,
                            fixture: saved.result,
                            error: `Patch saved, pixel names not: ${(result && result.error) || 'no reply'}`
                        };
                    }
                }
            }
            return { success: true, fixture: saved.result };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('device-fixture-locate', async (event, { ip, px, ms = 10000 } = {}) => (
        postForm(ip, '/fixture/locate', { px: String(px || ''), ms })
    ));

    // Over-the-air firmware: what each node would get, then the update run.
    ipcMain.handle('device-ota-plan', async (event, { ids } = {}) => {
        try {
            const images = listImages();
            const wanted = Array.isArray(ids) && ids.length ? new Set(ids) : null;
            const list = snapshotDevices().devices.filter((node) => !wanted || wanted.has(node.id));
            const rows = await runPool(list, 4, async (node) => {
                const result = node.ip && !node.stale ? await fetchStatus(node.ip) : null;
                const ok = Boolean(result && result.success);
                if (ok) {
                    setFw(node.id, result.status);
                }
                const fw = ok ? fwFacts(result.status) : null;
                return {
                    id: node.id,
                    name: node.longName || node.shortName || node.ip,
                    ip: node.ip,
                    fw,
                    image: fw ? images[fw.board] || null : null,
                    error: ok ? '' : ((result && result.error) || 'No reply')
                };
            });
            emitDevices();
            return { success: true, images: Object.values(images), rows };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    let otaRunning = false;
    ipcMain.handle('device-ota-run', async (event, { ids, includeBusy = false } = {}) => {
        if (otaRunning) {
            return { success: false, error: 'An update is already running' };
        }
        const wanted = new Set(Array.isArray(ids) ? ids : []);
        const list = snapshotDevices().devices.filter((node) => wanted.has(node.id) && node.ip);
        if (!list.length) {
            return { success: false, error: 'No nodes selected' };
        }
        otaRunning = true;
        const progress = (id, payload) => sendToRenderer('device-ota-progress', { id, ...payload });
        try {
            const images = listImages();
            // Each board's image is read and checked once, before any node gets it.
            const verified = new Map();
            const imageOk = (image) => {
                if (!verified.has(image.board)) {
                    verified.set(image.board, verifyListedImage(image));
                }
                return verified.get(image.board);
            };
            const results = await runPool(list, OTA_PARALLEL, async (node) => {
                progress(node.id, { phase: 'connecting' });
                const statusResult = await fetchStatus(node.ip);
                const fw = statusResult && statusResult.success ? fwFacts(statusResult.status) : null;
                const image = fw ? images[fw.board] || null : null;
                const verdict = otaVerdict(fw, image, { includeBusy });
                if (verdict.verdict !== 'update') {
                    progress(node.id, { phase: 'skipped', message: verdict.label });
                    return { id: node.id, success: false, skipped: true, error: verdict.label };
                }
                if (!imageOk(image)) {
                    const message = `The ${image.boardName} image in ${image.source} does not match its manifest; rebuild it`;
                    progress(node.id, { phase: 'error', message });
                    return { id: node.id, success: false, error: message };
                }
                const result = await postFirmware(node.ip, image.path, (payload) => progress(node.id, payload), {
                    force: Boolean(includeBusy && verdict.busy),
                    targetVersion: image.version
                });
                return { id: node.id, ...result };
            });
            return { success: true, results };
        } catch (error) {
            return { success: false, error: error.message };
        } finally {
            otaRunning = false;
            refreshFirmware();
        }
    });

    const inspectPushJobs = async (jobs = []) => Promise.all((jobs || []).map(async (job) => {
        assertInLibrary(job.filePath);
        let scan;
        try {
            scan = await runFileTask('scan', { filePath: job.filePath });
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
    }));

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
            const [looks, states] = await Promise.all([
                inspectPushJobs(jobs),
                loadPushDeviceStates(rows)
            ]);
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
            const [looks, states] = await Promise.all([
                inspectPushJobs(jobs),
                loadPushDeviceStates(rows)
            ]);
            const analysis = analyzePush(looks, states);
            if (!analysis.overall.canPush) {
                return { success: false, error: analysis.overall.label || 'Cannot push', analysis };
            }
            const results = [];
            for (const look of analysis.looks) {
                const plans = (rows || [])
                    .map((target) => ({ target, plan: slicePlan(look, target.id) }))
                    .filter((item) => item.plan);
                if (!plans.length) {
                    continue;
                }
                const labelOf = (target) => target.longName || target.shortName || target.ip;
                emitPushProgress({
                    phase: 'connecting',
                    sent: 0,
                    total: 0,
                    label: `Slicing ${look.name}`
                });
                plans.forEach((item) => {
                    item.destPath = item.plan.destPath || destUploadPath(item.plan.filePath);
                    item.tempPath = path.join(
                        os.tmpdir(),
                        `whip-push-${crypto.randomBytes(8).toString('hex')}.dmx`
                    );
                    temps.push(item.tempPath);
                });
                // One pass over the look for every node's slice.
                await runFileTask('slice', {
                    srcPath: look.filePath,
                    targets: plans.map(({ plan, tempPath }) => ({
                        destPath: tempPath,
                        proto: plan.proto,
                        destProto: plan.destProto,
                        destUniShift: plan.destUniShift,
                        slideDelta: plan.slideDelta,
                        destFirstAddr: plan.destFirstAddr,
                        destLastAddr: plan.destLastAddr
                    }))
                });

                // Up to PUSH_PARALLEL nodes at once; the progress bar is the sum.
                const progress = new Map();
                const label = plans.length > 1
                    ? `${plans.length} nodes · ${look.name}`
                    : `${labelOf(plans[0].target)} · ${look.name}`;
                const emitSum = (phase) => {
                    let sent = 0;
                    let total = 0;
                    let startedAt = Date.now();
                    for (const item of progress.values()) {
                        sent += item.sent || 0;
                        total += item.total || 0;
                        startedAt = Math.min(startedAt, item.startedAt || startedAt);
                    }
                    emitPushProgress({ phase, sent, total, startedAt, label });
                };
                const queue = plans.slice();
                const uploadOne = async (item) => {
                    const uploaded = await postUpload(item.target.ip, item.tempPath, (update) => {
                        progress.set(item.target.id, update);
                        const phase = update.phase === 'done' || update.phase === 'error'
                            ? 'sending'
                            : update.phase;
                        emitSum(phase);
                    }, item.destPath, { meta: false });
                    try {
                        fs.unlinkSync(item.tempPath);
                    } catch (err) {
                        // retried in finally
                    }
                    item.uploaded = uploaded;
                };
                const workers = Array.from({ length: Math.min(PUSH_PARALLEL, queue.length) }, async () => {
                    while (queue.length) {
                        await uploadOne(queue.shift());
                    }
                });
                await Promise.all(workers);
                emitSum('waiting');

                // Sidecars last, so the sync group names only the nodes that
                // actually received their slice.
                const ok = plans.filter((item) => item.uploaded && item.uploaded.success);
                const group = crypto.randomUUID();
                const wantSync = ok.length > 1;
                const batchKind = look.batch && look.batch.kind;
                const syncKind = (batchKind === 'fit' || batchKind === 'shift') ? 'uni' : 'split';
                const members = JSON.stringify(ok.map((item) => ({
                    n: labelOf(item.target),
                    m: item.target.mac || ''
                })));
                await Promise.all(ok.map(async (item) => {
                    const dest = (item.uploaded.result && item.uploaded.result.path) || item.destPath;
                    const fields = { path: dest, name: look.name };
                    if (wantSync) {
                        fields.sync_group = group;
                        fields.sync_members = members;
                        fields.sync_kind = syncKind;
                        // Every member loops on the same length.
                        if (look.durationMs) {
                            fields.sync_dur = Math.round(look.durationMs);
                        }
                    }
                    const meta = await postMeta(item.target.ip, fields);
                    item.dest = dest;
                    if (!meta || !meta.success) {
                        item.metaError = (meta && meta.error) || 'sidecar failed';
                    }
                }));
                emitSum('done');

                for (const item of plans) {
                    const name = labelOf(item.target);
                    if (!item.uploaded || !item.uploaded.success) {
                        results.push({
                            label: name,
                            dest: item.destPath,
                            error: (item.uploaded && item.uploaded.error) || 'Push failed'
                        });
                    } else if (item.metaError) {
                        results.push({
                            label: name,
                            dest: item.dest,
                            error: `Uploaded, but the title/sync sidecar failed: ${item.metaError}`
                        });
                    } else {
                        results.push({ label: name, dest: item.dest });
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

    // Full show to one node, then the node slices it for every peer on the
    // cue bus and uploads the parts (firmware POST /distribute).
    const waitForDistribute = async (holder, label) => {
        const started = Date.now();
        let seenRunning = false;
        while (Date.now() - started < 30 * 60 * 1000) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            const result = await fetchStatus(holder.ip);
            const dist = result && result.success && result.status && result.status.dist;
            if (!dist) {
                continue;
            }
            if (dist.state === 'running') {
                seenRunning = true;
                emitPushProgress({
                    phase: 'sending',
                    sent: dist.sent || 0,
                    total: dist.total || 0,
                    label: `${label} → ${dist.peer || '…'} (${(dist.i || 0) + 1}/${dist.n || 1})`
                });
                continue;
            }
            if (dist.state === 'done' || (dist.state === 'error' && seenRunning) || dist.state === 'error') {
                return dist;
            }
        }
        return { state: 'error', msg: 'timed out' };
    };

    // Full show to one node, which plays it and streams every peer its
    // universes live (firmware POST /stream); members need no SD content.
    ipcMain.handle('device-push-stream', async (event, { jobs, holder } = {}) => {
        try {
            const list = Array.isArray(jobs) ? jobs : [];
            if (list.length !== 1) {
                return { success: false, error: 'Stream plays one show at a time' };
            }
            if (!holder || !holder.ip) {
                return { success: false, error: 'Pick the node that plays the full show' };
            }
            const job = list[0];
            assertInLibrary(job.filePath);
            const label = holder.longName || holder.ip;
            const destPath = job.dest || destUploadPath(job.filePath);
            const uploaded = await postUpload(holder.ip, job.filePath, (progress) => {
                emitPushProgress({ ...progress, label: `${label} · full show` });
            }, destPath, { name: job.name, titlePath: job.filePath });
            if (!uploaded || !uploaded.success) {
                return { success: false, error: (uploaded && uploaded.error) || 'Upload failed' };
            }
            const dest = (uploaded.result && uploaded.result.path) || destPath;
            const started = await postForm(holder.ip, '/stream', { path: dest, on: 1 }, 4000);
            if (!started || !started.success) {
                return { success: false, error: `Upload done, stream failed: ${(started && started.error) || 'no reply'}` };
            }
            return { success: true, results: [{ label, dest }] };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('device-stream-stop', async (event, { ip } = {}) => postForm(ip, '/stream', { on: 0 }));

    ipcMain.handle('device-push-distribute', async (event, { jobs, holder } = {}) => {
        try {
            const list = Array.isArray(jobs) ? jobs : [];
            if (list.length !== 1) {
                return { success: false, error: 'Distribute sends one show at a time' };
            }
            if (!holder || !holder.ip) {
                return { success: false, error: 'Pick the node that holds the full show' };
            }
            const job = list[0];
            assertInLibrary(job.filePath);
            const label = holder.longName || holder.ip;
            const destPath = job.dest || destUploadPath(job.filePath);
            const uploaded = await postUpload(holder.ip, job.filePath, (progress) => {
                emitPushProgress({ ...progress, label: `${label} · full show` });
            }, destPath, { name: job.name, titlePath: job.filePath });
            if (!uploaded || !uploaded.success) {
                return { success: false, error: (uploaded && uploaded.error) || 'Upload failed' };
            }
            const dest = (uploaded.result && uploaded.result.path) || destPath;
            const started = await postForm(holder.ip, '/distribute', { path: dest }, 4000);
            if (!started || !started.success) {
                return { success: false, error: `Upload done, distribute failed: ${(started && started.error) || 'no reply'}` };
            }
            const dist = await waitForDistribute(holder, label);
            if (dist.state !== 'done') {
                return { success: false, error: `Distribute: ${dist.msg || 'failed'}` };
            }
            return {
                success: true,
                results: [{ label, dest, note: dist.msg }],
                failed: dist.failed || 0
            };
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

    ipcMain.handle('device-set-shownet', async (event, { ip, role, ssid, pass, ch } = {}) => {
        return postForm(ip, '/shownet', {
            role: role || 'standalone',
            ssid: ssid || '',
            pass: pass || '',
            ch: ch || 6
        }, 4000);
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

    // The engine host rebinds the receivers on set-protocol; the device list
    // resets here and polling restarts once the sockets are bound.
    const handleSetProtocol = (event, payload = {}) => {
        selectedNic = nicInfo((payload && payload.interfaceIp) || '0.0.0.0');
        stopPoll();
        clearDevices();
    };
    ipcMain.on('set-protocol', handleSetProtocol);
    const stopBoundWatch = engineHost.onReceiversBound(() => {
        syncUiEmit();
    });
    const stopRecordWatch = engineHost.onRecordingChange(syncUiEmit);

    const handleScan = () => {
        if (quietRecord()) {
            return;
        }
        sendPoll();
        emitDevices();
        refreshFirmware();
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

    return () => {
        stopPoll();
        stopBoundWatch();
        stopRecordWatch();
        client.unsubscribe(pollReplySub);
        if (emitTimer) {
            clearTimeout(emitTimer);
            emitTimer = null;
        }
        devices.clear();
        ipcMain.removeHandler('device-status');
        ipcMain.removeHandler('device-identify');
        ipcMain.removeHandler('device-reboot');
        ipcMain.removeHandler('device-list');
        ipcMain.removeHandler('device-ota-plan');
        ipcMain.removeHandler('device-fixture-get');
        ipcMain.removeHandler('device-fixture-set');
        ipcMain.removeHandler('device-fixture-locate');
        ipcMain.removeHandler('device-ota-run');
        ipcMain.removeHandler('device-push-analyze');
        ipcMain.removeHandler('device-push-show');
        ipcMain.removeHandler('device-push-batch');
        ipcMain.removeHandler('device-push-distribute');
        ipcMain.removeHandler('device-push-stream');
        ipcMain.removeHandler('device-stream-stop');
        ipcMain.removeHandler('device-play');
        ipcMain.removeHandler('device-stop');
        ipcMain.removeHandler('device-set-brightness');
        ipcMain.removeHandler('device-set-live');
        ipcMain.removeHandler('device-wifi-scan');
        ipcMain.removeHandler('device-wifi-connect');
        ipcMain.removeHandler('device-wifi-forget');
        ipcMain.removeHandler('device-set-name');
        ipcMain.removeHandler('device-set-shownet');
        ipcMain.removeHandler('device-rename-show');
        ipcMain.removeHandler('device-open-portal');
        ipcMain.removeHandler('device-pull-show');
        ipcMain.removeListener('devices-scan', handleScan);
        ipcMain.removeListener('set-protocol', handleSetProtocol);
        ipcMain.removeListener('set-ui-view', handleUiView);
        if (stopUiView) {
            stopUiView();
        }
    };
}

module.exports = setupNetworkHandlers;
module.exports.whipRejectReason = whipRejectReason;
