const React = require('react');
const { useState } = React;
const cx = require('./cx');

// Label above a control, with an optional hint or error line under it.
const Field = ({ label, hint, error, htmlFor, className, children }) => React.createElement('div', {
    className: cx('flex flex-col gap-1', className)
},
    label && React.createElement('label', { className: 'label-micro', htmlFor }, label),
    children,
    error
        ? React.createElement('p', { className: 'text-xs text-danger', role: 'alert' }, error)
        : hint && React.createElement('p', { className: 'text-xs text-muted' }, hint)
);

const TextInput = React.forwardRef(({ className, type = 'text', ...rest }, ref) => React.createElement('input', {
    ref,
    type,
    className: cx('field', className),
    ...rest
}));

// options: [{ value, label, disabled }] or pass <option> children.
const Select = React.forwardRef(({ className, compact = false, options, children, ...rest }, ref) => React.createElement('select', {
    ref,
    className: cx('field', compact && 'field-compact', className),
    ...rest
}, options
    ? options.map((option) => React.createElement('option', {
        key: option.value,
        value: option.value,
        disabled: option.disabled
    }, option.label))
    : children));

const Checkbox = React.forwardRef(({ label, className, inputClassName, children, ...rest }, ref) => {
    const input = React.createElement('input', {
        ref,
        type: 'checkbox',
        className: cx('check', inputClassName),
        ...rest
    });
    if (!label && !children) {
        return input;
    }
    return React.createElement('label', {
        className: cx('inline-flex items-center gap-2', rest.disabled ? 'opacity-50' : 'cursor-pointer', className)
    }, input, label, children);
});

// On/off switch; onChange receives the new boolean.
const Toggle = ({ checked, onChange, label, disabled, className }) => {
    const button = React.createElement('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': Boolean(checked),
        'aria-label': typeof label === 'string' ? label : undefined,
        disabled,
        className: cx('switch', checked && 'is-on'),
        onClick: () => onChange && onChange(!checked)
    });
    if (!label) {
        return button;
    }
    return React.createElement('label', {
        className: cx('inline-flex items-center gap-2', disabled ? 'opacity-50' : 'cursor-pointer', className)
    }, button, React.createElement('span', { 'aria-hidden': true }, label));
};

// Native range input (keyboard, drag, slider role). onInput fires while the
// value moves; onCommit once on release / key up, so callers can preview a
// drag and apply it once. Without onInput the thumb follows the drag locally.
const Slider = ({
    value,
    min = 0,
    max = 100,
    step = 1,
    onInput,
    onCommit,
    label,
    valueText,
    disabled,
    className
}) => {
    const [drag, setDrag] = useState(null);
    const shown = drag === null ? Number(value) || 0 : drag;
    const span = Math.max(1e-9, max - min);
    const fill = Math.max(0, Math.min(100, ((shown - min) / span) * 100));
    const commit = (event) => {
        if (drag === null) {
            return;
        }
        const next = Number(event.currentTarget.value);
        setDrag(null);
        if (onCommit) {
            onCommit(next);
        }
    };
    return React.createElement('input', {
        type: 'range',
        className: cx('slider', className),
        style: { '--fill': `${fill}%` },
        min,
        max,
        step,
        value: shown,
        disabled,
        'aria-label': label,
        'aria-valuetext': valueText,
        onChange: (event) => {
            const next = Number(event.target.value);
            setDrag(next);
            if (onInput) {
                onInput(next);
            }
        },
        onPointerUp: commit,
        onKeyUp: commit,
        onBlur: commit
    });
};

module.exports = { Field, TextInput, Select, Checkbox, Toggle, Slider };
