// Companion settings: the engine's settings store placed under Electron's
// userData, with the default library under Documents. Same exports as
// before so every main-process caller is unchanged.
const { app } = require('electron');
const path = require('path');
const { createSettingsStore } = require('../engine/settingsStore');

const defaultLibraryDir = () => path.join(app.getPath('documents'), 'DMX whIP', 'Shows');

let store = null;
const getStore = () => {
    if (!store) {
        store = createSettingsStore({
            filePath: path.join(app.getPath('userData'), 'settings.json'),
            defaultLibraryDir: defaultLibraryDir()
        });
    }
    return store;
};

const loadSettings = () => getStore().load();
const saveSettings = (patch = {}) => getStore().save(patch);
const getLibraryDir = () => getStore().getLibraryDir();

module.exports = {
    defaultLibraryDir,
    getStore,
    loadSettings,
    saveSettings,
    getLibraryDir
};
