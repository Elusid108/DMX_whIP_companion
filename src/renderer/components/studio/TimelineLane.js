const React = require('react');
const { useCallback } = React;
const TiledCanvas = require('./TiledCanvas');

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
    const canHeatmap = !ghost && !recording && Array.isArray(bands) && bucketCount > 0;
    const clipWidth = Math.max(
        (durationMs > 0 || recording || canHeatmap) ? 2 : 0,
        (durationMs / 1000) * pixelsPerSecond
    );

    // Paints only the columns inside the tile being drawn.
    const draw = useCallback((ctx, { x0, x1, height, isDark }) => {
        ctx.fillStyle = isDark ? '#09090b' : '#f4f4f5';
        ctx.fillRect(x0, 0, x1 - x0, height);

        const rgb = protocol === 'sacn' ? SACN_RGB : ARTNET_RGB;
        const rows = Math.max(1, bandsPerBucket || 8);
        const cols = Math.max(1, bucketCount);
        const bandH = height / rows;
        const colW = clipWidth / cols;
        const first = Math.max(0, Math.floor(x0 / colW));
        const last = Math.min(cols - 1, Math.ceil(x1 / colW));

        for (let col = first; col <= last; col += 1) {
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
    }, [bands, bandsPerBucket, bucketCount, clipWidth, protocol]);

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
            className: 'timeline-clip',
            style: { width: `${clipWidth}px` }
        },
            React.createElement(TiledCanvas, { width: clipWidth, draw })
        )
    );
};

module.exports = TimelineLane;
