const { execFile } = require('child_process');

const execText = (file, args, timeoutMs = 8000) => new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => {
        if (err) {
            resolve('');
            return;
        }
        resolve(String(stdout || ''));
    });
});

const bandFromText = (block) => {
    const band = /Band\s*:\s*(2\.4|5|6)\s*GHz/i.exec(block);
    if (band) {
        return `${band[1]} GHz`;
    }
    const radio = /Radio type\s*:\s*(.+)/i.exec(block);
    const kind = radio ? radio[1].trim().toLowerCase() : '';
    if (/802\.11(a|ac|ax).*5|5\s*ghz/.test(kind) || /\bac\b/.test(kind)) {
        return '5 GHz';
    }
    if (/802\.11(b|g)/.test(kind)) {
        return '2.4 GHz';
    }
    return '';
};

const is24 = (band) => band.startsWith('2.4');

const parseInterfaces = (text) => {
    const blocks = String(text || '').split(/\r?\n\s*\r?\n/);
    for (const block of blocks) {
        const ssid = /^\s*SSID\s*:\s*(.+)$/im.exec(block);
        if (!ssid || !ssid[1].trim() || ssid[1].trim() === '') {
            continue;
        }
        const name = ssid[1].trim();
        if (name === '' || /^not connected$/i.test(name)) {
            continue;
        }
        const band = bandFromText(block);
        return { ssid: name, band, is24ghz: band ? is24(band) : true };
    }
    return null;
};

const parseNetworks = (text) => {
    const bySsid = new Map();
    const chunks = String(text || '').split(/\r?\n(?=SSID\s+\d+\s*:)/);
    for (const chunk of chunks) {
        const ssidMatch = /SSID\s+\d+\s*:\s*(.*)$/m.exec(chunk);
        if (!ssidMatch) {
            continue;
        }
        const ssid = ssidMatch[1].trim();
        if (!ssid) {
            continue;
        }
        const auth = /Authentication\s*:\s*(.+)/i.exec(chunk);
        const band = bandFromText(chunk);
        const is24ghz = band ? is24(band) : true;
        const secure = auth ? !/open/i.test(auth[1]) : true;
        const key = ssid.toLowerCase();
        const existing = bySsid.get(key);
        if (!existing) {
            bySsid.set(key, { ssid, band, is24ghz, secure });
            continue;
        }
        if (is24ghz) {
            existing.is24ghz = true;
            existing.band = existing.band && existing.band !== band ? '2.4 / 5 GHz' : (band || existing.band);
        } else if (!existing.is24ghz && band) {
            existing.band = band;
        }
        if (!secure) {
            existing.secure = false;
        }
    }
    return Array.from(bySsid.values());
};

const readWlan = async () => {
    if (process.platform !== 'win32') {
        return { success: true, current: null, networks: [] };
    }
    const [ifaceText, netText] = await Promise.all([
        execText('netsh', ['wlan', 'show', 'interfaces']),
        execText('netsh', ['wlan', 'show', 'networks', 'mode=bssid'])
    ]);
    return {
        success: true,
        current: parseInterfaces(ifaceText),
        networks: parseNetworks(netText)
    };
};

module.exports = {
    readWlan,
    parseInterfaces,
    parseNetworks
};
