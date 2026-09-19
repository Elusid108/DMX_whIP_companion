const React = require('react');
const { useEffect, useRef } = React;
const { useUniverseLevels } = require('../../hooks/useUniverseLevels');

const COLS = 32;
const ROWS = 16;
const CSS_W = 96;
const CSS_H = 48;
const ARTNET_RGB = [34, 211, 238];
const SACN_RGB = [45, 212, 191];

const UniverseActivityGrid = ({ protocol, universeId }) => {
    const canvasRef = useRef(null);
    const bufferRef = useRef(null);
    const { subscribe } = useUniverseLevels(protocol, universeId);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return undefined;
        }

        const draw = () => {
            const dpr = window.devicePixelRatio || 1;
            canvas.width = Math.floor(CSS_W * dpr);
            canvas.height = Math.floor(CSS_H * dpr);
            canvas.style.width = `${CSS_W}px`;
            canvas.style.height = `${CSS_H}px`;

            const ctx = canvas.getContext('2d');
            if (!ctx) {
                return;
            }
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, CSS_W, CSS_H);

            const isDark = document.documentElement.classList.contains('dark');
            const rgb = protocol === 'sacn' ? SACN_RGB : ARTNET_RGB;
            const levels = bufferRef.current;
            const cellW = CSS_W / COLS;
            const cellH = CSS_H / ROWS;
            const gap = 1;
            const fillW = Math.max(1, cellW - gap);
            const fillH = Math.max(1, cellH - gap);

            for (let row = 0; row < ROWS; row++) {
                for (let col = 0; col < COLS; col++) {
                    const value = levels ? (levels[(row * COLS) + col] || 0) : 0;
                    const x = col * cellW;
                    const y = row * cellH;
                    if (value <= 0) {
                        ctx.fillStyle = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
                        ctx.fillRect(x, y, fillW, fillH);
                        continue;
                    }
                    const t = value / 255;
                    ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.18 + (t * 0.82)})`;
                    ctx.fillRect(x, y, fillW, fillH);
                }
            }
        };

        const unsubscribe = subscribe((buffer) => {
            bufferRef.current = buffer;
            draw();
        });

        const themeObserver = new MutationObserver(draw);
        themeObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['class']
        });

        return () => {
            unsubscribe();
            themeObserver.disconnect();
        };
    }, [protocol, universeId, subscribe]);

    return React.createElement('canvas', {
        ref: canvasRef,
        className: 'block flex-none',
        width: CSS_W,
        height: CSS_H,
        style: { width: `${CSS_W}px`, height: `${CSS_H}px` }
    });
};

module.exports = UniverseActivityGrid;
