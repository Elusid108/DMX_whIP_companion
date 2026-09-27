const React = require('react');
const { useEffect, useRef, useState } = React;

// A timeline row can be far wider than one canvas may be (Chromium draws
// nothing past 32767 device px). The row is split into tiles; a tile holds a
// canvas only while it is near the visible scroll area.
const TILE_PX = 2048;

const Tile = ({ x0, width, draw, theme }) => {
    const boxRef = useRef(null);
    const canvasRef = useRef(null);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const box = boxRef.current;
        if (!box) {
            return undefined;
        }
        const observer = new IntersectionObserver((entries) => {
            setVisible(entries.some((entry) => entry.isIntersecting));
        }, { rootMargin: `0px ${TILE_PX}px` });
        observer.observe(box);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        const box = boxRef.current;
        if (!visible || !canvas || !box) {
            return undefined;
        }
        const paint = () => {
            const height = Math.max(1, box.clientHeight);
            const dpr = window.devicePixelRatio || 1;
            const pxW = Math.max(1, Math.floor(width * dpr));
            const pxH = Math.max(1, Math.floor(height * dpr));
            if (canvas.width !== pxW || canvas.height !== pxH) {
                canvas.width = pxW;
                canvas.height = pxH;
            }
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                return;
            }
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, pxW, pxH);
            // Row coordinates in, tile pixels out.
            ctx.setTransform(dpr, 0, 0, dpr, -x0 * dpr, 0);
            draw(ctx, { x0, x1: x0 + width, height });
        };
        paint();
        const observer = new ResizeObserver(paint);
        observer.observe(box);
        return () => observer.disconnect();
    }, [visible, draw, width, x0, theme]);

    return React.createElement('div', {
        ref: boxRef,
        className: 'absolute top-0 bottom-0 pointer-events-none',
        style: { left: `${x0}px`, width: `${width}px` }
    },
        visible && React.createElement('canvas', {
            ref: canvasRef,
            className: 'block h-full w-full'
        })
    );
};

// draw(ctx, { x0, x1, height }) paints row coordinates; it only needs to
// cover [x0, x1). Pass a memoized draw so tiles repaint on change; tiles also
// repaint on a theme switch, so draw can read colours from theme.js.
const TiledCanvas = ({ width, draw }) => {
    const [theme, setTheme] = useState(0);

    useEffect(() => {
        const observer = new MutationObserver(() => setTheme((value) => value + 1));
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        return () => observer.disconnect();
    }, []);

    const total = Math.max(0, Math.ceil(width));
    const tiles = [];
    for (let x0 = 0; x0 < total; x0 += TILE_PX) {
        tiles.push(React.createElement(Tile, {
            key: x0,
            x0,
            width: Math.min(TILE_PX, total - x0),
            draw,
            theme
        }));
    }
    return React.createElement('div', {
        className: 'absolute inset-0 pointer-events-none',
        style: { width: `${total}px` }
    }, tiles);
};

module.exports = TiledCanvas;
