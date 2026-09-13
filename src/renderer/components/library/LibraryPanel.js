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
    const saveTimer = useRef(null);
    const selectedRef = useRef(null);
    const dirtyRef = useRef(false);
    const nameRef = useRef('');
    const notesRef = useRef('');

    selectedRef.current = selectedPath;
    nameRef.current = name;
    notesRef.current = notes;

    useEffect(() => {
        dirtyRef.current = false;
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

        loadList();
        ipcRenderer.on('library-updated', handleUpdated);
        ipcRenderer.on('file-loaded', handleFileLoaded);
        return () => {
            ipcRenderer.removeListener('library-updated', handleUpdated);
            ipcRenderer.removeListener('file-loaded', handleFileLoaded);
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

    const handleRename = () => runAction(async () => {
        if (!selectedPath) {
            return;
        }
        const current = inspect && inspect.filename
            ? inspect.filename.replace(/\.dmx$/i, '')
            : '';
        const next = window.prompt('Rename file (without .dmx)', current);
        if (next == null) {
            return;
        }
        const result = await ipcRenderer.invoke('library-rename', {
            filePath: selectedPath,
            name: next
        });
        if (result && result.success) {
            setSelectedPath(result.filePath);
            if (loadedPath === selectedPath) {
                setLoadedPath(result.filePath);
            }
        } else if (result && result.error) {
            setError(result.error);
        }
    });

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
        className: 'flex-1 bg-white rounded-lg shadow-md min-h-0 flex flex-col overflow-hidden'
    },
        React.createElement('div', {
            className: 'flex items-center justify-between gap-2 p-3 border-b'
        },
            React.createElement('div', {
                className: 'text-sm text-gray-600 truncate'
            }, libraryDir ? `Library: ${libraryDir}` : 'Library'),
            React.createElement('button', {
                type: 'button',
                className: 'px-3 py-2 rounded bg-gray-700 text-white disabled:opacity-50',
                disabled: busy,
                onClick: handleImport
            }, 'Import')
        ),
        error && React.createElement('div', {
            className: 'px-3 pt-2 text-sm text-red-600'
        }, error),
        React.createElement('div', {
            className: 'flex flex-1 min-h-0'
        },
            React.createElement('div', {
                className: 'w-72 border-r p-2 overflow-y-auto'
            },
                React.createElement(ShowList, {
                    shows,
                    selectedPath,
                    loadedPath,
                    onSelect: setSelectedPath
                })
            ),
            React.createElement('div', {
                className: 'flex-1 p-4 min-h-0'
            },
                React.createElement(ShowInspector, {
                    show: inspect,
                    name,
                    notes,
                    busy,
                    onNameChange: handleNameChange,
                    onNotesChange: handleNotesChange,
                    onPlay: handlePlay,
                    onRename: handleRename,
                    onDelete: handleDelete,
                    onExport: handleExport
                })
            )
        )
    );
};

module.exports = LibraryPanel;
