const React = require('react');
const { useRef, useState } = React;

const EDGE = 7;
const ROW_H = 28;

const TimelineClips = ({
    clips,
    trackCount,
    pixelsPerSecond,
    durationMs,
    selectedId,
    range,
    onSelect,
    onMove,
    onTrim,
    onRangeChange,
    onInspect,
    onAddTrack
}) => {
    const stackRef = useRef(null);
    const dragRef = useRef(null);
    const [preview, setPreview] = useState(null);

    const rows = Math.max(1, trackCount || 1);
    const timeFromClientX = (clientX) => {
        const node = stackRef.current;
        if (!node) {
            return 0;
        }
        const rect = node.getBoundingClientRect();
        const x = clientX - rect.left;
        return Math.max(0, Math.min(durationMs, (x / pixelsPerSecond) * 1000));
    };

    const trackFromClientY = (clientY, originTrack) => {
        const node = stackRef.current;
        if (!node) {
            return originTrack;
        }
        const rect = node.getBoundingClientRect();
        const index = Math.floor((clientY - rect.top) / ROW_H);
        return Math.max(0, Math.min(rows, index));
    };

    const displayClips = preview && preview.clips ? preview.clips : (clips || []);

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
            startY: event.clientY,
            startMs: clip.startMs || 0,
            trackId: clip.trackId || 0
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
        if (drag.kind === 'move') {
            const deltaMs = ((event.clientX - drag.startX) / pixelsPerSecond) * 1000;
            const startMs = Math.max(0, drag.startMs + deltaMs);
            const trackId = trackFromClientY(event.clientY, drag.trackId);
            setPreview({
                clips: (clips || []).map((clip) => (
                    clip.id === drag.clipId ? { ...clip, startMs, trackId } : clip
                ))
            });
        }
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
        if (drag.kind === 'trim' && nextPreview && nextPreview.clips) {
            const clip = nextPreview.clips.find((item) => item.id === drag.clipId);
            if (clip && onTrim) {
                onTrim(drag.clipId, drag.edge, drag.edge === 'in' ? clip.sourceInMs : clip.sourceOutMs);
            }
            return;
        }
        if (drag.kind === 'move' && nextPreview && nextPreview.clips && onMove) {
            const clip = nextPreview.clips.find((item) => item.id === drag.clipId);
            if (!clip) {
                return;
            }
            onMove(clip.id, clip.startMs, clip.trackId);
        }
    };

    const rowCount = Math.max(rows, preview && preview.clips
        ? preview.clips.reduce((max, clip) => Math.max(max, (clip.trackId || 0) + 1), rows)
        : rows);

    return React.createElement('div', {
        ref: stackRef,
        className: 'timeline-clip-stack',
        style: { height: `${rowCount * ROW_H}px` },
        onPointerMove,
        onPointerUp,
        onPointerCancel: onPointerUp
    },
        range && range.endMs > range.startMs && React.createElement('div', {
            className: 'timeline-range',
            style: {
                left: `${(range.startMs / 1000) * pixelsPerSecond}px`,
                width: `${((range.endMs - range.startMs) / 1000) * pixelsPerSecond}px`
            }
        }),
        Array.from({ length: rowCount }, (_, trackId) => React.createElement('div', {
            key: `row-${trackId}`,
            className: 'timeline-clips'
        })),
        displayClips.map((clip) => {
            const start = clip.startMs || 0;
            const widthMs = Math.max(0, (clip.sourceOutMs || 0) - (clip.sourceInMs || 0));
            const left = (start / 1000) * pixelsPerSecond;
            const width = Math.max(8, (widthMs / 1000) * pixelsPerSecond);
            const top = ((clip.trackId || 0) * ROW_H) + 2;
            return React.createElement('div', {
                key: clip.id,
                className: `timeline-block ${selectedId === clip.id ? 'is-active' : ''}`,
                style: { left: `${left}px`, width: `${width}px`, top: `${top}px`, height: `${ROW_H - 4}px` },
                onContextMenu: (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onSelect(clip.id);
                    if (onInspect) {
                        onInspect(clip, { x: event.clientX, y: event.clientY });
                    }
                },
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
                }, clip.name || 'Clip'),
                React.createElement('span', { className: 'timeline-block-edge is-out' })
            );
        })
    );
};

module.exports = TimelineClips;
