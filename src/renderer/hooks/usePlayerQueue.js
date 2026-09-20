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
    const nextId = useRef(1);

    queueRef.current = queue;
    indexRef.current = currentIndex;
    loopRef.current = loop;
    networkRef.current = playbackNetwork || '0.0.0.0';

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

    const enqueueAndPlay = useCallback(async ({ filePath, name } = {}) => {
        if (!filePath || isRecording) {
            return;
        }
        const item = {
            id: `q${nextId.current}`,
            filePath,
            name: name || filePath.split(/[\\/]/).pop()
        };
        nextId.current += 1;
        const nextQueue = [...queueRef.current, item];
        queueRef.current = nextQueue;
        setQueue(nextQueue);
        setCollapsed(false);
        await playAt(nextQueue.length - 1);
    }, [isRecording, playAt]);

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
        enqueueAndPlay,
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
