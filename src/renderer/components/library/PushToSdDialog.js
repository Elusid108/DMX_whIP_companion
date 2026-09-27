const React = require('react');
const { useEffect, useMemo, useRef, useState } = React;
const ipcRenderer = require('../../ipc');
const { formatAddr, toAddr } = require('../../../services/shared/pushFit');
const { formatBytes } = require('../../../services/shared/format');
const { Button, Checkbox, Dialog, EmptyState, ProgressBar, Select } = require('../ui');

const deviceLabel = (device) => (
    `${device.longName || device.shortName || 'dmxwhip'} (${device.ip})`
);

const chipClass = (level) => {
    if (level === 'green') {
        return 'text-ok';
    }
    if (level === 'red') {
        return 'text-danger';
    }
    return 'text-warn';
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
        className: 'relative h-6 rounded bg-hover overflow-hidden mb-1.5'
    },
        ranges.map((range, index) => {
            const first = range.firstAddr + slide;
            const last = range.lastAddr + slide;
            const left = ((first - min) / total) * 100;
            const width = ((last - first + 1) / total) * 100;
            return React.createElement('div', {
                key: `file-${range.universe != null ? range.universe : index}`,
                className: 'absolute inset-y-1 rounded-sm bg-faint/50',
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
    const [mode, setMode] = useState('split');
    const [holderId, setHolderId] = useState('');
    const [analysis, setAnalysis] = useState(null);
    const [analyzing, setAnalyzing] = useState(false);
    const openedRef = useRef(false);
    const requestRef = useRef(0);
    const analysisRef = useRef(null);
    analysisRef.current = analysis;

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

    const jobsKey = (jobs || []).map((job) => `${job.filePath}:${job.dest || ''}`).join('|');
    const chosen = useMemo(
        () => targets.filter((device) => selectedIds.includes(device.id)),
        [targets, selectedIds]
    );
    const analyzeKey = chosen.map((device) => `${device.id}|${device.ip}`).sort().join(',');

    useEffect(() => {
        if (!open || !jobs || !jobs.length || !selectedIds.length) {
            setAnalysis(null);
            setAnalyzing(false);
            return undefined;
        }
        const selected = targets.filter((device) => selectedIds.includes(device.id));
        if (!selected.length) {
            setAnalysis(null);
            return undefined;
        }
        let cancelled = false;
        const request = requestRef.current + 1;
        requestRef.current = request;
        if (!analysisRef.current) {
            setAnalyzing(true);
        }
        ipcRenderer.invoke('device-push-analyze', {
            jobs,
            devices: selected.map((device) => ({
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
            } else if (!analysisRef.current) {
                setAnalysis(null);
            }
            setAnalyzing(false);
        }).catch(() => {
            if (!cancelled && request === requestRef.current) {
                if (!analysisRef.current) {
                    setAnalysis(null);
                }
                setAnalyzing(false);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [open, jobsKey, analyzeKey]);

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
    const holder = selectedIds.includes(holderId) ? holderId : selectedIds[0];
    const oneShow = (jobs || []).length === 1;
    const canConfirm = selectedIds.length > 0 && !pushing
        && (mode === 'split' || (oneShow && Boolean(holder)));
    const pushLabel = pushing
        ? 'Pushing…'
        : (mode === 'distribute'
            ? 'Send & distribute'
            : (mode === 'stream'
                ? 'Send & stream'
                : (overall && overall.pushLabel) || 'Push'));

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

    return React.createElement(Dialog, {
        open,
        onClose,
        dismissible: !pushing,
        size: 'lg',
        title: 'Push to SD',
        subtitle: lookName || 'Selected look'
    },
        targets.length === 0
            ? React.createElement(EmptyState, null, 'No idle nodes')
            : React.createElement(React.Fragment, null,
                React.createElement(Checkbox, {
                    className: 'text-xs text-muted mb-1.5',
                    label: 'Select all',
                    checked: allSelected,
                    disabled: pushing,
                    onChange: (event) => {
                        setSelectedIds(event.target.checked
                            ? targets.map((device) => device.id)
                            : []);
                    }
                }),
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
                                React.createElement(Checkbox, {
                                    inputClassName: 'mt-0.5',
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
                                        className: 'text-xs text-muted block'
                                    }, window
                                        ? `${window.deviceProto || 'auto'} · ${formatAddr(window.startUni, window.startCh)} · ${window.count} px · ${window.chPx} ch/px`
                                        : (analyzing ? 'Reading patch…' : 'Waiting for /status'))
                                )
                            ),
                            row && React.createElement('span', {
                                className: `text-xs flex-none pt-0.5 ${chipClass(row.level)}`
                            }, row.label),
                            React.createElement(Button, {
                                className: 'flex-none',
                                disabled: pushing,
                                onClick: (event) => identify(event, device.ip)
                            }, 'Identify')
                        );
                    })
                )
            ),
        lookRows.map((look) => React.createElement('div', {
            key: look.filePath,
            className: 'mb-2 rounded-md border border-line p-2'
        },
            React.createElement('div', {
                className: 'text-xs font-medium truncate mb-0.5'
            }, look.name),
            React.createElement('div', {
                className: 'text-xs text-muted mb-1'
            }, look.fileLabel),
            React.createElement(CoverageBar, { look }),
            React.createElement('div', {
                className: `text-xs ${chipClass(look.batch.level)}`
            }, look.batch.label),
            look.devices.some((row) => row.extraOutputs) && React.createElement('p', {
                className: 'text-xs text-muted mt-1'
            }, 'SD play is output 0 only.')
        )),
        analyzing && !lookRows.length && React.createElement('p', {
            className: 'text-xs text-muted mb-2'
        }, 'Comparing files to node patches…'),
        overall && overall.needsFirmwareSync && React.createElement('p', {
            className: 'text-xs text-warn mb-2'
        }, 'Update firmware for lockstep. Files will still play, but nodes may drift.'),
        pushing && React.createElement('div', {
            className: 'flex flex-col gap-1 mb-2'
        },
            React.createElement(ProgressBar, {
                value: total > 0 ? percent : null,
                label: 'Push progress'
            }),
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
                ? 'text-accent'
                : 'text-danger'}`
        }, pushError),
        overall && mode === 'split' && React.createElement('p', {
            className: `text-xs mb-2 ${chipClass(overall.level)}`
        }, overall.label),
        React.createElement('div', { className: 'flex flex-wrap items-end gap-2 mb-2' },
            React.createElement('label', { className: 'flex flex-col gap-0.5 text-xs text-muted' },
                'Mode',
                React.createElement(Select, {
                    value: mode,
                    disabled: pushing,
                    onChange: (event) => setMode(event.target.value)
                },
                    React.createElement('option', { value: 'split' }, 'Split: this PC slices, every node gets its part'),
                    React.createElement('option', { value: 'distribute' }, 'Distribute: full show to one node, it sends the parts'),
                    React.createElement('option', { value: 'stream' }, 'Stream: full show to one node, it plays and streams the parts live')
                )
            ),
            mode !== 'split' && React.createElement('label', { className: 'flex flex-col gap-0.5 text-xs text-muted' },
                'Holder',
                React.createElement(Select, {
                    value: holder || '',
                    disabled: pushing || !selectedIds.length,
                    onChange: (event) => setHolderId(event.target.value)
                }, targets.filter((device) => selectedIds.includes(device.id)).map((device) => React.createElement('option', {
                    key: device.id,
                    value: device.id
                }, device.longName || device.ip)))
            )
        ),
        mode === 'stream' && React.createElement('p', { className: 'text-xs text-muted mb-2' },
            oneShow
                ? 'The holder plays the whole show and sends every node on the network the universes its patch uses, live (firmware 0.43+). The others need nothing on their SD and must not be receiving another stream.'
                : 'Stream plays one show at a time. Select a single look.'),
        mode === 'distribute' && React.createElement('p', { className: 'text-xs text-muted mb-2' },
            oneShow
                ? 'The holder gets the whole show, then slices it for every node on the network (firmware 0.42+) using each node\'s own patch.'
                : 'Distribute sends one show at a time. Select a single look.'),
        React.createElement('div', {
            className: 'flex gap-1.5'
        },
            React.createElement(Button, {
                block: true,
                className: 'flex-1',
                disabled: pushing,
                onClick: onClose
            }, 'Cancel'),
            React.createElement(Button, {
                variant: 'primary',
                block: true,
                className: 'flex-1',
                disabled: pushing || !canConfirm,
                onClick: () => onPush(selectedIds, { mode, holderId: holder })
            }, pushLabel)
        )
    );
};

module.exports = PushToSdDialog;
