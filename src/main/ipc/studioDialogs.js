// The three Studio paths that need a native dialog or ffmpeg. Each one
// finishes by calling the engine; the engine never sees a dialog.
const { ipcMain, dialog, BrowserWindow } = require('electron');
const path = require('path');
const { newId } = require('../../services/shared/compilationEdl');
const { convertToStudioWav, tempWavPath } = require('../audioConvert');

const AUDIO_FILTERS = [
    { name: 'Audio', extensions: ['wav', 'aiff', 'aif', 'mp3', 'm4a', 'flac', 'ogg'] }
];

function setupStudioDialogHandlers(mainWindow, engineHost) {
    const { client } = engineHost;

    const sendSafe = (channel, payload) => {
        if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
            return;
        }
        mainWindow.webContents.send(channel, payload);
    };

    ipcMain.removeHandler('load-recording');
    ipcMain.handle('load-recording', async (event, payload = {}) => {
        let filePath = payload && payload.filePath;
        if (!filePath) {
            const { filePaths, canceled } = await dialog.showOpenDialog({
                title: 'Load Recording',
                filters: [{ name: 'DMX Recordings', extensions: ['dmx'] }],
                properties: ['openFile']
            });
            if (canceled || !filePaths || !filePaths.length) {
                const result = { success: false, error: 'No file selected' };
                sendSafe('file-loaded', result);
                return result;
            }
            filePath = filePaths[0];
        }
        try {
            return await client.command('playback.load', { filePath, displayName: payload.displayName });
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.removeHandler('import-audio');
    ipcMain.handle('import-audio', async (event, payload = {}) => {
        try {
            // Audio always comes from the picker; the renderer never names a path.
            const { filePaths, canceled } = await dialog.showOpenDialog({
                title: 'Import audio',
                filters: AUDIO_FILTERS,
                properties: ['openFile']
            });
            if (canceled || !filePaths || !filePaths.length) {
                return { success: false, error: 'No file selected' };
            }
            const filePath = filePaths[0];
            const dest = tempWavPath(newId());
            await convertToStudioWav(filePath, dest);
            return await client.command('studio.audio.add', {
                wavPath: dest,
                name: path.parse(filePath).name || 'Audio',
                startMs: payload.startMs
            });
        } catch (error) {
            console.error('Error importing audio:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.removeHandler('confirm-unsaved-compilation');
    ipcMain.handle('confirm-unsaved-compilation', async (event, payload = {}) => {
        const win = event && event.sender
            ? BrowserWindow.fromWebContents(event.sender)
            : null;
        const reason = payload && payload.reason === 'leave' ? 'leave' : 'new';
        const options = {
            type: 'question',
            buttons: ['Save', "Don't Save", 'Cancel'],
            defaultId: 0,
            cancelId: 2,
            title: 'Unsaved compilation',
            message: 'The compilation has unsaved changes.',
            detail: reason === 'leave'
                ? 'Save it before leaving Studio?'
                : 'Save it before clearing Studio?'
        };
        const result = win
            ? await dialog.showMessageBox(win, options)
            : await dialog.showMessageBox(options);
        const choice = result.response === 0
            ? 'save'
            : (result.response === 1 ? 'discard' : 'cancel');
        return { choice };
    });

    return () => {
        ['load-recording', 'import-audio', 'confirm-unsaved-compilation'].forEach((channel) => ipcMain.removeHandler(channel));
    };
}

module.exports = setupStudioDialogHandlers;
