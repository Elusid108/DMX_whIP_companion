const { ipcMain } = require('electron');
const { loadSettings, saveSettings } = require('../settings');
const { getLiveOutput } = require('../liveOutput');

// Live tab: levels in, layout saved, output adapter shared with playback.
function setupLiveHandlers() {
    const live = getLiveOutput();
    const settings = loadSettings();
    live.configure({ nic: settings.outputNic, dest: settings.live.dest });

    const onSet = (event, changes) => {
        live.set(changes);
    };
    ipcMain.on('live-set', onSet);

    ipcMain.handle('live-release-all', () => {
        live.releaseAll();
        return { success: true };
    });

    ipcMain.handle('live-get', () => {
        const s = loadSettings();
        return { success: true, live: s.live, outputNic: s.outputNic };
    });

    // patch: any of { faders, pads, dest, midi }; normalized by settings.js.
    ipcMain.handle('live-save', (event, patch = {}) => {
        try {
            const current = loadSettings().live;
            const next = saveSettings({ live: { ...current, ...(patch || {}) } }).live;
            live.configure({ dest: next.dest });
            return { success: true, live: next };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('set-output-nic', (event, { nic } = {}) => {
        try {
            const saved = saveSettings({ outputNic: String(nic || '0.0.0.0') }).outputNic;
            live.configure({ nic: saved });
            return { success: true, outputNic: saved };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    return () => {
        ipcMain.removeListener('live-set', onSet);
        ipcMain.removeHandler('live-release-all');
        ipcMain.removeHandler('live-get');
        ipcMain.removeHandler('live-save');
        ipcMain.removeHandler('set-output-nic');
        live.shutdown();
    };
}

module.exports = setupLiveHandlers;
