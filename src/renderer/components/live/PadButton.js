const React = require('react');
const { useRef } = React;
const { cx } = require('../ui');

// One pad: Flash is lit while held, Toggle flips on each press. Pointer
// capture per pad keeps several held pads independent on a touch screen.
const PadButton = ({ index, control, lit, editing, armed, mapped, onPress, onEdit, address }) => {
    const rootRef = useRef(null);
    const heldRef = useRef(null);
    const label = control.name || `P${index + 1}`;

    const onPointerDown = (event) => {
        if (event.button !== undefined && event.button !== 0) {
            return;
        }
        event.preventDefault();
        if (editing) {
            onEdit(rootRef);
            return;
        }
        try {
            event.currentTarget.setPointerCapture(event.pointerId);
        } catch (err) {
            // Pointer already gone; the press still counts.
        }
        heldRef.current = event.pointerId;
        onPress(true);
    };
    const onPointerUp = (event) => {
        if (heldRef.current === event.pointerId) {
            heldRef.current = null;
            onPress(false);
        }
    };
    const keyHeld = useRef(false);
    const onKeyDown = (event) => {
        if (event.key !== ' ' && event.key !== 'Enter') {
            return;
        }
        event.preventDefault();
        if (editing) {
            onEdit(rootRef);
            return;
        }
        if (!keyHeld.current) {
            keyHeld.current = true;
            onPress(true);
        }
    };
    const onKeyUp = (event) => {
        if ((event.key === ' ' || event.key === 'Enter') && keyHeld.current) {
            keyHeld.current = false;
            onPress(false);
        }
    };

    return React.createElement('button', {
        ref: rootRef,
        type: 'button',
        className: cx('live-pad', lit && 'is-lit', editing && 'is-editing', armed && 'is-armed'),
        'aria-pressed': lit,
        'aria-label': `${label}, ${control.mode === 'flash' ? 'flash' : 'toggle'}, ${address}`,
        onPointerDown,
        onPointerUp,
        onPointerCancel: onPointerUp,
        onKeyDown,
        onKeyUp,
        onContextMenu: (event) => event.preventDefault()
    },
        mapped && React.createElement('span', { className: 'live-midi-badge', title: 'Mapped to MIDI' }, 'MIDI'),
        React.createElement('span', { className: 'live-pad-name' }, label),
        React.createElement('span', { className: 'live-pad-meta' }, address),
        React.createElement('span', { className: 'live-pad-meta' }, control.mode === 'flash' ? 'Flash' : 'Toggle')
    );
};

module.exports = React.memo(PadButton);
