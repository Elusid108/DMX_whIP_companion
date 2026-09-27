const React = require('react');
const { useEffect, useState } = React;
const { Field, Popover, Select, TextInput } = require('../ui');
const { MAX_UNI, MIN_UNI, NAME_MAX } = require('../../../services/shared/liveControl');

// Number field that applies while the text is a valid value and shows the
// range otherwise (typing "1" on the way to "12" must not snap back).
const NumberField = ({ label, value, min, max, onApply }) => {
    const [text, setText] = useState(String(value));
    useEffect(() => {
        setText(String(value));
    }, [value]);
    const n = Number(text);
    const valid = text.trim() !== '' && Number.isInteger(n) && n >= min && n <= max;
    return React.createElement(Field, { label, error: valid ? '' : `${min}-${max}` },
        React.createElement(TextInput, {
            inputMode: 'numeric',
            value: text,
            'aria-invalid': !valid,
            onChange: (event) => {
                setText(event.target.value);
                const next = Number(event.target.value);
                if (event.target.value.trim() !== '' && Number.isInteger(next) && next >= min && next <= max) {
                    onApply(next);
                }
            },
            onBlur: () => setText(String(value))
        })
    );
};

// Edit one fader or pad: name, protocol, universe, channel (and for pads the
// mode and on level). Changes apply at once and are saved.
const ControlEditor = ({ target, control, anchorRef, onChange, onClose }) => {
    const isPad = target.kind === 'pads';
    const proto = control.proto;
    return React.createElement(Popover, {
        open: true,
        anchorRef,
        onClose,
        placement: 'bottom-start',
        label: isPad ? `Pad ${target.index + 1}` : `Fader ${target.index + 1}`,
        className: 'w-64 p-3'
    },
        React.createElement('div', { className: 'flex flex-col gap-2.5 text-sm' },
            React.createElement('div', { className: 'text-xs font-semibold text-muted' },
                isPad ? `Pad ${target.index + 1}` : `Fader ${target.index + 1}`
            ),
            React.createElement(Field, { label: 'Name' },
                React.createElement(TextInput, {
                    value: control.name,
                    maxLength: NAME_MAX,
                    placeholder: isPad ? `P${target.index + 1}` : `F${target.index + 1}`,
                    onChange: (event) => onChange({ name: event.target.value })
                })
            ),
            React.createElement(Field, { label: 'Protocol' },
                React.createElement(Select, {
                    value: proto,
                    onChange: (event) => {
                        const next = event.target.value;
                        onChange({ proto: next, uni: Math.max(MIN_UNI[next], Math.min(MAX_UNI[next], control.uni)) });
                    },
                    options: [{ value: 'artnet', label: 'Art-Net' }, { value: 'sacn', label: 'sACN' }]
                })
            ),
            React.createElement('div', { className: 'grid grid-cols-2 gap-2' },
                React.createElement(NumberField, {
                    label: 'Universe',
                    value: control.uni,
                    min: MIN_UNI[proto],
                    max: MAX_UNI[proto],
                    onApply: (uni) => onChange({ uni })
                }),
                React.createElement(NumberField, {
                    label: 'Channel',
                    value: control.ch,
                    min: 1,
                    max: 512,
                    onApply: (ch) => onChange({ ch })
                })
            ),
            isPad && React.createElement('div', { className: 'grid grid-cols-2 gap-2' },
                React.createElement(Field, { label: 'Mode' },
                    React.createElement(Select, {
                        value: control.mode,
                        onChange: (event) => onChange({ mode: event.target.value }),
                        options: [{ value: 'toggle', label: 'Toggle' }, { value: 'flash', label: 'Flash' }]
                    })
                ),
                React.createElement(NumberField, {
                    label: 'On level',
                    value: control.on,
                    min: 1,
                    max: 255,
                    onApply: (on) => onChange({ on })
                })
            )
        )
    );
};

module.exports = ControlEditor;
