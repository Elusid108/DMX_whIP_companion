const React = require('react');
const { useRef, useState } = React;

const EDGE = 7;

const TimelineClips = ({
    clips,
    pixelsPerSecond,
    durationMs,
    selectedId,
    range,
    onSelect,
    onReorder,
    onTrim,
    onRangeChange
}) => {
    const rowRef = useRef(null);
    const dragRef = useRef(null);
    const [preview, setPreview] = useState(null);

    const timeFromClientX = (clientX) => {
        const node = rowRef.current;
        if (!node) {
            return 0;
        }
        const rect = node.getBoundingClientRect();
        const x = clientX - rect.left;
        return Math.max(0, Math.min(durationMs, (x / pixelsPerSecond) * 1000));
    };

    const displayClips = preview && preview.clips ? preview.clips : (clips || []);

    const onPointerDown = (event, clip, index, edge) => {
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
                sourceOutMs: clip.sourceOutMs
            };
            return;
        }
        dragRef.current = {
            kind: 'move',
            fromIndex: index,
            startX: event.clientX
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
            const next = drag.edge === 'in'
                ? drag.sourceInMs + deltaMs
                : drag.sourceOutMs + deltaMs;
            setPreview({
                clips: (clips || []).map((clip) => {
                    if (clip.id !== drag.clipId) {
                        return clip;
                    }
                    if (drag.edge === 'in') {
                        return { ...clip, sourceInMs: Math.min(next, clip.sourceOutMs) };
                    }
                    return { ...clip, sourceOutMs: Math.max(next, clip.sourceInMs) };
                })
            });
            return;
        }
        if (drag.kind === 'move') {
            const t = timeFromClientX(event.clientX);
            let dest = (clips || []).length;
            for (let i = 0; i < (clips || []).length; i += 1) {
                const mid = (clips[i].startMs + clips[i].endMs) / 2;
                if (t < mid) {
                    dest = i;
                    break;
                }
            }
            setPreview({ dest, fromIndex: drag.fromIndex });
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
        if (drag.kind === 'move' && nextPreview && nextPreview.dest != null && onReorder) {
            let dest = nextPreview.dest;
            if (dest > drag.fromIndex) {
                dest -= 1;
            }
            if (dest !== drag.fromIndex) {
                onReorder(drag.fromIndex, dest);
            }
        }
    };

    if (!clips || clips.length === 0 || durationMs <= 0) {
        return React.createElement('div', {
            className: 'timeline-clips'
        });
    }

    return React.createElement('div', {
        ref: rowRef,
        className: 'timeline-clips',
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
        displayClips.map((clip, index) => {
            const start = clip.startMs != null
                ? clip.startMs
                : displayClips.slice(0, index).reduce((sum, item) => (
                    sum + Math.max(0, (item.sourceOutMs || 0) - (item.sourceInMs || 0))
                ), 0);
            const widthMs = Math.max(0, (clip.sourceOutMs || 0) - (clip.sourceInMs || 0));
            const left = (start / 1000) * pixelsPerSecond;
            const width = Math.max(8, (widthMs / 1000) * pixelsPerSecond);
            const moving = preview && preview.fromIndex === index && preview.dest != null;
            return React.createElement('div', {
                key: clip.id,
                className: `timeline-block ${selectedId === clip.id ? 'is-active' : ''} ${moving ? 'is-moving' : ''}`,
                style: { left: `${left}px`, width: `${width}px` },
                onPointerDown: (event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    const x = event.clientX - rect.left;
                    const edge = x <= EDGE ? 'in' : (x >= rect.width - EDGE ? 'out' : null);
                    onPointerDown(event, clip, index, edge);
                }
            },
                React.createElement('span', {
                    className: 'timeline-block-edge is-in'
                }),
                React.createElement('span', {
                    className: 'truncate px-1.5 text-[10px] font-medium'
                }, clip.name || 'Clip'),
                React.createElement('span', {
                    className: 'timeline-block-edge is-out'
                })
            );
        })
    );
};

module.exports = TimelineClips;
