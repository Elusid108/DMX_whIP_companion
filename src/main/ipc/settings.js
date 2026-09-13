const { ipcMain } = require('electron');
const { loadSettings, saveSettings } = require('../settings');

function setupSettingsHandlers() {
    ipcMain.handle('get-settings', async () => {
        try {
            return { success: true, settings: loadSettings() };
        } catch (error) {
            return { success: false, error: error.message, settings: loadSettings() };
        }
    });

    ipcMain.handle('set-theme', async (event, { theme } = {}) => {
        try {
            const settings = saveSettings({ theme: theme === 'light' ? 'light' : 'dark' });
            return { success: true, settings };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    return () => {
        ipcMain.removeHandler('get-settings');
        ipcMain.removeHandler('set-theme');
    };
}

module.exports = setupSettingsHandlers;
