const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const SOFTAP_IP = '4.3.2.1';
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const SD_PATH_MAX = 63;
const INVALID_NAME = /[<>:"/\\|?*\x00-\x1f]/g;
const INVALID_SEG = /[<>:"/\\|?*\x00-\x1f]/;

const isIpv4 = (ip) => typeof ip === 'string' && IPV4.test(ip.trim());

// 4.3.2.1 is a public internet address. Only fall back to it when this PC
// is actually on a node's SoftAP (has a 4.3.2.x address).
const softApReachable = () => Object.values(os.networkInterfaces()).some((list) => (
    (list || []).some((addr) => addr && addr.family === 'IPv4' && /^4\.3\.2\./.test(addr.address))
));

const hostsFor = (ip) => (
    ip === SOFTAP_IP || !softApReachable() ? [ip] : [ip, SOFTAP_IP]
);

const isImmediateConnectFail = (err) => {
    const code = err && err.code;
    const msg = String((err && err.message) || '');
    return code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EHOSTUNREACH'
        || /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH/.test(msg);
};

const busyError = () => ({
    success: false,
    error: 'Node busy or live input — HTTP is down while lighting is present (~2 s after silence it returns).'
});

const mapNodeError = (json, statusCode) => {
    const code = json && json.error;
    if (code === 'live' || statusCode === 503) {
        return busyError();
    }
    if (code === 'no sd') {
        return { success: false, error: 'No SD card on the node.' };
    }
    if (code === 'busy') {
        return { success: false, error: 'Node SD is busy.' };
    }
    if (code) {
        return { success: false, error: String(code) };
    }
    return { success: false, error: `HTTP ${statusCode}` };
};

const requestJson = (method, ip, requestPath, { body, contentType, timeoutMs = 1500 } = {}) => {
    return new Promise((resolve, reject) => {
        const payload = body ? Buffer.from(String(body)) : null;
        const headers = {};
        if (payload) {
            headers['Content-Type'] = contentType || 'application/x-www-form-urlencoded';
            headers['Content-Length'] = payload.length;
        }
        const req = http.request({
            host: ip,
            port: 80,
            path: requestPath,
            method,
            timeout: timeoutMs,
            headers
        }, (res) => {
            const chunks = [];
            res.on('data', (chunk) => {
                chunks.push(chunk);
            });
            res.on('end', () => {
                const data = Buffer.concat(chunks).toString('utf8');
                if (!data) {
                    resolve({ statusCode: res.statusCode, json: {} });
                    return;
                }
                try {
                    resolve({
                        statusCode: res.statusCode,
                        json: JSON.parse(data)
                    });
                } catch (err) {
                    reject(new Error('Invalid JSON from node'));
                }
            });
        });
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('timeout'));
        });
        req.on('error', reject);
        if (payload) {
            req.write(payload);
        }
        req.end();
    });
};

const formBody = (fields = {}) => Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null)
    .flatMap(([key, value]) => {
        if (Array.isArray(value)) {
            return value.map((item) => `${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`);
        }
        return [`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`];
    })
    .join('&');

// idempotent: false (POSTs) moves to the next host only when the first
// could not even connect, so a slow node never runs a command twice.
const withHosts = async (ip, run, { idempotent = true } = {}) => {
    if (!isIpv4(ip)) {
        return { success: false, error: 'Invalid device IP' };
    }
    let lastError = null;
    for (const host of hostsFor(ip)) {
        try {
            const result = await run(host);
            if (result) {
                return result;
            }
        } catch (err) {
            lastError = err;
            if (!idempotent && !isImmediateConnectFail(err)) {
                break;
            }
        }
    }
    if (lastError && lastError.message === 'Invalid JSON from node') {
        return { success: false, error: lastError.message };
    }
    if (lastError && /HTTP|Invalid|Scan|password|ssid|bad /.test(lastError.message)) {
        return { success: false, error: lastError.message };
    }
    return busyError();
};

const fetchStatus = async (ip) => withHosts(ip, async (host) => {
    const result = await requestJson('GET', host, '/status');
    if (result.statusCode >= 200 && result.statusCode < 300 && result.json) {
        return { success: true, status: result.json, via: host };
    }
    if (result.statusCode === 503) {
        return busyError();
    }
    throw new Error((result.json && result.json.error) || `HTTP ${result.statusCode}`);
});

const postForm = async (ip, requestPath, fields, timeoutMs = 2500) => withHosts(ip, async (host) => {
    const result = await requestJson('POST', host, requestPath, {
        body: formBody(fields),
        timeoutMs
    });
    if (result.statusCode === 503 || (result.json && result.json.error === 'live')) {
        return busyError();
    }
    if (result.statusCode >= 200 && result.statusCode < 300) {
        return { success: true, status: result.json, result: result.json, via: host };
    }
    return mapNodeError(result.json, result.statusCode);
}, { idempotent: false });

const postIdentify = async (ip, ms = 3000) => {
    const duration = Number(ms);
    return postForm(ip, '/identify', {
        ms: Number.isFinite(duration) ? Math.max(200, Math.min(15000, duration)) : 3000
    });
};

const postReboot = async (ip) => postForm(ip, '/reboot', {});

const sidecarPath = (dmxPath) => {
    const parsed = path.parse(dmxPath);
    return path.join(parsed.dir, `${parsed.name}.json`);
};

const readLocalTitle = (dmxPath) => {
    try {
        const raw = fs.readFileSync(sidecarPath(dmxPath), 'utf8');
        const parsed = JSON.parse(raw);
        const name = parsed && typeof parsed.name === 'string' ? parsed.name.trim() : '';
        return name;
    } catch (err) {
        return '';
    }
};

const destUploadPath = (filePath) => {
    const trimmed = String(path.parse(filePath).name || '').trim().replace(/\.dmx$/i, '');
    const base = trimmed.replace(INVALID_NAME, '').replace(/[. ]+$/g, '') || 'show';
    let dest = `/${base}.dmx`;
    if (dest.length > SD_PATH_MAX) {
        dest = `/${base.slice(0, SD_PATH_MAX - 5)}.dmx`;
    }
    return dest;
};

const isValidDestPath = (dest) => {
    if (typeof dest !== 'string' || dest[0] !== '/' || dest.includes('..')) {
        return false;
    }
    if (!/\.dmx$/i.test(dest) || dest.endsWith('/')) {
        return false;
    }
    if (dest.length < 6 || dest.length > SD_PATH_MAX) {
        return false;
    }
    const parts = dest.slice(1).split('/');
    return parts.length > 0 && parts.every((part) => part && !INVALID_SEG.test(part));
};

const UPLOAD_IDLE_MS = 60000;
const UPLOAD_MIN_BUDGET_MS = 10 * 60 * 1000;

const uploadBudgetMs = (size) => Math.max(
    UPLOAD_MIN_BUDGET_MS,
    Math.ceil(Math.max(0, size) / 8192) * 1000
);

const formatUploadBytes = (bytes) => {
    const value = Number(bytes) || 0;
    if (value < 1024) {
        return `${value} B`;
    }
    if (value < 1024 * 1024) {
        return `${(value / 1024).toFixed(1)} KB`;
    }
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

const formatUploadElapsed = (ms) => {
    const total = Math.max(0, Math.round(Number(ms) / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const uploadFail = (err, sent, total) => {
    const msg = err && err.message ? String(err.message) : 'Upload failed';
    if (/timed out/i.test(msg) || msg === 'timeout') {
        return {
            success: false,
            error: /sent /.test(msg)
                ? msg
                : `Upload timed out — sent ${formatUploadBytes(sent)} of ${formatUploadBytes(total)}`
        };
    }
    if (isImmediateConnectFail(err)) {
        return { success: false, error: `Could not reach the node (${msg})` };
    }
    return { success: false, error: msg };
};

// Stream one file as multipart/form-data (text fields first, then the file
// part) with byte progress through emit({ phase, sent, total }). Resolves
// { statusCode, json, sent, total }; rejects on network errors or timeouts.
const sendMultipart = (host, {
    urlPath,
    filePath,
    size,
    fields = {},
    fileField = 'file',
    fileName,
    startedAt = Date.now(),
    emit = () => {}
}) => new Promise((resolve, reject) => {
    const boundary = `----whip${Date.now().toString(16)}`;
    const parts = Object.keys(fields).map((name) => (
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
        `${fields[name]}\r\n`
    )).join('');
    const header = Buffer.from(
        parts +
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${fileField}"; filename="${fileName || path.basename(filePath)}"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const total = header.length + size + footer.length;
    let sent = 0;
    let settled = false;
    const budgetMs = uploadBudgetMs(size);

    const finish = (fn) => {
        if (settled) {
            return;
        }
        settled = true;
        clearTimeout(budgetTimer);
        fn();
    };

    const timeoutError = () => new Error(
        `Upload timed out after ${formatUploadElapsed(Date.now() - startedAt)} — sent ${formatUploadBytes(sent)} of ${formatUploadBytes(total)}`
    );

    const bumpIdle = () => {
        if (req.socket) {
            req.socket.setTimeout(UPLOAD_IDLE_MS);
        } else {
            req.setTimeout(UPLOAD_IDLE_MS);
        }
    };

    emit({ phase: 'connecting', sent: 0, total });

    const req = http.request({
        host,
        port: 80,
        path: urlPath,
        method: 'POST',
        headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': total
        }
    }, (res) => {
        bumpIdle();
        let data = '';
        res.on('data', (chunk) => {
            bumpIdle();
            data += chunk;
        });
        res.on('end', () => {
            let json = {};
            if (data) {
                try {
                    json = JSON.parse(data);
                } catch (err) {
                    finish(() => reject(new Error('Invalid JSON from node')));
                    return;
                }
            }
            finish(() => resolve({ statusCode: res.statusCode, json, sent, total }));
        });
    });

    let stream = null;
    const abort = () => {
        if (stream) {
            stream.destroy();
        }
        req.destroy();
    };

    const budgetTimer = setTimeout(() => {
        abort();
        finish(() => reject(timeoutError()));
    }, budgetMs);

    req.setTimeout(UPLOAD_IDLE_MS);
    req.on('socket', (socket) => {
        socket.setTimeout(UPLOAD_IDLE_MS);
    });
    req.on('timeout', () => {
        abort();
        finish(() => reject(timeoutError()));
    });
    req.on('error', (err) => {
        if (stream) {
            stream.destroy();
        }
        finish(() => reject(err));
    });

    req.write(header);
    sent = header.length;
    emit({ phase: 'sending', sent, total });
    bumpIdle();

    stream = fs.createReadStream(filePath);
    stream.on('error', (err) => {
        req.destroy();
        finish(() => reject(err));
    });
    stream.on('data', (chunk) => {
        sent += chunk.length;
        emit({ phase: 'sending', sent, total });
        bumpIdle();
        if (!req.write(chunk)) {
            stream.pause();
            req.once('drain', () => {
                bumpIdle();
                stream.resume();
            });
        }
    });
    stream.on('end', () => {
        req.end(footer);
        sent = total;
        emit({ phase: 'waiting', sent, total });
        bumpIdle();
    });
});

const postUpload = (ip, filePath, onProgress, destPathArg, extraMeta = {}) => {
    if (!isIpv4(ip)) {
        return Promise.resolve({ success: false, error: 'Invalid device IP' });
    }
    if (!filePath || !/\.dmx$/i.test(filePath)) {
        return Promise.resolve({ success: false, error: 'Only .dmx files can be pushed' });
    }
    if (!fs.existsSync(filePath)) {
        return Promise.resolve({ success: false, error: 'File not found' });
    }
    if (destPathArg && !isValidDestPath(destPathArg)) {
        return Promise.resolve({ success: false, error: 'Invalid SD dest path' });
    }

    const destPath = destPathArg && isValidDestPath(destPathArg)
        ? destPathArg
        : destUploadPath(filePath);
    const stat = fs.statSync(filePath);
    const startedAt = Date.now();
    let lastPhase = '';
    let lastEmit = 0;
    let lastSent = 0;
    let lastTotal = stat.size;

    const emit = (payload) => {
        if (payload.sent != null) {
            lastSent = payload.sent;
        }
        if (payload.total != null) {
            lastTotal = payload.total;
        }
        if (typeof onProgress !== 'function') {
            return;
        }
        const now = Date.now();
        if (payload.phase === lastPhase && payload.phase === 'sending' && now - lastEmit < 100) {
            return;
        }
        lastPhase = payload.phase;
        lastEmit = now;
        onProgress({
            dest: destPath,
            startedAt,
            ...payload
        });
    };

    const sendTo = (host) => sendMultipart(host, {
        urlPath: `/upload?path=${encodeURIComponent(destPath)}`,
        filePath,
        size: stat.size,
        fields: { path: destPath },
        fileField: 'file',
        fileName: path.basename(destPath),
        startedAt,
        emit
    });

    const mapResult = (result) => {
        if (result.statusCode === 503 || (result.json && result.json.error === 'live')) {
            emit({ phase: 'error', sent: result.sent || 0, total: result.total || 0 });
            return busyError();
        }
        if (result.statusCode >= 200 && result.statusCode < 300) {
            emit({ phase: 'done', sent: result.total || result.sent || 0, total: result.total || 0 });
            return { success: true, result: result.json, via: result.via };
        }
        emit({ phase: 'error', sent: result.sent || 0, total: result.total || 0 });
        return mapNodeError(result.json, result.statusCode);
    };

    const finishUpload = async (result) => {
        const uploaded = mapResult(result);
        if (uploaded.success) {
            const dest = (uploaded.result && uploaded.result.path) || destPath;
            const name = (extraMeta && extraMeta.name)
                || readLocalTitle((extraMeta && extraMeta.titlePath) || filePath);
            const fields = { path: dest };
            if (name) {
                fields.name = name;
            }
            if (extraMeta && extraMeta.sync_group) {
                fields.sync_group = extraMeta.sync_group;
                if (extraMeta.sync_members) {
                    fields.sync_members = extraMeta.sync_members;
                }
                if (extraMeta.sync_kind) {
                    fields.sync_kind = extraMeta.sync_kind;
                }
            }
            if (extraMeta && extraMeta.meta === false) {
                return uploaded;
            }
            if (fields.name || fields.sync_group) {
                const meta = await postForm(ip, '/meta', fields);
                if (!meta || !meta.success) {
                    uploaded.metaError = (meta && meta.error) || 'Could not write the show title';
                }
            }
        }
        return uploaded;
    };

    return (async () => {
        try {
            const result = await sendTo(ip);
            result.via = ip;
            return finishUpload(result);
        } catch (err) {
            if (ip !== SOFTAP_IP && isImmediateConnectFail(err) && lastSent === 0
                && softApReachable()) {
                try {
                    const result = await sendTo(SOFTAP_IP);
                    result.via = SOFTAP_IP;
                    return finishUpload(result);
                } catch (apErr) {
                    emit({ phase: 'error', sent: lastSent, total: lastTotal });
                    return uploadFail(apErr, lastSent, lastTotal);
                }
            }
            emit({ phase: 'error', sent: lastSent, total: lastTotal });
            return uploadFail(err, lastSent, lastTotal);
        }
    })();
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const OTA_ERRORS = {
    busy: 'The node is busy (playing, live or updating others).',
    'too large': 'The image is bigger than the node\'s update slot. Flash it once over USB (Flash tab).',
    'no ota slot': 'The node\'s flash layout has no update slot. Flash it once over USB (Flash tab).',
    'other board': 'That image is for a different board.',
    'not a whip image': 'That file is not DMX whIP firmware.',
    'not firmware': 'That file is not a firmware image.',
    'verify failed': 'The image did not verify on the node. Nothing changed.'
};

const OTA_VERIFY_MS = 150000;
const OTA_POLL_MS = 3000;

// POST the image to /ota, then wait for the node to reboot and report the
// target version as its own (kept after its health check), or a rollback.
// onProgress({ phase: connecting|sending|waiting|rebooting|checking|done|error, sent, total, message }).
const postFirmware = async (ip, imagePath, onProgress, { force = false, targetVersion = '' } = {}) => {
    if (!isIpv4(ip)) {
        return { success: false, error: 'Invalid device IP' };
    }
    let size = 0;
    try {
        size = fs.statSync(imagePath).size;
    } catch (err) {
        return { success: false, error: 'Firmware image not found' };
    }
    const report = (payload) => {
        if (typeof onProgress === 'function') {
            onProgress(payload);
        }
    };
    let lastEmit = 0;
    const emit = (payload) => {
        const now = Date.now();
        if (payload.phase === 'sending' && now - lastEmit < 150) {
            return;
        }
        lastEmit = now;
        report(payload);
    };
    let result;
    try {
        result = await sendMultipart(ip, {
            urlPath: `/ota?force=${force ? 1 : 0}`,
            filePath: imagePath,
            size,
            fileField: 'firmware',
            fileName: 'firmware.bin',
            emit
        });
    } catch (err) {
        const failed = uploadFail(err, 0, size);
        report({ phase: 'error', message: failed.error });
        return failed;
    }
    if (result.statusCode < 200 || result.statusCode >= 300) {
        const code = result.json && result.json.error;
        const error = OTA_ERRORS[code] || (code ? String(code) : `HTTP ${result.statusCode}`);
        report({ phase: 'error', message: error });
        return { success: false, error, code };
    }
    report({ phase: 'rebooting', sent: result.total, total: result.total });
    const deadline = Date.now() + OTA_VERIFY_MS;
    let sawTarget = false;
    while (Date.now() < deadline) {
        await sleep(OTA_POLL_MS);
        const status = await fetchStatus(ip);
        if (!status || !status.success || !status.status) {
            continue;
        }
        const st = status.status;
        const ota = st.ota || {};
        if (targetVersion && st.ver === targetVersion) {
            sawTarget = true;
            if (!ota.pending) {
                report({ phase: 'done', message: `Updated to v${st.ver}` });
                return { success: true, version: st.ver };
            }
            report({ phase: 'checking', message: 'Checking itself' });
            continue;
        }
        if (ota.rolled_back && (sawTarget || Date.now() > deadline - OTA_VERIFY_MS + 20000)) {
            const error = `Rolled back to v${st.ver}: the new firmware did not come up healthy`;
            report({ phase: 'error', message: error });
            return { success: false, error, rolledBack: true };
        }
        if (!targetVersion && st.ver) {
            report({ phase: 'done', message: `Running v${st.ver}` });
            return { success: true, version: st.ver };
        }
    }
    const error = sawTarget
        ? 'Updated, but it stopped answering before finishing its health check'
        : 'No reply after the update; check the node';
    report({ phase: 'error', message: error });
    return { success: false, error };
};

const getJson = async (ip, requestPath, timeoutMs = 2500) => withHosts(ip, async (host) => {
    const result = await requestJson('GET', host, requestPath, { timeoutMs });
    if (result.statusCode === 503) {
        return busyError();
    }
    if (result.statusCode >= 200 && result.statusCode < 300) {
        return { success: true, result: result.json, via: host };
    }
    return mapNodeError(result.json, result.statusCode);
});

const scanWifi = async (ip) => {
    if (!isIpv4(ip)) {
        return { success: false, error: 'Invalid device IP' };
    }
    let lastError = null;
    for (const host of hostsFor(ip)) {
        try {
            const started = await requestJson('GET', host, '/scan?start=1', { timeoutMs: 2500 });
            if (started.statusCode === 503) {
                return busyError();
            }
            if (started.statusCode < 200 || started.statusCode >= 300) {
                lastError = new Error((started.json && started.json.error) || `HTTP ${started.statusCode}`);
                continue;
            }
            if (Array.isArray(started.json && started.json.networks)) {
                return {
                    success: true,
                    networks: started.json.networks,
                    state: started.json.state,
                    via: host
                };
            }
            for (let i = 0; i < 20; i += 1) {
                await sleep(400);
                const next = await requestJson('GET', host, '/scan', { timeoutMs: 2500 });
                if (next.statusCode === 503) {
                    return busyError();
                }
                if (Array.isArray(next.json && next.json.networks)) {
                    return {
                        success: true,
                        networks: next.json.networks,
                        state: next.json.state,
                        via: host
                    };
                }
            }
            return { success: false, error: 'Wi-Fi scan timed out' };
        } catch (err) {
            lastError = err;
        }
    }
    if (lastError && lastError.message === 'Invalid JSON from node') {
        return { success: false, error: lastError.message };
    }
    return busyError();
};

const downloadFile = async (ip, sdPath, destPath) => {
    if (!isIpv4(ip)) {
        return { success: false, error: 'Invalid device IP' };
    }
    if (!sdPath || !String(sdPath).startsWith('/') || !/\.dmx$/i.test(sdPath)) {
        return { success: false, error: 'Select a .dmx on the node SD' };
    }
    const query = `/file?path=${encodeURIComponent(sdPath)}`;
    let lastError = null;
    for (const host of hostsFor(ip)) {
        try {
            const result = await new Promise((resolve, reject) => {
                const req = http.request({
                    host,
                    port: 80,
                    path: query,
                    method: 'GET',
                    timeout: 120000
                }, (res) => {
                    if (res.statusCode === 503) {
                        res.resume();
                        resolve(busyError());
                        return;
                    }
                    if (res.statusCode < 200 || res.statusCode >= 300) {
                        let data = '';
                        res.on('data', (chunk) => {
                            data += chunk;
                        });
                        res.on('end', () => {
                            let json = {};
                            if (data) {
                                try {
                                    json = JSON.parse(data);
                                } catch (err) {
                                    json = {};
                                }
                            }
                            resolve(mapNodeError(json, res.statusCode));
                        });
                        return;
                    }
                    const out = fs.createWriteStream(destPath);
                    res.pipe(out);
                    out.on('finish', () => resolve({ success: true, filePath: destPath, via: host }));
                    out.on('error', reject);
                    res.on('error', reject);
                });
                req.on('timeout', () => {
                    req.destroy();
                    reject(new Error('timeout'));
                });
                req.on('error', reject);
                req.end();
            });
            if (result) {
                return result;
            }
        } catch (err) {
            lastError = err;
            try {
                if (fs.existsSync(destPath)) {
                    fs.unlinkSync(destPath);
                }
            } catch (cleanupErr) {
                // leave a partial file rather than mask the download error
            }
        }
    }
    if (lastError && lastError.message === 'Invalid JSON from node') {
        return { success: false, error: lastError.message };
    }
    return busyError();
};

// Sidecar title and sync group for a show already on the node's SD.
const postMeta = async (ip, fields) => postForm(ip, '/meta', fields);

module.exports = {
    SOFTAP_IP,
    isIpv4,
    destUploadPath,
    downloadFile,
    fetchStatus,
    getJson,
    postForm,
    postFirmware,
    postIdentify,
    postMeta,
    postReboot,
    postUpload,
    scanWifi
};
