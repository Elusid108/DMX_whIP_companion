const React = require('react');
const { useEffect, useMemo, useRef, useState, useSyncExternalStore } = React;
const { Button, Field, Popover, Select, TextInput } = require('../ui');
const Fader = require('./Fader');
const PadButton = require('./PadButton');
const ControlEditor = require('./ControlEditor');
const liveStore = require('../../liveStore');
const {
    FADERS,
    PADS,
    MAX_UNI,
    MIN_UNI,
    addressLabel
} = require('../../../services/shared/liveControl');

const useLive = () => useSyncExternalStore(liveStore.subscribe, liveStore.getSnapshot);

const BANK = 16;

const PATCH_TARGETS = [
    { value: 'f0', label: 'Faders 1-16', kind: 'faders', from: 0, count: BANK },
    { value: 'f1', label: 'Faders 17-32', kind: 'faders', from: BANK, count: BANK },
    { value: 'fa', label: 'All faders', kind: 'faders', from: 0, count: FADERS },
    { value: 'pa', label: 'All pads', kind: 'pads', from: 0, count: PADS }
];

// Give a run of controls consecutive channels.
const PatchPopover = ({ anchorRef, onClose }) => {
    const [target, setTarget] = useState('f0');
    const [proto, setProto] = useState('artnet');
    const [uni, setUni] = useState('0');
    const [ch, setCh] = useState('1');
    const u = Number(uni);
    const c = Number(ch);
    const uniOk = Number.isInteger(u) && u >= MIN_UNI[proto] && u <= MAX_UNI[proto];
    const chOk = Number.isInteger(c) && c >= 1 && c <= 512;
    const apply = () => {
        const t = PATCH_TARGETS.find((p) => p.value === target);
        liveStore.patchRow(t.kind, t.from, t.count, { proto, uni: u, ch: c });
        onClose();
    };
    return React.createElement(Popover, {
        open: true,
        anchorRef,
        onClose,
        placement: 'bottom-end',
        label: 'Patch controls',
        className: 'w-64 p-3'
    },
        React.createElement('div', { className: 'flex flex-col gap-2.5 text-sm' },
            React.createElement('p', { className: 'text-xs text-muted' },
                'Give these controls consecutive channels from the start address.'
            ),
            React.createElement(Field, { label: 'Controls' },
                React.createElement(Select, {
                    value: target,
                    onChange: (event) => setTarget(event.target.value),
                    options: PATCH_TARGETS
                })
            ),
            React.createElement(Field, { label: 'Protocol' },
                React.createElement(Select, {
                    value: proto,
                    onChange: (event) => {
                        const next = event.target.value;
                        setProto(next);
                        if (next === 'sacn' && uni === '0') {
                            setUni('1');
                        }
                    },
                    options: [{ value: 'artnet', label: 'Art-Net' }, { value: 'sacn', label: 'sACN' }]
                })
            ),
            React.createElement('div', { className: 'grid grid-cols-2 gap-2' },
                React.createElement(Field, { label: 'Universe', error: uniOk ? '' : `${MIN_UNI[proto]}-${MAX_UNI[proto]}` },
                    React.createElement(TextInput, { inputMode: 'numeric', value: uni, onChange: (e) => setUni(e.target.value) })
                ),
                React.createElement(Field, { label: 'Start channel', error: chOk ? '' : '1-512' },
                    React.createElement(TextInput, { inputMode: 'numeric', value: ch, onChange: (e) => setCh(e.target.value) })
                )
            ),
            React.createElement(Button, { variant: 'primary', disabled: !uniOk || !chOk, onClick: apply }, 'Patch')
        )
    );
};

const LivePanel = ({ outputNicLabel }) => {
    const { layout, state } = useLive();
    const [editing, setEditing] = useState(false);
    const [editor, setEditor] = useState(null);
    const [patchOpen, setPatchOpen] = useState(false);
    const patchRef = useRef(null);

    useEffect(() => {
        liveStore.load();
    }, []);
    useEffect(() => {
        if (!editing) {
            setEditor(null);
        }
    }, [editing]);

    // Stable per-control handlers so memoised controls only redraw on their
    // own change.
    const handlers = useMemo(() => ({
        fader: Array.from({ length: FADERS }, (_, i) => ({
            change: (v) => liveStore.setFader(i, v),
            edit: (ref) => setEditor({ kind: 'faders', index: i, ref })
        })),
        pad: Array.from({ length: PADS }, (_, i) => ({
            press: (down) => liveStore.pressPad(i, down),
            edit: (ref) => setEditor({ kind: 'pads', index: i, ref })
        }))
    }), []);

    const fader = (i) => React.createElement(Fader, {
        key: i,
        index: i,
        control: layout.faders[i],
        address: addressLabel(layout.faders[i]),
        value: state.faders[i],
        editing,
        onChange: handlers.fader[i].change,
        onEdit: handlers.fader[i].edit
    });

    const bank = (from) => React.createElement('div', { className: 'live-bank' },
        Array.from({ length: BANK }, (_, k) => fader(from + k))
    );

    const anyOn = state.faders.some((v) => v > 0) || state.pads.some(Boolean);
    const dest = layout.dest ? layout.dest : 'Broadcast / multicast';

    return React.createElement('div', { className: 'flex flex-1 min-h-0 flex-col' },
        React.createElement('div', { className: 'app-toolbar bg-panel' },
            React.createElement(Button, {
                active: editing,
                'aria-pressed': editing,
                onClick: () => setEditing((v) => !v)
            }, editing ? 'Done' : 'Edit'),
            React.createElement('button', {
                ref: patchRef,
                type: 'button',
                className: 'btn-quiet',
                onClick: () => setPatchOpen(true)
            }, 'Patch…'),
            React.createElement('button', {
                type: 'button',
                className: 'btn-quiet',
                disabled: !anyOn,
                onClick: liveStore.releaseAll
            }, 'Release all'),
            React.createElement('span', { className: 'ml-auto text-xs text-muted truncate' },
                `Out: ${outputNicLabel} · ${dest}`
            )
        ),
        editing && React.createElement('p', { className: 'px-3 pt-2 text-xs text-muted' },
            'Press a fader or pad to set its name and address.'
        ),
        React.createElement('div', { className: 'live-surface' },
            React.createElement('section', { className: 'live-faders', 'aria-label': 'Faders' },
                bank(0),
                bank(BANK)
            ),
            React.createElement('section', { className: 'live-pads', 'aria-label': 'Pads' },
                layout.pads.map((pad, i) => React.createElement(PadButton, {
                    key: i,
                    index: i,
                    control: pad,
                    address: addressLabel(pad),
                    lit: state.pads[i],
                    editing,
                    onPress: handlers.pad[i].press,
                    onEdit: handlers.pad[i].edit
                }))
            )
        ),
        editor && React.createElement(ControlEditor, {
            key: `${editor.kind}${editor.index}`,
            target: editor,
            control: layout[editor.kind][editor.index],
            anchorRef: editor.ref,
            onChange: (patch) => liveStore.updateControl(editor.kind, editor.index, patch),
            onClose: () => setEditor(null)
        }),
        patchOpen && React.createElement(PatchPopover, {
            anchorRef: patchRef,
            onClose: () => setPatchOpen(false)
        })
    );
};

// Left rail on the Live view: where the output goes.
const LiveRail = ({ outputNicLabel }) => {
    const { layout } = useLive();
    const [dest, setDest] = useState(layout.dest);
    useEffect(() => {
        setDest(layout.dest);
    }, [layout.dest]);
    const valid = dest.trim() === '' || /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(dest.trim());
    const commit = () => {
        if (valid) {
            liveStore.setDest(dest.trim());
        }
    };
    return React.createElement('div', { className: 'flex flex-col gap-3 p-3 text-sm' },
        React.createElement('div', { className: 'label-micro' }, 'Output'),
        React.createElement('p', { className: 'text-xs text-muted' },
            `Adapter: ${outputNicLabel} (Settings → Output NIC). Levels merge with a playing show (highest wins); a universe left at 0 for 2 s is released so nodes go back to their own show.`
        ),
        React.createElement(Field, {
            label: 'Destination',
            hint: 'Empty: Art-Net broadcast and sACN multicast. Or one IP for unicast.',
            error: valid ? '' : 'Not an IPv4 address'
        },
            React.createElement(TextInput, {
                value: dest,
                placeholder: 'Broadcast',
                onChange: (event) => setDest(event.target.value),
                onBlur: commit,
                onKeyDown: (event) => {
                    if (event.key === 'Enter') {
                        commit();
                    }
                }
            })
        )
    );
};

module.exports = { LivePanel, LiveRail };
