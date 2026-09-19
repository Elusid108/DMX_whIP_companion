const React = require('react');
const { useEffect, useRef, useState } = React;

const EDGE = 7;

const slicePeaks = (peaks, sourceInMs, sourceOutMs, durationMs) => {
    if (!Array.isArray(peaks) || peaks.length === 0 || !durationMs) {
        return [];
    }
    const start = Math.max(0, Math.min(1, sourceInMs / durationMs));
    const end = Math.max(start, Math.min(1, sourceOutMs / durationMs));
    const from = Math.floor(start * peaks.length);
    const to = Math.max(from + 1, Math.ceil(end * peaks.length));
    return peaks.slice(from, to);
};

const WaveRow = ({ clips, audioMedia, channel, pixelsPerSecond, durationMs }) => {
    const wrapRef = useRef(null);
    const canvasRef = useRef(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        const wrap = wrapRef.current;
        if (!canvas || !wrap) {
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
            ctx.fillStyle = isDark ? 'rgba(34,211,238,0.85)' : 'rgba(8,145,178,0.8)';
            const mid = cssH / 2;
            for (const clip of clips || []) {
                const media = audioMedia && audioMedia[clip.mediaId];
                const peaks = media ? (channel === 'R' ? media.peaksR : media.peaksL) : [];
                const shown = slicePeaks(peaks, clip.sourceInMs, clip.sourceOutMs, media && media.durationMs);
                const left = ((clip.startMs || 0) / 1000) * pixelsPerSecond;
                const width = Math.max(2, (((clip.sourceOutMs || 0) - (clip.sourceInMs || 0)) / 1000) * pixelsPerSecond);
                if (shown.length === 0) {
                    continue;
                }
                const step = width / shown.length;
                for (let i = 0; i < shown.length; i += 1) {
                    const amp = (shown[i] / 255) * (mid - 1);
                    const x = left + (i * step);
                    ctx.fillRect(x, mid - amp, Math.max(1, step), amp * 2);
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
    }, [audioMedia, channel, clips, durationMs, pixelsPerSecond]);

    return React.createElement('div', { className: 'timeline-audio-row', ref: wrapRef },
        React.createElement('canvas', { ref: canvasRef, className: 'block h-full w-full pointer-events-none' })
    );
};

const TimelineAudio = ({
    clips,
    audioMedia,
    pixelsPerSecond,
    durationMs,
    selectedId,
    range,
    onSelect,
    onMove,
    onTrim,
    onRangeChange
}) => {
    const rowRef = useRef(null);
    const dragRef = useRef(null);
    const [preview, setPreview] = useState(null);
    const displayClips = preview && preview.clips ? preview.clips : (clips || []);

    const timeFromClientX = (clientX) => {
        const node = rowRef.current;
        if (!node) {
            return 0;
        }
        const rect = node.getBoundingClientRect();
        return Math.max(0, Math.min(durationMs, ((clientX - rect.left) / pixelsPerSecond) * 1000));
    };

    const onPointerDown = (event, clip, edge) => {
        if (event.button !== 0) {
            return;
        }
        event.stopPropagation();
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        if (event.shiftKey) {
            const t = timeFromClientX(event.clientX);
            dragRef.current = { kind: 'range', start: t };
            onRangeChange({ startMs: t, endMs: t });
            return;
        }
        onSelect(clip.id);
        if (edge) {
            dragRef.current = {
                kind: 'trim',
                clipId: clip.id,
                edge,
                startX: event.clientX,
                sourceInMs: clip.sourceInMs,
                sourceOutMs: clip.sourceOutMs,
                startMs: clip.startMs
            };
            return;
        }
        dragRef.current = {
            kind: 'move',
            clipId: clip.id,
            startX: event.clientX,
            startMs: clip.startMs || 0
        };
    };

    const onPointerMove = (event) => {
        const drag = dragRef.current;
        if (!drag) {
            return;
        }
        event.stopPropagation();
        if (drag.kind === 'range') {
            const t = timeFromClientX(event.clientX);
            onRangeChange({
                startMs: Math.min(drag.start, t),
                endMs: Math.max(drag.start, t)
            });
            return;
        }
        if (drag.kind === 'trim') {
            const deltaMs = ((event.clientX - drag.startX) / pixelsPerSecond) * 1000;
            setPreview({
                clips: (clips || []).map((clip) => {
                    if (clip.id !== drag.clipId) {
                        return clip;
                    }
                    if (drag.edge === 'in') {
                        const sourceInMs = Math.min(drag.sourceInMs + deltaMs, clip.sourceOutMs);
                        return {
                            ...clip,
                            sourceInMs,
                            startMs: Math.max(0, drag.startMs + (sourceInMs - drag.sourceInMs))
                        };
                    }
                    return { ...clip, sourceOutMs: Math.max(drag.sourceOutMs + deltaMs, clip.sourceInMs) };
                })
            });
            return;
        }
        const deltaMs = ((event.clientX - drag.startX) / pixelsPerSecond) * 1000;
        setPreview({
            clips: (clips || []).map((clip) => (
                clip.id === drag.clipId ? { ...clip, startMs: Math.max(0, drag.startMs + deltaMs) } : clip
            ))
        });
    };

    const onPointerUp = (event) => {
        const drag = dragRef.current;
        if (!drag) {
            return;
        }
        event.stopPropagation();
        dragRef.current = null;
        const nextPreview = preview;
        setPreview(null);
        if (drag.kind === 'trim' && nextPreview && nextPreview.clips && onTrim) {
            const clip = nextPreview.clips.find((item) => item.id === drag.clipId);
            if (clip) {
                onTrim(clip.id, drag.edge, drag.edge === 'in' ? clip.sourceInMs : clip.sourceOutMs, 'audio');
            }
            return;
        }
        if (drag.kind === 'move' && nextPreview && nextPreview.clips && onMove) {
            const clip = nextPreview.clips.find((item) => item.id === drag.clipId);
            if (clip) {
                onMove(clip.id, clip.startMs, 0, 'audio');
            }
        }
    };

    return React.createElement('div', {
        ref: rowRef,
        className: 'timeline-audio-stack',
        onPointerMove,
        onPointerUp,
        onPointerCancel: onPointerUp
    },
        React.createElement(WaveRow, {
            clips: displayClips,
            audioMedia,
            channel: 'L',
            pixelsPerSecond,
            durationMs
        }),
        React.createElement(WaveRow, {
            clips: displayClips,
            audioMedia,
            channel: 'R',
            pixelsPerSecond,
            durationMs
        }),
        range && range.endMs > range.startMs && React.createElement('div', {
            className: 'timeline-range',
            style: {
                left: `${(range.startMs / 1000) * pixelsPerSecond}px`,
                width: `${((range.endMs - range.startMs) / 1000) * pixelsPerSecond}px`
            }
        }),
        displayClips.map((clip) => {
            const left = ((clip.startMs || 0) / 1000) * pixelsPerSecond;
            const width = Math.max(8, (((clip.sourceOutMs || 0) - (clip.sourceInMs || 0)) / 1000) * pixelsPerSecond);
            return React.createElement('div', {
                key: clip.id,
                className: `timeline-audio-block ${selectedId === clip.id ? 'is-active' : ''}`,
                style: { left: `${left}px`, width: `${width}px` },
                onPointerDown: (event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    const x = event.clientX - rect.left;
                    const edge = x <= EDGE ? 'in' : (x >= rect.width - EDGE ? 'out' : null);
                    onPointerDown(event, clip, edge);
                }
            },
                React.createElement('span', { className: 'timeline-block-edge is-in' }),
                React.createElement('span', {
                    className: 'truncate px-1.5 text-[10px] font-medium'
                }, clip.name || 'Audio'),
                React.createElement('span', { className: 'timeline-block-edge is-out' })
            );
        })
    );
};

module.exports = TimelineAudio;
