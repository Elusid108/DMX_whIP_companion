const { app, BrowserWindow } = require('electron');
const path = require('path');
const setupNetworkHandlers = require('./ipc/network');
const setupRecordingHandlers = require('./ipc/recording');
const setupPlaybackHandlers = require('./ipc/playback');
const { setupLibraryHandlers } = require('./ipc/library');
const setupSettingsHandlers = require('./ipc/settings');
const setupFirmwareFlashHandlers = require('./firmwareFlash');

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;

const isAllowedPortalUrl = (href) => {
    try {
        const url = new URL(href);
        if (url.protocol !== 'http:') {
            return false;
        }
        if (url.username || url.password) {
            return false;
        }
        if (url.port && url.port !== '80') {
            return false;
        }
        const host = url.hostname;
        if (!IPV4.test(host)) {
            return false;
        }
        return host.split('.').every((part) => {
            const n = Number(part);
            return Number.isInteger(n) && n >= 0 && n <= 255;
        });
    } catch (err) {
        return false;
    }
};

let mainWindow = null;

app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') {
        return;
    }
    contents.on('will-navigate', (event, url) => {
        if (!isAllowedPortalUrl(url)) {
            event.preventDefault();
        }
    });
    contents.on('will-redirect', (event, url) => {
        if (!isAllowedPortalUrl(url)) {
            event.preventDefault();
        }
    });
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        title: 'DMX whIP Companion',
        webPreferences: {
            preload: path.join(__dirname, '../preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: true,
            webviewTag: true
        }
    });

    mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
        webPreferences.nodeIntegration = false;
        webPreferences.contextIsolation = true;
        webPreferences.sandbox = true;
        if (!isAllowedPortalUrl(params.src)) {
            event.preventDefault();
        }
    });

    mainWindow.on('page-title-updated', (event) => {
        event.preventDefault();
    });

    const recordingHandler = setupRecordingHandlers(mainWindow);
    const cleanupNetwork = setupNetworkHandlers(mainWindow, recordingHandler);
    setupPlaybackHandlers(mainWindow);
    const cleanupLibrary = setupLibraryHandlers(mainWindow, recordingHandler);
    const cleanupSettings = setupSettingsHandlers();
    const cleanupFlash = setupFirmwareFlashHandlers(mainWindow);

    mainWindow.on('closed', () => {
        if (cleanupNetwork) cleanupNetwork();
        if (cleanupLibrary) cleanupLibrary();
        if (cleanupSettings) cleanupSettings();
        if (cleanupFlash) cleanupFlash();
        if (recordingHandler && recordingHandler.close) recordingHandler.close();
        mainWindow = null;
    });

    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
        .catch(err => console.error('Error loading index.html:', err));

    if (process.env.DEBUG) {
        mainWindow.webContents.openDevTools();
    }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// Error handling
process.on('uncaughtException', async (error) => {
    console.error('Uncaught exception:', error);
    console.error('Stack trace:', error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled rejection at:', promise, 'reason:', reason);
});
