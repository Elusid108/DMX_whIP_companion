const React = require('react');
const { useEffect, useMemo, useState } = React;
const ipcRenderer = require('../../ipc');
const {
    GENERAL_NOTE,
    MAX_SUBS,
    MODES,
    NAME_MAX,
    channelMap,
    channelText,
    formatRanges,
    fromFixture,
    headerLen,
    layout,
    pixelChannels,
    pixelsFromOutputs,
    pixelsOf,
    segmentsFromOutputs,
    subChannels,
    toFields,
    validate
} = require('../../../services/shared/fixture');
const {
    Button,
    Dialog,
    EmptyState,
    Field,
    IconButton,
    Icons,
    Select,
    TextInput,
    Toggle,
    cx
} = require('../ui');

const ROW_H = 36;
const LIST_H = 360;
const OVERSCAN = 8;

const footText = (fx, lay, pixelCount) => {
    const hdr = headerLen(fx.mode);
    let math = `${hdr} + ${MODES[fx.mode].per}×${fx.subs.length}`;
    if (fx.mode === 'full') {
        math = `${hdr} + ${pixelCount} px`;
    } else if (fx.mode === 'basic') {
        math = `${hdr}`;
    }
    const start = Number(fx.ch) || 1;
    const last = start - 1 + lay.footprint - 1;
    const endUni = (Number(fx.uni) || 0) + Math.floor(last / 512);
    return `${MODES[fx.mode].label} · ${math} = ${lay.footprint} ch · ${fx.proto === 'sacn' ? 'sACN' : 'Art-Net'} ${fx.uni}.${start}–${endUni}.${(last % 512) + 1}${lay.unis > 1 ? ` · ${lay.unis} universes` : ''}`;
};

// Node advanced patch (firmware 0.45+): fixture address and mode, named
// pixels grouped into sub-fixtures, channel lists per mode. Same model and
// rules as the node portal's Patch -> Advanced.
const AdvancedPatch = ({ open, device, onClose }) => {
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState('');
    const [outputs, setOutputs] = useState([]);
    const [fx, setFx] = useState(null);
    const [subOf, setSubOf] = useState([]);
    const [names, setNames] = useState([]);
    const [namesDirty, setNamesDirty] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [sel, setSel] = useState(() => new Set());
    const [anchor, setAnchor] = useState(-1);
    const [addTo, setAddTo] = useState('');
    const [saving, setSaving] = useState(false);
    const [notice, setNotice] = useState(null);
    const [serverErr, setServerErr] = useState('');
    const [scrollTop, setScrollTop] = useState(0);

    const ip = device && device.ip;
    const pixels = useMemo(() => pixelsFromOutputs(outputs), [outputs]);
    const segments = useMemo(() => segmentsFromOutputs(outputs), [outputs]);

    const applyFixture = (json, count) => {
        const next = fromFixture(json, count);
        setFx(next.fx);
        setSubOf(next.subOf);
        setServerErr(json && json.storage === false
            ? 'This node has no config partition. Flash it once over USB.'
            : (json && json.en && json.valid === false ? (json.err || '') : ''));
        setDirty(false);
    };

    const load = async () => {
        if (!ip) {
            return;
        }
        setLoading(true);
        setLoadError('');
        setNotice(null);
        try {
            const result = await ipcRenderer.invoke('device-fixture-get', { ip });
            if (!result || !result.success) {
                setLoadError((result && result.error) || 'Could not read the advanced patch');
                return;
            }
            const outs = result.outputs || [];
            setOutputs(outs);
            applyFixture(result.fixture, pixelsFromOutputs(outs).length);
            setNames(result.names || []);
            setNamesDirty(false);
            setSel(new Set());
            setAnchor(-1);
        } catch (err) {
            setLoadError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (open) {
            setFx(null);
            setScrollTop(0);
            load();
        }
    }, [open, ip]);

    const lay = useMemo(() => (fx ? layout(fx, pixels) : null), [fx, pixels]);
    const problem = fx ? validate(fx, subOf, pixels) : '';

    // Flattened rows: a header per segment, then its pixels.
    const rows = useMemo(() => {
        const out = [];
        segments.forEach((seg) => {
            out.push({ type: 'seg', seg });
            for (let g = seg.g0; g < seg.g0 + seg.count; g += 1) {
                out.push({ type: 'px', g });
            }
        });
        return out;
    }, [segments]);

    const edit = (patch) => {
        setFx((current) => ({ ...current, ...patch }));
        setDirty(true);
        setServerErr('');
        setNotice(null);
    };

    const assign = (k) => {
        setSubOf((current) => current.map((v, g) => (sel.has(g) ? k : v)));
        setDirty(true);
        setNotice(null);
    };

    const groupNew = () => {
        if (!sel.size) {
            return;
        }
        if (fx.subs.length >= MAX_SUBS) {
            setNotice({ tone: 'err', text: `${MAX_SUBS} sub-fixtures is the maximum.` });
            return;
        }
        const k = fx.subs.length;
        setFx((current) => ({ ...current, subs: [...current.subs, { name: `Sub ${k + 1}` }] }));
        assign(k);
        setAddTo(String(k));
    };

    const moveSub = (k, dir) => {
        const j = k + dir;
        if (j < 0 || j >= fx.subs.length) {
            return;
        }
        setFx((current) => {
            const subs = current.subs.slice();
            [subs[k], subs[j]] = [subs[j], subs[k]];
            return { ...current, subs };
        });
        setSubOf((current) => current.map((v) => (v === k ? j : (v === j ? k : v))));
        setDirty(true);
    };

    const removeSub = (k) => {
        setFx((current) => ({ ...current, subs: current.subs.filter((_, i) => i !== k) }));
        setSubOf((current) => current.map((v) => (v === k ? -1 : (v > k ? v - 1 : v))));
        setAddTo('');
        setDirty(true);
    };

    const renameSub = (k, name) => {
        setFx((current) => ({
            ...current,
            subs: current.subs.map((s, i) => (i === k ? { ...s, name } : s))
        }));
        setDirty(true);
    };

    const clickPixel = (event, g) => {
        if (event.target.closest('input,button')) {
            return;
        }
        setSel((current) => {
            const next = new Set(current);
            if (event.shiftKey && anchor >= 0) {
                const a = Math.min(anchor, g);
                const b = Math.max(anchor, g);
                for (let i = a; i <= b; i += 1) {
                    next.add(i);
                }
            } else if (next.has(g)) {
                next.delete(g);
            } else {
                next.add(g);
            }
            return next;
        });
        setAnchor(g);
    };

    const selectRange = (g0, count) => {
        setSel((current) => {
            const next = new Set(current);
            let all = true;
            for (let g = g0; g < g0 + count; g += 1) {
                all = all && next.has(g);
            }
            for (let g = g0; g < g0 + count; g += 1) {
                if (all) {
                    next.delete(g);
                } else {
                    next.add(g);
                }
            }
            return next;
        });
    };

    const locate = async () => {
        if (!sel.size) {
            return;
        }
        const result = await ipcRenderer.invoke('device-fixture-locate', { ip, px: formatRanges([...sel]) });
        setNotice(result && result.success
            ? { tone: 'ok', text: 'Selected pixels lit white for 10 s.' }
            : { tone: 'err', text: (result && result.error) || 'Locate failed' });
    };

    const save = async () => {
        if (problem) {
            setNotice({ tone: 'err', text: problem });
            return;
        }
        setSaving(true);
        setNotice(null);
        try {
            const result = await ipcRenderer.invoke('device-fixture-set', {
                ip,
                fields: toFields(fx, subOf),
                names: namesDirty ? pixels.map((_, g) => names[g] || '') : null
            });
            if (result && result.fixture) {
                applyFixture(result.fixture, pixels.length);
            }
            if (!result || !result.success) {
                setNotice({ tone: 'err', text: (result && result.error) || 'Save failed' });
                return;
            }
            setNamesDirty(false);
            setNotice({ tone: 'ok', text: 'Advanced patch saved to the node.' });
        } catch (err) {
            setNotice({ tone: 'err', text: err.message });
        } finally {
            setSaving(false);
        }
    };

    const close = () => {
        if ((dirty || namesDirty) && !window.confirm('Discard the unsaved advanced patch changes?')) {
            return;
        }
        onClose();
    };

    const selList = [...sel].sort((a, b) => a - b);
    const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
    const last = Math.min(rows.length, Math.ceil((scrollTop + LIST_H) / ROW_H) + OVERSCAN);

    const renderRow = (row, index) => {
        const style = { position: 'absolute', top: index * ROW_H, left: 0, right: 0, height: ROW_H };
        if (row.type === 'seg') {
            const { seg } = row;
            return React.createElement('div', {
                key: `seg-${seg.out}-${seg.seg}`,
                style,
                className: 'flex items-center gap-2 px-2 bg-panel border-b border-line text-xs font-medium'
            },
                React.createElement('span', { className: 'flex-1 min-w-0 truncate' },
                    `Output ${seg.out + 1} · GPIO ${seg.data}${seg.parts > 1 ? ` · part ${seg.seg + 1}` : ''} · px ${seg.g0}–${seg.g0 + seg.count - 1}`),
                React.createElement(Button, {
                    className: 'py-0.5',
                    onClick: () => selectRange(seg.g0, seg.count)
                }, 'Select')
            );
        }
        const { g } = row;
        const k = subOf[g];
        const selected = sel.has(g);
        return React.createElement('div', {
            key: `px-${g}`,
            style,
            className: cx(
                'flex items-center gap-2 px-2 border-b border-line cursor-pointer select-none',
                selected ? 'bg-selected' : 'hover:bg-hover'
            ),
            onClick: (event) => clickPixel(event, g)
        },
            React.createElement('span', { className: 'readout mt-0 w-10 text-right flex-none' }, g),
            React.createElement(TextInput, {
                className: 'py-0.5 text-xs w-40 flex-none',
                value: names[g] || '',
                placeholder: `Pixel ${g}`,
                maxLength: NAME_MAX,
                'aria-label': `Pixel ${g} name`,
                onChange: (event) => {
                    const value = event.target.value;
                    setNames((current) => {
                        const next = current.slice();
                        next[g] = value;
                        return next;
                    });
                    setNamesDirty(true);
                }
            }),
            React.createElement('span', { className: 'text-xs truncate flex-1 min-w-0' },
                k >= 0 ? (fx.subs[k] && fx.subs[k].name) || `Sub ${k + 1}` : React.createElement('span', { className: 'text-faint' }, 'not grouped')),
            React.createElement('span', { className: 'readout mt-0 flex-none' },
                `ch ${channelText(pixelChannels(fx, lay, subOf, pixels, g))}`)
        );
    };

    const body = () => {
        if (loading && !fx) {
            return React.createElement(EmptyState, null, 'Reading the node…');
        }
        if (loadError) {
            return React.createElement(EmptyState, {
                title: 'Advanced patch unavailable',
                action: React.createElement(Button, { onClick: load }, 'Try again')
            }, loadError);
        }
        if (!fx) {
            return null;
        }
        return React.createElement(React.Fragment, null,
            React.createElement('div', { className: 'grid gap-2 grid-cols-2 sm:grid-cols-5 items-end mb-1' },
                React.createElement('div', { className: 'col-span-2 sm:col-span-1 pb-1.5' },
                    React.createElement(Toggle, {
                        label: 'Enabled',
                        checked: fx.en,
                        onChange: (en) => edit({ en })
                    })),
                React.createElement(Field, { label: 'Mode' },
                    React.createElement(Select, {
                        value: fx.mode,
                        onChange: (event) => edit({ mode: event.target.value }),
                        options: Object.keys(MODES).map((value) => ({ value, label: MODES[value].label }))
                    })),
                React.createElement(Field, { label: 'Protocol' },
                    React.createElement(Select, {
                        value: fx.proto,
                        onChange: (event) => edit({ proto: event.target.value }),
                        options: [{ value: 'artnet', label: 'Art-Net' }, { value: 'sacn', label: 'sACN' }]
                    })),
                React.createElement(Field, { label: fx.proto === 'sacn' ? 'Universe (1-based)' : 'Universe (0-based)' },
                    React.createElement(TextInput, {
                        type: 'number',
                        min: fx.proto === 'sacn' ? 1 : 0,
                        value: fx.uni,
                        onChange: (event) => edit({ uni: Math.max(0, parseInt(event.target.value, 10) || 0) })
                    })),
                React.createElement(Field, { label: 'Channel' },
                    React.createElement(TextInput, {
                        type: 'number',
                        min: 1,
                        max: 512,
                        value: fx.ch,
                        onChange: (event) => edit({ ch: Math.min(512, Math.max(1, parseInt(event.target.value, 10) || 1)) })
                    }))
            ),
            React.createElement('p', { className: 'text-xs text-fg-soft' }, MODES[fx.mode].description),
            React.createElement('p', { className: 'text-xs text-muted mt-1' }, GENERAL_NOTE),
            React.createElement('p', { className: 'readout' }, footText(fx, lay, pixels.length)),
            (problem || serverErr) && React.createElement('p', { className: 'text-xs text-danger mt-1' }, problem || serverErr),
            React.createElement('details', { className: 'mt-2 mb-2', open: true },
                React.createElement('summary', { className: 'label-micro cursor-pointer' },
                    `Channel map · ${fx.proto === 'sacn' ? 'sACN' : 'Art-Net'} universe ${fx.uni}`),
                React.createElement('div', {
                    className: 'mt-1 max-h-64 overflow-y-auto rounded-md border border-line',
                    role: 'table',
                    'aria-label': 'Channel map'
                },
                    React.createElement('div', {
                        className: 'grid grid-cols-[minmax(5.5rem,auto)_minmax(7rem,auto)_1fr] text-xs'
                    },
                        ['Channel', 'Function', 'Values'].map((h) => React.createElement('div', {
                            key: h,
                            role: 'columnheader',
                            className: 'sticky top-0 bg-panel px-2 py-1 font-medium text-muted border-b border-line'
                        }, h)),
                        channelMap(fx, outputs, subOf).map((row, i) => [
                            React.createElement('div', { key: `c${i}`, role: 'cell', className: 'px-2 py-1 border-b border-line tabular-nums text-fg-soft whitespace-nowrap' }, row.channels),
                            React.createElement('div', { key: `n${i}`, role: 'cell', className: 'px-2 py-1 border-b border-line truncate' }, row.name),
                            React.createElement('div', { key: `v${i}`, role: 'cell', className: 'px-2 py-1 border-b border-line text-muted' }, row.values)
                        ])
                    ))),
            React.createElement('div', { className: 'grid gap-3 md:grid-cols-[17rem_1fr]' },
                React.createElement('div', { className: 'min-w-0' },
                    React.createElement('div', { className: 'label-micro mb-1' }, `Sub-fixtures · ${fx.subs.length}`),
                    fx.mode === 'basic' && React.createElement('p', { className: 'text-xs text-muted mb-1' },
                        'Basic mode has no sub-fixtures. Any you group are kept for the other modes.'),
                    fx.subs.length === 0
                        ? React.createElement(EmptyState, { size: 'xs' }, 'None yet. Select pixels, then Group as new.')
                        : React.createElement('div', { className: 'flex flex-col gap-1 max-h-[24rem] overflow-y-auto' },
                            fx.subs.map((sub, k) => React.createElement('div', {
                                key: k,
                                className: 'kv-row flex-col items-stretch gap-1 py-1.5 px-2'
                            },
                                React.createElement('div', { className: 'flex items-center gap-1' },
                                    React.createElement(TextInput, {
                                        className: 'py-0.5 text-xs flex-1 min-w-0',
                                        value: sub.name,
                                        maxLength: NAME_MAX,
                                        'aria-label': `Sub-fixture ${k + 1} name`,
                                        onChange: (event) => renameSub(k, event.target.value)
                                    }),
                                    React.createElement(IconButton, { label: 'Move up', icon: Icons.ArrowUp, variant: 'ghost', disabled: k === 0, onClick: () => moveSub(k, -1) }),
                                    React.createElement(IconButton, { label: 'Move down', icon: Icons.ArrowDown, variant: 'ghost', disabled: k === fx.subs.length - 1, onClick: () => moveSub(k, 1) }),
                                    React.createElement(IconButton, { label: 'Delete', icon: Icons.Close, variant: 'ghost', onClick: () => removeSub(k) })
                                ),
                                React.createElement('div', { className: 'flex items-center gap-2' },
                                    React.createElement('span', { className: 'readout mt-0 flex-1 min-w-0 truncate' },
                                        `${k + 1} · ${pixelsOf(subOf, k).length} px · ch ${channelText(subChannels(fx, k))}`),
                                    React.createElement(Button, {
                                        className: 'py-0.5',
                                        onClick: () => setSel(new Set(pixelsOf(subOf, k)))
                                    }, 'Select'))
                            )))
                ),
                React.createElement('div', { className: 'min-w-0' },
                    React.createElement('div', { className: 'flex flex-wrap items-center gap-1.5 mb-1' },
                        React.createElement(Button, { disabled: !sel.size, onClick: groupNew }, 'Group as new'),
                        React.createElement(Select, {
                            compact: true,
                            value: addTo,
                            disabled: !fx.subs.length,
                            'aria-label': 'Sub-fixture to add to',
                            onChange: (event) => setAddTo(event.target.value)
                        },
                            React.createElement('option', { value: '' }, 'Sub-fixture…'),
                            fx.subs.map((sub, k) => React.createElement('option', { key: k, value: String(k) }, sub.name || `Sub ${k + 1}`))),
                        React.createElement(Button, {
                            disabled: !sel.size || addTo === '',
                            onClick: () => assign(Number(addTo))
                        }, 'Add to'),
                        React.createElement(Button, { disabled: !sel.size, onClick: () => assign(-1) }, 'Ungroup'),
                        React.createElement(Button, { disabled: !sel.size, onClick: locate }, 'Locate'),
                        React.createElement(Button, { disabled: !sel.size, onClick: () => { setSel(new Set()); setAnchor(-1); } }, 'Clear')
                    ),
                    React.createElement('p', { className: 'readout mt-0 mb-1 truncate' },
                        sel.size ? `${sel.size} selected: ${formatRanges(selList)}` : 'Click pixels to select; Shift-click selects a run.'),
                    pixels.length === 0
                        ? React.createElement(EmptyState, { size: 'xs' }, 'No pixels. Patch the node first.')
                        : React.createElement('div', {
                            className: 'relative overflow-y-auto rounded-ui border border-line bg-surface',
                            style: { height: LIST_H },
                            onScroll: (event) => setScrollTop(event.currentTarget.scrollTop)
                        },
                            React.createElement('div', { style: { height: rows.length * ROW_H, position: 'relative' } },
                                rows.slice(first, last).map((row, i) => renderRow(row, first + i))))
                )
            )
        );
    };

    return React.createElement(Dialog, {
        open,
        onClose: close,
        dismissible: !saving,
        size: 'xl',
        title: `Advanced patch · ${(device && (device.longName || device.ip)) || ''}`
    },
        body(),
        notice && React.createElement('p', {
            className: cx('text-sm mt-2', notice.tone === 'ok' ? 'text-ok' : 'text-danger')
        }, notice.text),
        React.createElement('div', { className: 'flex gap-1.5 mt-3' },
            React.createElement(Button, { block: true, className: 'flex-1', disabled: saving, onClick: close }, 'Close'),
            React.createElement(Button, { block: true, className: 'flex-1', disabled: saving || loading, onClick: load }, 'Reload'),
            React.createElement(Button, {
                variant: 'primary',
                block: true,
                className: 'flex-1',
                disabled: saving || !fx || Boolean(problem) || !(dirty || namesDirty),
                onClick: save
            }, saving ? 'Saving…' : 'Save to node')
        )
    );
};

module.exports = AdvancedPatch;
