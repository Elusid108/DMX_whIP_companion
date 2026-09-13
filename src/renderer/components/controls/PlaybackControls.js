const React = require('react');
const ipcRenderer = require('../../ipc');
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
        className: 'flex flex-col gap-1 min-w-0'
    },
        React.createElement('div', {
            className: 'flex items-center gap-1.5 flex-wrap'
        },
            React.createElement('button', {
                onClick: handlePlayback,
                className: 'btn-primary'
            }, isPlaying ? 'Pause' : 'Play'),

            React.createElement('button', {
                onClick: () => {
                    ipcRenderer.send('stop-playback');
                },
                className: 'btn-danger'
            }, 'Stop'),

            React.createElement('label', {
                className: 'flex items-center gap-1.5 text-xs text-zinc-500'
            },
                React.createElement('input', {
                    type: 'checkbox',
                    checked: isLoopEnabled,
                    onChange: (e) => setIsLoopEnabled(e.target.checked),
                    className: 'h-3.5 w-3.5 accent-cyan-400'
                }),
                'Loop'
            ),

            React.createElement('select', {
                value: playbackNetwork,
                onChange: (e) => setPlaybackNetwork(e.target.value),
                className: 'field w-auto min-w-[8rem] py-1',
                title: 'Playback Network'
            },
                networkInterfaces.map(nic =>
                    React.createElement('option', {
                        key: nic.ip,
                        value: nic.ip
                    }, `${nic.name} (${nic.ip})`)
                )
            ),

            loadedFileName && React.createElement('span', {
                className: 'text-xs text-zinc-500 truncate max-w-[10rem]'
            }, loadedFileName)
        ),

        (isPlaying || isPaused) && playbackStats.currentFrame !== null &&
        React.createElement('div', {
            className: 'flex gap-3 text-xs text-zinc-500'
        },
            React.createElement('span', null, `Clip ${formatDuration(playbackStats.clipTime)}`),
            React.createElement('span', null, `Total ${formatDuration(playbackStats.totalPlayTime)}`),
            React.createElement('span', null, `${playbackStats.currentFrame}/${playbackStats.totalFrames}`),
            React.createElement('span', null, `${playbackStats.fps} fps`)
        )
    );
};

module.exports = PlaybackControls;
