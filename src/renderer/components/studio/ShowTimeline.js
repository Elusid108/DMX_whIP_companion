const React = require('react');
const { useCallback, useEffect, useMemo, useRef, useState } = React;
const TimelineLane = require('./TimelineLane');
const TimelineClips = require('./TimelineClips');

const HEADER_WIDTH = 160;
const MIN_PPS = 4;
const MAX_PPS = 400;
const PAD_PX = 24;

const parseUniverseKey = (key) => {
    const dash = String(key).indexOf('-');
    if (dash <= 0) {
        return null;
    }
    return {
        protocol: key.slice(0, dash),
        universe: Number(key.slice(dash + 1))
    };
};

const trackLabel = (protocol, universe) => (
    protocol === 'sacn' ? `sACN ${universe}` : `Art-Net ${universe}`
);

const formatTick = (seconds, step) => {
    const total = Math.max(0, seconds);
    const minutes = Math.floor(total / 60);
    const secs = total - (minutes * 60);
    if (step < 1) {
        const whole = Math.floor(secs);
        const hundredths = Math.round((secs - whole) * 100);
        return `${String(minutes).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(Math.floor(secs)).padStart(2, '0')}`;
};

const tickStep = (pixelsPerSecond) => {
    const raw = 48 / Math.max(pixelsPerSecond, 1);
    const steps = [0.1, 0.5, 1, 5, 10, 30, 60, 120, 300, 600];
    return steps.find((step) => step >= raw) || 600;
};

const buildTracks = (overview, selectedUniverses, recordingPath, isRecording) => {
    if (overview && overview.tracks && overview.tracks.length > 0) {
        return overview.tracks.map((track) => {
            const key = `${track.protocol}-${track.universe}`;
            return {
                key,
                protocol: track.protocol,
                universe: track.universe,
                wokenChannels: track.wokenChannels || 0,
                bands: track.bands,
                bucketCount: overview.bucketCount,
                bandsPerBucket: overview.bandsPerBucket || 8,
                armed: selectedUniverses ? selectedUniverses.has(key) : false,
                ghost: false
            };
        });
    }

    if (!recordingPath || !selectedUniverses || selectedUniverses.size === 0) {
        return [];
    }

    return [...selectedUniverses]
        .map(parseUniverseKey)
        .filter((item) => item && Number.isFinite(item.universe))
        .sort((a, b) => {
            if (a.protocol !== b.protocol) {
                return a.protocol.localeCompare(b.protocol);
            }
            return a.universe - b.universe;
        })
        .map((item) => ({
            key: `${item.protocol}-${item.universe}`,
            protocol: item.protocol,
            universe: item.universe,
            wokenChannels: 0,
            bands: null,
            bucketCount: 0,
            bandsPerBucket: 8,
            armed: true,
            ghost: !isRecording
        }));
};

const ShowTimeline = ({
    overview,
    playheadMs,
    isRecording,
    recordingDuration,
    selectedUniverses,
    isLoopEnabled,
    isFileLoaded,
    recordingPath,
    isIdle,
    loadError,
    clips,
    onSeek,
    onSplit,
    onCutRange,
    onReorderClip,
    onTrimClip
}) => {
    const scrollRef = useRef(null);
    const didFitRef = useRef(false);
    const dragRef = useRef(false);
    const [pixelsPerSecond, setPixelsPerSecond] = useState(40);
    const [viewWidth, setViewWidth] = useState(640);
    const [scrollLeft, setScrollLeft] = useState(0);
    const [selectedKey, setSelectedKey] = useState(null);
    const [selectedClipId, setSelectedClipId] = useState(null);
    const [range, setRange] = useState(null);

    const durationMs = isRecording
        ? recordingDuration
        : (overview && overview.durationMs) || 0;
    const durationSec = Math.max(durationMs / 1000, 0);
    const tracks = useMemo(
        () => buildTracks(overview, selectedUniverses, recordingPath, isRecording),
        [overview, selectedUniverses, recordingPath, isRecording]
    );

    const contentWidth = Math.max(viewWidth, (durationSec * pixelsPerSecond) + PAD_PX);
    const playheadX = Math.max(0, (playheadMs / 1000) * pixelsPerSecond);
    const clipWidth = Math.max(durationMs > 0 || isRecording ? 2 : 0, durationSec * pixelsPerSecond);
    const canSeek = Boolean(isFileLoaded && !isRecording && onSeek);

    const applyFit = useCallback(() => {
        const width = scrollRef.current ? scrollRef.current.clientWidth : viewWidth;
        const next = durationSec > 0
            ? Math.min(MAX_PPS, Math.max(MIN_PPS, (width - 8) / durationSec))
            : 40;
        setPixelsPerSecond(next);
        if (scrollRef.current) {
            scrollRef.current.scrollLeft = 0;
        }
    }, [durationSec, viewWidth]);

    useEffect(() => {
        const node = scrollRef.current;
        if (!node) {
            return undefined;
        }
        const update = () => setViewWidth(node.clientWidth || 640);
        update();
        const observer = new ResizeObserver(update);
        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (overview && overview.tracks && overview.tracks.length && !didFitRef.current) {
            didFitRef.current = true;
            applyFit();
        }
        if (!overview) {
            didFitRef.current = false;
        }
    }, [overview, applyFit]);

    const zoomBy = useCallback((factor, originX) => {
        const node = scrollRef.current;
        const cursor = originX == null
            ? (node ? node.clientWidth / 2 : 0)
            : originX;
        const currentScroll = node ? node.scrollLeft : 0;
        const time = (currentScroll + cursor) / pixelsPerSecond;
        const next = Math.min(MAX_PPS, Math.max(MIN_PPS, pixelsPerSecond * factor));
        setPixelsPerSecond(next);
        if (node) {
            node.scrollLeft = Math.max(0, (time * next) - cursor);
        }
    }, [pixelsPerSecond]);

    const seekFromClientX = (clientX) => {
        if (!canSeek || !scrollRef.current) {
            return;
        }
        const rect = scrollRef.current.getBoundingClientRect();
        const x = clientX - rect.left + scrollRef.current.scrollLeft;
        const timeMs = Math.max(0, Math.min(durationMs, (x / pixelsPerSecond) * 1000));
        onSeek(timeMs);
    };

    const onPointerDown = (event) => {
        if (!canSeek || event.button !== 0) {
            return;
        }
        dragRef.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        seekFromClientX(event.clientX);
    };

    const onPointerMove = (event) => {
        if (!dragRef.current) {
            return;
        }
        seekFromClientX(event.clientX);
    };

    const onPointerUp = (event) => {
        if (!dragRef.current) {
            return;
        }
        dragRef.current = false;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    };

    useEffect(() => {
        const node = scrollRef.current;
        if (!node) {
            return undefined;
        }
        const onWheel = (event) => {
            if (event.ctrlKey || event.metaKey) {
                event.preventDefault();
                const rect = node.getBoundingClientRect();
                const originX = event.clientX - rect.left;
                zoomBy(event.deltaY < 0 ? 1.15 : 1 / 1.15, originX);
                return;
            }
            event.preventDefault();
            node.scrollLeft += event.shiftKey ? event.deltaY : (event.deltaX || event.deltaY);
        };
        node.addEventListener('wheel', onWheel, { passive: false });
        return () => node.removeEventListener('wheel', onWheel);
    }, [pixelsPerSecond, zoomBy]);

    const ticks = useMemo(() => {
        const step = tickStep(pixelsPerSecond);
        const start = Math.max(0, Math.floor(((scrollLeft - 80) / pixelsPerSecond) / step) * step);
        const end = (scrollLeft + viewWidth + 80) / pixelsPerSecond;
        const list = [];
        for (let t = start; t <= end + 1e-6; t += step) {
            list.push(Math.round(t * 1000) / 1000);
        }
        return { list, step };
    }, [pixelsPerSecond, scrollLeft, viewWidth]);

    return React.createElement('div', {
        className: 'flex flex-1 min-h-0 flex-col bg-white dark:bg-zinc-900'
    },
        loadError && React.createElement('p', {
            className: 'px-3 pt-2 text-sm text-red-500'
        }, loadError),
        React.createElement('div', {
            className: 'flex flex-1 min-h-0 overflow-y-auto'
        },
            React.createElement('div', {
                className: 'flex flex-col flex-none',
                style: { width: HEADER_WIDTH }
            },
                React.createElement('div', { className: 'timeline-corner' },
                    React.createElement('button', {
                        type: 'button',
                        className: 'btn-quiet !px-1.5 !py-0.5',
                        onClick: applyFit
                    }, 'Fit'),
                    React.createElement('button', {
                        type: 'button',
                        className: 'btn-quiet !px-1.5 !py-0.5',
                        onClick: () => zoomBy(1 / 1.25)
                    }, '−'),
                    React.createElement('button', {
                        type: 'button',
                        className: 'btn-quiet !px-1.5 !py-0.5',
                        onClick: () => zoomBy(1.25)
                    }, '+')
                ),
                (clips && clips.length > 0) && React.createElement('div', {
                    className: 'timeline-corner justify-between'
                },
                    React.createElement('span', {
                        className: 'text-[10px] uppercase tracking-wide text-zinc-500'
                    }, 'Clips'),
                    React.createElement('div', {
                        className: 'flex items-center gap-1'
                    },
                        onSplit && React.createElement('button', {
                            type: 'button',
                            className: 'btn-quiet !px-1.5 !py-0.5',
                            onClick: () => onSplit(playheadMs)
                        }, 'Split'),
                        onCutRange && React.createElement('button', {
                            type: 'button',
                            className: 'btn-quiet !px-1.5 !py-0.5',
                            disabled: !(range && range.endMs > range.startMs),
                            onClick: () => {
                                if (range && onCutRange) {
                                    onCutRange(range.startMs, range.endMs);
                                    setRange(null);
                                }
                            }
                        }, 'Cut')
                    )
                ),
                tracks.map((track) => React.createElement('button', {
                    key: track.key,
                    type: 'button',
                    className: `timeline-header ${selectedKey === track.key ? 'is-active' : ''}`,
                    onClick: () => setSelectedKey(track.key)
                },
                    React.createElement('div', {
                        className: 'flex items-center gap-1.5 min-w-0'
                    },
                        React.createElement('span', {
                            className: `h-1.5 w-1.5 rounded-full flex-none ${
                                track.armed ? 'bg-red-500' : 'bg-zinc-400 dark:bg-zinc-600'
                            }`
                        }),
                        React.createElement('span', {
                            className: 'text-xs font-medium truncate'
                        }, trackLabel(track.protocol, track.universe))
                    ),
                    React.createElement('span', {
                        className: 'text-[10px] text-zinc-500'
                    }, track.wokenChannels > 0 ? `${track.wokenChannels} ch` : (track.ghost ? 'Armed' : '—'))
                )),
                tracks.length === 0 && React.createElement('div', {
                    className: 'timeline-header text-xs text-zinc-500'
                }, 'No layers')
            ),
            React.createElement('div', {
                ref: scrollRef,
                className: 'relative flex-1 min-w-0 overflow-x-auto overflow-y-hidden',
                onScroll: (event) => setScrollLeft(event.currentTarget.scrollLeft)
            },
                React.createElement('div', {
                    className: canSeek ? 'relative cursor-ew-resize' : 'relative',
                    style: { width: `${contentWidth}px`, minHeight: '100%' },
                    onPointerDown,
                    onPointerMove,
                    onPointerUp,
                    onPointerCancel: onPointerUp
                },
                    React.createElement('div', { className: 'timeline-ruler' },
                        ticks.list.map((time) => React.createElement('span', {
                            key: Math.round(time * 1000),
                            className: 'absolute top-0 text-[10px] text-zinc-500 tabular-nums',
                            style: { left: `${time * pixelsPerSecond}px` }
                        }, formatTick(time, ticks.step)))
                    ),
                    (clips && clips.length > 0) && React.createElement(TimelineClips, {
                        clips,
                        pixelsPerSecond,
                        durationMs,
                        selectedId: selectedClipId,
                        range,
                        onSelect: setSelectedClipId,
                        onReorder: onReorderClip,
                        onTrim: onTrimClip,
                        onRangeChange: setRange
                    }),
                    isLoopEnabled && clipWidth > 0 && React.createElement('div', {
                        className: 'timeline-loop',
                        style: { left: 0, width: `${clipWidth}px` }
                    }),
                    tracks.map((track) => React.createElement(TimelineLane, {
                        key: track.key,
                        protocol: track.protocol,
                        bands: track.bands,
                        bucketCount: track.bucketCount,
                        bandsPerBucket: track.bandsPerBucket,
                        durationMs,
                        pixelsPerSecond,
                        recording: isRecording,
                        ghost: track.ghost
                    })),
                    tracks.length === 0 && React.createElement('div', {
                        className: 'timeline-track'
                    }),
                    (isFileLoaded || isRecording) && React.createElement('div', {
                        className: 'timeline-playhead',
                        style: { left: `${playheadX}px` }
                    }),
                    isIdle && React.createElement('p', {
                        className: 'absolute inset-x-6 top-12 text-sm text-zinc-500 pointer-events-none'
                    }, 'Select universes, create a file in Studio or load a look from Library, then record or play.')
                )
            )
        )
    );
};

module.exports = ShowTimeline;
