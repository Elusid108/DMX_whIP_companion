const React = require('react');
const { useState, useEffect, useRef } = React;
const ipcRenderer = require('../../ipc');
const ShowList = require('./ShowList');
const ShowInspector = require('./ShowInspector');

const LibraryPanel = () => {
    const [shows, setShows] = useState([]);
    const [libraryDir, setLibraryDir] = useState('');
    const [selectedPath, setSelectedPath] = useState(null);
    const [loadedPath, setLoadedPath] = useState(null);
    const [inspect, setInspect] = useState(null);
    const [name, setName] = useState('');
    const [notes, setNotes] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [devices, setDevices] = useState([]);
    const [targetId, setTargetId] = useState(null);
    const [pushing, setPushing] = useState(false);
    const [pushError, setPushError] = useState('');
    const [pushProgress, setPushProgress] = useState(null);
    const [renaming, setRenaming] = useState(false);
    const [renameDraft, setRenameDraft] = useState('');
    const saveTimer = useRef(null);
    const selectedRef = useRef(null);
    const dirtyRef = useRef(false);
    const nameRef = useRef('');
    const notesRef = useRef('');

    selectedRef.current = selectedPath;
    nameRef.current = name;
    notesRef.current = notes;

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
        setRenaming(false);
        setRenameDraft('');
    }, [selectedPath]);

    const applyList = (nextShows) => {
        setShows(nextShows);
        setSelectedPath((current) => {
            if (current && nextShows.some((show) => show.filePath === current)) {
                return current;
            }
            return nextShows[0] ? nextShows[0].filePath : null;
        });
    };

    useEffect(() => {
        const loadList = async () => {
            const result = await ipcRenderer.invoke('library-list');
            if (result && result.success) {
                setLibraryDir(result.libraryDir || '');
                applyList(result.shows || []);
            } else if (result && result.error) {
                setError(result.error);
            }
        };

        const handleUpdated = (event, payload = {}) => {
            setLibraryDir(payload.libraryDir || '');
            applyList(payload.shows || []);
        };

        const handleFileLoaded = (event, result = {}) => {
            if (result.success && result.filePath) {
                setLoadedPath(result.filePath);
                setError('');
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
            if (dirtyRef.current && selectedRef.current) {
                ipcRenderer.invoke('library-save-meta', {
                    filePath: selectedRef.current,
                    name: nameRef.current,
                    notes: notesRef.current
                });
            }
        };
    }, []);

    useEffect(() => {
        if (!selectedPath) {
            setInspect(null);
            setName('');
            setNotes('');
            return undefined;
        }

        let cancelled = false;
        const loadInspect = async () => {
            const result = await ipcRenderer.invoke('library-inspect', { filePath: selectedPath });
            if (cancelled || selectedRef.current !== selectedPath) {
                return;
            }
            if (result && result.success) {
                setInspect(result.show);
                if (!dirtyRef.current) {
                    setName(result.show.name || '');
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
    }, [selectedPath, shows]);

    const queueSaveMeta = (nextName, nextNotes) => {
        clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(async () => {
            if (!selectedRef.current) {
                return;
            }
            const result = await ipcRenderer.invoke('library-save-meta', {
                filePath: selectedRef.current,
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

    const handleChangeFolder = () => runAction(async () => {
        const result = await ipcRenderer.invoke('library-choose-dir');
        if (result && result.success) {
            setLibraryDir(result.libraryDir || '');
            applyList(result.shows || []);
        } else if (result && result.error && result.error !== 'No file selected') {
            setError(result.error);
        }
    });

    const handleImport = () => runAction(async () => {
        const result = await ipcRenderer.invoke('library-import');
        if (result && result.success) {
            setSelectedPath(result.filePath);
        } else if (result && result.error && result.error !== 'No file selected') {
            setError(result.error);
        }
    });

    const handleExport = () => runAction(async () => {
        if (!selectedPath) {
            return;
        }
        const result = await ipcRenderer.invoke('library-export', { filePath: selectedPath });
        if (result && result.error && result.error !== 'No file selected') {
            setError(result.error);
        }
    });

    const handlePlay = () => runAction(async () => {
        if (!selectedPath) {
            return;
        }
        const result = await ipcRenderer.invoke('load-recording', { filePath: selectedPath });
        if (result && !result.success) {
            setError(result.error || 'Unable to load recording');
        }
    });

    const handleRename = () => {
        if (!selectedPath) {
            return;
        }
        const current = inspect && inspect.filename
            ? inspect.filename.replace(/\.dmx$/i, '')
            : '';
        setRenameDraft(current);
        setRenaming(true);
    };

    const handleRenameCancel = () => {
        setRenaming(false);
        setRenameDraft('');
    };

    const handleRenameConfirm = () => runAction(async () => {
        if (!selectedPath) {
            return;
        }
        const next = String(renameDraft || '').trim();
        if (!next) {
            return;
        }
        const result = await ipcRenderer.invoke('library-rename', {
            filePath: selectedPath,
            name: next
        });
        if (result && result.success) {
            setRenaming(false);
            setSelectedPath(result.filePath);
            if (loadedPath === selectedPath) {
                setLoadedPath(result.filePath);
            }
        } else if (result && result.error) {
            setError(result.error);
        }
    });

    const handlePush = () => {
        if (!selectedPath || !targetId || pushing) {
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
            filePath: selectedPath
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
        if (!selectedPath) {
            return;
        }
        const label = (inspect && inspect.displayName) || 'this show';
        if (!window.confirm(`Delete ${label} from the library?`)) {
            return;
        }
        const result = await ipcRenderer.invoke('library-delete', { filePath: selectedPath });
        if (result && result.success) {
            if (loadedPath === selectedPath) {
                setLoadedPath(null);
            }
            setSelectedPath(null);
        } else if (result && result.error) {
            setError(result.error);
        }
    });

    return React.createElement('div', {
        className: 'flex-1 min-h-0 flex flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-950'
    },
        React.createElement('div', {
            className: 'flex items-center justify-between gap-2 px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-800'
        },
            React.createElement('div', {
                className: 'text-xs text-zinc-500 truncate',
                title: libraryDir
            }, libraryDir || 'Library'),
            React.createElement('div', {
                className: 'flex items-center gap-1.5 flex-none'
            },
                React.createElement('button', {
                    type: 'button',
                    className: 'btn-quiet',
                    disabled: busy,
                    onClick: handleChangeFolder
                }, 'Change folder'),
                React.createElement('button', {
                    type: 'button',
                    className: 'btn-quiet',
                    disabled: busy,
                    onClick: handleImport
                }, 'Import')
            )
        ),
        error && React.createElement('div', {
            className: 'px-3 pt-2 text-sm text-red-500'
        }, error),
        React.createElement('div', {
            className: 'flex flex-1 min-h-0'
        },
            React.createElement('div', {
                className: 'w-72 border-r border-zinc-200 dark:border-zinc-800 p-2 overflow-y-auto'
            },
                React.createElement(ShowList, {
                    shows,
                    selectedPath,
                    loadedPath,
                    onSelect: setSelectedPath
                })
            ),
            React.createElement('div', {
                className: 'flex-1 p-3 min-h-0 overflow-hidden'
            },
                React.createElement(ShowInspector, {
                    show: inspect,
                    name,
                    notes,
                    busy,
                    onNameChange: handleNameChange,
                    onNotesChange: handleNotesChange,
                    renaming,
                    renameDraft,
                    onPlay: handlePlay,
                    onRename: handleRename,
                    onRenameDraftChange: setRenameDraft,
                    onRenameConfirm: handleRenameConfirm,
                    onRenameCancel: handleRenameCancel,
                    onDelete: handleDelete,
                    onExport: handleExport,
                    devices,
                    targetId,
                    pushing,
                    pushProgress,
                    pushError,
                    onTargetChange: setTargetId,
                    onPush: handlePush
                })
            )
        )
    );
};

module.exports = LibraryPanel;
