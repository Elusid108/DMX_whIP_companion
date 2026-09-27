const React = require('react');
const { useRef } = React;
const { cx } = require('../ui');

// Vertical 0-255 fader. Pointer capture per fader, so several fingers can
// move several faders at once; the track takes the level under the pointer.
// In edit mode a press opens the editor instead of moving the level.
const Fader = ({ index, control, value, editing, onChange, onEdit, address }) => {
    const trackRef = useRef(null);
    const rootRef = useRef(null);
    const dragRef = useRef(null);
    const label = control.name || `F${index + 1}`;
    const pct = (value / 255) * 100;

    const valueAt = (clientY) => {
        const rect = trackRef.current.getBoundingClientRect();
        const t = 1 - ((clientY - rect.top) / Math.max(1, rect.height));
        return Math.round(Math.max(0, Math.min(1, t)) * 255);
    };

    const onPointerDown = (event) => {
        if (event.button !== undefined && event.button !== 0) {
            return;
        }
        if (editing) {
            onEdit(rootRef);
            return;
        }
        event.preventDefault();
        try {
            event.currentTarget.setPointerCapture(event.pointerId);
        } catch (err) {
            // Pointer already gone; the press still counts.
        }
        dragRef.current = event.pointerId;
        onChange(valueAt(event.clientY));
    };
    const onPointerMove = (event) => {
        if (dragRef.current === event.pointerId) {
            onChange(valueAt(event.clientY));
        }
    };
    const endDrag = (event) => {
        if (dragRef.current === event.pointerId) {
            dragRef.current = null;
        }
    };

    const onKeyDown = (event) => {
        const step = {
            ArrowUp: 1,
            ArrowRight: 1,
            ArrowDown: -1,
            ArrowLeft: -1,
            PageUp: 10,
            PageDown: -10
        }[event.key];
        if (step) {
            event.preventDefault();
            onChange(value + step);
        } else if (event.key === 'Home') {
            event.preventDefault();
            onChange(0);
        } else if (event.key === 'End') {
            event.preventDefault();
            onChange(255);
        } else if ((event.key === 'Enter' || event.key === ' ') && editing) {
            event.preventDefault();
            onEdit(rootRef);
        }
    };

    return React.createElement('div', {
        ref: rootRef,
        className: cx('live-fader', editing && 'is-editing')
    },
        React.createElement('div', { className: 'live-fader-value' }, value),
        React.createElement('div', {
            ref: trackRef,
            className: 'live-fader-track',
            role: 'slider',
            tabIndex: 0,
            'aria-label': `${label}, ${address}`,
            'aria-valuemin': 0,
            'aria-valuemax': 255,
            'aria-valuenow': value,
            onPointerDown,
            onPointerMove,
            onPointerUp: endDrag,
            onPointerCancel: endDrag,
            onKeyDown
        },
            React.createElement('div', { className: 'live-fader-fill', style: { height: `${pct}%` } }),
            React.createElement('div', {
                className: 'live-fader-thumb',
                style: { bottom: `calc((100% - var(--fader-thumb)) * ${value / 255})` }
            })
        ),
        React.createElement('div', { className: 'live-fader-name', title: label }, label),
        React.createElement('div', { className: 'live-fader-addr' }, address)
    );
};

module.exports = React.memo(Fader);
