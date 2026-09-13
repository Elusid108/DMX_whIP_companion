const { ipcMain, dialog, app } = require('electron');
const path = require('path');
const fs = require('fs');
const { createHeader, scanRecording } = require('../../services/shared/dmxRecording');

const INVALID_NAME = new RegExp('[<>:"/\\\\|?*\\x00-\\x1f]', 'g');

const sendSafe = (mainWindow, channel, payload) => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
        return;
    }
    mainWindow.webContents.send(channel, payload);
};

const getLibraryDir = () => path.join(app.getPath('documents'), 'DMX whIP', 'Shows');

const ensureLibrary = () => {
    const dir = getLibraryDir();
    fs.mkdirSync(dir, { recursive: true });
    return dir;
};

const sidecarPath = (dmxPath) => {
    const parsed = path.parse(dmxPath);
    return path.join(parsed.dir, `${parsed.name}.json`);
};

const isInsideLibrary = (filePath) => {
    const libDir = path.resolve(ensureLibrary());
    const resolved = path.resolve(filePath);
    const relative = path.relative(libDir, resolved);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

const assertInLibrary = (filePath) => {
    if (!filePath || !isInsideLibrary(filePath)) {
        throw new Error('File is not in the library');
    }
};

const sanitizeBaseName = (name) => {
    const trimmed = String(name || '').trim().replace(/\.dmx$/i, '');
    const cleaned = trimmed.replace(INVALID_NAME, '').replace(/[. ]+$/g, '');
    if (!cleaned) {
        throw new Error('Invalid name');
    }
    return cleaned;
};

const readSidecar = (dmxPath) => {
    const metaPath = sidecarPath(dmxPath);
    try {
        const raw = fs.readFileSync(metaPath, 'utf8');
        const parsed = JSON.parse(raw);
        return {
            name: typeof parsed.name === 'string' ? parsed.name : '',
            notes: typeof parsed.notes === 'string' ? parsed.notes : ''
        };
    } catch (err) {
        return { name: '', notes: '' };
    }
};

const writeSidecar = (dmxPath, meta = {}) => {
    const current = readSidecar(dmxPath);
    const next = {
        name: typeof meta.name === 'string' ? meta.name : current.name,
        notes: typeof meta.notes === 'string' ? meta.notes : current.notes,
        updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(sidecarPath(dmxPath), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    return next;
};

const uniqueDmxPath = (dir, baseName) => {
    let candidate = path.join(dir, `${baseName}.dmx`);
    let n = 1;
    while (fs.existsSync(candidate)) {
        n += 1;
        candidate = path.join(dir, `${baseName}_${n}.dmx`);
    }
    return candidate;
};

const findNextScenePath = () => {
    const dir = ensureLibrary();
    let sceneNum = 1;
    while (true) {
        const testPath = path.join(dir, `scene_${sceneNum}.dmx`);
        if (!fs.existsSync(testPath)) {
            return testPath;
        }
        sceneNum += 1;
    }
};

const toShowSummary = (filePath) => {
    const stat = fs.statSync(filePath);
    const filename = path.basename(filePath);
    const basename = path.parse(filename).name;
    const meta = readSidecar(filePath);
    return {
        filePath,
        filename,
        displayName: meta.name.trim() ? meta.name : basename,
        notes: meta.notes,
        size: stat.size,
        created: stat.birthtimeMs || stat.ctimeMs,
        modified: stat.mtimeMs
    };
};

const listShows = () => {
    const dir = ensureLibrary();
    return fs.readdirSync(dir)
        .filter((name) => name.toLowerCase().endsWith('.dmx'))
        .map((name) => toShowSummary(path.join(dir, name)))
        .sort((a, b) => b.modified - a.modified);
};

function setupLibraryHandlers(mainWindow, recordingHandler) {
    const inspectCache = new Map();
    let watcher = null;
    let watchTimer = null;

    const isActiveRecording = (filePath) => {
        if (!recordingHandler) {
            return false;
        }
        const active = recordingHandler.getRecordingPath && recordingHandler.getRecordingPath();
        if (!active || !filePath) {
            return false;
        }
        return path.resolve(active) === path.resolve(filePath);
    };

    const emitList = () => {
        sendSafe(mainWindow, 'library-updated', {
            shows: listShows(),
            libraryDir: getLibraryDir()
        });
    };

    const scheduleRefresh = () => {
        clearTimeout(watchTimer);
        watchTimer = setTimeout(() => {
            inspectCache.clear();
            emitList();
        }, 200);
    };

    const startWatch = () => {
        const dir = ensureLibrary();
        if (watcher) {
            watcher.close();
            watcher = null;
        }
        try {
            watcher = fs.watch(dir, scheduleRefresh);
            watcher.on('error', (err) => {
                console.error('Library watch error:', err);
            });
        } catch (err) {
            console.error('Unable to watch library folder:', err);
        }
    };

    const inspectShow = (filePath) => {
        assertInLibrary(filePath);
        if (!fs.existsSync(filePath)) {
            throw new Error('File not found');
        }

        const summary = toShowSummary(filePath);
        const cached = inspectCache.get(filePath);
        let scan;
        if (cached && cached.mtime === summary.modified) {
            scan = cached.scan;
        } else {
            try {
                scan = scanRecording(filePath);
            } catch (err) {
                scan = {
                    duration: 0,
                    frameCount: 0,
                    size: summary.size,
                    created: summary.created,
                    modified: summary.modified,
                    universes: [],
                    protocols: [],
                    packetRate: 0,
                    perUniverse: [],
                    error: err.message,
                    playable: false
                };
            }
            inspectCache.set(filePath, { mtime: summary.modified, scan });
        }

        return {
            ...summary,
            ...scan,
            displayName: summary.displayName,
            notes: summary.notes,
            name: readSidecar(filePath).name
        };
    };

    const createLibraryFile = () => {
        const filePath = findNextScenePath();
        fs.writeFileSync(filePath, createHeader(0));
        writeSidecar(filePath, { name: '', notes: '' });
        if (recordingHandler && recordingHandler.setRecordingPath) {
            recordingHandler.setRecordingPath(filePath);
        }
        return filePath;
    };

    startWatch();

    const handlers = [
        'library-list',
        'library-new-file',
        'library-inspect',
        'library-save-meta',
        'library-import',
        'library-export',
        'library-rename',
        'library-delete'
    ];

    ipcMain.handle('library-list', async () => {
        try {
            return { success: true, shows: listShows(), libraryDir: getLibraryDir() };
        } catch (error) {
            return { success: false, error: error.message, shows: [] };
        }
    });

    ipcMain.handle('library-new-file', async () => {
        if (recordingHandler && recordingHandler.isRecording && recordingHandler.isRecording()) {
            return { success: false, error: 'Stop recording before creating a new file' };
        }
        try {
            const filePath = createLibraryFile();
            return { success: true, filePath };
        } catch (error) {
            console.error('Error creating library file:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('library-inspect', async (event, { filePath } = {}) => {
        try {
            return { success: true, show: inspectShow(filePath) };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('library-save-meta', async (event, { filePath, name, notes } = {}) => {
        try {
            assertInLibrary(filePath);
            if (!fs.existsSync(filePath)) {
                throw new Error('File not found');
            }
            const meta = writeSidecar(filePath, { name, notes });
            inspectCache.delete(filePath);
            return { success: true, meta, show: toShowSummary(filePath) };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('library-import', async () => {
        try {
            const { filePaths, canceled } = await dialog.showOpenDialog({
                title: 'Import Recording',
                filters: [{ name: 'DMX Recordings', extensions: ['dmx'] }],
                properties: ['openFile']
            });
            if (canceled || !filePaths || filePaths.length === 0) {
                return { success: false, error: 'No file selected' };
            }

            const source = filePaths[0];
            const dir = ensureLibrary();
            const baseName = sanitizeBaseName(path.parse(source).name);
            const dest = uniqueDmxPath(dir, baseName);
            fs.copyFileSync(source, dest);

            const sourceSidecar = sidecarPath(source);
            if (fs.existsSync(sourceSidecar)) {
                fs.copyFileSync(sourceSidecar, sidecarPath(dest));
            } else {
                writeSidecar(dest, { name: '', notes: '' });
            }

            return { success: true, filePath: dest };
        } catch (error) {
            console.error('Error importing recording:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('library-export', async (event, { filePath } = {}) => {
        try {
            assertInLibrary(filePath);
            if (!fs.existsSync(filePath)) {
                throw new Error('File not found');
            }

            const { filePath: dest, canceled } = await dialog.showSaveDialog({
                title: 'Export Recording',
                defaultPath: path.basename(filePath),
                filters: [{ name: 'DMX Recordings', extensions: ['dmx'] }]
            });
            if (canceled || !dest) {
                return { success: false, error: 'No file selected' };
            }

            fs.copyFileSync(filePath, dest);
            const metaPath = sidecarPath(filePath);
            if (fs.existsSync(metaPath)) {
                const destSidecar = sidecarPath(dest);
                fs.copyFileSync(metaPath, destSidecar);
            }
            return { success: true, filePath: dest };
        } catch (error) {
            console.error('Error exporting recording:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('library-rename', async (event, { filePath, name } = {}) => {
        try {
            assertInLibrary(filePath);
            if (isActiveRecording(filePath) && recordingHandler.isRecording()) {
                throw new Error('Stop recording before renaming this file');
            }
            if (!fs.existsSync(filePath)) {
                throw new Error('File not found');
            }

            const dir = ensureLibrary();
            const baseName = sanitizeBaseName(name);
            const dest = path.join(dir, `${baseName}.dmx`);
            if (path.resolve(dest) === path.resolve(filePath)) {
                return { success: true, filePath };
            }
            if (fs.existsSync(dest)) {
                throw new Error('A show with that filename already exists');
            }

            fs.renameSync(filePath, dest);
            const oldSidecar = sidecarPath(filePath);
            const newSidecar = sidecarPath(dest);
            if (fs.existsSync(oldSidecar)) {
                fs.renameSync(oldSidecar, newSidecar);
            }
            inspectCache.delete(filePath);

            if (isActiveRecording(filePath) && recordingHandler.setRecordingPath) {
                recordingHandler.setRecordingPath(dest);
            }

            return { success: true, filePath: dest };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('library-delete', async (event, { filePath } = {}) => {
        try {
            assertInLibrary(filePath);
            if (isActiveRecording(filePath) && recordingHandler.isRecording()) {
                throw new Error('Stop recording before deleting this file');
            }
            if (!fs.existsSync(filePath)) {
                throw new Error('File not found');
            }

            fs.unlinkSync(filePath);
            const metaPath = sidecarPath(filePath);
            if (fs.existsSync(metaPath)) {
                fs.unlinkSync(metaPath);
            }
            inspectCache.delete(filePath);

            if (isActiveRecording(filePath) && recordingHandler.setRecordingPath) {
                recordingHandler.setRecordingPath(null);
            }

            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    return () => {
        handlers.forEach((channel) => {
            ipcMain.removeHandler(channel);
        });
        clearTimeout(watchTimer);
        if (watcher) {
            watcher.close();
            watcher = null;
        }
    };
}

module.exports = {
    setupLibraryHandlers,
    getLibraryDir,
    ensureLibrary,
    findNextScenePath
};
