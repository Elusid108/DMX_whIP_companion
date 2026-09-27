const React = require('react');
const { createPortal } = require('react-dom');
const { useEffect, useId, useRef } = React;
const cx = require('./cx');

const SIZES = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl'
};

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Modal dialog (a bottom sheet under 640 px, see .dialog-panel). Escape and a
// backdrop press call onClose unless dismissible is false (e.g. while busy).
// Focus moves in on open, Tab stays inside, and focus returns on close.
const Dialog = ({
    open,
    onClose,
    title,
    subtitle,
    size = 'md',
    dismissible = true,
    className,
    children
}) => {
    const panelRef = useRef(null);
    const titleId = useId();
    const dismissRef = useRef(dismissible);
    const closeRef = useRef(onClose);
    dismissRef.current = dismissible;
    closeRef.current = onClose;

    useEffect(() => {
        if (!open) {
            return undefined;
        }
        const previous = document.activeElement;
        const panel = panelRef.current;
        if (panel && !panel.contains(document.activeElement)) {
            const first = panel.querySelector(FOCUSABLE);
            (first || panel).focus();
        }
        const onKeyDown = (event) => {
            if (event.key === 'Escape') {
                if (dismissRef.current && closeRef.current) {
                    event.stopPropagation();
                    closeRef.current();
                }
                return;
            }
            if (event.key !== 'Tab' || !panelRef.current) {
                return;
            }
            const items = Array.from(panelRef.current.querySelectorAll(FOCUSABLE))
                .filter((node) => node.offsetParent !== null);
            if (!items.length) {
                event.preventDefault();
                return;
            }
            const first = items[0];
            const last = items[items.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            if (previous && previous.focus && document.contains(previous)) {
                previous.focus();
            }
        };
    }, [open]);

    if (!open) {
        return null;
    }
    return createPortal(React.createElement('div', {
        className: 'dialog-backdrop',
        onMouseDown: (event) => {
            if (event.target === event.currentTarget && dismissible && onClose) {
                onClose();
            }
        }
    },
        React.createElement('div', {
            ref: panelRef,
            role: 'dialog',
            'aria-modal': true,
            'aria-labelledby': title ? titleId : undefined,
            tabIndex: -1,
            className: cx('dialog-panel', SIZES[size] || SIZES.md, className)
        },
            title && React.createElement('div', {
                id: titleId,
                className: 'text-sm font-medium mb-1'
            }, title),
            subtitle && React.createElement('p', {
                className: 'text-xs text-muted truncate mb-2',
                title: typeof subtitle === 'string' ? subtitle : undefined
            }, subtitle),
            children
        )
    ), document.body);
};

module.exports = Dialog;
