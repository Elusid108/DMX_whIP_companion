const { useEffect, useRef } = require('react');

// Two-finger horizontal pinch on ref's element: onZoom(factor, originX)
// with originX relative to the element's left edge. Touch only; mouse and
// trackpads use Ctrl+wheel. The element needs touch-action that leaves
// pinch to us (pan-x pan-y).
const usePinchZoom = (ref, onZoom) => {
    const zoomRef = useRef(onZoom);
    zoomRef.current = onZoom;

    useEffect(() => {
        const node = ref.current;
        if (!node) {
            return undefined;
        }
        const touches = new Map();
        let last = 0;
        let frame = 0;
        let pending = 1;
        let originX = 0;

        const spread = () => {
            const xs = [...touches.values()];
            return Math.abs(xs[0] - xs[1]);
        };
        const flush = () => {
            frame = 0;
            if (pending !== 1) {
                zoomRef.current(pending, originX);
                pending = 1;
            }
        };
        const onDown = (event) => {
            if (event.pointerType !== 'touch') {
                return;
            }
            touches.set(event.pointerId, event.clientX);
            if (touches.size === 2) {
                last = Math.max(1, spread());
            }
        };
        const onMove = (event) => {
            if (!touches.has(event.pointerId)) {
                return;
            }
            touches.set(event.pointerId, event.clientX);
            if (touches.size !== 2) {
                return;
            }
            const now = Math.max(1, spread());
            const xs = [...touches.values()];
            originX = ((xs[0] + xs[1]) / 2) - node.getBoundingClientRect().left;
            pending *= now / last;
            last = now;
            if (!frame) {
                frame = requestAnimationFrame(flush);
            }
        };
        const onUp = (event) => {
            touches.delete(event.pointerId);
        };
        node.addEventListener('pointerdown', onDown, true);
        node.addEventListener('pointermove', onMove, true);
        node.addEventListener('pointerup', onUp, true);
        node.addEventListener('pointercancel', onUp, true);
        return () => {
            cancelAnimationFrame(frame);
            node.removeEventListener('pointerdown', onDown, true);
            node.removeEventListener('pointermove', onMove, true);
            node.removeEventListener('pointerup', onUp, true);
            node.removeEventListener('pointercancel', onUp, true);
        };
    }, [ref]);
};

module.exports = usePinchZoom;
