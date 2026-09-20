const React = require('react');
const { useEffect, useMemo, useRef, useState } = React;

const formatBytes = (bytes) => {
    const value = Number(bytes) || 0;
    if (value < 1024) {
        return `${value} B`;
    }
    if (value < 1024 * 1024) {
        return `${(value / 1024).toFixed(1)} KB`;
    }
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

const deviceLabel = (device) => (
    `${device.longName || device.shortName || 'dmxwhip'} (${device.ip})`
);

const PushToSdDialog = ({
    open,
    lookName,
    devices,
    pushing,
    pushProgress,
    pushError,
    onClose,
    onPush
}) => {
    const targets = useMemo(
        () => (devices || []).filter((device) => device && device.ip && !device.stale),
        [devices]
    );
    const [selectedIds, setSelectedIds] = useState([]);
    const openedRef = useRef(false);

    useEffect(() => {
        if (!open) {
            openedRef.current = false;
            return;
        }
        if (!openedRef.current) {
            openedRef.current = true;
            setSelectedIds(targets[0] ? [targets[0].id] : []);
            return;
        }
        setSelectedIds((current) => current.filter((id) => (
            targets.some((device) => device.id === id)
        )));
    }, [open, targets]);

    useEffect(() => {
        if (!open) {
            return undefined;
        }
        const onKeyDown = (event) => {
            if (event.key === 'Escape' && !pushing) {
                onClose();
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [open, pushing, onClose]);

    if (!open) {
        return null;
    }

    const allSelected = targets.length > 0 && targets.every((device) => selectedIds.includes(device.id));
    const sent = Number(pushProgress && pushProgress.sent) || 0;
    const total = Number(pushProgress && pushProgress.total) || 0;
    const percent = total > 0 ? Math.min(100, Math.round((sent / total) * 100)) : 0;
    const phase = pushProgress && pushProgress.phase;
    const currentLabel = pushProgress && pushProgress.label;
    const phaseLabel = phase === 'connecting'
        ? 'Connecting…'
        : phase === 'waiting'
            ? 'Waiting for the node…'
            : phase === 'sending'
                ? 'Sending…'
                : '';
    const elapsed = pushProgress && pushProgress.startedAt
        ? Date.now() - pushProgress.startedAt
        : 0;
    let etaLabel = '';
    if (phase === 'sending' && sent > 256 * 1024 && elapsed > 1000 && sent < total) {
        const remainMs = ((total - sent) / sent) * elapsed;
        const remainSec = Math.max(1, Math.round(remainMs / 1000));
        const minutes = Math.floor(remainSec / 60);
        const seconds = remainSec % 60;
        etaLabel = minutes > 0
            ? `~${minutes} min ${seconds}s left`
            : `~${seconds}s left`;
    }

    const toggle = (id) => {
        setSelectedIds((current) => (
            current.includes(id)
                ? current.filter((item) => item !== id)
                : [...current, id]
        ));
    };

    return React.createElement('div', {
        className: 'fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4',
        onMouseDown: (event) => {
            if (event.target === event.currentTarget && !pushing) {
                onClose();
            }
        }
    },
        React.createElement('div', {
            className: 'w-80 max-w-full rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-800 dark:bg-zinc-900',
            role: 'dialog',
            'aria-modal': true,
            'aria-label': 'Push to SD'
        },
            React.createElement('div', {
                className: 'text-sm font-medium mb-1'
            }, 'Push to SD'),
            React.createElement('p', {
                className: 'text-xs text-zinc-500 truncate mb-2',
                title: lookName || ''
            }, lookName || 'Selected look'),
            targets.length === 0
                ? React.createElement('p', {
                    className: 'text-sm text-zinc-500 italic'
                }, 'No idle nodes')
                : React.createElement(React.Fragment, null,
                    React.createElement('label', {
                        className: 'flex items-center gap-2 text-xs text-zinc-500 mb-1.5'
                    },
                        React.createElement('input', {
                            type: 'checkbox',
                            className: 'h-3.5 w-3.5 accent-cyan-400',
                            checked: allSelected,
                            disabled: pushing,
                            onChange: (event) => {
                                setSelectedIds(event.target.checked
                                    ? targets.map((device) => device.id)
                                    : []);
                            }
                        }),
                        'Select all'
                    ),
                    React.createElement('div', {
                        className: 'max-h-48 overflow-y-auto flex flex-col gap-1 mb-2'
                    },
                        targets.map((device) => React.createElement('label', {
                            key: device.id,
                            className: 'flex items-center gap-2 text-sm'
                        },
                            React.createElement('input', {
                                type: 'checkbox',
                                className: 'h-3.5 w-3.5 accent-cyan-400 flex-none',
                                checked: selectedIds.includes(device.id),
                                disabled: pushing,
                                onChange: () => toggle(device.id)
                            }),
                            React.createElement('span', {
                                className: 'truncate'
                            }, deviceLabel(device))
                        ))
                    )
                ),
            pushing && React.createElement('div', {
                className: 'flex flex-col gap-1 mb-2'
            },
                React.createElement('div', {
                    className: 'h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden'
                },
                    React.createElement('div', {
                        className: 'h-full bg-cyan-500',
                        style: { width: `${percent}%` }
                    })
                ),
                React.createElement('p', {
                    className: 'readout'
                }, [
                    currentLabel,
                    total > 0 ? `${percent}% · ${formatBytes(sent)} / ${formatBytes(total)}` : phaseLabel || 'Connecting…',
                    total > 0 ? phaseLabel : null,
                    etaLabel
                ].filter(Boolean).join(' · '))
            ),
            pushError && React.createElement('div', {
                className: `text-sm mb-2 ${pushError.startsWith('Pushed ')
                    ? 'text-cyan-600 dark:text-cyan-400'
                    : 'text-red-500'}`
            }, pushError),
            React.createElement('div', {
                className: 'flex gap-1.5'
            },
                React.createElement('button', {
                    type: 'button',
                    className: 'btn-quiet flex-1 justify-center',
                    disabled: pushing,
                    onClick: onClose
                }, 'Cancel'),
                React.createElement('button', {
                    type: 'button',
                    className: 'btn-primary flex-1 justify-center',
                    disabled: pushing || selectedIds.length === 0,
                    onClick: () => onPush(selectedIds)
                }, pushing ? 'Pushing…' : 'Push')
            )
        )
    );
};

module.exports = PushToSdDialog;
