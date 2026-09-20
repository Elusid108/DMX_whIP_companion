const React = require('react');
const { useEffect, useMemo, useRef, useState } = React;
const ipcRenderer = require('../../ipc');
const { formatAddr, toAddr } = require('../../../services/shared/pushFit');

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

const chipClass = (level) => {
    if (level === 'green') {
        return 'text-emerald-600 dark:text-emerald-400';
    }
    if (level === 'red') {
        return 'text-red-500';
    }
    return 'text-amber-600 dark:text-amber-400';
};

const barColor = (level) => {
    if (level === 'green') {
        return 'bg-emerald-500/70';
    }
    if (level === 'red') {
        return 'bg-red-500/70';
    }
    return 'bg-amber-400/70';
};

const CoverageBar = ({ look }) => {
    const span = look && look.span;
    const rows = (look && look.devices) || [];
    if (!span || !rows.length) {
        return null;
    }
    const slide = (look.batch && look.batch.slideDelta) || 0;
    const ranges = (Array.isArray(span.ranges) && span.ranges.length)
        ? span.ranges
        : [{ firstAddr: span.firstAddr, lastAddr: span.lastAddr }];
    let min = ranges[0].firstAddr + slide;
    let max = ranges[0].lastAddr + slide;
    ranges.forEach((range) => {
        const start = range.firstAddr + slide;
        const end = range.lastAddr + slide;
        if (start < min) {
            min = start;
        }
        if (end > max) {
            max = end;
        }
    });
    rows.forEach((row) => {
        if (!row.capacity) {
            return;
        }
        const start = toAddr(row.startUni, row.startCh);
        const end = start + row.capacity - 1;
        if (start < min) {
            min = start;
        }
        if (end > max) {
            max = end;
        }
    });
    const total = Math.max(1, max - min + 1);

    return React.createElement('div', {
        className: 'relative h-6 rounded bg-zinc-200 dark:bg-zinc-800 overflow-hidden mb-1.5'
    },
        ranges.map((range, index) => {
            const first = range.firstAddr + slide;
            const last = range.lastAddr + slide;
            const left = ((first - min) / total) * 100;
            const width = ((last - first + 1) / total) * 100;
            return React.createElement('div', {
                key: `file-${range.universe != null ? range.universe : index}`,
                className: 'absolute inset-y-1 rounded-sm bg-zinc-400/50 dark:bg-zinc-600/50',
                style: { left: `${left}%`, width: `${Math.max(width, 1.5)}%` },
                title: look.fileLabel
            });
        }),
        rows.map((row) => {
            if (!row.capacity) {
                return null;
            }
            const start = toAddr(row.startUni, row.startCh);
            const left = ((start - min) / total) * 100;
            const width = (row.capacity / total) * 100;
            return React.createElement('div', {
                key: row.id,
                className: `absolute top-0 h-1.5 rounded-sm ${barColor(row.level)}`,
                style: { left: `${left}%`, width: `${Math.max(width, 1.2)}%` },
                title: `${row.longName} · ${row.label}`
            });
        })
    );
};

const PushToSdDialog = ({
    open,
    lookName,
    jobs,
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
    const [analysis, setAnalysis] = useState(null);
    const [analyzing, setAnalyzing] = useState(false);
    const openedRef = useRef(false);
    const requestRef = useRef(0);

    useEffect(() => {
        if (!open) {
            openedRef.current = false;
            setAnalysis(null);
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

    const jobsKey = (jobs || []).map((job) => `${job.filePath}:${job.dest || ''}`).join('|');

    useEffect(() => {
        if (!open || !jobs || !jobs.length || !selectedIds.length) {
            setAnalysis(null);
            setAnalyzing(false);
            return undefined;
        }
        const chosen = targets.filter((device) => selectedIds.includes(device.id));
        if (!chosen.length) {
            setAnalysis(null);
            return undefined;
        }
        let cancelled = false;
        const request = requestRef.current + 1;
        requestRef.current = request;
        setAnalyzing(true);
        ipcRenderer.invoke('device-push-analyze', {
            jobs,
            devices: chosen.map((device) => ({
                id: device.id,
                ip: device.ip,
                mac: device.mac,
                longName: device.longName,
                shortName: device.shortName
            }))
        }).then((result) => {
            if (cancelled || request !== requestRef.current) {
                return;
            }
            if (result && result.success) {
                setAnalysis(result.analysis);
            } else {
                setAnalysis(null);
            }
            setAnalyzing(false);
        }).catch(() => {
            if (!cancelled && request === requestRef.current) {
                setAnalysis(null);
                setAnalyzing(false);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [open, jobsKey, selectedIds, targets]);

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

    const lookRows = (analysis && analysis.looks) || [];
    const overall = analysis && analysis.overall;
    const canConfirm = Boolean(overall && overall.canPush) && selectedIds.length > 0 && !analyzing;
    const pushLabel = pushing
        ? 'Pushing…'
        : (overall && overall.pushLabel) || 'Push';

    const toggle = (id) => {
        setSelectedIds((current) => (
            current.includes(id)
                ? current.filter((item) => item !== id)
                : [...current, id]
        ));
    };

    const identify = (event, ip) => {
        event.preventDefault();
        event.stopPropagation();
        if (!ip || pushing) {
            return;
        }
        ipcRenderer.invoke('device-identify', { ip }).catch(() => {});
    };

    const deviceAnalysis = (id) => {
        for (let i = 0; i < lookRows.length; i += 1) {
            const row = (lookRows[i].devices || []).find((item) => item.id === id);
            if (row) {
                return row;
            }
        }
        return (analysis && analysis.devices || []).find((item) => item.id === id) || null;
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
            className: 'w-full max-w-2xl rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-800 dark:bg-zinc-900 max-h-[90vh] overflow-y-auto',
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
                        className: 'max-h-52 overflow-y-auto flex flex-col gap-1 mb-2'
                    },
                        targets.map((device) => {
                            const row = deviceAnalysis(device.id);
                            const window = row && row.capacity
                                ? row
                                : null;
                            return React.createElement('div', {
                                key: device.id,
                                className: 'flex items-start gap-2 text-sm'
                            },
                                React.createElement('label', {
                                    className: 'flex items-start gap-2 min-w-0 flex-1'
                                },
                                    React.createElement('input', {
                                        type: 'checkbox',
                                        className: 'h-3.5 w-3.5 accent-cyan-400 flex-none mt-0.5',
                                        checked: selectedIds.includes(device.id),
                                        disabled: pushing,
                                        onChange: () => toggle(device.id)
                                    }),
                                    React.createElement('span', {
                                        className: 'min-w-0'
                                    },
                                        React.createElement('span', {
                                            className: 'truncate block'
                                        }, deviceLabel(device)),
                                        React.createElement('span', {
                                            className: 'text-xs text-zinc-500 block'
                                        }, window
                                            ? `${window.deviceProto || 'auto'} · ${formatAddr(window.startUni, window.startCh)} · ${window.count} px · ${window.chPx} ch/px`
                                            : (analyzing ? 'Reading patch…' : 'Waiting for /status'))
                                    )
                                ),
                                row && React.createElement('span', {
                                    className: `text-xs flex-none pt-0.5 ${chipClass(row.level)}`
                                }, row.label),
                                React.createElement('button', {
                                    type: 'button',
                                    className: 'btn-quiet text-xs flex-none',
                                    disabled: pushing,
                                    onClick: (event) => identify(event, device.ip)
                                }, 'Identify')
                            );
                        })
                    )
                ),
            lookRows.map((look) => React.createElement('div', {
                key: look.filePath,
                className: 'mb-2 rounded-md border border-zinc-200 dark:border-zinc-800 p-2'
            },
                React.createElement('div', {
                    className: 'text-xs font-medium truncate mb-0.5'
                }, look.name),
                React.createElement('div', {
                    className: 'text-xs text-zinc-500 mb-1'
                }, look.fileLabel),
                React.createElement(CoverageBar, { look }),
                React.createElement('div', {
                    className: `text-xs ${chipClass(look.batch.level)}`
                }, look.batch.label),
                look.devices.some((row) => row.extraOutputs) && React.createElement('p', {
                    className: 'text-xs text-zinc-500 mt-1'
                }, 'SD play is output 0 only.')
            )),
            analyzing && !lookRows.length && React.createElement('p', {
                className: 'text-xs text-zinc-500 mb-2'
            }, 'Comparing files to node patches…'),
            overall && overall.needsFirmwareSync && React.createElement('p', {
                className: 'text-xs text-amber-600 dark:text-amber-400 mb-2'
            }, 'Update firmware for lockstep. Files will still play, but nodes may drift.'),
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
            overall && React.createElement('p', {
                className: `text-xs mb-2 ${chipClass(overall.level)}`
            }, overall.label),
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
                    disabled: pushing || !canConfirm,
                    onClick: () => onPush(selectedIds)
                }, pushLabel)
            )
        )
    );
};

module.exports = PushToSdDialog;
