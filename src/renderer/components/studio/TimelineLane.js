const React = require('react');
const { useEffect, useRef } = React;

const ARTNET_RGB = [34, 211, 238];
const SACN_RGB = [45, 212, 191];

const TimelineLane = ({
    protocol,
    bands,
    bucketCount,
    bandsPerBucket,
    durationMs,
    pixelsPerSecond,
    recording,
    ghost
}) => {
    const wrapRef = useRef(null);
    const canvasRef = useRef(null);

    const canHeatmap = !ghost && !recording && Array.isArray(bands) && bucketCount > 0;
    const clipWidth = Math.max(
        (durationMs > 0 || recording || canHeatmap) ? 2 : 0,
        (durationMs / 1000) * pixelsPerSecond
    );

    useEffect(() => {
        const canvas = canvasRef.current;
        const wrap = wrapRef.current;
        if (!canvas || !wrap || !canHeatmap) {
            return undefined;
        }

        const draw = () => {
            const cssW = Math.max(1, wrap.clientWidth);
            const cssH = Math.max(1, wrap.clientHeight);
            const dpr = window.devicePixelRatio || 1;
            canvas.width = Math.floor(cssW * dpr);
            canvas.height = Math.floor(cssH * dpr);
            canvas.style.width = `${cssW}px`;
            canvas.style.height = `${cssH}px`;

            const ctx = canvas.getContext('2d');
            if (!ctx) {
                return;
            }
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            const isDark = document.documentElement.classList.contains('dark');
            ctx.fillStyle = isDark ? '#09090b' : '#f4f4f5';
            ctx.fillRect(0, 0, cssW, cssH);

            const rgb = protocol === 'sacn' ? SACN_RGB : ARTNET_RGB;
            const rows = Math.max(1, bandsPerBucket || 8);
            const cols = Math.max(1, bucketCount);
            const bandH = cssH / rows;
            const colW = cssW / cols;

            for (let col = 0; col < cols; col += 1) {
                for (let row = 0; row < rows; row += 1) {
                    const value = bands[(col * rows) + row] || 0;
                    if (value <= 0) {
                        continue;
                    }
                    const t = value / 255;
                    ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.14 + (t * 0.86)})`;
                    ctx.fillRect(col * colW, row * bandH, Math.max(1, colW), Math.max(1, bandH));
                }
            }
        };

        draw();
        const observer = new ResizeObserver(draw);
        observer.observe(wrap);
        const themeObserver = new MutationObserver(draw);
        themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        return () => {
            observer.disconnect();
            themeObserver.disconnect();
        };
    }, [bands, bandsPerBucket, bucketCount, canHeatmap, protocol]);

    if (ghost) {
        return React.createElement('div', { className: 'timeline-track' });
    }

    if (!canHeatmap) {
        return React.createElement('div', { className: 'timeline-track' },
            clipWidth > 0 && React.createElement('div', {
                className: `timeline-clip ${protocol === 'sacn' ? 'is-sacn' : 'is-artnet'}`,
                style: { width: `${clipWidth}px` }
            })
        );
    }

    return React.createElement('div', { className: 'timeline-track' },
        React.createElement('div', {
            ref: wrapRef,
            className: 'timeline-clip',
            style: { width: `${clipWidth}px` }
        },
            React.createElement('canvas', {
                ref: canvasRef,
                className: 'block h-full w-full'
            })
        )
    );
};

module.exports = TimelineLane;
