const React = require('react');
const { useEffect, useMemo, useRef, useState, useSyncExternalStore } = React;
const { Button, Field, Popover, Select, TextInput, Toggle, cx } = require('../ui');
const Fader = require('./Fader');
const PadButton = require('./PadButton');
const ControlEditor = require('./ControlEditor');
const liveStore = require('../../liveStore');
const midiStore = require('../../midiStore');
const {
    FADERS,
    PADS,
    MAX_UNI,
    MIN_UNI,
    addressLabel,
    targetInfo,
    targetOf
} = require('../../../services/shared/liveControl');

const useLive = () => useSyncExternalStore(liveStore.subscribe, liveStore.getSnapshot);
const useMidi = () => useSyncExternalStore(midiStore.subscribe, midiStore.getSnapshot);

const targetName = (layout, target) => {
    const info = targetInfo(target);
    if (!info) {
        return target;
    }
    const c = layout[info.kind][info.index];
    const short = `${info.kind === 'faders' ? 'F' : 'P'}${info.index + 1}`;
    return c && c.name ? `${c.name} (${short})` : short;
};

// Learn mode strip: what is listening, what was just captured.
const LearnBar = ({ layout, midi }) => {
    const mapped = midi.armed ? midi.maps.filter((m) => m.target === midi.armed) : [];
    let text;
    if (midi.status === 'unsupported' || midi.status === 'denied') {
        text = 'MIDI is not available in this window.';
    } else if (midi.armed) {
        text = `Listening for ${targetName(layout, midi.armed)}: move or press a control on your MIDI device.`;
    } else if (midi.captured) {
        text = `${targetName(layout, midi.captured.target)} \u2190 ${midi.captured.device} \u00b7 ${midi.captured.label}. Click the next fader or pad, or Done.`;
    } else {
        text = 'Click a fader or pad, then move or press a control on your MIDI device. Esc or Done to finish.';
    }
    return React.createElement('div', {
        className: 'flex flex-wrap items-center gap-2 px-3 py-2 text-xs border-b border-line bg-selected',
        role: 'status'
    },
        React.createElement('span', { className: cx('flex-1 min-w-[12rem]', midi.armed ? 'text-accent font-medium' : 'text-fg-soft') }, text),
        midi.heard && React.createElement('span', { className: 'text-muted' }, `Heard: ${midi.heard.device} \u00b7 ${midi.heard.label}`),
        midi.armed && mapped.length > 0 && React.createElement(Button, {
            onClick: () => midiStore.clearTarget(midi.armed)
        }, 'Clear mapping'),
        midi.armed && React.createElement(Button, { onClick: midiStore.disarm }, 'Cancel')
    );
};

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
    const midi = useMidi();
    const learning = midi.learning;
    const learningRef = useRef(false);
    learningRef.current = learning;
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
    // Leaving the tab ends Learn.
    useEffect(() => () => midiStore.setLearning(false), []);
    useEffect(() => {
        if (!learning) {
            return undefined;
        }
        const onKey = (event) => {
            if (event.key !== 'Escape') {
                return;
            }
            if (midiStore.getSnapshot().armed) {
                midiStore.disarm();
            } else {
                midiStore.setLearning(false);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [learning]);

    const toggleLearn = () => {
        setEditing(false);
        midiStore.setLearning(!learning);
    };
    const toggleEdit = () => {
        midiStore.setLearning(false);
        setEditing((v) => !v);
    };
    const mappedTargets = useMemo(() => new Set(midi.maps.map((m) => m.target)), [midi.maps]);

    // Stable per-control handlers so memoised controls only redraw on their
    // own change.
    const handlers = useMemo(() => ({
        // In Learn, a press arms the control; in Edit it opens the editor.
        fader: Array.from({ length: FADERS }, (_, i) => ({
            change: (v) => liveStore.setFader(i, v),
            edit: (ref) => (learningRef.current
                ? midiStore.arm(targetOf('faders', i))
                : setEditor({ kind: 'faders', index: i, ref }))
        })),
        pad: Array.from({ length: PADS }, (_, i) => ({
            press: (down) => liveStore.pressPad(i, down),
            edit: (ref) => (learningRef.current
                ? midiStore.arm(targetOf('pads', i))
                : setEditor({ kind: 'pads', index: i, ref }))
        }))
    }), []);

    const fader = (i) => React.createElement(Fader, {
        key: i,
        index: i,
        control: layout.faders[i],
        address: addressLabel(layout.faders[i]),
        value: state.faders[i],
        editing: editing || learning,
        armed: midi.armed === targetOf('faders', i),
        mapped: mappedTargets.has(targetOf('faders', i)),
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
                onClick: toggleEdit
            }, editing ? 'Done' : 'Edit'),
            React.createElement(Button, {
                active: learning,
                'aria-pressed': learning,
                title: 'Map faders and pads to a MIDI controller',
                onClick: toggleLearn
            }, learning ? 'Done' : 'Learn MIDI'),
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
        learning && React.createElement(LearnBar, { layout, midi }),
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
                    editing: editing || learning,
                    armed: midi.armed === targetOf('pads', i),
                    mapped: mappedTargets.has(targetOf('pads', i)),
                    onPress: handlers.pad[i].press,
                    onEdit: handlers.pad[i].edit
                }))
            )
        ),
        editor && React.createElement(ControlEditor, {
            key: `${editor.kind}${editor.index}`,
            target: editor,
            control: layout[editor.kind][editor.index],
            midiMaps: midi.maps.filter((m) => m.target === targetOf(editor.kind, editor.index)),
            onClearMidi: () => midiStore.clearTarget(targetOf(editor.kind, editor.index)),
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
// Light-on value per controller: Auto follows its profile.
const OnValue = ({ device }) => {
    const [text, setText] = useState(device.on ? String(device.on) : '');
    useEffect(() => {
        setText(device.on ? String(device.on) : '');
    }, [device.on]);
    const commit = () => {
        const n = Number(text);
        const on = text.trim() === '' ? 0 : (Number.isInteger(n) && n >= 1 && n <= 127 ? n : device.on);
        setText(on ? String(on) : '');
        midiStore.setDeviceOption(device.key, { on });
    };
    return React.createElement('label', { className: 'flex items-center gap-1.5 text-xs text-muted' },
        'Light on',
        React.createElement(TextInput, {
            className: 'w-16 py-0.5 text-xs',
            inputMode: 'numeric',
            value: text,
            placeholder: 'Auto',
            'aria-label': `${device.key} light-on value, 1-127, empty for Auto`,
            onChange: (event) => setText(event.target.value),
            onBlur: commit,
            onKeyDown: (event) => {
                if (event.key === 'Enter') {
                    commit();
                }
            }
        })
    );
};

const MidiDevices = () => {
    const midi = useMidi();
    let note = '';
    if (midi.status === 'unsupported') {
        note = 'MIDI is not available in this window.';
    } else if (midi.status === 'denied') {
        note = 'MIDI access was refused. Rescan to ask again.';
    } else if (midi.status === 'idle') {
        note = 'Starting MIDI\u2026';
    } else if (!midi.devices.length) {
        note = 'No MIDI devices found. Plug one in (it appears by itself) or Rescan.';
    }
    return React.createElement('div', { className: 'flex flex-col gap-2' },
        React.createElement('div', { className: 'flex items-center gap-2' },
            React.createElement('div', { className: 'label-micro flex-1' }, 'MIDI devices'),
            React.createElement(Button, { className: 'py-0.5', onClick: midiStore.rescan }, 'Rescan')
        ),
        note && React.createElement('p', { className: 'text-xs text-muted' }, note),
        midi.devices.map((d) => React.createElement('div', { key: d.key, className: 'kv-row flex-col items-stretch gap-1.5 py-2 px-2' },
            React.createElement('div', { className: 'flex items-center gap-2 min-w-0' },
                React.createElement('span', {
                    className: cx('w-2 h-2 rounded-full flex-none transition-colors',
                        d.active ? 'bg-accent' : (d.busy ? 'bg-warn' : (d.online ? 'bg-ok' : 'bg-faint'))),
                    role: 'img',
                    'aria-label': d.busy ? 'In use by another program' : (d.online ? 'Connected' : 'Not connected')
                }),
                React.createElement('div', { className: 'flex flex-col min-w-0 flex-1' },
                    React.createElement('span', { className: 'text-sm truncate', title: d.key }, d.key),
                    React.createElement('span', { className: 'text-[11px] text-muted truncate' },
                        d.online || d.output
                            ? `${d.profile || 'Generic MIDI'} \u00b7 ${d.maps} mapped`
                            : `Not connected \u00b7 ${d.maps} mapped`)
                )
            ),
            d.busy && React.createElement('p', { className: 'text-xs text-warn' },
                'In use by another program. Close it (or its editor) and Rescan.'),
            React.createElement('div', { className: 'flex flex-wrap items-center gap-x-3 gap-y-1.5' },
                React.createElement(Toggle, {
                    label: 'Feedback',
                    checked: d.feedback,
                    disabled: !d.output,
                    onChange: (on) => midiStore.setDeviceOption(d.key, { feedback: on })
                }),
                React.createElement(OnValue, { device: d })
            ),
            React.createElement('div', { className: 'flex items-center gap-2' },
                React.createElement(Button, {
                    className: 'py-0.5',
                    disabled: !d.output || !d.maps,
                    title: 'Light every mapped pad on this controller for a moment',
                    onClick: () => midiStore.testLights(d.key)
                }, 'Test lights'),
                React.createElement(Button, {
                    className: 'ml-auto py-0.5',
                    disabled: !d.maps,
                    onClick: () => midiStore.clearDevice(d.key)
                }, 'Clear')
            )
        )),
        React.createElement('p', { className: 'text-xs text-muted' },
            'Every connected controller is listed; the dot flashes when it sends. Learn MIDI, click a fader or pad, then move or press a control. Feedback lights pads and moves motor faders; Akai APC and Behringer controllers are recognised. For other gear, set Light on to the value that lights its pads.')
    );
};

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
        ),
        React.createElement(MidiDevices)
    );
};

module.exports = { LivePanel, LiveRail };
