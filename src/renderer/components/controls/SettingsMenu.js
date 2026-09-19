const React = require('react');
const { useEffect, useRef, useState } = React;
const { version } = require('../../../../package.json');
const ipcRenderer = require('../../ipc');

const CogIcon = () => React.createElement('svg', {
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className: 'w-3.5 h-3.5',
    'aria-hidden': true
},
    React.createElement('circle', { cx: '12', cy: '12', r: '3' }),
    React.createElement('path', {
        d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z'
    })
);

const SettingsMenu = ({ theme, onToggleTheme }) => {
    const [open, setOpen] = useState(false);
    const [libraryDir, setLibraryDir] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const rootRef = useRef(null);

    useEffect(() => {
        if (!open) {
            return undefined;
        }
        const onPointerDown = (event) => {
            if (rootRef.current && !rootRef.current.contains(event.target)) {
                setOpen(false);
            }
        };
        const onKeyDown = (event) => {
            if (event.key === 'Escape') {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);

    useEffect(() => {
        if (!open) {
            return undefined;
        }
        let cancelled = false;
        const applyDir = (dir) => {
            if (!cancelled) {
                setLibraryDir(dir || '');
            }
        };
        ipcRenderer.invoke('library-list').then((result) => {
            if (result && result.success) {
                applyDir(result.libraryDir);
            }
        }).catch(() => {});
        const handleUpdated = (event, payload = {}) => {
            applyDir(payload.libraryDir);
        };
        ipcRenderer.on('library-updated', handleUpdated);
        return () => {
            cancelled = true;
            ipcRenderer.removeListener('library-updated', handleUpdated);
        };
    }, [open]);

    const runLibrary = async (work) => {
        if (busy) {
            return;
        }
        setBusy(true);
        setError('');
        try {
            const result = await work();
            if (result && result.success) {
                if (result.libraryDir) {
                    setLibraryDir(result.libraryDir);
                }
            } else if (result && result.error && result.error !== 'No file selected') {
                setError(result.error);
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    return React.createElement('div', {
        ref: rootRef,
        className: 'relative ml-auto'
    },
        React.createElement('button', {
            type: 'button',
            className: 'btn-quiet flex-none p-1.5',
            title: 'Settings',
            'aria-label': 'Settings',
            'aria-expanded': open,
            onClick: () => setOpen((current) => !current)
        },
            React.createElement(CogIcon)
        ),
        open && React.createElement('div', {
            className: 'absolute right-0 top-full mt-1 z-20 w-72 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-800 dark:bg-zinc-900'
        },
            React.createElement('button', {
                type: 'button',
                className: 'btn-quiet w-full justify-center',
                onClick: onToggleTheme
            }, theme === 'dark' ? 'Light mode' : 'Dark mode'),
            React.createElement('div', {
                className: 'mt-2 pt-2 border-t border-zinc-200 dark:border-zinc-800'
            },
                React.createElement('div', {
                    className: 'label-micro mb-1'
                }, 'Library'),
                React.createElement('div', {
                    className: 'text-xs text-zinc-500 truncate mb-1.5',
                    title: libraryDir
                }, libraryDir || 'Library folder'),
                React.createElement('div', {
                    className: 'flex gap-1.5'
                },
                    React.createElement('button', {
                        type: 'button',
                        className: 'btn-quiet flex-1 justify-center',
                        disabled: busy,
                        onClick: () => runLibrary(() => ipcRenderer.invoke('library-choose-dir'))
                    }, 'Change folder'),
                    React.createElement('button', {
                        type: 'button',
                        className: 'btn-quiet flex-1 justify-center',
                        disabled: busy,
                        onClick: () => runLibrary(() => ipcRenderer.invoke('library-import'))
                    }, 'Import')
                ),
                error && React.createElement('p', {
                    className: 'text-xs text-red-500 mt-1.5'
                }, error)
            ),
            React.createElement('div', {
                className: 'readout mt-2 px-1 text-center'
            }, `v${version}`),
            React.createElement('button', {
                type: 'button',
                className: 'mt-1 w-full text-center text-xs text-cyan-600 dark:text-cyan-400 hover:underline',
                onClick: () => ipcRenderer.invoke('open-external-url', { url: 'https://chrismoore.me' })
            }, 'chrismoore.me')
        )
    );
};

module.exports = SettingsMenu;
