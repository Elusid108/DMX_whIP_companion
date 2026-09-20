const fs = require('fs');
const http = require('http');
const path = require('path');

const SOFTAP_IP = '4.3.2.1';
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const SD_PATH_MAX = 63;
const INVALID_NAME = /[<>:"/\\|?*\x00-\x1f]/g;
const INVALID_SEG = /[<>:"/\\|?*\x00-\x1f]/;

const isIpv4 = (ip) => typeof ip === 'string' && IPV4.test(ip.trim());

const hostsFor = (ip) => (ip === SOFTAP_IP ? [SOFTAP_IP] : [ip, SOFTAP_IP]);

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
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
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

const withHosts = async (ip, run) => {
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
});

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

const isImmediateConnectFail = (err) => {
    const code = err && err.code;
    const msg = String((err && err.message) || '');
    return code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EHOSTUNREACH'
        || /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH/.test(msg);
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

const postUpload = (ip, filePath, onProgress, destPathArg) => {
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

    const sendTo = (host) => new Promise((resolve, reject) => {
        const boundary = `----whip${Date.now().toString(16)}`;
        const header = Buffer.from(
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="path"\r\n\r\n` +
            `${destPath}\r\n` +
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="file"; filename="${path.basename(destPath)}"\r\n` +
            `Content-Type: application/octet-stream\r\n\r\n`
        );
        const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
        const total = header.length + stat.size + footer.length;
        let sent = 0;
        let settled = false;
        const budgetMs = uploadBudgetMs(stat.size);

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
            path: `/upload?path=${encodeURIComponent(destPath)}`,
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

        const budgetTimer = setTimeout(() => {
            req.destroy();
            finish(() => reject(timeoutError()));
        }, budgetMs);

        req.setTimeout(UPLOAD_IDLE_MS);
        req.on('socket', (socket) => {
            socket.setTimeout(UPLOAD_IDLE_MS);
        });
        req.on('timeout', () => {
            req.destroy();
            finish(() => reject(timeoutError()));
        });
        req.on('error', (err) => {
            finish(() => reject(err));
        });

        req.write(header);
        sent = header.length;
        emit({ phase: 'sending', sent, total });
        bumpIdle();

        const stream = fs.createReadStream(filePath);
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
            const name = readLocalTitle(filePath);
            if (name) {
                await postForm(ip, '/meta', { path: dest, name });
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
            if (ip !== SOFTAP_IP && isImmediateConnectFail(err) && lastSent === 0) {
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

module.exports = {
    SOFTAP_IP,
    isIpv4,
    destUploadPath,
    downloadFile,
    fetchStatus,
    getJson,
    postForm,
    postIdentify,
    postReboot,
    postUpload,
    scanWifi
};
