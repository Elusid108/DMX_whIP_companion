const React = require('react');
const { createPortal } = require('react-dom');
const { useState, useEffect, useRef } = React;
const ipcRenderer = require('../../ipc');
const ShowList = require('./ShowList');
const ShowInspector = require('./ShowInspector');
const PushToSdDialog = require('./PushToSdDialog');
const {
    collectLooks,
    collectLooksWithPath,
    findNode,
    firstShowPath,
    flattenFolderStack,
    folderExists
} = require('../../../services/shared/libraryTree');

const LibraryPanel = React.forwardRef(({
    studioTrackId = 0,
    studioHasClips = false,
    railHost,
    onQueuePlay,
    onQueueAdd
}, ref) => {
    const [shows, setShows] = useState([]);
    const [tree, setTree] = useState([]);
    const [selection, setSelection] = useState(null);
    const [loadedPath, setLoadedPath] = useState(null);
    const [inspect, setInspect] = useState(null);
    const [folderStack, setFolderStack] = useState([]);
    const [name, setName] = useState('');
    const [notes, setNotes] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [devices, setDevices] = useState([]);
    const [pushOpen, setPushOpen] = useState(false);
    const [pushing, setPushing] = useState(false);
    const [pushError, setPushError] = useState('');
    const [pushProgress, setPushProgress] = useState(null);
    const [collapsed, setCollapsed] = useState([]);
    const saveTimer = useRef(null);
    const selectedRef = useRef(null);
    const dirtyRef = useRef(false);
    const nameRef = useRef('');
    const notesRef = useRef('');

    const selectedIdsRef = useRef([]);
    const libraryClipboardRef = useRef([]);

    React.useImperativeHandle(ref, () => ({
        copy: () => {
            libraryClipboardRef.current = selectedIdsRef.current.slice();
        },
        paste: async () => {
            const ids = libraryClipboardRef.current;
            if (!ids.length) {
                return;
            }
            const result = await ipcRenderer.invoke('library-duplicate', { ids });
            if (result && !result.success && result.error) {
                setError(result.error);
            }
        }
    }));

    selectedRef.current = selection;
    nameRef.current = name;
    notesRef.current = notes;

    const selectedShowPath = selection && selection.type === 'show' ? selection.filePath : null;
    const selectedFolder = selection && selection.type === 'folder'
        ? ((findNode(tree, selection.id) || {}).node || null)
        : null;
    const selectedCompilation = selection && selection.type === 'compilation'
        ? ((findNode(tree, selection.id) || {}).node || null)
        : null;

    useEffect(() => {
        const handleProgress = (event, progress = {}) => {
            setPushProgress((current) => ({ ...(current || {}), ...progress }));
        };
        ipcRenderer.on('device-push-progress', handleProgress);
        return () => {
            ipcRenderer.removeListener('device-push-progress', handleProgress);
        };
    }, []);

    useEffect(() => {
        dirtyRef.current = false;
    }, [selectedShowPath]);

    const applyLibrary = (payload = {}) => {
        const nextShows = payload.shows || [];
        const nextTree = payload.tree || [];
        setShows(nextShows);
        setTree(nextTree);
        if (Array.isArray(payload.collapsed)) {
            setCollapsed(payload.collapsed);
        }
        setSelection((current) => {
            if (current && current.type === 'show'
                && nextShows.some((show) => show.filePath === current.filePath)) {
                return current;
            }
            if (current && current.type === 'folder' && folderExists(nextTree, current.id)) {
                return current;
            }
            if (current && current.type === 'compilation' && findNode(nextTree, current.id)) {
                return current;
            }
            const first = firstShowPath(nextTree);
            return first ? { type: 'show', filePath: first } : null;
        });
    };

    useEffect(() => {
        const loadList = async () => {
            const result = await ipcRenderer.invoke('library-list');
            if (result && result.success) {
                applyLibrary(result);
            } else if (result && result.error) {
                setError(result.error);
            }
        };

        const handleUpdated = (event, payload = {}) => {
            applyLibrary(payload);
        };

        const handleFileLoaded = (event, result = {}) => {
            if (result.success) {
                setLoadedPath(result.filePath || result.projectPath || null);
                if (result.filePath) {
                    setError('');
                }
            }
        };

        const applyDevices = (payload = {}) => {
            setDevices(payload.devices || []);
        };

        const handleDevices = (event, payload = {}) => {
            applyDevices(payload);
        };

        loadList();
        ipcRenderer.invoke('device-list').then((snapshot) => {
            if (snapshot) {
                applyDevices(snapshot);
            }
        }).catch(() => {});
        ipcRenderer.on('library-updated', handleUpdated);
        ipcRenderer.on('file-loaded', handleFileLoaded);
        ipcRenderer.on('devices-update', handleDevices);
        return () => {
            ipcRenderer.removeListener('library-updated', handleUpdated);
            ipcRenderer.removeListener('file-loaded', handleFileLoaded);
            ipcRenderer.removeListener('devices-update', handleDevices);
            clearTimeout(saveTimer.current);
            const current = selectedRef.current;
            if (dirtyRef.current && current && current.type === 'show' && current.filePath) {
                ipcRenderer.invoke('library-save-meta', {
                    filePath: current.filePath,
                    name: nameRef.current,
                    notes: notesRef.current
                });
            }
        };
    }, []);

    useEffect(() => {
        if (!selectedShowPath) {
            setInspect(null);
            setName('');
            setNotes('');
            return undefined;
        }

        let cancelled = false;
        const loadInspect = async () => {
            const result = await ipcRenderer.invoke('library-inspect', { filePath: selectedShowPath });
            if (cancelled) {
                return;
            }
            const current = selectedRef.current;
            if (!current || current.type !== 'show' || current.filePath !== selectedShowPath) {
                return;
            }
            if (result && result.success) {
                setInspect(result.show);
                if (!dirtyRef.current) {
                    setName(result.show.name || result.show.displayName || '');
                    setNotes(result.show.notes || '');
                }
                setError('');
            } else {
                setInspect(null);
                setError((result && result.error) || 'Unable to inspect show');
            }
        };

        loadInspect();
        return () => {
            cancelled = true;
        };
    }, [selectedShowPath, shows]);

    useEffect(() => {
        if (!selection || selection.type !== 'folder' || !selectedFolder) {
            setFolderStack([]);
            return undefined;
        }
        let cancelled = false;
        const rows = flattenFolderStack(selectedFolder);
        setFolderStack(rows);
        const loadStack = async () => {
            const next = [];
            for (const row of rows) {
                if (row.kind !== 'look' || !row.show || !row.show.filePath) {
                    next.push(row);
                    continue;
                }
                const result = await ipcRenderer.invoke('library-inspect', { filePath: row.show.filePath });
                if (cancelled) {
                    return;
                }
                next.push({
                    ...row,
                    inspect: result && result.success ? result.show : { ...row.show, error: (result && result.error) || 'Unable to inspect' }
                });
            }
            if (!cancelled) {
                setFolderStack(next);
            }
        };
        loadStack();
        return () => {
            cancelled = true;
        };
    }, [selection, selectedFolder, tree]);

    const queueSaveMeta = (nextName, nextNotes) => {
        clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(async () => {
            const current = selectedRef.current;
            if (!current || current.type !== 'show' || !current.filePath) {
                return;
            }
            const result = await ipcRenderer.invoke('library-save-meta', {
                filePath: current.filePath,
                name: nextName,
                notes: nextNotes
            });
            if (result && result.success) {
                dirtyRef.current = false;
            } else if (result && !result.success && result.error) {
                setError(result.error);
            }
        }, 400);
    };

    const handleNameChange = (value) => {
        dirtyRef.current = true;
        setName(value);
        queueSaveMeta(value, notes);
    };

    const handleNotesChange = (value) => {
        dirtyRef.current = true;
        setNotes(value);
        queueSaveMeta(name, value);
    };

    const runAction = async (work) => {
        if (busy) {
            return;
        }
        setBusy(true);
        setError('');
        try {
            await work();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    const handlePlay = () => runAction(async () => {
        const ids = (selectedIdsRef.current && selectedIdsRef.current.length)
            ? selectedIdsRef.current
            : (selection && selection.id ? [selection.id] : []);
        const sources = [];
        const seen = new Set();
        const compilations = [];
        const addLook = (filePath, name) => {
            if (!filePath || seen.has(filePath)) {
                return;
            }
            seen.add(filePath);
            sources.push({ filePath, name });
        };
        for (const id of ids) {
            const found = findNode(tree, id);
            const node = found && found.node;
            if (!node) {
                continue;
            }
            if (node.type === 'show' && node.show && node.show.filePath) {
                addLook(node.show.filePath, node.show.displayName || node.show.filename || node.id);
            } else if (node.type === 'folder') {
                for (const look of collectLooks(node)) {
                    addLook(look.filePath, look.name);
                }
            } else if (node.type === 'compilation' && node.compilation && node.compilation.dirPath) {
                compilations.push(node);
            }
        }
        const trackId = studioTrackId || 0;
        const append = Boolean(studioHasClips);
        if (sources.length) {
            const result = await ipcRenderer.invoke('load-compilation', {
                name: selectedFolder ? selectedFolder.name : 'Stack',
                sources,
                trackId,
                append
            });
            if (result && !result.success) {
                setError(result.error || 'Unable to import');
            } else if (result && result.skipped && result.skipped.length) {
                setError(`Imported with ${result.skipped.length} skipped look(s)`);
            }
            return;
        }
        if (compilations.length === 1) {
            const result = await ipcRenderer.invoke('load-compilation', {
                dirPath: compilations[0].compilation.dirPath,
                trackId,
                append
            });
            if (result && !result.success) {
                setError(result.error || 'Unable to import compilation');
            }
            return;
        }
        if (selectedCompilation && selectedCompilation.compilation) {
            const result = await ipcRenderer.invoke('load-compilation', {
                dirPath: selectedCompilation.compilation.dirPath,
                trackId,
                append
            });
            if (result && !result.success) {
                setError(result.error || 'Unable to import compilation');
            }
            return;
        }
        setError('Select a look, folder, or compilation to import');
    });

    const handleRenameCompilation = (id, nextName) => {
        ipcRenderer.invoke('library-save-compilation-meta', { id, name: nextName }).then((result) => {
            if (result && !result.success && result.error) {
                setError(result.error);
            }
        });
    };

    const handleRenameShow = (filePath, nextName) => {
        if (filePath === selectedShowPath) {
            handleNameChange(nextName);
            return;
        }
        const listed = shows.find((show) => show.filePath === filePath);
        ipcRenderer.invoke('library-save-meta', {
            filePath,
            name: nextName,
            notes: listed && typeof listed.notes === 'string' ? listed.notes : undefined
        }).then((result) => {
            if (result && !result.success && result.error) {
                setError(result.error);
            }
        });
    };

    const handleRenameFolder = (id, nextName) => {
        ipcRenderer.invoke('library-rename-folder', { id, name: nextName }).then((result) => {
            if (result && !result.success && result.error) {
                setError(result.error);
            }
        });
    };

    const handleCreateFolder = () => {
        ipcRenderer.invoke('library-create-folder', { name: 'Folder' }).then((result) => {
            if (result && result.success) {
                setSelection({ type: 'folder', id: result.id });
            } else if (result && result.error) {
                setError(result.error);
            }
        });
    };

    const handleMove = (ids, parentId, index) => {
        const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
        if (!list.length) {
            return;
        }
        ipcRenderer.invoke('library-move', { ids: list, parentId, index }).then((result) => {
            if (result && !result.success && result.error) {
                setError(result.error);
            }
        });
    };

    const handleToggleCollapsed = (id) => {
        if (!id) {
            return;
        }
        const next = collapsed.includes(id)
            ? collapsed.filter((item) => item !== id)
            : [...collapsed, id];
        setCollapsed(next);
        ipcRenderer.invoke('library-set-collapsed', { ids: next }).then((result) => {
            if (result && !result.success && result.error) {
                setError(result.error);
            }
        });
    };

    const playable = Boolean(inspect && inspect.playable);
    const folderPlayable = Boolean(selectedFolder && collectLooks(selectedFolder).length > 0);
    const compilationPlayable = Boolean(selectedCompilation && selectedCompilation.compilation);
    const targets = devices.filter((device) => device && device.ip && !device.stale);

    const collectPushJobs = () => {
        const ids = (selectedIdsRef.current && selectedIdsRef.current.length)
            ? selectedIdsRef.current
            : (selection && selection.id ? [selection.id] : []);
        const jobs = [];
        const seen = new Set();
        const addJob = (filePath, name, dest) => {
            if (!filePath || seen.has(filePath)) {
                return;
            }
            seen.add(filePath);
            jobs.push({ filePath, name, dest });
        };
        for (const id of ids) {
            const found = findNode(tree, id);
            const node = found && found.node;
            if (!node) {
                continue;
            }
            if (node.type === 'show' && node.show && node.show.filePath) {
                addJob(
                    node.show.filePath,
                    node.show.displayName || node.show.filename || node.id,
                    null
                );
            } else if (node.type === 'folder') {
                for (const look of collectLooksWithPath(node)) {
                    addJob(look.filePath, look.name, look.dest);
                }
            }
        }
        if (!jobs.length && selectedShowPath) {
            addJob(
                selectedShowPath,
                (inspect && (inspect.displayName || inspect.name)) || 'Look',
                null
            );
        }
        return jobs;
    };

    const pushJobs = collectPushJobs();
    const canPush = Boolean(targets.length && pushJobs.length);

    const handleOpenPush = () => {
        if (!canPush || pushing) {
            return;
        }
        setPushError('');
        setPushProgress(null);
        setPushOpen(true);
    };

    const handlePush = async (ids) => {
        const list = (Array.isArray(ids) ? ids : []).filter(Boolean);
        const chosen = devices.filter((device) => (
            list.includes(device.id) && device.ip && !device.stale
        ));
        const jobs = collectPushJobs();
        if (!jobs.length || !chosen.length || pushing) {
            return;
        }
        setPushing(true);
        setPushError('');
        setPushProgress({
            phase: 'connecting',
            sent: 0,
            total: 0,
            label: `${chosen.length} node${chosen.length === 1 ? '' : 's'}`
        });
        try {
            const result = await ipcRenderer.invoke('device-push-batch', {
                jobs,
                devices: chosen.map((device) => ({
                    id: device.id,
                    ip: device.ip,
                    mac: device.mac,
                    longName: device.longName,
                    shortName: device.shortName
                }))
            });
            const results = (result && result.results) || [];
            const failed = results.filter((item) => item.error);
            const ok = results.filter((item) => !item.error);
            if (!result || !result.success) {
                setPushError((result && result.error) || 'Push failed');
            } else if (failed.length && !ok.length) {
                setPushError(failed[0].error);
            } else if (failed.length) {
                setPushError(`Pushed ${ok.length}; ${failed.length} failed`);
            } else {
                setPushOpen(false);
            }
        } catch (err) {
            setPushError(err.message);
        }
        setPushing(false);
        setPushProgress(null);
    };

    const handleDelete = () => runAction(async () => {
        if (!selectedShowPath) {
            return;
        }
        const label = (inspect && inspect.displayName) || 'this look';
        if (!window.confirm(`Delete ${label} from the library?`)) {
            return;
        }
        const result = await ipcRenderer.invoke('library-delete', { filePath: selectedShowPath });
        if (result && result.success) {
            if (loadedPath === selectedShowPath) {
                setLoadedPath(null);
            }
            setSelection(null);
        } else if (result && result.error) {
            setError(result.error);
        }
    });

    const handleDeleteCompilation = () => runAction(async () => {
        if (!selectedCompilation) {
            return;
        }
        const label = (selectedCompilation.compilation && selectedCompilation.compilation.name) || 'this compilation';
        if (!window.confirm(`Delete ${label}? This does not delete the original looks.`)) {
            return;
        }
        const result = await ipcRenderer.invoke('library-delete', { compilationId: selectedCompilation.id });
        if (result && result.success) {
            if (loadedPath === (selectedCompilation.compilation && selectedCompilation.compilation.dirPath)) {
                setLoadedPath(null);
            }
            setSelection(null);
        } else if (result && result.error) {
            setError(result.error);
        }
    });

    const handleDeleteFolder = () => runAction(async () => {
        if (!selection || selection.type !== 'folder') {
            return;
        }
        const label = (selectedFolder && selectedFolder.name) || 'this folder';
        if (!window.confirm(`Remove ${label}? Looks inside stay in the library.`)) {
            return;
        }
        const result = await ipcRenderer.invoke('library-delete-folder', { id: selection.id });
        if (result && result.success) {
            setSelection(null);
        } else if (result && result.error) {
            setError(result.error);
        }
    });

    const list = React.createElement(ShowList, {
        tree,
        collapsed,
        selected: selection,
        loadedPath,
        busy,
        playDisabled: busy || !(playable || folderPlayable || compilationPlayable),
        onSelect: setSelection,
        onRenameShow: handleRenameShow,
        onRenameFolder: handleRenameFolder,
        onRenameCompilation: handleRenameCompilation,
        onCreateFolder: handleCreateFolder,
        onToggleCollapsed: handleToggleCollapsed,
        onMove: handleMove,
        onPlay: handlePlay,
        onQueuePlay,
        onQueueAdd,
        onOpenPush: handleOpenPush,
        canPush,
        onSelectedIdsChange: (ids) => {
            selectedIdsRef.current = ids || [];
        }
    });
    const pushDialog = React.createElement(PushToSdDialog, {
        open: pushOpen,
        jobs: pushJobs,
        lookName: (() => {
            const ids = (selectedIdsRef.current && selectedIdsRef.current.length)
                ? selectedIdsRef.current
                : (selection && selection.id ? [selection.id] : []);
            if (ids.length === 1 && selectedFolder && pushJobs.length) {
                return `${selectedFolder.name} · ${pushJobs.length} look${pushJobs.length === 1 ? '' : 's'}`;
            }
            if (pushJobs.length === 1) {
                return pushJobs[0].dest || pushJobs[0].name;
            }
            return pushJobs.length ? `${pushJobs.length} looks` : '';
        })(),
        devices,
        pushing,
        pushProgress,
        pushError,
        onClose: () => {
            if (!pushing) {
                setPushOpen(false);
            }
        },
        onPush: handlePush
    });
    const inspector = React.createElement(ShowInspector, {
        selection,
        show: inspect,
        folder: selectedFolder,
        compilation: selectedCompilation && selectedCompilation.compilation,
        stack: folderStack,
        name,
        notes,
        busy,
        onNameChange: handleNameChange,
        onNotesChange: handleNotesChange,
        onFolderNameChange: handleRenameFolder,
        onCompilationNameChange: handleRenameCompilation,
        onDelete: handleDelete,
        onDeleteFolder: handleDeleteFolder,
        onDeleteCompilation: handleDeleteCompilation
    });
    const main = React.createElement('div', {
        className: 'flex-1 min-h-0 flex flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-950'
    },
        error && React.createElement('div', {
            className: 'px-3 pt-2 text-sm text-red-500'
        }, error),
        React.createElement('div', {
            className: 'flex-1 p-3 min-h-0 overflow-hidden'
        }, inspector)
    );
    if (!railHost) {
        return React.createElement(React.Fragment, null, main, pushDialog);
    }
    return React.createElement(React.Fragment, null,
        createPortal(React.createElement('div', {
            className: 'h-full min-h-0 flex flex-col p-2'
        }, list), railHost),
        main,
        pushDialog
    );
});

module.exports = LibraryPanel;
