const { BrowserWindow, ipcMain, shell } = require('electron');
const { loadSettings, saveSettings } = require('../settings');

const ALLOWED_EXTERNAL = new Set([
    'https://chrismoore.me',
    'https://chrismoore.me/',
    'https://www.chrismoore.me',
    'https://www.chrismoore.me/'
]);

const UI_SECTIONS = new Set(['monitor']);

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
            const win = BrowserWindow.fromWebContents(event.sender);
            if (win) {
                win.setBackgroundColor(settings.theme === 'light' ? '#f4f4f5' : '#09090b');
            }
            return { success: true, settings };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // View preferences the renderer owns (merged into one settings section).
    ipcMain.handle('set-ui-settings', async (event, { section, patch } = {}) => {
        if (!UI_SECTIONS.has(section) || !patch || typeof patch !== 'object') {
            return { success: false, error: 'Unknown settings section' };
        }
        try {
            const current = loadSettings()[section] || {};
            const settings = saveSettings({ [section]: { ...current, ...patch } });
            return { success: true, value: settings[section] };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('open-external-url', async (event, { url } = {}) => {
        const href = String(url || '').trim();
        if (!ALLOWED_EXTERNAL.has(href)) {
            return { success: false, error: 'URL is not allowed' };
        }
        try {
            await shell.openExternal(href);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    return () => {
        ipcMain.removeHandler('get-settings');
        ipcMain.removeHandler('set-theme');
        ipcMain.removeHandler('set-ui-settings');
        ipcMain.removeHandler('open-external-url');
    };
}

module.exports = setupSettingsHandlers;
