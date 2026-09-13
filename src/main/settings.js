const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

const defaultLibraryDir = () => path.join(app.getPath('documents'), 'DMX whIP', 'Shows');

let cache = null;

const normalize = (raw = {}) => ({
    libraryDir: typeof raw.libraryDir === 'string' && raw.libraryDir.trim()
        ? raw.libraryDir.trim()
        : defaultLibraryDir(),
    theme: raw.theme === 'light' ? 'light' : 'dark'
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
