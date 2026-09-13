const React = require('react');
const { useState, useEffect, useRef } = React;
const ipcRenderer = require('../../ipc');

const RecordingControls = ({ selectedUniverses }) => {
    const [isRecording, setIsRecording] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [recordingPath, setRecordingPath] = useState(null);
    const [loadError, setLoadError] = useState('');
    const [recordingDuration, setRecordingDuration] = useState(0);
    const [frameCount, setFrameCount] = useState(0);
    const [recordingFps, setRecordingFps] = useState(0);
    const [droppedFrames, setDroppedFrames] = useState(0);
    const recordingStartTime = useRef(null);
    const durationTimer = useRef(null);

    useEffect(() => {
        const handleFileLoaded = (event, result = {}) => {
            setIsLoading(false);
            if (result.success) {
                setLoadError('');
            } else if (result.error && result.error !== 'No file selected') {
                setLoadError(result.error);
            }
        };

        const handlePlaybackStats = (event, stats = {}) => {
            setIsPlaying(Boolean(stats.isPlaying));
            if (stats.isReset) {
                setIsPlaying(false);
            }
        };

        ipcRenderer.on('file-loaded', handleFileLoaded);
        ipcRenderer.on('playback-stats', handlePlaybackStats);
        return () => {
            ipcRenderer.removeListener('file-loaded', handleFileLoaded);
            ipcRenderer.removeListener('playback-stats', handlePlaybackStats);
        };
    }, []);

    useEffect(() => {
        const handleFrameRecorded = (event, stats = {}) => {
            setFrameCount(stats.totalFrames || 0);
            setRecordingFps(stats.currentFps || 0);
            setDroppedFrames(stats.droppedFrames || 0);
        };

        const handleRecordingError = (event, result = {}) => {
            setIsRecording(false);
            clearInterval(durationTimer.current);
            setLoadError(result.error || 'Recording failed');
        };

        ipcRenderer.on('recording-stats-update', handleFrameRecorded);
        ipcRenderer.on('recording-error', handleRecordingError);

        return () => {
            ipcRenderer.removeListener('recording-stats-update', handleFrameRecorded);
            ipcRenderer.removeListener('recording-error', handleRecordingError);
        };
    }, []);

    const formatDuration = (ms) => {
        const minutes = Math.floor(ms / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        const milliseconds = Math.floor((ms % 1000) / 10);
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}:${milliseconds.toString().padStart(2, '0')}`;
    };

    const recordingFileName = recordingPath
        ? recordingPath.split(/[\\/]/).pop()
        : '';

    const handleNewFile = async () => {
        if (isRecording) {
            return;
        }
        try {
            const name = window.prompt('New recording name (without .dmx)');
            if (name == null) {
                return;
            }
            const result = await ipcRenderer.invoke('library-new-file', { name });
            if (result && result.success) {
                setRecordingPath(result.filePath);
                setLoadError('');
            } else if (result && result.error && result.error !== 'No file selected') {
                setLoadError(result.error);
            }
        } catch (error) {
            setLoadError(error.message);
        }
    };

    const handleStartRecording = () => {
        if (!recordingPath) {
            return;
        }
        setIsRecording(true);
        recordingStartTime.current = Date.now();
        setRecordingDuration(0);
        setFrameCount(0);
        setDroppedFrames(0);
        setLoadError('');

        durationTimer.current = setInterval(() => {
            setRecordingDuration(Date.now() - recordingStartTime.current);
        }, 10);

        ipcRenderer.send('start-recording');
    };

    const handleStopRecording = () => {
        setIsRecording(false);
        clearInterval(durationTimer.current);
        ipcRenderer.send('stop-recording');
    };

    const handleLoadFile = async () => {
        if (isLoading) return;

        try {
            setIsLoading(true);
            setLoadError('');
            const result = await ipcRenderer.invoke('load-recording');
            if (result && !result.success && result.error && result.error !== 'No file selected') {
                setLoadError(result.error);
            }
        } catch (error) {
            setLoadError(error.message);
        } finally {
            setIsLoading(false);
        }
    };

    return React.createElement('div', {
        className: 'flex flex-col gap-1 min-w-0'
    },
        React.createElement('div', {
            className: 'flex items-center gap-1.5 flex-wrap'
        },
            React.createElement('button', {
                onClick: handleNewFile,
                className: 'btn-quiet',
                disabled: isRecording || isPlaying
            }, 'New File'),

            recordingPath && React.createElement('button', {
                onClick: isRecording ? handleStopRecording : handleStartRecording,
                className: isRecording ? 'btn-danger' : 'btn-primary',
                disabled: isPlaying || (!isRecording && (!selectedUniverses || selectedUniverses.size === 0))
            }, isRecording ? 'Stop Recording' : 'Record'),

            React.createElement('button', {
                onClick: handleLoadFile,
                className: 'btn-quiet',
                disabled: isRecording || isLoading
            }, isLoading ? 'Loading...' : 'Load'),

            recordingFileName && React.createElement('span', {
                className: 'text-xs text-zinc-500 truncate max-w-[12rem]'
            }, recordingFileName)
        ),

        loadError && React.createElement('div', {
            className: 'text-xs text-red-500'
        }, loadError),

        isRecording && React.createElement('div', {
            className: 'flex gap-3 text-xs text-zinc-500'
        },
            React.createElement('span', null, formatDuration(recordingDuration)),
            React.createElement('span', null, `${recordingFps} fps`),
            React.createElement('span', null, `${frameCount} frames`),
            React.createElement('span', {
                className: 'text-red-500'
            }, `Dropped ${droppedFrames}`)
        )
    );
};

module.exports = RecordingControls;
