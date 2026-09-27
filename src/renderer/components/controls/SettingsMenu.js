const React = require('react');
const { useCallback, useEffect, useRef, useState } = React;
const { version } = require('../../../../package.json');
const ipcRenderer = require('../../ipc');
const NetworkSelect = require('./NetworkSelect');
const { Button, IconButton, Icons, Popover } = require('../ui');

const SettingsMenu = ({
    theme,
    onToggleTheme,
    networkInterfaces,
    selectedNic,
    onInputNicChange,
    playbackNetwork,
    onOutputNicChange
}) => {
    const [open, setOpen] = useState(false);
    const [libraryDir, setLibraryDir] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const anchorRef = useRef(null);
    const close = useCallback(() => setOpen(false), []);

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
        className: 'ml-auto flex-none'
    },
        React.createElement(IconButton, {
            ref: anchorRef,
            label: 'Settings',
            icon: Icons.Cog,
            'aria-expanded': open,
            'aria-haspopup': 'dialog',
            onClick: () => setOpen((current) => !current)
        }),
        React.createElement(Popover, {
            open,
            anchorRef,
            onClose: close,
            label: 'Settings',
            className: 'w-80'
        },
            React.createElement('div', {
                className: 'flex flex-col gap-2'
            },
                React.createElement(NetworkSelect, {
                    label: 'Input NIC',
                    selectedNic,
                    networkInterfaces: networkInterfaces || [],
                    onChange: onInputNicChange
                }),
                React.createElement(NetworkSelect, {
                    label: 'Output NIC',
                    selectedNic: playbackNetwork,
                    networkInterfaces: networkInterfaces || [],
                    onChange: onOutputNicChange
                })
            ),
            React.createElement('div', {
                className: 'mt-2 pt-2 border-t border-line'
            },
                React.createElement(Button, {
                    block: true,
                    onClick: onToggleTheme
                }, theme === 'dark' ? 'Light mode' : 'Dark mode')
            ),
            React.createElement('div', {
                className: 'mt-2 pt-2 border-t border-line'
            },
                React.createElement('div', {
                    className: 'label-micro mb-1'
                }, 'Library'),
                React.createElement('div', {
                    className: 'text-xs text-muted truncate mb-1.5',
                    title: libraryDir
                }, libraryDir || 'Library folder'),
                React.createElement('div', {
                    className: 'flex gap-1.5'
                },
                    React.createElement(Button, {
                        block: true,
                        className: 'flex-1',
                        disabled: busy,
                        onClick: () => runLibrary(() => ipcRenderer.invoke('library-choose-dir'))
                    }, 'Change folder'),
                    React.createElement(Button, {
                        block: true,
                        className: 'flex-1',
                        disabled: busy,
                        onClick: () => runLibrary(() => ipcRenderer.invoke('library-import'))
                    }, 'Import')
                ),
                error && React.createElement('p', {
                    className: 'text-xs text-danger mt-1.5'
                }, error)
            ),
            React.createElement('div', {
                className: 'readout mt-2 px-1 text-center'
            }, `v${version}`),
            React.createElement('button', {
                type: 'button',
                className: 'mt-1 w-full text-center text-xs text-accent hover:underline',
                onClick: () => ipcRenderer.invoke('open-external-url', { url: 'https://chrismoore.me' })
            }, 'chrismoore.me')
        )
    );
};

module.exports = SettingsMenu;
