// 2: cue bus v3 (shared clock, launch from any node). Older nodes still
// answer HTTP but cannot join synced groups.
const MIN_FIRMWARE_API = 2;
// 3: POST /ota (over-the-air updates).
const OTA_MIN_API = 3;

// Every firmware image carries WHIPFW:<board>:<version>:<api>; (ota.cpp).
const FW_TAG = /WHIPFW:([A-Za-z0-9._-]+):([A-Za-z0-9._-]+):([0-9]+);/;

const statusApi = (status) => {
    if (!status || status.api == null || status.api === '') {
        return 0;
    }
    const n = Number(status.api);
    return Number.isFinite(n) ? n : 0;
};

const apiTooOld = (status) => statusApi(status) < MIN_FIRMWARE_API;

// Board, version and API of a firmware image (Buffer / Uint8Array / string).
const parseFwTag = (image) => {
    let text = '';
    if (typeof image === 'string') {
        text = image;
    } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(image)) {
        text = image.toString('latin1');
    } else if (image && image.length != null) {
        text = Buffer.from(image).toString('latin1');
    }
    const m = FW_TAG.exec(text);
    return m ? { board: m[1], version: m[2], api: Number(m[3]) } : null;
};

// Numeric compare of dotted versions (major.minor.patch): <0 when a is older.
const compareVersions = (a, b) => {
    const parts = (v) => String(v || '').split('.').slice(0, 3).map((p) => parseInt(p, 10) || 0);
    const x = parts(a);
    const y = parts(b);
    for (let i = 0; i < 3; i += 1) {
        const d = (x[i] || 0) - (y[i] || 0);
        if (d !== 0) {
            return d < 0 ? -1 : 1;
        }
    }
    return 0;
};

// What an over-the-air update would do for one node.
// status: its /status (or null), image: { board, version, size } for its board.
// verdict: update | current | busy | needs-usb | no-image | unknown.
const otaVerdict = (status, image, { includeBusy = false } = {}) => {
    if (!status) {
        return { verdict: 'unknown', label: 'No reply' };
    }
    const ota = status.ota || null;
    const busy = Boolean(ota && ota.busy);
    if (!image || (status.board && image.board !== status.board)) {
        return { verdict: 'no-image', label: 'No image for this board', busy };
    }
    const target = image.version;
    if (compareVersions(status.ver, target) >= 0) {
        return { verdict: 'current', label: 'Current', target, busy };
    }
    if (statusApi(status) < OTA_MIN_API || !ota) {
        return { verdict: 'needs-usb', label: 'Needs one USB flash', target, busy };
    }
    if (ota.max && image.size > ota.max) {
        return { verdict: 'needs-usb', label: 'Flash layout too small: one USB flash', target, busy };
    }
    if (ota.pending) {
        return { verdict: 'busy', label: 'Finishing its last update', target, busy };
    }
    if (busy && !includeBusy) {
        return { verdict: 'busy', label: 'Busy (playing or live)', target, busy };
    }
    return { verdict: 'update', label: `Update to v${target}`, target, busy };
};

module.exports = {
    MIN_FIRMWARE_API,
    OTA_MIN_API,
    statusApi,
    apiTooOld,
    parseFwTag,
    compareVersions,
    otaVerdict
};
