const React = require('react');
const { useEffect, useRef, useState } = React;
const ipcRenderer = require('../../ipc');

const Field = ({ label, children }) => React.createElement('div', {
    className: 'flex flex-col gap-1'
},
    React.createElement('label', {
        className: 'label-micro'
    }, label),
    children
);

const pinValue = (value) => {
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 && n <= 48 ? n : 0;
};

const FlashPanel = () => {
    const [ports, setPorts] = useState([]);
    const [port, setPort] = useState('');
    const [boards, setBoards] = useState([]);
    const [boardId, setBoardId] = useState('waveshare-s3-matrix');
    const [ledPin, setLedPin] = useState(14);
    const [sdPins, setSdPins] = useState({ cs: 7, mosi: 6, clk: 5, miso: 4 });
    const [eraseNvs, setEraseNvs] = useState(false);
    const [artifactNote, setArtifactNote] = useState('');
    const [artifactError, setArtifactError] = useState('');
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState({ percent: 0, label: '' });
    const [info, setInfo] = useState(null);
    const [error, setError] = useState('');
    const [log, setLog] = useState([]);
    const logRef = useRef(null);

    const persist = (patch) => {
        ipcRenderer.invoke('flash-set-settings', patch).catch(() => {});
    };

    const refreshPorts = async () => {
        const result = await ipcRenderer.invoke('flash-ports');
        if (result && result.success) {
            setPorts(result.ports || []);
            return result.ports || [];
        }
        setError((result && result.error) || 'Unable to list USB ports');
        return [];
    };

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            const catalogResult = await ipcRenderer.invoke('flash-catalog');
            const nextPorts = await refreshPorts();
            if (cancelled) {
                return;
            }
            if (!catalogResult || !catalogResult.success) {
                setError((catalogResult && catalogResult.error) || 'Unable to load board catalog');
                return;
            }
            const nextBoards = catalogResult.catalog.boards || [];
            setBoards(nextBoards);
            const settings = catalogResult.settings || {};
            const nextBoardId = settings.flashBoardId || (nextBoards[0] && nextBoards[0].id);
            setBoardId(nextBoardId);
            const nextBoard = nextBoards.find((item) => item.id === nextBoardId) || nextBoards[0];
            if (nextBoard && nextBoard.defaults) {
                setLedPin(nextBoard.defaults.led.data);
                setSdPins(settings.flashSdPins || nextBoard.defaults.sd);
            }
            const savedPort = settings.flashPort;
            if (savedPort && nextPorts.some((item) => item.path === savedPort)) {
                setPort(savedPort);
            } else if (nextPorts[0]) {
                setPort(nextPorts[0].path);
            }
            if (catalogResult.artifacts && catalogResult.artifacts.error) {
                setArtifactError(catalogResult.artifacts.error);
                setArtifactNote('');
            } else if (catalogResult.artifacts && catalogResult.artifacts.source) {
                setArtifactNote(catalogResult.artifacts.source);
                setArtifactError('');
            }
        };
        load().catch((err) => {
            if (!cancelled) {
                setError(err.message);
            }
        });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        const onProgress = (_event, payload) => {
            if (payload) {
                setProgress(payload);
            }
        };
        const onLog = (_event, payload) => {
            if (!payload || !payload.line) {
                return;
            }
            setLog((prev) => [...prev.slice(-200), payload.line]);
        };
        ipcRenderer.on('flash-progress', onProgress);
        ipcRenderer.on('flash-log', onLog);
        return () => {
            ipcRenderer.removeListener('flash-progress', onProgress);
            ipcRenderer.removeListener('flash-log', onLog);
        };
    }, []);

    useEffect(() => {
        if (logRef.current) {
            logRef.current.scrollTop = logRef.current.scrollHeight;
        }
    }, [log]);

    const handleBoardChange = (nextId) => {
        setBoardId(nextId);
        const next = boards.find((item) => item.id === nextId);
        if (next && next.defaults) {
            setLedPin(next.defaults.led.data);
            setSdPins(next.defaults.sd);
            persist({ flashBoardId: nextId, flashSdPins: next.defaults.sd });
        }
    };

    const handlePortChange = (next) => {
        setPort(next);
        persist({ flashPort: next });
    };

    const handlePin = (key, raw) => {
        const next = { ...sdPins, [key]: pinValue(raw) };
        setSdPins(next);
        persist({ flashSdPins: next });
    };

    const run = async (work) => {
        if (busy) {
            return;
        }
        setBusy(true);
        setError('');
        try {
            await work();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    const handleIdentify = () => run(async () => {
        setInfo(null);
        setLog([]);
        setProgress({ percent: 0, label: 'Identifying' });
        const result = await ipcRenderer.invoke('flash-identify', { port });
        if (!result || !result.success) {
            setError((result && result.error) || 'Identify failed');
            setProgress({ percent: 0, label: '' });
            return;
        }
        setInfo(result);
        setProgress({ percent: 0, label: 'Identified' });
    });

    const handleFlash = () => run(async () => {
        setLog([]);
        setProgress({ percent: 0, label: 'Starting' });
        const result = await ipcRenderer.invoke('flash-run', {
            port,
            boardId,
            pins: sdPins,
            eraseNvs
        });
        if (!result || !result.success) {
            setError((result && result.error) || 'Flash failed');
            return;
        }
        setInfo((prev) => ({ ...(prev || {}), chip: result.chip }));
        if (result.pinsError) {
            setError(result.pinsError);
        }
        setProgress({ percent: 100, label: result.pinsError ? 'Flashed — pins not applied' : 'Done' });
    });

    const pinField = (key, label) => React.createElement(Field, { label },
        React.createElement('input', {
            type: 'number',
            min: 0,
            max: 48,
            className: 'field',
            value: sdPins[key],
            disabled: busy,
            onChange: (event) => handlePin(key, event.target.value)
        })
    );

    return React.createElement('div', {
        className: 'flex-1 min-h-0 overflow-y-auto bg-zinc-50 dark:bg-zinc-950'
    },
        React.createElement('div', {
            className: 'h-full flex flex-col max-w-xl mx-auto w-full min-h-0 p-3 gap-3'
        },
            React.createElement('div', {
                className: 'status-strip'
            },
                React.createElement('div', {
                    className: 'text-sm font-medium'
                }, 'USB flash'),
                React.createElement('p', {
                    className: 'text-xs text-zinc-500'
                }, 'Identify the ESP32-S3, then write the prebuilt Matrix image. Close any serial monitor first. If connect fails, hold BOOT, tap RESET, release BOOT.')
            ),
            React.createElement('div', {
                className: 'grid grid-cols-2 gap-2'
            },
                React.createElement(Field, { label: 'Port' },
                    React.createElement('div', {
                        className: 'flex gap-1'
                    },
                        React.createElement('select', {
                            className: 'field',
                            value: port,
                            disabled: busy,
                            onChange: (event) => handlePortChange(event.target.value)
                        },
                            !ports.length && React.createElement('option', { value: '' }, 'No serial ports'),
                            ports.map((item) => React.createElement('option', {
                                key: item.path,
                                value: item.path
                            }, item.friendlyName || item.path))
                        ),
                        React.createElement('button', {
                            type: 'button',
                            className: 'btn-quiet flex-none',
                            disabled: busy,
                            onClick: () => refreshPorts()
                        }, 'Refresh')
                    )
                ),
                React.createElement(Field, { label: 'Board' },
                    React.createElement('select', {
                        className: 'field',
                        value: boardId,
                        disabled: busy || boards.length < 2,
                        onChange: (event) => handleBoardChange(event.target.value)
                    },
                        boards.map((item) => React.createElement('option', {
                            key: item.id,
                            value: item.id
                        }, item.name))
                    )
                )
            ),
            React.createElement('div', {
                className: 'grid grid-cols-2 gap-2'
            },
                React.createElement(Field, { label: 'LED data (read-only)' },
                    React.createElement('input', {
                        className: 'field',
                        value: ledPin,
                        disabled: true,
                        readOnly: true
                    })
                ),
                React.createElement(Field, { label: 'Erase NVS' },
                    React.createElement('label', {
                        className: 'flex items-center gap-2 text-sm pt-1.5'
                    },
                        React.createElement('input', {
                            type: 'checkbox',
                            checked: eraseNvs,
                            disabled: busy,
                            onChange: (event) => setEraseNvs(event.target.checked)
                        }),
                        'Clear Wi-Fi, name, and pins'
                    )
                )
            ),
            React.createElement('div', {
                className: 'grid grid-cols-4 gap-2'
            },
                pinField('cs', 'SD CS'),
                pinField('mosi', 'SD MOSI'),
                pinField('clk', 'SD CLK'),
                pinField('miso', 'SD MISO')
            ),
            artifactNote && React.createElement('p', {
                className: 'readout'
            }, `Image: ${artifactNote}`),
            artifactError && React.createElement('p', {
                className: 'text-sm text-red-500'
            }, artifactError),
            info && React.createElement('p', {
                className: 'readout'
            }, [info.chip, info.mac, info.flashSize].filter(Boolean).join(' · ')),
            error && React.createElement('p', {
                className: 'text-sm text-red-500'
            }, error),
            React.createElement('div', {
                className: 'flex gap-2'
            },
                React.createElement('button', {
                    type: 'button',
                    className: 'btn-quiet',
                    disabled: busy || !port,
                    onClick: handleIdentify
                }, busy && progress.label === 'Identifying' ? 'Identifying…' : 'Identify'),
                React.createElement('button', {
                    type: 'button',
                    className: 'btn-primary',
                    disabled: busy || !port || Boolean(artifactError),
                    onClick: handleFlash
                }, busy ? (progress.label || 'Flashing…') : 'Flash')
            ),
            progress.label && React.createElement('div', {
                className: 'flex flex-col gap-1'
            },
                React.createElement('div', {
                    className: 'h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden'
                },
                    React.createElement('div', {
                        className: 'h-full bg-cyan-600 dark:bg-cyan-400',
                        style: { width: `${Math.max(0, Math.min(100, progress.percent || 0))}%` }
                    })
                ),
                React.createElement('p', {
                    className: 'readout'
                }, `${progress.label}${progress.percent ? ` ${progress.percent}%` : ''}`)
            ),
            React.createElement('pre', {
                ref: logRef,
                className: 'flex-1 min-h-[8rem] overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-2 readout whitespace-pre-wrap'
            }, log.join('\n') || 'Log output appears here.')
        )
    );
};

module.exports = FlashPanel;
