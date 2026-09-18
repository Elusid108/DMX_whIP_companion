const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

const defaultLibraryDir = () => path.join(app.getPath('documents'), 'DMX whIP', 'Shows');

const defaultSdPins = { cs: 7, mosi: 6, clk: 5, miso: 4 };

const pinOrDefault = (value, fallback) => {
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 && n <= 48 ? n : fallback;
};

const normalizeSdPins = (raw = {}) => ({
    cs: pinOrDefault(raw.cs, defaultSdPins.cs),
    mosi: pinOrDefault(raw.mosi, defaultSdPins.mosi),
    clk: pinOrDefault(raw.clk, defaultSdPins.clk),
    miso: pinOrDefault(raw.miso, defaultSdPins.miso)
});

let cache = null;

const normalize = (raw = {}) => ({
    libraryDir: typeof raw.libraryDir === 'string' && raw.libraryDir.trim()
        ? raw.libraryDir.trim()
        : defaultLibraryDir(),
    theme: raw.theme === 'light' ? 'light' : 'dark',
    flashPort: typeof raw.flashPort === 'string' ? raw.flashPort : '',
    flashBoardId: typeof raw.flashBoardId === 'string' && raw.flashBoardId.trim()
        ? raw.flashBoardId.trim()
        : 'waveshare-s3-matrix',
    flashSdPins: normalizeSdPins(raw.flashSdPins)
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
