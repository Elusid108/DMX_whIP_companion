const React = require('react');
const { createPortal } = require('react-dom');
const { useCallback, useEffect, useLayoutEffect, useRef } = React;
const cx = require('./cx');

const MARGIN = 8;
const GAP = 4;

// Floating panel anchored to an element (anchorRef) or a screen point
// ({ x, y }). It opens on the preferred side (placement 'bottom-end',
// 'bottom-start', 'top-end', 'top-start'), flips when the other side has
// more room, clamps inside the window, and scrolls when taller than the
// room left. Outside press and Escape call onClose; focus returns to the
// anchor on Escape.
const Popover = ({
    open,
    anchorRef,
    point,
    onClose,
    placement = 'bottom-end',
    label,
    className,
    children
}) => {
    const panelRef = useRef(null);

    const place = useCallback(() => {
        const panel = panelRef.current;
        if (!panel) {
            return;
        }
        const anchor = anchorRef && anchorRef.current;
        let rect = null;
        if (anchor) {
            rect = anchor.getBoundingClientRect();
        } else if (point) {
            rect = { left: point.x, right: point.x, top: point.y, bottom: point.y };
        }
        if (!rect) {
            return;
        }
        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;
        const [side, align] = placement.split('-');

        panel.style.maxHeight = '';
        panel.style.maxWidth = `${Math.max(0, vw - (MARGIN * 2))}px`;
        const width = panel.offsetWidth;
        const height = panel.offsetHeight;

        const below = vh - rect.bottom - GAP - MARGIN;
        const above = rect.top - GAP - MARGIN;
        const preferBelow = side !== 'top';
        const fitsPreferred = height <= (preferBelow ? below : above);
        const useBelow = fitsPreferred ? preferBelow : below >= above;
        const room = Math.max(80, useBelow ? below : above);
        const shownHeight = Math.min(height, room);
        const top = useBelow ? rect.bottom + GAP : rect.top - GAP - shownHeight;

        let left = align === 'start' ? rect.left : rect.right - width;
        left = Math.min(left, vw - MARGIN - width);
        left = Math.max(MARGIN, left);

        panel.style.maxHeight = `${room}px`;
        panel.style.top = `${Math.max(MARGIN, top)}px`;
        panel.style.left = `${left}px`;
        panel.style.visibility = 'visible';
    }, [anchorRef, point, placement]);

    useLayoutEffect(() => {
        if (open) {
            place();
        }
    });

    useEffect(() => {
        if (!open) {
            return undefined;
        }
        let frame = 0;
        const schedule = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(place);
        };
        const onPointerDown = (event) => {
            const target = event.target;
            const tag = target && target.tagName;
            // Native <select> menus report their own option targets.
            if (tag === 'OPTION' || tag === 'SELECT') {
                return;
            }
            const panel = panelRef.current;
            const anchor = anchorRef && anchorRef.current;
            if ((panel && panel.contains(target)) || (anchor && anchor.contains(target))) {
                return;
            }
            onClose();
        };
        const onKeyDown = (event) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                onClose();
                const anchor = anchorRef && anchorRef.current;
                if (anchor && anchor.focus) {
                    anchor.focus();
                }
            }
        };
        const observer = new ResizeObserver(schedule);
        if (panelRef.current) {
            observer.observe(panelRef.current);
        }
        window.addEventListener('resize', schedule);
        window.addEventListener('scroll', schedule, true);
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
            window.removeEventListener('resize', schedule);
            window.removeEventListener('scroll', schedule, true);
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open, place, onClose, anchorRef]);

    if (!open) {
        return null;
    }
    return createPortal(React.createElement('div', {
        ref: panelRef,
        role: 'dialog',
        'aria-label': label,
        className: cx('pop-panel fixed z-50 overflow-y-auto', className),
        style: { top: 0, left: 0, visibility: 'hidden' }
    }, children), document.body);
};

module.exports = Popover;
