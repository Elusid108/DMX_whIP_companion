const { ipcMain, dialog } = require('electron');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { createHeader, scanRecording } = require('../../services/shared/dmxRecording');
const { getLibraryDir, saveSettings } = require('../settings');
const {
    cloneTree,
    collectFolderIds,
    dissolveFolder,
    findNode,
    hydrateTree,
    insertNode,
    moveNodes,
    pruneAndFill,
    renameFolder,
    stripTree
} = require('../../services/shared/libraryTree');

const INVALID_NAME = new RegExp('[<>:"/\\\\|?*\\x00-\\x1f]', 'g');

const sendSafe = (mainWindow, channel, payload) => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
        return;
    }
    mainWindow.webContents.send(channel, payload);
};

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

const uniqueCompPath = (dir, baseName) => {
    const stem = String(baseName || 'Stack').replace(/\.comp$/i, '');
    let candidate = path.join(dir, `${stem}.comp`);
    let n = 1;
    while (fs.existsSync(candidate)) {
        n += 1;
        candidate = path.join(dir, `${stem}_${n}.comp`);
    }
    return candidate;
};

const readCompilationSummary = (dirPath) => {
    const id = path.basename(dirPath);
    let name = id.replace(/\.comp$/i, '');
    let notes = '';
    let clipCount = 0;
    try {
        const raw = JSON.parse(fs.readFileSync(path.join(dirPath, 'project.json'), 'utf8'));
        if (raw && typeof raw.name === 'string' && raw.name.trim()) {
            name = raw.name.trim();
        }
        if (raw && typeof raw.notes === 'string') {
            notes = raw.notes;
        }
        if (raw && Array.isArray(raw.clips)) {
            clipCount = raw.clips.length;
        }
    } catch (err) {
        // unreadable project still appears in the list
    }
    const stat = fs.statSync(dirPath);
    return {
        id,
        dirPath,
        name,
        notes,
        clipCount,
        created: stat.birthtimeMs || stat.ctimeMs,
        modified: stat.mtimeMs
    };
};

const listCompilations = () => {
    const dir = ensureLibrary();
    return fs.readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.toLowerCase().endsWith('.comp'))
        .map((entry) => readCompilationSummary(path.join(dir, entry.name)));
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

const indexPath = () => path.join(ensureLibrary(), 'library.json');

const sanitizeFolderName = (name) => {
    const cleaned = String(name || '').trim().replace(INVALID_NAME, '').replace(/[. ]+$/g, '');
    return (cleaned || 'Folder').slice(0, 60);
};

const readIndexFile = () => {
    try {
        const raw = JSON.parse(fs.readFileSync(indexPath(), 'utf8'));
        return {
            items: raw && Array.isArray(raw.items) ? raw.items : [],
            collapsed: raw && Array.isArray(raw.collapsed)
                ? raw.collapsed.filter((id) => typeof id === 'string')
                : []
        };
    } catch (err) {
        // first run or unreadable index
    }
    return { items: [], collapsed: [] };
};

const writeIndexFile = (items, collapsed) => {
    fs.writeFileSync(indexPath(), `${JSON.stringify({
        version: 1,
        items,
        collapsed: collapsed || []
    }, null, 2)}\n`, 'utf8');
};

const readIndexItems = () => readIndexFile().items;

const writeIndexItems = (items) => {
    writeIndexFile(items, readIndexFile().collapsed);
};

const listLibrary = () => {
    const shows = listShows();
    const compilations = listCompilations();
    const showById = new Map(shows.map((show) => [show.filename, show]));
    const compilationById = new Map(compilations.map((item) => [item.id, item]));
    const showIds = shows.map((show) => show.filename);
    const compilationIds = compilations.map((item) => item.id);
    const previous = readIndexFile();
    const next = pruneAndFill(previous.items, showIds, compilationIds);
    const folderIds = new Set(collectFolderIds(next));
    const nextCollapsed = previous.collapsed.filter((id) => folderIds.has(id));
    if (JSON.stringify(stripTree(previous.items)) !== JSON.stringify(next)
        || JSON.stringify(previous.collapsed) !== JSON.stringify(nextCollapsed)) {
        writeIndexFile(next, nextCollapsed);
    }
    return {
        shows,
        compilations,
        tree: hydrateTree(next, showById, compilationById),
        collapsed: nextCollapsed,
        libraryDir: getLibraryDir()
    };
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
        sendSafe(mainWindow, 'library-updated', listLibrary());
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

    const createLibraryFile = (name) => {
        const baseName = sanitizeBaseName(name);
        const filePath = uniqueDmxPath(ensureLibrary(), baseName);
        fs.writeFileSync(filePath, createHeader(0));
        writeSidecar(filePath, { name: baseName, notes: '' });
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
        'library-delete',
        'library-choose-dir',
        'library-create-folder',
        'library-rename-folder',
        'library-delete-folder',
        'library-move',
        'library-set-collapsed',
        'library-save-compilation-meta',
        'library-duplicate'
    ];

    ipcMain.handle('library-list', async () => {
        try {
            return { success: true, ...listLibrary() };
        } catch (error) {
            return { success: false, error: error.message, shows: [], tree: [], collapsed: [] };
        }
    });

    ipcMain.handle('library-new-file', async (event, { name } = {}) => {
        if (recordingHandler && recordingHandler.isRecording && recordingHandler.isRecording()) {
            return { success: false, error: 'Stop recording before creating a new file' };
        }
        try {
            const filePath = createLibraryFile(name);
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

    ipcMain.handle('library-choose-dir', async () => {
        try {
            const { filePaths, canceled } = await dialog.showOpenDialog({
                title: 'Choose library folder',
                defaultPath: getLibraryDir(),
                properties: ['openDirectory', 'createDirectory']
            });
            if (canceled || !filePaths || filePaths.length === 0) {
                return { success: false, error: 'No file selected' };
            }

            const libraryDir = filePaths[0];
            fs.mkdirSync(libraryDir, { recursive: true });
            saveSettings({ libraryDir });
            inspectCache.clear();
            startWatch();
            emitList();
            return { success: true, ...listLibrary() };
        } catch (error) {
            console.error('Error choosing library folder:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('library-delete', async (event, { filePath, compilationId } = {}) => {
        try {
            if (compilationId) {
                const dirPath = path.join(ensureLibrary(), path.basename(compilationId));
                assertInLibrary(dirPath);
                if (!fs.existsSync(dirPath)) {
                    throw new Error('Compilation not found');
                }
                fs.rmSync(dirPath, { recursive: true, force: true });
                return { success: true };
            }
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

    ipcMain.handle('library-create-folder', async (event, { name, parentId } = {}) => {
        try {
            const items = cloneTree(readIndexItems());
            const folder = {
                type: 'folder',
                id: `fold_${crypto.randomBytes(6).toString('hex')}`,
                name: sanitizeFolderName(name),
                children: []
            };
            insertNode(items, folder, parentId || 'root', 0);
            writeIndexItems(items);
            emitList();
            return { success: true, id: folder.id, name: folder.name };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('library-rename-folder', async (event, { id, name } = {}) => {
        try {
            const items = cloneTree(readIndexItems());
            renameFolder(items, id, sanitizeFolderName(name));
            writeIndexItems(items);
            emitList();
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('library-delete-folder', async (event, { id } = {}) => {
        try {
            const items = cloneTree(readIndexItems());
            dissolveFolder(items, id);
            writeIndexItems(items);
            emitList();
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('library-move', async (event, { id, ids, parentId, index } = {}) => {
        try {
            const list = Array.isArray(ids) && ids.length ? ids : (id ? [id] : []);
            const items = cloneTree(readIndexItems());
            moveNodes(items, list, parentId || 'root', index);
            writeIndexItems(items);
            emitList();
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('library-duplicate', async (event, { ids } = {}) => {
        try {
            const items = cloneTree(readIndexItems());
            const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
            for (const id of list) {
                const found = findNode(items, id);
                if (!found || !found.node) {
                    continue;
                }
                const parentId = found.parent ? found.parent.id : 'root';
                if (found.node.type === 'show') {
                    const src = path.join(ensureLibrary(), found.node.id);
                    assertInLibrary(src);
                    if (!fs.existsSync(src)) {
                        continue;
                    }
                    const base = `${path.parse(found.node.id).name} copy`;
                    const dest = uniqueDmxPath(ensureLibrary(), sanitizeBaseName(base));
                    fs.copyFileSync(src, dest);
                    const meta = readSidecar(src);
                    writeSidecar(dest, {
                        name: `${meta.name || path.parse(found.node.id).name} copy`,
                        notes: meta.notes
                    });
                    insertNode(items, { type: 'show', id: path.basename(dest) }, parentId, found.index + 1);
                } else if (found.node.type === 'compilation') {
                    const src = path.join(ensureLibrary(), found.node.id);
                    assertInLibrary(src);
                    if (!fs.existsSync(src)) {
                        continue;
                    }
                    const dest = uniqueCompPath(ensureLibrary(), `${path.basename(found.node.id, '.comp')} copy`);
                    fs.cpSync(src, dest, { recursive: true });
                    const projectFile = path.join(dest, 'project.json');
                    if (fs.existsSync(projectFile)) {
                        const raw = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
                        raw.name = `${raw.name || 'Stack'} copy`;
                        fs.writeFileSync(projectFile, `${JSON.stringify(raw, null, 2)}\n`);
                    }
                    insertNode(items, { type: 'compilation', id: path.basename(dest) }, parentId, found.index + 1);
                }
            }
            writeIndexItems(items);
            emitList();
            return { success: true, ...listLibrary() };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('library-save-compilation-meta', async (event, { id, name, notes } = {}) => {
        try {
            const dirPath = path.join(ensureLibrary(), path.basename(id));
            assertInLibrary(dirPath);
            const projectFile = path.join(dirPath, 'project.json');
            if (!fs.existsSync(projectFile)) {
                throw new Error('Compilation not found');
            }
            const raw = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
            if (typeof name === 'string') {
                raw.name = name;
            }
            if (typeof notes === 'string') {
                raw.notes = notes;
            }
            fs.writeFileSync(projectFile, `${JSON.stringify(raw, null, 2)}\n`);
            emitList();
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('library-set-collapsed', async (event, { ids } = {}) => {
        try {
            const items = readIndexItems();
            const folderIds = new Set(collectFolderIds(items));
            const collapsed = (Array.isArray(ids) ? ids : [])
                .filter((entry) => typeof entry === 'string' && folderIds.has(entry));
            writeIndexFile(items, collapsed);
            emitList();
            return { success: true, collapsed };
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
    findNextScenePath,
    assertInLibrary,
    sanitizeBaseName,
    uniqueDmxPath,
    uniqueCompPath,
    writeSidecar,
    listLibrary
};
