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
            const result = await ipcRenderer.invoke('new-recording-file');
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
        className: 'flex flex-col gap-4'
    },
        React.createElement('div', {
            className: 'flex items-center gap-4 flex-wrap'
        },
            React.createElement('button', {
                onClick: handleNewFile,
                className: 'px-4 py-2 rounded bg-gray-700 text-white',
                disabled: isRecording || isPlaying
            }, 'New File'),

            recordingPath && React.createElement('button', {
                onClick: isRecording ? handleStopRecording : handleStartRecording,
                className: `px-4 py-2 rounded ${isRecording ? 'bg-red-500' : 'bg-green-500'} text-white`,
                disabled: isPlaying || (!isRecording && (!selectedUniverses || selectedUniverses.size === 0))
            }, isRecording ? 'Stop Recording' : 'Start Recording Selected'),

            React.createElement('button', {
                onClick: handleLoadFile,
                className: `px-4 py-2 rounded bg-blue-500 text-white ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`,
                disabled: isRecording || isLoading,
                style: { pointerEvents: isLoading ? 'none' : 'auto' }
            }, isLoading ? 'Loading...' : 'Load Recording'),

            recordingFileName && React.createElement('span', {
                className: 'text-sm text-gray-600'
            }, `File: ${recordingFileName}`)
        ),

        loadError && React.createElement('div', {
            className: 'text-sm text-red-600'
        }, loadError),

        isRecording && React.createElement('div', {
            className: 'flex gap-4'
        },
            React.createElement('span', {
                className: 'text-sm'
            }, `Duration: ${formatDuration(recordingDuration)}`),
            React.createElement('span', {
                className: 'text-sm'
            }, `FPS: ${recordingFps}`),
            React.createElement('span', {
                className: 'text-sm'
            }, `Frames: ${frameCount}`),
            React.createElement('span', {
                className: 'text-sm text-red-500'
            }, `Dropped: ${droppedFrames}`)
        )
    );
};

module.exports = RecordingControls;
