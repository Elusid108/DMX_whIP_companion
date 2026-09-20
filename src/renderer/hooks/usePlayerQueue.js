const { useCallback, useEffect, useRef, useState } = require('react');
const ipcRenderer = require('../ipc');

const formatClock = (ms) => {
    const value = Math.max(0, Math.round(Number(ms) || 0));
    const totalSec = Math.floor(value / 1000);
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const usePlayerQueue = ({ playbackNetwork, isRecording } = {}) => {
    const [queue, setQueue] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(-1);
    const [collapsed, setCollapsed] = useState(true);
    const [loop, setLoop] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [playheadMs, setPlayheadMs] = useState(0);
    const [durationMs, setDurationMs] = useState(0);
    const [error, setError] = useState('');

    const queueRef = useRef([]);
    const indexRef = useRef(-1);
    const loopRef = useRef(false);
    const networkRef = useRef(playbackNetwork || '0.0.0.0');
    const playingRef = useRef(false);
    const pausedRef = useRef(false);
    const nextId = useRef(1);

    queueRef.current = queue;
    indexRef.current = currentIndex;
    loopRef.current = loop;
    networkRef.current = playbackNetwork || '0.0.0.0';
    playingRef.current = isPlaying;
    pausedRef.current = isPaused;

    const playAt = useCallback(async (index) => {
        const item = queueRef.current[index];
        if (!item || isRecording) {
            return;
        }
        setCurrentIndex(index);
        indexRef.current = index;
        setError('');
        const result = await ipcRenderer.invoke('player-play', {
            filePath: item.filePath,
            playbackNetwork: networkRef.current,
            loop: loopRef.current
        });
        if (!result || !result.success) {
            setError((result && result.error) || 'Unable to play');
            setIsPlaying(false);
            setIsPaused(false);
            return;
        }
        setDurationMs(Number(result.durationMs) || 0);
        setPlayheadMs(0);
        setIsPlaying(true);
        setIsPaused(false);
    }, [isRecording]);

    useEffect(() => {
        const handleStats = (event, stats = {}) => {
            if (stats.source !== 'player') {
                return;
            }
            setIsPlaying(Boolean(stats.isPlaying));
            setIsPaused(Boolean(stats.isPaused));
            if (stats.isReset) {
                setPlayheadMs(0);
                return;
            }
            if (typeof stats.playheadMs === 'number') {
                setPlayheadMs(stats.playheadMs);
            }
            if (stats.playerEnded && !loopRef.current) {
                const next = indexRef.current + 1;
                if (next < queueRef.current.length) {
                    playAt(next);
                    return;
                }
                ipcRenderer.send('stop-playback', { source: 'player' });
                setPlayheadMs(0);
                setIsPlaying(false);
                setIsPaused(false);
            }
        };
        ipcRenderer.on('playback-stats', handleStats);
        return () => {
            ipcRenderer.removeListener('playback-stats', handleStats);
        };
    }, [playAt]);

    const makeItem = (look) => {
        const filePath = look && look.filePath;
        if (!filePath) {
            return null;
        }
        const item = {
            id: `q${nextId.current}`,
            filePath,
            name: look.name || filePath.split(/[\\/]/).pop()
        };
        nextId.current += 1;
        return item;
    };

    const playExclusive = useCallback(async ({ filePath, name } = {}) => {
        if (!filePath || isRecording) {
            return;
        }
        ipcRenderer.send('stop-playback', { source: 'player' });
        const item = makeItem({ filePath, name });
        const nextQueue = item ? [item] : [];
        queueRef.current = nextQueue;
        setQueue(nextQueue);
        setCollapsed(false);
        if (item) {
            await playAt(0);
        }
    }, [isRecording, playAt]);

    const enqueueLooks = useCallback((looks) => {
        if (isRecording) {
            return;
        }
        const list = Array.isArray(looks) ? looks : [looks];
        const seen = new Set(queueRef.current.map((item) => item.filePath));
        const added = [];
        for (const look of list) {
            if (!look || !look.filePath || seen.has(look.filePath)) {
                continue;
            }
            seen.add(look.filePath);
            const item = makeItem(look);
            if (item) {
                added.push(item);
            }
        }
        if (!added.length) {
            return;
        }
        const nextQueue = [...queueRef.current, ...added];
        queueRef.current = nextQueue;
        setQueue(nextQueue);
        setCollapsed(false);
        if (indexRef.current < 0) {
            setCurrentIndex(-1);
        }
    }, [isRecording]);

    const moveItem = useCallback((index, delta) => {
        const next = index + delta;
        const list = queueRef.current.slice();
        if (index < 0 || next < 0 || next >= list.length) {
            return;
        }
        const [item] = list.splice(index, 1);
        list.splice(next, 0, item);
        queueRef.current = list;
        setQueue(list);
        if (indexRef.current === index) {
            setCurrentIndex(next);
            indexRef.current = next;
        } else if (indexRef.current === next) {
            setCurrentIndex(index);
            indexRef.current = index;
        }
    }, []);

    const removeItem = useCallback((index) => {
        const list = queueRef.current.slice();
        if (index < 0 || index >= list.length) {
            return;
        }
        const removingCurrent = indexRef.current === index;
        list.splice(index, 1);
        queueRef.current = list;
        setQueue(list);
        if (!list.length) {
            ipcRenderer.send('stop-playback', { source: 'player' });
            setCurrentIndex(-1);
            indexRef.current = -1;
            setPlayheadMs(0);
            setDurationMs(0);
            setIsPlaying(false);
            setIsPaused(false);
            return;
        }
        if (removingCurrent) {
            const next = Math.min(index, list.length - 1);
            if (playingRef.current || pausedRef.current) {
                playAt(next);
                return;
            }
            setCurrentIndex(next);
            indexRef.current = next;
            return;
        }
        if (indexRef.current > index) {
            const next = indexRef.current - 1;
            setCurrentIndex(next);
            indexRef.current = next;
        }
    }, [playAt]);

    const clearQueue = useCallback(() => {
        ipcRenderer.send('stop-playback', { source: 'player' });
        queueRef.current = [];
        setQueue([]);
        setCurrentIndex(-1);
        indexRef.current = -1;
        setPlayheadMs(0);
        setDurationMs(0);
        setIsPlaying(false);
        setIsPaused(false);
    }, []);

    const handlePlay = useCallback(() => {
        if (isRecording || currentIndex < 0) {
            return;
        }
        ipcRenderer.send('toggle-playback', {
            source: 'player',
            loop,
            playbackNetwork: networkRef.current
        });
    }, [currentIndex, isRecording, loop]);

    const handlePause = useCallback(() => {
        if (!isPlaying) {
            return;
        }
        ipcRenderer.send('toggle-playback', {
            source: 'player',
            loop,
            playbackNetwork: networkRef.current
        });
    }, [isPlaying, loop]);

    const handleStop = useCallback(() => {
        ipcRenderer.send('stop-playback', { source: 'player' });
        setPlayheadMs(0);
        setIsPlaying(false);
        setIsPaused(false);
    }, []);

    const handleBack = useCallback(() => {
        if (currentIndex < 0) {
            return;
        }
        if (currentIndex > 0) {
            playAt(currentIndex - 1);
            return;
        }
        playAt(0);
    }, [currentIndex, playAt]);

    const handleNext = useCallback(() => {
        if (currentIndex < 0 || currentIndex >= queue.length - 1) {
            return;
        }
        playAt(currentIndex + 1);
    }, [currentIndex, playAt, queue.length]);

    const handleSeek = useCallback((timeMs) => {
        if (currentIndex < 0 || isRecording) {
            return;
        }
        const next = Math.max(0, Number(timeMs) || 0);
        setPlayheadMs(next);
        ipcRenderer.send('seek-playback', {
            source: 'player',
            timeMs: next,
            playbackNetwork: networkRef.current,
            loop
        });
    }, [currentIndex, isRecording, loop]);

    const handleToggleLoop = useCallback(() => {
        setLoop((current) => {
            const next = !current;
            loopRef.current = next;
            ipcRenderer.send('set-playback-loop', { loop: next });
            return next;
        });
    }, []);

    const handleSelect = useCallback((index) => {
        if (index === currentIndex && (isPlaying || isPaused)) {
            return;
        }
        playAt(index);
    }, [currentIndex, isPaused, isPlaying, playAt]);

    const current = currentIndex >= 0 ? queue[currentIndex] : null;

    return {
        queue,
        currentIndex,
        current,
        collapsed,
        setCollapsed,
        loop,
        isPlaying,
        isPaused,
        isFileLoaded: queue.length > 0,
        playheadMs,
        durationMs,
        error,
        formatClock,
        playExclusive,
        enqueueLooks,
        moveItem,
        removeItem,
        clearQueue,
        handlePlay,
        handlePause,
        handleStop,
        handleBack,
        handleNext,
        handleSeek,
        handleToggleLoop,
        handleSelect
    };
};

module.exports = usePlayerQueue;
