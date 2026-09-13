const { app, BrowserWindow } = require('electron');
const path = require('path');
const { version } = require('../../package.json');
const setupNetworkHandlers = require('./ipc/network');
const setupRecordingHandlers = require('./ipc/recording');
const setupPlaybackHandlers = require('./ipc/playback');

let mainWindow = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        title: `DMX whIP Companion v${version}`,
        webPreferences: {
            preload: path.join(__dirname, '../preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: true
        }
    });

    mainWindow.on('page-title-updated', (event) => {
        event.preventDefault();
    });

    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
        .catch(err => console.error('Error loading index.html:', err));

    if (process.env.DEBUG) {
        mainWindow.webContents.openDevTools();
    }

    // Set up IPC handlers
    const recordingHandler = setupRecordingHandlers(mainWindow);
    const cleanupNetwork = setupNetworkHandlers(mainWindow, recordingHandler);
    setupPlaybackHandlers(mainWindow);

    mainWindow.on('closed', () => {
        if (cleanupNetwork) cleanupNetwork();
        if (recordingHandler && recordingHandler.close) recordingHandler.close();
        mainWindow = null;
    });
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