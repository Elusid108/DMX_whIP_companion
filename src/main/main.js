const { app, BrowserWindow, protocol, net, screen } = require('electron');
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
const setupStudioDialogHandlers = require('./ipc/studioDialogs');
const { setupLibraryHandlers } = require('./ipc/library');
const setupSettingsHandlers = require('./ipc/settings');
const setupFirmwareFlashHandlers = require('./firmwareFlash');
const { stopFileTasks } = require('../adapters/node/workers');
const { loadSettings, saveSettings } = require('./settings');
const { createEngineHost, shutdownEngine } = require('./engineHost');

// Saved bounds only if they still land on a connected display.
const restoredBounds = () => {
    let saved = null;
    try {
        saved = loadSettings().windowBounds;
    } catch (err) {
        saved = null;
    }
    if (!saved) {
        return null;
    }
    const area = screen.getDisplayMatching(saved).workArea;
    const visible = saved.x < area.x + area.width - 80 && saved.x + saved.width > area.x + 80
        && saved.y < area.y + area.height - 40 && saved.y >= area.y - 20;
    return visible ? saved : null;
};

const themeBackground = () => {
    try {
        return loadSettings().theme === 'light' ? '#f4f4f5' : '#09090b';
    } catch (err) {
        return '#09090b';
    }
};

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
    const bounds = restoredBounds();
    mainWindow = new BrowserWindow({
        width: bounds ? bounds.width : 1280,
        height: bounds ? bounds.height : 800,
        ...(bounds ? { x: bounds.x, y: bounds.y } : {}),
        minWidth: 360,
        minHeight: 480,
        show: false,
        backgroundColor: themeBackground(),
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

    // Web MIDI (Live tab) for the app page only, never for an embedded node
    // portal. Chromium asks for "midiSysex" for any MIDI access, even
    // without sysex, so both names are allowed here. Other permissions keep
    // Electron's default.
    const MIDI_PERMISSIONS = new Set(['midi', 'midiSysex']);
    const midiAllowed = (webContents) => (
        Boolean(mainWindow) && !mainWindow.isDestroyed() && webContents === mainWindow.webContents
    );
    const ses = mainWindow.webContents.session;
    ses.setPermissionRequestHandler((webContents, permission, callback) => {
        callback(MIDI_PERMISSIONS.has(permission) ? midiAllowed(webContents) : true);
    });
    ses.setPermissionCheckHandler((webContents, permission) => (
        MIDI_PERMISSIONS.has(permission) ? midiAllowed(webContents) : true
    ));

    mainWindow.on('page-title-updated', (event) => {
        event.preventDefault();
    });

    mainWindow.once('ready-to-show', () => {
        if (bounds && bounds.maximized) {
            mainWindow.maximize();
        }
        mainWindow.show();
    });

    // Remember where the window was (normal bounds, plus maximized).
    let boundsTimer = null;
    const rememberBounds = () => {
        clearTimeout(boundsTimer);
        boundsTimer = setTimeout(() => {
            if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) {
                return;
            }
            try {
                saveSettings({
                    windowBounds: { ...mainWindow.getNormalBounds(), maximized: mainWindow.isMaximized() }
                });
            } catch (err) {
                // Bounds are a convenience; never block the window on them.
            }
        }, 500);
    };
    ['resize', 'move', 'maximize', 'unmaximize'].forEach((name) => mainWindow.on(name, rememberBounds));

    // The app page holds the full window.dmx bridge (flash, delete, reboot):
    // it never navigates away or opens windows.
    mainWindow.webContents.on('will-navigate', (event, url) => {
        if (url !== mainWindow.webContents.getURL()) {
            event.preventDefault();
        }
    });
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    const engineHost = createEngineHost(mainWindow);
    const cleanupNetwork = setupNetworkHandlers(mainWindow, engineHost);
    const cleanupCueBus = setupCueBusHandlers(mainWindow);
    const cleanupStudioDialogs = setupStudioDialogHandlers(mainWindow, engineHost);
    const playback = engineHost.engine.playback;
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
    const cleanupLibrary = setupLibraryHandlers(mainWindow, engineHost);
    const cleanupSettings = setupSettingsHandlers();
    const cleanupFlash = setupFirmwareFlashHandlers(mainWindow);

    mainWindow.on('closed', () => {
        protocol.unhandle('compmedia');
        if (cleanupNetwork) cleanupNetwork();
        if (cleanupCueBus) cleanupCueBus();
        if (cleanupStudioDialogs) cleanupStudioDialogs();
        if (cleanupLibrary) cleanupLibrary();
        if (cleanupSettings) cleanupSettings();
        if (cleanupFlash) cleanupFlash();
        engineHost.close();
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
    shutdownEngine();
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
