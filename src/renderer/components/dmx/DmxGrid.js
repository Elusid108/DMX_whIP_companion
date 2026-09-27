const React = require('react');
const { useEffect, useRef, useState } = React;
const { tokenColor, tokenRgb } = require('../../theme');
const { describeChannel } = require('../../../services/shared/monitorOverlay');

// 512 channels drawn on one canvas (one element instead of ~1500 DOM
// nodes). Columns follow the Grid setting, or the panel width on Auto.
// With an overlay, each row also gets bracket lanes for the detected nodes,
// pixel groups are outlined, and bars can take each channel's colour.
const LABEL_H = 13;
const BOX_H = 28;
const GAP = 4;
const LANE_H = 14;
const MIN_CELL = 26;

// Bracket colours per node (readable on both themes).
const NODE_RGB = ['56,189,248', '167,139,250', '244,114,182', '251,146,60', '45,212,191', '250,204,21'];
const ROLE_RGB = { r: '239,68,68', g: '34,197,94', b: '59,130,246', c: '245,158,11' };

const columnsFor = (grid, width) => {
    if (grid === '32x16') {
        return 32;
    }
    if (grid === '16x32') {
        return 16;
    }
    if (grid === '8x64') {
        return 8;
    }
    if (width >= 32 * MIN_CELL) {
        return 32;
    }
    return width >= 16 * MIN_CELL ? 16 : 8;
};

const formatValue = (value, format) => {
    if (format === 'percent') {
        return `${Math.round((value / 255) * 100)}%`;
    }
    if (format === 'hex') {
        return value.toString(16).toUpperCase().padStart(2, '0');
    }
    return String(value);
};

const protocolTitle = (protocol) => {
    if (protocol === 'artnet') {
        return 'Art-Net';
    }
    if (protocol === 'sacn') {
        return 'sACN';
    }
    return protocol ? String(protocol).toUpperCase() : '';
};

const roleRgb = (role) => {
    if (ROLE_RGB[role]) {
        return ROLE_RGB[role];
    }
    if (role === 'w') {
        return tokenRgb('fg-soft').join(',');
    }
    if (role === 'fx') {
        return tokenRgb('muted').join(',');
    }
    return null;
};

const geometry = (width, props) => {
    const overlay = props.overlay;
    const cols = columnsFor(props.gridDimensions, width);
    const lanes = props.showNodes && overlay ? overlay.lanes : 0;
    const bandH = lanes * LANE_H;
    const rowH = bandH + LABEL_H + BOX_H + GAP;
    const cellW = width / cols;
    return { cols, lanes, bandH, rowH, cellW, boxW: Math.max(4, cellW - GAP) };
};

// Number shown after the channel on a pixel's first cell.
const groupTag = (cell) => {
    if (!cell || cell.group < 0 || cell.pixel == null) {
        return '';
    }
    if (cell.kind === 'sub') {
        return `S${cell.pixel + 1}`;
    }
    if (cell.kind === 'fixpx') {
        return `p${cell.pixel}`;
    }
    if (cell.kind === 'pixel' || cell.kind === 'manual') {
        return `p${cell.pixel + 1}`;
    }
    return '';
};

const drawBrackets = (ctx, g, overlay, row, rowTop, font, bg) => {
    const rowStart = row * g.cols + 1;
    const rowEnd = rowStart + g.cols - 1;
    overlay.spans.forEach((span) => {
        const first = Math.max(span.first, rowStart);
        const last = Math.min(span.last, rowEnd);
        if (first > last) {
            return;
        }
        const x0 = (first - rowStart) * g.cellW + 1;
        const x1 = (last - rowStart) * g.cellW + g.boxW - 1;
        const y = rowTop + (span.lane * LANE_H);
        const mid = y + 6.5;
        const rgb = NODE_RGB[span.color % NODE_RGB.length];
        ctx.strokeStyle = `rgba(${rgb},0.9)`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x0, mid);
        ctx.lineTo(x1, mid);
        if (first === span.first) {
            ctx.moveTo(x0, mid);
            ctx.lineTo(x0, y + LANE_H - 1);
        }
        if (last === span.last) {
            ctx.moveTo(x1, mid);
            ctx.lineTo(x1, y + LANE_H - 1);
        }
        ctx.stroke();
        if (first !== span.first) {
            // Continues from the row above.
            ctx.beginPath();
            ctx.moveTo(x0 + 4, mid - 3);
            ctx.lineTo(x0, mid);
            ctx.lineTo(x0 + 4, mid + 3);
            ctx.stroke();
        }
        if (last !== span.last) {
            ctx.beginPath();
            ctx.moveTo(x1 - 4, mid - 3);
            ctx.lineTo(x1, mid);
            ctx.lineTo(x1 - 4, mid + 3);
            ctx.stroke();
        }
        // Name on the line, knocked out of it, clipped to the bracket.
        const room = x1 - x0 - 16;
        if (room > 12) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(x0 + 6, y, room, LANE_H);
            ctx.clip();
            ctx.font = `600 10px ${font}`;
            ctx.textAlign = 'left';
            const text = span.name;
            const w = Math.min(room, ctx.measureText(text).width + 6);
            ctx.fillStyle = bg;
            ctx.fillRect(x0 + 6, y, w, LANE_H - 1);
            ctx.fillStyle = `rgba(${rgb},1)`;
            ctx.fillText(text, x0 + 9, mid);
            ctx.restore();
        }
    });
    ctx.lineWidth = 1;
};

const draw = (canvas, width, props) => {
    const { dmxData, selectedUniverse, displayFormat, showAnimations, overlay, colorBars } = props;
    const g = geometry(width, props);
    const rows = Math.ceil(dmxData.length / g.cols);
    const height = rows * g.rowH;
    const dpr = window.devicePixelRatio || 1;
    const pxW = Math.max(1, Math.floor(width * dpr));
    const pxH = Math.max(1, Math.floor(height * dpr));
    if (canvas.width !== pxW || canvas.height !== pxH) {
        canvas.width = pxW;
        canvas.height = pxH;
    }
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        return g;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const font = getComputedStyle(canvas).fontFamily || 'sans-serif';
    const live = selectedUniverse !== null;
    const cells = overlay ? overlay.cells : null;
    const colors = {
        label: tokenColor('muted'),
        offFill: tokenColor('hover'),
        offLine: tokenColor('edge'),
        offText: tokenColor('faint'),
        onLine: tokenColor('accent', 0.4),
        bar: tokenColor('accent', 0.2),
        onText: tokenColor('fg'),
        groupLine: tokenColor('muted', 0.55),
        groupTint: tokenColor('fg', 0.05),
        bg: tokenColor('surface')
    };
    ctx.textBaseline = 'middle';
    const showTags = g.cellW >= 46;

    for (let row = 0; row < rows; row += 1) {
        const rowTop = row * g.rowH;
        const by = rowTop + g.bandH + LABEL_H;
        const start = row * g.cols;
        const end = Math.min(dmxData.length, start + g.cols);

        // Pixel groups: alternate tint and one outline per run in this row.
        if (cells) {
            let i = start;
            while (i < end) {
                const cell = cells[i];
                if (!cell || cell.group < 0) {
                    i += 1;
                    continue;
                }
                let j = i;
                while (j + 1 < end && cells[j + 1] && cells[j + 1].group === cell.group) {
                    j += 1;
                }
                const x0 = (i - start) * g.cellW - 1.5;
                const x1 = (j - start) * g.cellW + g.boxW + 1.5;
                ctx.beginPath();
                ctx.roundRect(x0, by - 1.5, x1 - x0, BOX_H + 3, 5);
                if (cell.group % 2 === 1) {
                    ctx.fillStyle = colors.groupTint;
                    ctx.fill();
                }
                ctx.strokeStyle = colors.groupLine;
                ctx.stroke();
                i = j + 1;
            }
        }

        for (let i = start; i < end; i += 1) {
            const x = (i - start) * g.cellW;
            const cx = x + (g.boxW / 2);
            const cell = cells ? cells[i] : null;

            let label = String(i + 1);
            if (showTags && cell && (i === 0 || !cells[i - 1] || cells[i - 1].group !== cell.group)) {
                const tag = groupTag(cell);
                label = tag ? `${label} · ${tag}` : label;
            }
            ctx.font = `500 10px ${font}`;
            ctx.textAlign = 'center';
            ctx.fillStyle = colors.label;
            ctx.fillText(label, cx, rowTop + g.bandH + (LABEL_H / 2));

            const value = dmxData[i];
            const active = live && value !== null && value !== undefined;
            const rgb = colorBars && cell ? roleRgb(cell.role) : null;
            ctx.beginPath();
            ctx.roundRect(x + 0.5, by + 0.5, g.boxW - 1, BOX_H - 1, 4);
            if (active) {
                if (showAnimations && value > 0) {
                    const h = (BOX_H - 2) * (value / 255);
                    ctx.fillStyle = rgb ? `rgba(${rgb},0.5)` : colors.bar;
                    ctx.fillRect(x + 1, by + BOX_H - 1 - h, g.boxW - 2, h);
                }
                ctx.strokeStyle = colors.onLine;
                ctx.stroke();
            } else {
                ctx.fillStyle = colors.offFill;
                ctx.fill();
                ctx.strokeStyle = colors.offLine;
                ctx.stroke();
            }
            if (rgb) {
                // The channel's colour stays visible at 0.
                ctx.fillStyle = `rgba(${rgb},0.9)`;
                ctx.fillRect(x + 3, by + BOX_H - 3, g.boxW - 6, 2);
            }
            ctx.font = `${g.cellW < 30 ? 10 : 12}px ${font}`;
            ctx.fillStyle = active ? colors.onText : colors.offText;
            ctx.fillText(active ? formatValue(value, displayFormat) : '0', cx, by + (BOX_H / 2));
        }

        if (g.lanes && overlay) {
            drawBrackets(ctx, g, overlay, row, rowTop, font, colors.bg);
        }
    }
    return g;
};

const DmxGrid = React.memo((props) => {
    const { selectedUniverse, selectedProtocol, overlay, dmxData, displayFormat } = props;
    const boxRef = useRef(null);
    const canvasRef = useRef(null);
    const propsRef = useRef(props);
    const frameRef = useRef(0);
    const geomRef = useRef(null);
    const [width, setWidth] = useState(0);
    const [hover, setHover] = useState(null);
    propsRef.current = props;

    const schedule = () => {
        if (frameRef.current) {
            return;
        }
        frameRef.current = requestAnimationFrame(() => {
            frameRef.current = 0;
            const canvas = canvasRef.current;
            const box = boxRef.current;
            if (canvas && box && box.clientWidth > 0) {
                geomRef.current = draw(canvas, box.clientWidth, propsRef.current);
            }
        });
    };

    useEffect(() => {
        const box = boxRef.current;
        if (!box) {
            return undefined;
        }
        const resize = new ResizeObserver(() => {
            setWidth(box.clientWidth);
            schedule();
        });
        resize.observe(box);
        const theme = new MutationObserver(schedule);
        theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(schedule);
        }
        return () => {
            resize.disconnect();
            theme.disconnect();
            cancelAnimationFrame(frameRef.current);
            frameRef.current = 0;
        };
    }, []);

    useEffect(schedule);

    // Channel under the pointer (hover with a mouse, tap on touch).
    const pick = (event) => {
        const g = geomRef.current;
        const canvas = canvasRef.current;
        if (!g || !canvas) {
            return null;
        }
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const col = Math.floor(x / g.cellW);
        const row = Math.floor(y / g.rowH);
        const i = row * g.cols + col;
        if (col < 0 || col >= g.cols || row < 0 || i >= 512) {
            return null;
        }
        return { ch: i + 1, x, y: (row * g.rowH) + g.bandH, w: rect.width };
    };
    const onPointerMove = (event) => {
        if (event.pointerType === 'touch') {
            return;
        }
        const hit = pick(event);
        setHover((prev) => (prev && hit && prev.ch === hit.ch ? prev : hit));
    };
    const onPointerDown = (event) => {
        if (event.pointerType === 'touch') {
            const hit = pick(event);
            setHover((prev) => (prev && hit && prev.ch === hit.ch ? null : hit));
        }
    };

    const title = selectedUniverse !== null
        ? `DMX Channels — ${protocolTitle(selectedProtocol)} Universe ${selectedUniverse}`
        : 'DMX Channels — No Universe Selected';
    const cols = columnsFor(props.gridDimensions, width);

    let tip = null;
    if (hover && selectedUniverse !== null) {
        const value = dmxData[hover.ch - 1];
        const text = `${describeChannel(overlay, hover.ch)}${value != null ? ` · ${formatValue(value, displayFormat)}` : ''}`;
        const left = Math.max(0, Math.min(hover.x - 12, hover.w - 260));
        tip = React.createElement('div', {
            className: 'pointer-events-none absolute z-10 max-w-[260px] rounded-md border border-line bg-surface px-2 py-1 text-[11px] text-fg shadow-lg',
            style: { left: `${left}px`, top: `${Math.max(0, hover.y - 26)}px` },
            role: 'status'
        }, text);
    }

    return React.createElement('div', {
        className: 'flex-1 p-3 overflow-auto min-h-0 bg-surface border-l border-line'
    },
        React.createElement('h3', { className: 'text-sm font-semibold mb-2' }, title),
        React.createElement('div', { ref: boxRef, className: 'relative w-full' },
            React.createElement('canvas', {
                ref: canvasRef,
                className: 'block w-full',
                role: 'img',
                'aria-label': `${title}, ${cols} columns`,
                onPointerMove,
                onPointerDown,
                onPointerLeave: (event) => {
                    if (event.pointerType !== 'touch') {
                        setHover(null);
                    }
                }
            }),
            tip
        )
    );
}, (prev, next) => (
    prev.selectedUniverse === next.selectedUniverse &&
    prev.selectedProtocol === next.selectedProtocol &&
    prev.displayFormat === next.displayFormat &&
    prev.gridDimensions === next.gridDimensions &&
    prev.showAnimations === next.showAnimations &&
    prev.overlay === next.overlay &&
    prev.showNodes === next.showNodes &&
    prev.colorBars === next.colorBars &&
    prev.dmxData === next.dmxData
));

module.exports = DmxGrid;
