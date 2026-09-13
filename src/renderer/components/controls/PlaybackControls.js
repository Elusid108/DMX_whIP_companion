const React = require('react');
const { ipcRenderer } = require('electron');
const { useState, useEffect } = React;

const PlaybackControls = ({
    networkInterfaces,
    selectedNic
}) => {
    const [isFileLoaded, setIsFileLoaded] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [loadedFileName, setLoadedFileName] = useState('');
    const [playbackStats, setPlaybackStats] = useState({
        currentFrame: null,
        totalFrames: 0,
        clipTime: 0,
        totalPlayTime: 0,
        fps: 0
    });
    const [isLoopEnabled, setIsLoopEnabled] = useState(false);
    const [playbackNetwork, setPlaybackNetwork] = useState(selectedNic || '0.0.0.0');

    useEffect(() => {
        const handleFileLoaded = (event, { success, filePath, error }) => {
            if (success) {
                setIsFileLoaded(true);
                setLoadedFileName(filePath.split(/[\\/]/).pop());
            } else if (error && error !== 'No file selected') {
                setIsFileLoaded(false);
                setLoadedFileName('');
            }
        };

        const handlePlaybackStats = (event, stats) => {
            setPlaybackStats(stats);
            setIsPlaying(Boolean(stats.isPlaying));
            setIsPaused(Boolean(stats.isPaused));

            if (stats.isReset) {
                setIsPlaying(false);
                setIsPaused(false);
            }
        };

        ipcRenderer.on('file-loaded', handleFileLoaded);
        ipcRenderer.on('playback-stats', handlePlaybackStats);

        return () => {
            ipcRenderer.removeListener('file-loaded', handleFileLoaded);
            ipcRenderer.removeListener('playback-stats', handlePlaybackStats);
        };
    }, []);

    const handlePlayback = () => {
        if (isFileLoaded) {
            ipcRenderer.send('toggle-playback', {
                loop: isLoopEnabled,
                playbackNetwork
            });
        }
    };

    const formatDuration = (ms) => {
        if (!ms && ms !== 0) return '00:00:00';
        const minutes = Math.floor(ms / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        const milliseconds = Math.floor((ms % 1000) / 10);
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}:${milliseconds.toString().padStart(2, '0')}`;
    };

    if (!isFileLoaded) {
        return null;
    }

    return React.createElement('div', { 
        className: 'flex flex-col gap-2'
    },
        // Controls Row
        React.createElement('div', { 
            className: 'flex items-center gap-4'
        },
            // Play/Pause button
            React.createElement('button', {
                onClick: handlePlayback,
                className: `px-4 py-2 rounded ${isPlaying ? 'bg-yellow-500' : 'bg-blue-500'} text-white`
            }, isPlaying ? 'Pause' : 'Play'),

            // Stop button
            React.createElement('button', {
                onClick: () => {
                    ipcRenderer.send('stop-playback');
                },
                className: 'px-4 py-2 rounded bg-red-500 text-white'
            }, 'Stop'),

            // Loop checkbox
            React.createElement('label', { 
                className: 'flex items-center gap-2'
            },
                React.createElement('input', {
                    type: 'checkbox',
                    checked: isLoopEnabled,
                    onChange: (e) => setIsLoopEnabled(e.target.checked),
                    className: 'form-checkbox'
                }),
                'Loop Playback'
            ),

            // Network selector
            React.createElement('div', { 
                className: 'flex flex-col min-w-fit'
            },
                React.createElement('label', {
                    className: 'text-sm text-gray-600'
                }, 'Playback Network'),
                React.createElement('select', {
                    value: playbackNetwork,
                    onChange: (e) => setPlaybackNetwork(e.target.value),
                    className: 'border rounded p-1'
                },
                    networkInterfaces.map(nic =>
                        React.createElement('option', {
                            key: nic.ip,
                            value: nic.ip
                        }, `${nic.name} (${nic.ip})`)
                    )
                )
            ),

            // Loaded filename
            loadedFileName && React.createElement('span', {
                className: 'text-sm text-gray-600 ml-2'
            }, `Loaded: ${loadedFileName}`)
        ),

        // Stats Row
        (isPlaying || isPaused) && playbackStats.currentFrame !== null && 
        React.createElement('div', { 
            className: 'flex gap-4 ml-4'
        },
            React.createElement('span', {
                className: 'text-sm'
            }, `Clip: ${formatDuration(playbackStats.clipTime)}`),
            React.createElement('span', {
                className: 'text-sm'
            }, `Total: ${formatDuration(playbackStats.totalPlayTime)}`),
            React.createElement('span', {
                className: 'text-sm'
            }, `Frame: ${playbackStats.currentFrame}/${playbackStats.totalFrames}`),
            React.createElement('span', {
                className: 'text-sm'
            }, `FPS: ${playbackStats.fps}`)
        )
    );
};

module.exports = PlaybackControls;