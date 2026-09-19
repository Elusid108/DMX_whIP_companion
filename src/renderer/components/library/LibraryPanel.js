const React = require('react');
const { useState, useEffect, useRef } = React;
const ipcRenderer = require('../../ipc');
const ShowList = require('./ShowList');
const ShowInspector = require('./ShowInspector');
const {
    collectLooks,
    findNode,
    firstShowPath,
    flattenFolderStack,
    folderExists
} = require('../../../services/shared/libraryTree');

const LibraryPanel = () => {
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
    const [targetId, setTargetId] = useState(null);
    const [pushing, setPushing] = useState(false);
    const [pushError, setPushError] = useState('');
    const [pushProgress, setPushProgress] = useState(null);
    const [collapsed, setCollapsed] = useState([]);
    const saveTimer = useRef(null);
    const selectedRef = useRef(null);
    const dirtyRef = useRef(false);
    const nameRef = useRef('');
    const notesRef = useRef('');

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
            setPushProgress(progress);
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
            const next = payload.devices || [];
            setDevices(next);
            setTargetId((current) => {
                const idle = next.filter((device) => device && !device.stale);
                if (current && idle.some((device) => device.id === current)) {
                    return current;
                }
                return idle[0] ? idle[0].id : null;
            });
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
        if (selectedCompilation && selectedCompilation.compilation) {
            const result = await ipcRenderer.invoke('load-compilation', {
                dirPath: selectedCompilation.compilation.dirPath
            });
            if (result && !result.success) {
                setError(result.error || 'Unable to load compilation');
            }
            return;
        }
        if (selectedFolder) {
            const sources = collectLooks(selectedFolder);
            if (sources.length === 0) {
                setError('This folder has no looks to load');
                return;
            }
            const result = await ipcRenderer.invoke('load-compilation', {
                name: selectedFolder.name,
                sources
            });
            if (result && !result.success) {
                setError(result.error || 'Unable to load folder');
            } else if (result && result.skipped && result.skipped.length) {
                setError(`Loaded with ${result.skipped.length} skipped look(s)`);
            }
            return;
        }
        if (!selectedShowPath) {
            return;
        }
        const displayName = (inspect && (inspect.name || inspect.displayName)) || undefined;
        const result = await ipcRenderer.invoke('load-recording', {
            filePath: selectedShowPath,
            displayName
        });
        if (result && !result.success) {
            setError(result.error || 'Unable to load recording');
        }
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

    const handlePush = () => {
        if (!selectedShowPath || !targetId || pushing) {
            return;
        }
        const target = devices.find((device) => device.id === targetId);
        if (!target || target.stale || !target.ip) {
            setPushError('Select an idle node');
            return;
        }
        setPushing(true);
        setPushError('');
        setPushProgress({ phase: 'connecting', sent: 0, total: 0 });
        ipcRenderer.invoke('device-push-show', {
            ip: target.ip,
            filePath: selectedShowPath
        }).then((result) => {
            if (!result || !result.success) {
                setPushError((result && result.error) || 'Push failed');
                return;
            }
            const dest = result.result && result.result.path;
            setPushError(dest ? `Pushed ${dest}` : '');
        }).catch((err) => {
            setPushError(err.message);
        }).finally(() => {
            setPushing(false);
            setPushProgress(null);
        });
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

    const playable = Boolean(inspect && inspect.playable);
    const folderPlayable = Boolean(selectedFolder && collectLooks(selectedFolder).length > 0);
    const compilationPlayable = Boolean(selectedCompilation && selectedCompilation.compilation);
    const targets = devices.filter((device) => device && device.ip && !device.stale);
    const canPush = Boolean(selectedShowPath && inspect && inspect.playable && targetId
        && targets.some((device) => device.id === targetId));

    return React.createElement('div', {
        className: 'flex-1 min-h-0 flex flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-950'
    },
        error && React.createElement('div', {
            className: 'px-3 pt-2 text-sm text-red-500'
        }, error),
        React.createElement('div', {
            className: 'flex flex-1 min-h-0'
        },
            React.createElement('div', {
                className: 'app-sidebar overflow-hidden p-2 flex flex-col'
            },
                React.createElement(ShowList, {
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
                    devices,
                    targetId,
                    pushing,
                    pushProgress,
                    pushError,
                    onTargetChange: setTargetId,
                    onPush: handlePush,
                    canPush
                })
            ),
            React.createElement('div', {
                className: 'flex-1 p-3 min-h-0 overflow-hidden'
            },
                React.createElement(ShowInspector, {
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
                })
            )
        )
    );
};

module.exports = LibraryPanel;
