// Display formatters shared by the renderer (one copy of each).

const pad2 = (value) => String(value).padStart(2, '0');

// mm:ss:hh (hundredths), the Studio / Library timecode.
const formatDuration = (ms) => {
    const value = Math.max(0, Number(ms) || 0);
    const minutes = Math.floor(value / 60000);
    const seconds = Math.floor((value % 60000) / 1000);
    const hundredths = Math.floor((value % 1000) / 10);
    return `${pad2(minutes)}:${pad2(seconds)}:${pad2(hundredths)}`;
};

// m:ss, or h:mm:ss past an hour (player queue clock).
const formatClock = (ms) => {
    const value = Math.max(0, Math.round(Number(ms) || 0));
    const totalSec = Math.floor(value / 1000);
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    if (hours > 0) {
        return `${hours}:${pad2(minutes)}:${pad2(seconds)}`;
    }
    return `${minutes}:${pad2(seconds)}`;
};

const formatBytes = (bytes) => {
    const value = Number(bytes) || 0;
    if (value < 1024) {
        return `${value} B`;
    }
    if (value < 1024 * 1024) {
        return `${(value / 1024).toFixed(1)} KB`;
    }
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDate = (ms) => (ms ? new Date(ms).toLocaleString() : '—');

const protocolName = (protocol) => (protocol === 'sacn' ? 'sACN' : 'Art-Net');

const protocolList = (protocols, separator = ', ') => {
    if (!Array.isArray(protocols) || protocols.length === 0) {
        return '—';
    }
    return protocols.map(protocolName).join(separator);
};

module.exports = {
    formatDuration,
    formatClock,
    formatBytes,
    formatDate,
    protocolName,
    protocolList
};
