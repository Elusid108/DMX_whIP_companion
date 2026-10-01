// The show library on disk: paths, sidecars, the folder index and the
// listing. The dialogs, the folder watch and the IPC handlers stay in the
// companion. One store per engine, bound to the settings store's
// libraryDir; every file and path operation goes through the storage port.
const {
    collectFolderIds,
    hydrateTree,
    pruneAndFill,
    stripTree
} = require('./libraryTree');

const INVALID_NAME = new RegExp('[<>:"/\\\\|?*\\x00-\\x1f]', 'g');


// deps: { storage, clock, settings }
const createLibraryStore = ({ storage, clock, settings }) => {
    const getLibraryDir = () => settings.getLibraryDir();

    const ensureLibrary = () => {
        const dir = getLibraryDir();
        storage.mkdirSync(dir);
        return dir;
    };

    const sidecarPath = (dmxPath) => {
        const parsed = storage.parse(dmxPath);
        return storage.join(parsed.dir, `${parsed.name}.json`);
    };

    // Real paths, so a symlink or junction inside the library cannot point out.
    const realOrResolved = (target) => {
        const resolved = storage.resolve(target);
        try {
            return storage.realpathSync(resolved);
        } catch (err) {
            // A path that does not exist yet (new file): resolve its parent.
            try {
                return storage.join(storage.realpathSync(storage.dirname(resolved)), storage.basename(resolved));
            } catch (parentErr) {
                return resolved;
            }
        }
    };

    const isInsideLibrary = (filePath) => {
        const libDir = realOrResolved(ensureLibrary());
        const resolved = realOrResolved(filePath);
        const relative = storage.relative(libDir, resolved);
        return relative !== '' && !relative.startsWith('..') && !storage.isAbsolute(relative);
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
            const raw = storage.readTextSync(metaPath);
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
            updatedAt: new Date(clock.now()).toISOString()
        };
        storage.writeFileSync(sidecarPath(dmxPath), `${JSON.stringify(next, null, 2)}\n`);
        return next;
    };

    const uniqueDmxPath = (dir, baseName) => {
        let candidate = storage.join(dir, `${baseName}.dmx`);
        let n = 1;
        while (storage.existsSync(candidate)) {
            n += 1;
            candidate = storage.join(dir, `${baseName}_${n}.dmx`);
        }
        return candidate;
    };

    const uniqueCompPath = (dir, baseName) => {
        const stem = String(baseName || 'Stack').replace(/\.comp$/i, '');
        let candidate = storage.join(dir, `${stem}.comp`);
        let n = 1;
        while (storage.existsSync(candidate)) {
            n += 1;
            candidate = storage.join(dir, `${stem}_${n}.comp`);
        }
        return candidate;
    };

    const readCompilationSummary = (dirPath) => {
        const id = storage.basename(dirPath);
        let name = id.replace(/\.comp$/i, '');
        let notes = '';
        let clipCount = 0;
        try {
            const raw = JSON.parse(storage.readTextSync(storage.join(dirPath, 'project.json')));
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
        const stat = storage.statSync(dirPath);
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
        return storage.readdirSync(dir)
            .filter((entry) => entry.isDirectory() && entry.name.toLowerCase().endsWith('.comp'))
            .map((entry) => readCompilationSummary(storage.join(dir, entry.name)));
    };

    const findNextScenePath = () => {
        const dir = ensureLibrary();
        let sceneNum = 1;
        while (true) {
            const testPath = storage.join(dir, `scene_${sceneNum}.dmx`);
            if (!storage.existsSync(testPath)) {
                return testPath;
            }
            sceneNum += 1;
        }
    };

    const toShowSummary = (filePath) => {
        const stat = storage.statSync(filePath);
        const filename = storage.basename(filePath);
        const basename = storage.parse(filename).name;
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
        return storage.readdirSync(dir)
            .map((entry) => entry.name)
            .filter((name) => name.toLowerCase().endsWith('.dmx'))
            .map((name) => toShowSummary(storage.join(dir, name)))
            .sort((a, b) => b.modified - a.modified);
    };

    const indexPath = () => storage.join(ensureLibrary(), 'library.json');

    const sanitizeFolderName = (name) => {
        const cleaned = String(name || '').trim().replace(INVALID_NAME, '').replace(/[. ]+$/g, '');
        return (cleaned || 'Folder').slice(0, 60);
    };

    const readIndexFile = () => {
        try {
            const raw = JSON.parse(storage.readTextSync(indexPath()));
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
        storage.writeFileSync(indexPath(), `${JSON.stringify({
            version: 1,
            items,
            collapsed: collapsed || []
        }, null, 2)}\n`);
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


    return {
        INVALID_NAME,
        getLibraryDir,
        ensureLibrary,
        sidecarPath,
        realOrResolved,
        isInsideLibrary,
        assertInLibrary,
        sanitizeBaseName,
        readSidecar,
        writeSidecar,
        uniqueDmxPath,
        uniqueCompPath,
        readCompilationSummary,
        listCompilations,
        findNextScenePath,
        toShowSummary,
        listShows,
        indexPath,
        sanitizeFolderName,
        readIndexFile,
        writeIndexFile,
        readIndexItems,
        writeIndexItems,
        listLibrary
    };
};

module.exports = { createLibraryStore };
