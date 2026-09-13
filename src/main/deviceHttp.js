const http = require('http');

const SOFTAP_IP = '4.3.2.1';
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;

const isIpv4 = (ip) => typeof ip === 'string' && IPV4.test(ip.trim());

const requestJson = (method, ip, path, { body, timeoutMs = 1500 } = {}) => {
    return new Promise((resolve, reject) => {
        const req = http.request({
            host: ip,
            port: 80,
            path,
            method,
            timeout: timeoutMs
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
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
        if (body) {
            req.setHeader('Content-Type', 'application/x-www-form-urlencoded');
            req.write(body);
        }
        req.end();
    });
};

const busyError = () => ({
    success: false,
    error: 'Node busy or live input — HTTP is down while lighting is present (~2 s after silence it returns).'
});

const fetchStatus = async (ip) => {
    if (!isIpv4(ip)) {
        return { success: false, error: 'Invalid device IP' };
    }
    const hosts = ip === SOFTAP_IP ? [SOFTAP_IP] : [ip, SOFTAP_IP];
    let lastError = null;
    for (const host of hosts) {
        try {
            const result = await requestJson('GET', host, '/status');
            if (result.statusCode >= 200 && result.statusCode < 300 && result.json) {
                return { success: true, status: result.json, via: host };
            }
            lastError = new Error(`HTTP ${result.statusCode}`);
        } catch (err) {
            lastError = err;
        }
    }
    if (lastError && lastError.message === 'Invalid JSON from node') {
        return { success: false, error: lastError.message };
    }
    return busyError();
};

const postIdentify = async (ip, ms = 3000) => {
    if (!isIpv4(ip)) {
        return { success: false, error: 'Invalid device IP' };
    }
    const duration = Number(ms);
    const body = `ms=${Number.isFinite(duration) ? Math.max(200, Math.min(15000, duration)) : 3000}`;
    const hosts = ip === SOFTAP_IP ? [SOFTAP_IP] : [ip, SOFTAP_IP];
    let lastError = null;
    for (const host of hosts) {
        try {
            const result = await requestJson('POST', host, '/identify', { body });
            if (result.statusCode === 503) {
                return busyError();
            }
            if (result.statusCode >= 200 && result.statusCode < 300) {
                return { success: true, result: result.json, via: host };
            }
            lastError = new Error((result.json && result.json.error) || `HTTP ${result.statusCode}`);
        } catch (err) {
            lastError = err;
        }
    }
    if (lastError && /HTTP|Invalid/.test(lastError.message)) {
        return { success: false, error: lastError.message };
    }
    return busyError();
};

module.exports = {
    SOFTAP_IP,
    fetchStatus,
    postIdentify
};
