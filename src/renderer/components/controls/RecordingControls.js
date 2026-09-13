const React = require('react');
const { useState, useEffect, useRef } = React;
const { ipcRenderer } = require('electron');

// Simple debounce utility
const debounce = (func, wait) => {
    let timeout;
    return (...args) => {
        if (timeout) {
            clearTimeout(timeout);
        }
        timeout = setTimeout(() => {
            func.apply(null, args);
            timeout = null;
        }, wait);
    };
};

const RecordingControls = ({ selectedUniverses, isPlaying, selectedNic }) => {
    const [isRecording, setIsRecording] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const loadClickTime = useRef(0);  // Track last click time
    const [recordingDuration, setRecordingDuration] = useState(0);
    const [frameCount, setFrameCount] = useState(0);
    const [recordingFps, setRecordingFps] = useState(0);
    const [droppedFrames, setDroppedFrames] = useState(0);
    const [testSacnActive, setTestSacnActive] = useState(false);
    const recordingStartTime = useRef(null);
    const durationTimer = useRef(null);

    useEffect(() => {
        const handleFileLoaded = () => {
            setIsLoading(false);
        };

        ipcRenderer.on('file-loaded', handleFileLoaded);
        return () => {
            ipcRenderer.removeListener('file-loaded', handleFileLoaded);
        };
    }, []);

    useEffect(() => {
        const handleFrameRecorded = (event, stats = {}) => {
            console.log('Recording stats update:', stats); // Debug log
            setFrameCount(stats.totalFrames || 0);
            setRecordingFps(stats.currentFps || 0);
            setDroppedFrames(stats.droppedFrames || 0);
        };

        const handleTestSacnStopped = () => {
            setTestSacnActive(false);
        };

        ipcRenderer.on('recording-stats-update', handleFrameRecorded);
        ipcRenderer.on('test-sacn-stopped', handleTestSacnStopped);

        return () => {
            ipcRenderer.removeListener('recording-stats-update', handleFrameRecorded);
            ipcRenderer.removeListener('test-sacn-stopped', handleTestSacnStopped);
        };
    }, []);

    const formatDuration = (ms) => {
        const minutes = Math.floor(ms / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        const milliseconds = Math.floor((ms % 1000) / 10);
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}:${milliseconds.toString().padStart(2, '0')}`;
    };

    const handleStartRecording = () => {
        setIsRecording(true);
        recordingStartTime.current = Date.now();
        setFrameCount(0);
        setDroppedFrames(0);
        
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
            console.log('Load file clicked'); // Debug
            await ipcRenderer.invoke('load-recording');
        } catch (error) {
            console.error('Error loading file:', error);
        } finally {
            setIsLoading(false);
        }
    };

    return React.createElement('div', { 
        className: 'flex flex-col gap-4'
    },
        // Main controls row
        React.createElement('div', { 
            className: 'flex items-center gap-4'
        },
            // Record button
            React.createElement('button', {
                onClick: isRecording ? handleStopRecording : handleStartRecording,
                className: `px-4 py-2 rounded ${isRecording ? 'bg-red-500' : 'bg-green-500'} text-white`,
                disabled: isPlaying || (!isRecording && (!selectedUniverses || selectedUniverses.size === 0))
            }, isRecording ? 'Stop Recording' : 'Start Recording Selected'),

            // Load file button
            React.createElement('button', {
                onClick: handleLoadFile,
                className: `px-4 py-2 rounded bg-blue-500 text-white ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`,
                disabled: isRecording || isLoading,
                style: { pointerEvents: isLoading ? 'none' : 'auto' }  // Additional click prevention
            }, isLoading ? 'Loading...' : 'Load Recording'),

            // Test sACN button
            React.createElement('button', {
                onClick: () => {
                    if (testSacnActive) {
                        ipcRenderer.send('stop-test-sacn');
                    } else {
                        ipcRenderer.send('start-test-sacn', { interfaceIp: selectedNic });
                    }
                    setTestSacnActive(!testSacnActive);
                },
                className: `px-4 py-2 rounded ${testSacnActive ? 'bg-red-500' : 'bg-green-500'} text-white`,
                disabled: isRecording || isPlaying
            }, testSacnActive ? 'Stop Test sACN' : 'Test sACN')
        ),

        // Recording stats row
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