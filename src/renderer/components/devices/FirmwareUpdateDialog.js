const React = require('react');
const { useEffect, useMemo, useRef, useState } = React;
const ipcRenderer = require('../../ipc');
const { otaVerdict } = require('../../../services/shared/firmwareCompat');
const { formatBytes } = require('../../../services/shared/format');
const { Button, Checkbox, Dialog, EmptyState, ProgressBar, StatusPill, Toggle } = require('../ui');

const TONES = {
    update: 'warn',
    current: 'ok',
    busy: 'muted',
    'needs-usb': 'danger',
    'no-image': 'muted',
    unknown: 'muted'
};

const PHASES = {
    connecting: 'Connecting',
    sending: 'Sending',
    waiting: 'Writing to flash',
    rebooting: 'Rebooting',
    checking: 'Checking itself'
};

const progressText = (p) => {
    if (!p) {
        return '';
    }
    if (p.message) {
        return p.message;
    }
    if (p.phase === 'sending' && p.total) {
        return `Sending ${Math.round((100 * (p.sent || 0)) / p.total)}%`;
    }
    return PHASES[p.phase] || p.phase || '';
};

const progressValue = (p) => {
    if (!p) {
        return 0;
    }
    if (p.phase === 'sending' && p.total) {
        return (100 * (p.sent || 0)) / p.total;
    }
    if (p.phase === 'done') {
        return 100;
    }
    return ['waiting', 'rebooting', 'checking', 'connecting'].includes(p.phase) ? null : 0;
};

// Over-the-air update for one or many nodes. initialIds preselects (e.g. the
// inspector's node); otherwise every node with an update available is ticked.
const FirmwareUpdateDialog = ({ open, onClose, initialIds }) => {
    const [plan, setPlan] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [includeBusy, setIncludeBusy] = useState(false);
    const [selected, setSelected] = useState([]);
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState({});

    const verdicts = useMemo(() => {
        const out = {};
        ((plan && plan.rows) || []).forEach((row) => {
            out[row.id] = otaVerdict(row.fw, row.image, { includeBusy });
        });
        return out;
    }, [plan, includeBusy]);

    const loadPlan = async (preselect) => {
        setLoading(true);
        setError('');
        try {
            const result = await ipcRenderer.invoke('device-ota-plan', {});
            if (!result || !result.success) {
                setError((result && result.error) || 'Could not read the nodes');
                return;
            }
            setPlan(result);
            if (preselect) {
                const eligible = result.rows
                    .filter((row) => otaVerdict(row.fw, row.image).verdict === 'update')
                    .map((row) => row.id);
                const wanted = Array.isArray(initialIds) && initialIds.length
                    ? initialIds.filter((id) => result.rows.some((row) => row.id === id))
                    : eligible;
                setSelected(wanted);
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!open) {
            return undefined;
        }
        setProgress({});
        setIncludeBusy(false);
        loadPlan(true);
        const onProgress = (event, payload = {}) => {
            if (!payload.id) {
                return;
            }
            setProgress((current) => ({ ...current, [payload.id]: payload }));
        };
        ipcRenderer.on('device-ota-progress', onProgress);
        return () => ipcRenderer.removeListener('device-ota-progress', onProgress);
    }, [open]);

    const rows = (plan && plan.rows) || [];
    const updatable = (id) => verdicts[id] && verdicts[id].verdict === 'update';
    const chosen = selected.filter(updatable);
    const busyChosen = chosen.filter((id) => verdicts[id] && verdicts[id].busy);

    // Select all: every node that can be updated (current, no reply, other
    // board and needs-USB rows are never picked).
    const updatableIds = rows.map((row) => row.id).filter(updatable);
    const allChosen = updatableIds.length > 0 && chosen.length === updatableIds.length;
    const someChosen = chosen.length > 0 && !allChosen;
    const allRef = useRef(null);
    useEffect(() => {
        if (allRef.current) {
            allRef.current.indeterminate = someChosen;
        }
    });
    const toggleAll = () => {
        setSelected(allChosen ? [] : updatableIds);
    };

    const toggle = (id) => {
        setSelected((current) => (current.includes(id)
            ? current.filter((item) => item !== id)
            : [...current, id]));
    };

    const run = async () => {
        if (!chosen.length || running) {
            return;
        }
        if (busyChosen.length && !window.confirm(
            `${busyChosen.length} of these node${busyChosen.length === 1 ? ' is' : 's are'} playing or live. Their lights stop while they update and reboot. Continue?`
        )) {
            return;
        }
        setRunning(true);
        setError('');
        setProgress({});
        try {
            const result = await ipcRenderer.invoke('device-ota-run', { ids: chosen, includeBusy });
            if (!result || !result.success) {
                setError((result && result.error) || 'Update failed');
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setRunning(false);
            loadPlan(false);
        }
    };

    const images = (plan && plan.images) || [];

    return React.createElement(Dialog, {
        open,
        onClose,
        dismissible: !running,
        size: 'lg',
        title: 'Update firmware'
    },
        React.createElement('p', { className: 'text-xs text-muted mb-1' },
            'Over Wi-Fi. Each node checks the image is for its board, reboots itself, and goes back to its old firmware if the new one does not come up cleanly.'),
        React.createElement('div', { className: 'readout mb-2' },
            images.length
                ? images.map((image) => `${image.boardName} v${image.version} (${formatBytes(image.size)}, ${image.source})`).join(' · ')
                : 'No firmware image found. Build it (Flash tab → Build firmware) or copy firmware.bin into firmware/artifacts/<board>/.'),
        loading && !rows.length
            ? React.createElement(EmptyState, null, 'Reading the nodes…')
            : rows.length === 0
                ? React.createElement(EmptyState, null, 'No nodes found. Scan on the selected NIC first.')
                : React.createElement(React.Fragment, null,
                  React.createElement(Checkbox, {
                      ref: allRef,
                      className: 'mb-1.5 px-3 ml-px text-sm',
                      checked: allChosen,
                      disabled: running || !updatableIds.length,
                      onChange: toggleAll,
                      label: updatableIds.length
                          ? `Select all (${chosen.length} of ${updatableIds.length} to update)`
                          : 'Select all (nothing to update)'
                  }),
                  React.createElement('div', { className: 'flex flex-col gap-1 mb-2 max-h-[50vh] overflow-y-auto' },
                    rows.map((row) => {
                        const verdict = verdicts[row.id] || { verdict: 'unknown', label: 'No reply' };
                        const p = progress[row.id];
                        const value = progressValue(p);
                        return React.createElement('div', {
                            key: row.id,
                            className: 'kv-row flex-col items-stretch gap-1'
                        },
                            React.createElement('div', { className: 'flex items-center gap-2 min-w-0' },
                                React.createElement(Checkbox, {
                                    checked: selected.includes(row.id) && updatable(row.id),
                                    disabled: running || !updatable(row.id),
                                    onChange: () => toggle(row.id),
                                    'aria-label': `Update ${row.name}`
                                }),
                                React.createElement('div', { className: 'min-w-0 flex-1' },
                                    React.createElement('div', { className: 'text-sm truncate' }, row.name),
                                    React.createElement('div', { className: 'readout mt-0' },
                                        [
                                            row.ip,
                                            row.fw ? `v${row.fw.ver}${verdict.target && verdict.verdict !== 'current' ? ` → v${verdict.target}` : ''}` : row.error,
                                            row.fw && row.fw.ota && row.fw.ota.rolled_back ? 'rolled back last time' : ''
                                        ].filter(Boolean).join(' · '))
                                ),
                                React.createElement(StatusPill, {
                                    tone: TONES[verdict.verdict] || 'muted',
                                    title: verdict.label
                                }, verdict.label)
                            ),
                            p && React.createElement('div', { className: 'flex items-center gap-2' },
                                React.createElement(ProgressBar, {
                                    className: 'flex-1',
                                    value: p.phase === 'error' || p.phase === 'skipped' ? 0 : value,
                                    label: `${row.name} update`
                                }),
                                React.createElement('span', {
                                    className: `text-xs flex-none ${p.phase === 'error' ? 'text-danger' : (p.phase === 'done' ? 'text-ok' : 'text-muted')}`
                                }, progressText(p))
                            )
                        );
                    })
                  )
                ),
        React.createElement(Toggle, {
            className: 'text-xs text-muted mb-1',
            label: 'Include busy nodes (playing or live input)',
            checked: includeBusy,
            disabled: running,
            onChange: setIncludeBusy
        }),
        React.createElement('p', { className: 'text-xs text-muted mb-2' },
            'Up to three nodes update at once. Nodes on firmware older than 0.44 need one USB flash from the Flash tab first.'),
        error && React.createElement('p', { className: 'text-sm text-danger mb-2' }, error),
        React.createElement('div', { className: 'flex gap-1.5' },
            React.createElement(Button, {
                block: true,
                className: 'flex-1',
                disabled: running,
                onClick: onClose
            }, 'Close'),
            React.createElement(Button, {
                block: true,
                className: 'flex-1',
                disabled: running || loading,
                onClick: () => loadPlan(false)
            }, 'Refresh'),
            React.createElement(Button, {
                variant: 'primary',
                block: true,
                className: 'flex-1',
                disabled: running || !chosen.length,
                onClick: run
            }, running
                ? 'Updating…'
                : (chosen.length ? `Update ${chosen.length} node${chosen.length === 1 ? '' : 's'}` : 'Update'))
        )
    );
};

module.exports = FirmwareUpdateDialog;
