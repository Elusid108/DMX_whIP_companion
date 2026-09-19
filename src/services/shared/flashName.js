const LONG_MAX = 63;
const SHORT_MAX = 17;

const clipName = (value, max) => String(value || '').replace(/[\x00-\x1f]/g, '').trim().slice(0, max);

const macSuffix = (mac) => {
    const hex = String(mac || '').replace(/[^0-9a-fA-F]/g, '');
    return hex.length >= 4 ? hex.slice(-4).toUpperCase() : '';
};

const normMac = (mac) => String(mac || '').toLowerCase().replace(/[^0-9a-f]/g, '');

const clampInt = (value, min, max, fallback) => {
    const n = Number(value);
    if (!Number.isFinite(n)) {
        return fallback;
    }
    return Math.max(min, Math.min(max, Math.round(n)));
};

const normalizeNameOpts = (raw = {}) => ({
    mode: raw.mode === 'seq' ? 'seq' : 'mac',
    start: clampInt(raw.start, 0, 999999, 1),
    digits: clampInt(raw.digits, 1, 6, 1)
});

const formatSeq = (start, index, digits) => String(Math.max(0, start + index)).padStart(digits, '0');

const resolveNodeName = (pattern, mac, index = 0, opts = {}) => {
    const base = clipName(pattern || 'Whip', 40) || 'Whip';
    const { mode, start, digits } = normalizeNameOpts(opts);
    const suffix = mode === 'seq'
        ? formatSeq(start, index, digits)
        : (macSuffix(mac) || formatSeq(1, index, 1));
    const long = clipName(`${base}-${suffix}`, LONG_MAX);
    return {
        long,
        short: clipName(long, SHORT_MAX)
    };
};

module.exports = {
    LONG_MAX,
    SHORT_MAX,
    clipName,
    macSuffix,
    normMac,
    normalizeNameOpts,
    resolveNodeName
};
