const fs = require('fs');
const http = require('http');
const path = require('path');

const SOFTAP_IP = '4.3.2.1';
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const SD_PATH_MAX = 63;
const INVALID_NAME = /[<>:"/\\|?*\x00-\x1f]/g;

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

const destUploadPath = (filePath) => {
    const trimmed = String(path.parse(filePath).name || '').trim().replace(/\.dmx$/i, '');
    const base = trimmed.replace(INVALID_NAME, '').replace(/[. ]+$/g, '') || 'show';
    let dest = `/${base}.dmx`;
    if (dest.length > SD_PATH_MAX) {
        dest = `/${base.slice(0, SD_PATH_MAX - 5)}.dmx`;
    }
    return dest;
};

const postUpload = (ip, filePath) => {
    if (!isIpv4(ip)) {
        return Promise.resolve({ success: false, error: 'Invalid device IP' });
    }
    if (!filePath || !/\.dmx$/i.test(filePath)) {
        return Promise.resolve({ success: false, error: 'Only .dmx files can be pushed' });
    }
    if (!fs.existsSync(filePath)) {
        return Promise.resolve({ success: false, error: 'File not found' });
    }

    const destPath = destUploadPath(filePath);
    const stat = fs.statSync(filePath);
    const hosts = hostsFor(ip);

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
        const req = http.request({
            host,
            port: 80,
            path: `/upload?path=${encodeURIComponent(destPath)}`,
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': header.length + stat.size + footer.length
            },
            timeout: 120000
        }, (res) => {
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
                        reject(new Error('Invalid JSON from node'));
                        return;
                    }
                }
                resolve({ statusCode: res.statusCode, json });
            });
        });
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('timeout'));
        });
        req.on('error', reject);

        req.write(header);
        const stream = fs.createReadStream(filePath);
        stream.on('error', (err) => {
            req.destroy();
            reject(err);
        });
        stream.on('data', (chunk) => {
            if (!req.write(chunk)) {
                stream.pause();
                req.once('drain', () => stream.resume());
            }
        });
        stream.on('end', () => {
            req.end(footer);
        });
    });

    return (async () => {
        let lastError = null;
        for (const host of hosts) {
            try {
                const result = await sendTo(host);
                if (result.statusCode === 503 || (result.json && result.json.error === 'live')) {
                    return busyError();
                }
                if (result.statusCode >= 200 && result.statusCode < 300) {
                    return { success: true, result: result.json, via: host };
                }
                return mapNodeError(result.json, result.statusCode);
            } catch (err) {
                lastError = err;
            }
        }
        if (lastError && lastError.message === 'Invalid JSON from node') {
            return { success: false, error: lastError.message };
        }
        return busyError();
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
    postUpload,
    scanWifi
};
