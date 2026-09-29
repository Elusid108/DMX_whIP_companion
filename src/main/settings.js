const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { normalizePixels } = require('../services/shared/pixelMap');
const { normalizeLive } = require('../services/shared/liveControl');

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

const defaultLibraryDir = () => path.join(app.getPath('documents'), 'DMX whIP', 'Shows');

const defaultSdPins = { cs: 7, mosi: 6, clk: 5, miso: 4 };

const pinOrDefault = (value, fallback) => {
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 && n <= 48 ? n : fallback;
};

const clampInt = (value, min, max, fallback) => {
    const n = Number(value);
    if (!Number.isFinite(n)) {
        return fallback;
    }
    return Math.max(min, Math.min(max, Math.round(n)));
};

const normalizeSdPins = (raw = {}) => ({
    cs: pinOrDefault(raw.cs, defaultSdPins.cs),
    mosi: pinOrDefault(raw.mosi, defaultSdPins.mosi),
    clk: pinOrDefault(raw.clk, defaultSdPins.clk),
    miso: pinOrDefault(raw.miso, defaultSdPins.miso)
});

let cache = null;

// Last window position and size; null until the window has been moved.
const normalizeBounds = (raw) => {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const n = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);
    const bounds = { x: n(raw.x), y: n(raw.y), width: n(raw.width), height: n(raw.height) };
    if (Object.values(bounds).some((v) => v == null) || bounds.width < 360 || bounds.height < 480) {
        return null;
    }
    return { ...bounds, maximized: Boolean(raw.maximized) };
};

// Monitor view toggles. groupMode is per universe ('artnet:0' -> 'auto' |
// 'off' | '1'..'5'); only overrides are kept.
const GROUP_MODES = new Set(['off', '1', '2', '3', '4', '5']);
const normalizeMonitor = (raw) => {
    const m = raw && typeof raw === 'object' ? raw : {};
    const groupMode = {};
    if (m.groupMode && typeof m.groupMode === 'object') {
        Object.entries(m.groupMode).slice(0, 256).forEach(([key, value]) => {
            if (/^(artnet|sacn):\d{1,5}$/.test(key) && GROUP_MODES.has(String(value))) {
                groupMode[key] = String(value);
            }
        });
    }
    return {
        displayFormat: ['decimal', 'percent', 'hex'].includes(m.displayFormat) ? m.displayFormat : 'decimal',
        gridDimensions: ['auto', '8x64', '16x32', '32x16'].includes(m.gridDimensions) ? m.gridDimensions : 'auto',
        showAnimations: m.showAnimations !== false,
        showNodes: m.showNodes !== false,
        colorBars: m.colorBars !== false,
        groupMode
    };
};

const normalize = (raw = {}) => ({
    libraryDir: typeof raw.libraryDir === 'string' && raw.libraryDir.trim()
        ? raw.libraryDir.trim()
        : defaultLibraryDir(),
    theme: raw.theme === 'light' ? 'light' : 'dark',
    windowBounds: normalizeBounds(raw.windowBounds),
    flashPort: typeof raw.flashPort === 'string' ? raw.flashPort : '',
    flashBoardId: typeof raw.flashBoardId === 'string' && raw.flashBoardId.trim()
        ? raw.flashBoardId.trim()
        : '',
    flashSdPins: normalizeSdPins(raw.flashSdPins),
    flashSsid: typeof raw.flashSsid === 'string' ? raw.flashSsid : '',
    flashPassword: typeof raw.flashPassword === 'string' ? raw.flashPassword : '',
    flashNamePattern: typeof raw.flashNamePattern === 'string' && raw.flashNamePattern.trim()
        ? raw.flashNamePattern.trim()
        : 'Whip',
    flashNameMode: raw.flashNameMode === 'seq' ? 'seq' : 'mac',
    flashNameStart: clampInt(raw.flashNameStart, 0, 999999, 1),
    flashNameDigits: clampInt(raw.flashNameDigits, 1, 6, 1),
    flashPixels: normalizePixels(raw.flashPixels),
    flashShowRole: ['host', 'member'].includes(raw.flashShowRole) ? raw.flashShowRole : 'standalone',
    flashShowSsid: typeof raw.flashShowSsid === 'string' ? raw.flashShowSsid : '',
    flashShowPass: typeof raw.flashShowPass === 'string' ? raw.flashShowPass : '',
    flashShowCh: clampInt(raw.flashShowCh, 1, 13, 6),
    flashButtonPin: Number.isInteger(raw.flashButtonPin) && raw.flashButtonPin >= 0 && raw.flashButtonPin <= 48
        ? raw.flashButtonPin
        : null,
    monitor: normalizeMonitor(raw.monitor),
    // Output adapter for playback and Live (the Settings menu's Output NIC).
    outputNic: typeof raw.outputNic === 'string' && /^[\d.]{7,15}$/.test(raw.outputNic) ? raw.outputNic : '0.0.0.0',
    live: normalizeLive(raw.live),
    liveCid: typeof raw.liveCid === 'string' && /^[0-9a-f]{32}$/.test(raw.liveCid) ? raw.liveCid : ''
});

const loadSettings = () => {
    if (cache) {
        return cache;
    }
    try {
        const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
        cache = normalize(raw);
    } catch (err) {
        cache = normalize();
    }
    return cache;
};

const saveSettings = (patch = {}) => {
    cache = normalize({ ...loadSettings(), ...patch });
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), `${JSON.stringify(cache, null, 2)}\n`);
    return cache;
};

const getLibraryDir = () => loadSettings().libraryDir;

module.exports = {
    defaultLibraryDir,
    loadSettings,
    saveSettings,
    getLibraryDir
};
