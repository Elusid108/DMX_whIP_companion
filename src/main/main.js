const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

protocol.registerSchemesAsPrivileged([
    {
        scheme: 'compmedia',
        privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            stream: true,
            corsEnabled: true
        }
    }
]);
const setupNetworkHandlers = require('./ipc/network');
const setupCueBusHandlers = require('./ipc/cuebus');
const setupRecordingHandlers = require('./ipc/recording');
const setupPlaybackHandlers = require('./ipc/playback');
const { setupLibraryHandlers } = require('./ipc/library');
const setupSettingsHandlers = require('./ipc/settings');
const setupFirmwareFlashHandlers = require('./firmwareFlash');
const { stopFileTasks } = require('./fileTasks');

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

    // The app page holds the full window.dmx bridge (flash, delete, reboot):
    // it never navigates away or opens windows.
    mainWindow.webContents.on('will-navigate', (event, url) => {
        if (url !== mainWindow.webContents.getURL()) {
            event.preventDefault();
        }
    });
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    const recordingHandler = setupRecordingHandlers(mainWindow);
    const cleanupNetwork = setupNetworkHandlers(mainWindow, recordingHandler);
    const cleanupCueBus = setupCueBusHandlers(mainWindow);
    const playback = setupPlaybackHandlers(mainWindow, recordingHandler);
    protocol.handle('compmedia', (request) => {
        try {
            const parsed = new URL(request.url);
            const id = decodeURIComponent((parsed.hostname || parsed.pathname || '').replace(/\//g, ''));
            const filePath = playback && playback.resolveAudioPath ? playback.resolveAudioPath(id) : null;
            if (!filePath || !fs.existsSync(filePath)) {
                return new Response('Not found', { status: 404 });
            }
            return net.fetch(pathToFileURL(filePath).href);
        } catch (err) {
            return new Response('Bad request', { status: 400 });
        }
    });
    const cleanupLibrary = setupLibraryHandlers(mainWindow, recordingHandler);
    const cleanupSettings = setupSettingsHandlers();
    const cleanupFlash = setupFirmwareFlashHandlers(mainWindow);

    mainWindow.on('closed', () => {
        protocol.unhandle('compmedia');
        if (playback && playback.close) playback.close();
        if (cleanupNetwork) cleanupNetwork();
        if (cleanupCueBus) cleanupCueBus();
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

app.on('will-quit', () => {
    stopFileTasks();
});

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
