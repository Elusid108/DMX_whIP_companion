const LONG_MAX = 63;
const SHORT_MAX = 17;

const clipName = (value, max) => String(value || '').replace(/[\x00-\x1f]/g, '').trim().slice(0, max);

const macSuffix = (mac) => {
    const hex = String(mac || '').replace(/[^0-9a-fA-F]/g, '');
    return hex.length >= 4 ? hex.slice(-4).toUpperCase() : '';
};

const normMac = (mac) => String(mac || '').toLowerCase().replace(/[^0-9a-f]/g, '');

const resolveNodeName = (pattern, mac, index = 0) => {
    const base = clipName(pattern || 'Whip', 40) || 'Whip';
    const suffix = macSuffix(mac);
    const long = clipName(suffix ? `${base}-${suffix}` : `${base}-${index + 1}`, LONG_MAX);
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
    resolveNodeName
};
