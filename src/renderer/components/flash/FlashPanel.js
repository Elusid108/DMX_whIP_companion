const React = require('react');
const { createPortal } = require('react-dom');
const { useEffect, useMemo, useRef, useState } = React;
const ipcRenderer = require('../../ipc');
const { resolveNodeName, normalizeNameOpts, normMac } = require('../../../services/shared/flashName');
const {
    CHIPS,
    RGB_ORDERS,
    BRIGHTNESS_WARN,
    DEFAULT_PIXELS,
    addressAt,
    chipByName,
    formatAddr,
    normalizePixels,
    pixelsSummary,
    validatePixels
} = require('../../../services/shared/pixelMap');

const FLASH_CONCURRENCY = 4;
const ARTPOLL_WAIT_MS = 30000;

const Field = ({ label, children }) => React.createElement('div', {
    className: 'flex flex-col gap-1'
},
    React.createElement('label', {
        className: 'label-micro'
    }, label),
    children
);

const EyeIcon = ({ off }) => React.createElement('svg', {
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className: 'w-3.5 h-3.5',
    'aria-hidden': true
},
    React.createElement('path', {
        d: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z'
    }),
    React.createElement('circle', { cx: 12, cy: 12, r: 3 }),
    off && React.createElement('path', { d: 'M3 3l18 18' })
);

const pinValue = (value) => {
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 && n <= 48 ? n : 0;
};

const emptyRow = (port, selected) => ({
    path: port.path,
    friendlyName: port.friendlyName || port.path,
    manufacturer: port.manufacturer || '',
    selected: Boolean(selected),
    chip: '',
    mac: '',
    name: '',
    percent: 0,
    label: '',
    lastLog: '',
    error: '',
    downloadMode: false,
    provisioned: false,
    deviceId: '',
    waiting: false
});

const runPool = async (items, worker) => {
    let index = 0;
    const run = async () => {
        while (index < items.length) {
            const current = index;
            index += 1;
            await worker(items[current], current);
        }
    };
    const n = Math.min(FLASH_CONCURRENCY, items.length);
    await Promise.all(Array.from({ length: n }, run));
};

const findByMac = (devices, mac) => {
    const want = normMac(mac);
    if (!want) {
        return null;
    }
    return (devices || []).find((device) => normMac(device.mac || device.id) === want) || null;
};

const waitForArtPoll = (mac, timeoutMs) => new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
        if (done) {
            return;
        }
        done = true;
        clearTimeout(timer);
        ipcRenderer.removeListener('devices-update', onUpdate);
        resolve(value);
    };
    const onUpdate = (_event, payload = {}) => {
        const found = findByMac(payload.devices, mac);
        if (found) {
            finish(found);
        }
    };
    ipcRenderer.on('devices-update', onUpdate);
    ipcRenderer.invoke('device-list').then((snap) => {
        const found = findByMac(snap && snap.devices, mac);
        if (found) {
            finish(found);
        }
    }).catch(() => {});
    ipcRenderer.send('devices-scan');
    const timer = setTimeout(() => finish(null), timeoutMs);
});

const FlashPanel = ({ onOpenDevice, railHost } = {}) => {
    const [rows, setRows] = useState([]);
    const [boards, setBoards] = useState([]);
    const [boardId, setBoardId] = useState('waveshare-s3-matrix');
    const [sdPins, setSdPins] = useState({ cs: 7, mosi: 6, clk: 5, miso: 4 });
    const [pixels, setPixels] = useState(DEFAULT_PIXELS);
    const [namePattern, setNamePattern] = useState('Whip');
    const [nameMode, setNameMode] = useState('mac');
    const [nameStart, setNameStart] = useState(1);
    const [nameDigits, setNameDigits] = useState(1);
    const [ssid, setSsid] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [clearWifi, setClearWifi] = useState(false);
    const [wlan, setWlan] = useState({ current: null, networks: [] });
    const [artifactNote, setArtifactNote] = useState('');
    const [artifactError, setArtifactError] = useState('');
    const [batchBusy, setBatchBusy] = useState(false);
    const [buildBusy, setBuildBusy] = useState(false);
    const [buildStatus, setBuildStatus] = useState('');
    const [buildOk, setBuildOk] = useState(false);
    const [error, setError] = useState('');
    const [log, setLog] = useState([]);
    const logRef = useRef(null);
    const busy = batchBusy || buildBusy;

    const persist = (patch) => {
        ipcRenderer.invoke('flash-set-settings', patch).catch(() => {});
    };

    const patchRow = (path, patch) => {
        setRows((prev) => prev.map((row) => (row.path === path ? { ...row, ...patch } : row)));
    };

    const refreshPorts = async () => {
        const result = await ipcRenderer.invoke('flash-ports');
        if (!result || !result.success) {
            setError((result && result.error) || 'Unable to list USB ports');
            return [];
        }
        const ports = result.ports || [];
        setRows((prev) => {
            const byPath = new Map(prev.map((row) => [row.path, row]));
            return ports.map((port) => {
                const existing = byPath.get(port.path);
                if (existing) {
                    return {
                        ...existing,
                        friendlyName: port.friendlyName || port.path,
                        manufacturer: port.manufacturer || ''
                    };
                }
                return emptyRow(port, prev.length === 0);
            });
        });
        return ports;
    };

    const refreshWlan = async () => {
        const result = await ipcRenderer.invoke('flash-wlan');
        if (!result || !result.success) {
            setWlan({ current: null, networks: [] });
            return result;
        }
        setWlan({
            current: result.current || null,
            networks: result.networks || []
        });
        return result;
    };

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            const catalogResult = await ipcRenderer.invoke('flash-catalog');
            await refreshPorts();
            const wlanResult = await refreshWlan();
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
                setSdPins(settings.flashSdPins || nextBoard.defaults.sd);
                const led = nextBoard.defaults.led || {};
                setPixels(normalizePixels(settings.flashPixels || {
                    data: led.data,
                    count: led.count,
                    order: led.order
                }));
            } else if (settings.flashPixels) {
                setPixels(normalizePixels(settings.flashPixels));
            }
            setNamePattern(settings.flashNamePattern || 'Whip');
            const nameOpts = normalizeNameOpts({
                mode: settings.flashNameMode,
                start: settings.flashNameStart,
                digits: settings.flashNameDigits
            });
            setNameMode(nameOpts.mode);
            setNameStart(nameOpts.start);
            setNameDigits(nameOpts.digits);
            const savedSsid = settings.flashSsid || '';
            setPassword(typeof settings.flashPassword === 'string' ? settings.flashPassword : '');
            if (savedSsid) {
                setSsid(savedSsid);
            } else if (wlanResult && wlanResult.current && wlanResult.current.ssid) {
                setSsid(wlanResult.current.ssid);
            }
            if (settings.flashPort) {
                setRows((prev) => prev.map((row) => ({
                    ...row,
                    selected: row.path === settings.flashPort || prev.length === 1
                })));
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
            if (!payload || !payload.port) {
                return;
            }
            patchRow(payload.port, {
                percent: payload.percent || 0,
                label: payload.label || ''
            });
        };
        const onLog = (_event, payload) => {
            if (!payload || !payload.line) {
                return;
            }
            const line = payload.port ? `${payload.port}  ${payload.line}` : payload.line;
            if (payload.port && payload.port !== 'build') {
                patchRow(payload.port, { lastLog: payload.line });
            }
            setLog((prev) => [...prev.slice(-200), line]);
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

    const selectedRows = rows.filter((row) => row.selected);
    const nameOpts = useMemo(() => normalizeNameOpts({
        mode: nameMode,
        start: nameStart,
        digits: nameDigits
    }), [nameMode, nameStart, nameDigits]);

    const nameIndexFor = (path, fallbackIndex = 0) => {
        const amongSelected = selectedRows.findIndex((row) => row.path === path);
        return amongSelected >= 0 ? amongSelected : fallbackIndex;
    };

    const previewName = (row, fallbackIndex = 0) => resolveNodeName(
        namePattern,
        row.mac,
        nameIndexFor(row.path, fallbackIndex),
        nameOpts
    ).long;

    const bandWarning = useMemo(() => {
        if (!ssid) {
            return '';
        }
        if (wlan.current && wlan.current.ssid === ssid && wlan.current.is24ghz === false) {
            return 'This PC is on 5 GHz. The S3 can only join 2.4 GHz — it will fail if this SSID has no 2.4 GHz radio.';
        }
        return '';
    }, [ssid, wlan.current]);

    const handleBoardChange = (nextId) => {
        setBoardId(nextId);
        const next = boards.find((item) => item.id === nextId);
        if (next && next.defaults) {
            setSdPins(next.defaults.sd);
            const led = next.defaults.led || {};
            const nextPixels = normalizePixels({
                ...pixels,
                data: led.data,
                count: led.count || pixels.count,
                order: led.order || pixels.order
            });
            setPixels(nextPixels);
            persist({ flashBoardId: nextId, flashSdPins: next.defaults.sd, flashPixels: nextPixels });
        }
    };

    const handlePin = (key, raw) => {
        const next = { ...sdPins, [key]: pinValue(raw) };
        setSdPins(next);
        persist({ flashSdPins: next });
    };

    const patchPixels = (patch) => {
        const next = normalizePixels({ ...pixels, ...patch });
        setPixels(next);
        persist({ flashPixels: next });
    };

    const persistNames = (patch) => {
        const nextPattern = patch.flashNamePattern != null ? patch.flashNamePattern : namePattern;
        const nextOpts = normalizeNameOpts({
            mode: patch.flashNameMode != null ? patch.flashNameMode : nameMode,
            start: patch.flashNameStart != null ? patch.flashNameStart : nameStart,
            digits: patch.flashNameDigits != null ? patch.flashNameDigits : nameDigits
        });
        persist({
            flashNamePattern: nextPattern || 'Whip',
            flashNameMode: nextOpts.mode,
            flashNameStart: nextOpts.start,
            flashNameDigits: nextOpts.digits
        });
        setRows((prev) => {
            const selected = prev.filter((row) => row.selected);
            return prev.map((row, index) => {
                const amongSelected = selected.findIndex((item) => item.path === row.path);
                const nameIndex = amongSelected >= 0 ? amongSelected : index;
                return {
                    ...row,
                    name: resolveNodeName(nextPattern, row.mac, nameIndex, nextOpts).long
                };
            });
        });
    };

    const handleNamePattern = (next) => {
        setNamePattern(next);
        persistNames({ flashNamePattern: next || 'Whip' });
    };

    const handleNameMode = (next) => {
        const mode = next === 'seq' ? 'seq' : 'mac';
        setNameMode(mode);
        persistNames({ flashNameMode: mode });
    };

    const handleNameStart = (raw) => {
        const start = normalizeNameOpts({ start: raw }).start;
        setNameStart(start);
        persistNames({ flashNameStart: start });
    };

    const handleNameDigits = (raw) => {
        const digits = normalizeNameOpts({ digits: raw }).digits;
        setNameDigits(digits);
        persistNames({ flashNameDigits: digits });
    };

    const handleSsid = (next) => {
        setSsid(next);
        persist({ flashSsid: next });
    };

    const handlePassword = (next) => {
        setPassword(next);
        persist({ flashPassword: next });
    };

    const toggleAll = (checked) => {
        setRows((prev) => prev.map((row) => ({ ...row, selected: checked })));
    };

    const applyArtifacts = (artifacts) => {
        if (artifacts && artifacts.error) {
            setArtifactError(artifacts.error);
            setArtifactNote('');
            return;
        }
        if (artifacts && artifacts.source) {
            setArtifactNote(artifacts.source);
            setArtifactError('');
        }
    };

    const handleBuild = async () => {
        if (busy) {
            return;
        }
        setBuildBusy(true);
        setBuildStatus('');
        setBuildOk(false);
        setError('');
        try {
            const result = await ipcRenderer.invoke('flash-build', { boardId });
            if (!result || !result.success) {
                setBuildOk(false);
                setBuildStatus((result && result.error) || 'Build failed');
                return;
            }
            if (result.source) {
                applyArtifacts({ source: result.source });
            } else {
                const catalogResult = await ipcRenderer.invoke('flash-catalog');
                if (catalogResult && catalogResult.success) {
                    applyArtifacts(catalogResult.artifacts);
                }
            }
            const extra = result.warning ? ` ${result.warning}` : '';
            setBuildOk(true);
            setBuildStatus(`Build succeeded.${result.source ? ` Image: ${result.source}.` : ''}${extra}`);
        } catch (err) {
            setBuildOk(false);
            setBuildStatus(err.message);
        } finally {
            setBuildBusy(false);
        }
    };

    const runBatch = async (work) => {
        if (busy) {
            return;
        }
        setBatchBusy(true);
        setError('');
        try {
            await work();
        } catch (err) {
            setError(err.message);
        } finally {
            setBatchBusy(false);
        }
    };

    const handleIdentify = () => runBatch(async () => {
        const targets = selectedRows;
        if (!targets.length) {
            setError('Select at least one COM port');
            return;
        }
        setLog([]);
        await runPool(targets, async (row, index) => {
            patchRow(row.path, {
                error: '',
                downloadMode: false,
                label: 'Identifying',
                lastLog: '',
                percent: 0
            });
            const result = await ipcRenderer.invoke('flash-identify', { port: row.path });
            if (!result || !result.success) {
                patchRow(row.path, {
                    error: (result && result.error) || 'Identify failed',
                    downloadMode: Boolean(result && result.downloadMode),
                    label: 'Failed'
                });
                return;
            }
            const names = resolveNodeName(namePattern, result.mac, index, nameOpts);
            patchRow(row.path, {
                chip: result.chip || '',
                mac: result.mac || '',
                name: names.long,
                label: 'Identified'
            });
        });
    });

    const handleFlash = () => runBatch(async () => {
        const targets = selectedRows;
        if (!targets.length) {
            setError('Select at least one COM port');
            return;
        }
        const pixelCheck = validatePixels(pixels, sdPins, targets.length);
        if (!pixelCheck.ok) {
            setError(pixelCheck.error);
            return;
        }
        persist({
            flashSsid: ssid,
            flashPassword: password,
            flashNamePattern: namePattern || 'Whip',
            flashNameMode: nameOpts.mode,
            flashNameStart: nameOpts.start,
            flashNameDigits: nameOpts.digits,
            flashSdPins: sdPins,
            flashPixels: pixelCheck.pixels,
            flashBoardId: boardId
        });
        setLog([]);
        await runPool(targets, async (row, index) => {
            const names = resolveNodeName(namePattern, row.mac, index, nameOpts);
            patchRow(row.path, {
                name: names.long,
                error: '',
                downloadMode: false,
                percent: 0,
                label: 'Starting',
                deviceId: '',
                waiting: false,
                provisioned: false
            });
            const result = await ipcRenderer.invoke('flash-run', {
                port: row.path,
                boardId,
                pins: sdPins,
                ssid: clearWifi ? '' : ssid,
                password: clearWifi ? '' : password,
                namePattern,
                nameMode: nameOpts.mode,
                nameStart: nameOpts.start,
                nameDigits: nameOpts.digits,
                nameIndex: index,
                longName: names.long,
                shortName: names.short,
                clearWifi,
                pixels: pixelCheck.pixels
            });
            if (!result || !result.success) {
                patchRow(row.path, {
                    error: (result && result.error) || 'Flash failed',
                    downloadMode: Boolean(result && result.downloadMode),
                    label: 'Failed',
                    percent: 0
                });
                return;
            }
            const flashedName = result.name || names.long;
            patchRow(row.path, {
                chip: result.chip || row.chip,
                mac: result.mac || row.mac,
                name: flashedName,
                percent: 100,
                label: result.pinsError ? 'Flashed — pins not applied' : 'Done',
                provisioned: Boolean(result.provisioned),
                error: result.pinsError || ''
            });
            if (result.provisioned && result.mac) {
                patchRow(row.path, { label: 'Waiting for ArtPoll…', waiting: true });
                const found = await waitForArtPoll(result.mac, ARTPOLL_WAIT_MS);
                if (found) {
                    patchRow(row.path, {
                        waiting: false,
                        deviceId: found.id,
                        label: `On network · ${found.ip || found.id}`
                    });
                } else {
                    patchRow(row.path, {
                        waiting: false,
                        label: 'No ArtPoll yet',
                        error: 'Board did not appear on ArtPoll. Stay on the show NIC. SoftAP dmxwhip / 4.3.2.1 is recovery only.'
                    });
                }
            }
        });
    });

    const selectedChip = chipByName(pixels.chip);
    const needsClock = Boolean(selectedChip && selectedChip.needsClock);

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

    const allSelected = rows.length > 0 && rows.every((row) => row.selected);

    const rail = React.createElement('div', {
        className: railHost ? 'h-full min-h-0 flex flex-col overflow-hidden' : 'app-sidebar overflow-hidden'
    },
            React.createElement('div', {
                className: 'flex-none flex flex-col gap-1.5 p-2 border-b border-zinc-200 dark:border-zinc-800'
            },
                React.createElement('div', {
                    className: 'flex items-center gap-2'
                },
                    React.createElement('input', {
                        type: 'checkbox',
                        checked: allSelected,
                        disabled: busy || !rows.length,
                        onChange: (event) => toggleAll(event.target.checked),
                        className: 'h-3.5 w-3.5 accent-cyan-400'
                    }),
                    React.createElement('span', {
                        className: 'text-xs text-zinc-500'
                    }, 'Select all')
                ),
                React.createElement('button', {
                    type: 'button',
                    className: 'btn-quiet w-full justify-center',
                    disabled: busy,
                    onClick: () => refreshPorts()
                }, 'Refresh ports'),
                React.createElement('button', {
                    type: 'button',
                    className: 'btn-quiet w-full justify-center',
                    disabled: busy || !selectedRows.length,
                    onClick: handleIdentify
                }, batchBusy ? 'Working…' : `Identify selected (${selectedRows.length})`),
                React.createElement('button', {
                    type: 'button',
                    className: 'btn-primary w-full justify-center',
                    disabled: busy || !selectedRows.length || Boolean(artifactError),
                    onClick: handleFlash
                }, batchBusy ? 'Flashing…' : `Flash selected (${selectedRows.length})`)
            ),
            React.createElement('div', {
                className: 'flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-1'
            },
                !rows.length && React.createElement('div', {
                    className: 'text-zinc-500 text-xs italic p-2'
                }, 'No serial ports. Plug in a board and Refresh.'),
                rows.map((row, index) => {
                    const preview = row.name || previewName(row, index);
                    const addr = row.selected
                        ? formatAddr(addressAt(pixels, nameIndexFor(row.path, index)))
                        : '';
                    return React.createElement('div', {
                        key: row.path,
                        className: `kv-row items-start ${row.selected ? 'is-active' : ''}`
                    },
                        React.createElement('input', {
                            type: 'checkbox',
                            className: 'mt-0.5 flex-none',
                            checked: row.selected,
                            disabled: busy,
                            onChange: (event) => patchRow(row.path, { selected: event.target.checked })
                        }),
                        React.createElement('div', {
                            className: 'min-w-0 flex-1'
                        },
                            React.createElement('div', {
                                className: 'font-medium truncate text-sm'
                            }, row.path),
                            React.createElement('div', {
                                className: 'readout truncate'
                            }, row.friendlyName),
                            React.createElement('div', {
                                className: 'readout truncate'
                            }, [row.chip, row.mac].filter(Boolean).join(' · ') || '—'),
                            React.createElement('div', {
                                className: 'readout truncate'
                            }, preview ? (addr ? `${preview} · ${addr}` : preview) : '—'),
                            React.createElement('div', {
                                className: 'h-1.5 mt-1 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden'
                            },
                                React.createElement('div', {
                                    className: 'h-full bg-cyan-600 dark:bg-cyan-400',
                                    style: { width: `${Math.max(0, Math.min(100, row.percent || 0))}%` }
                                })
                            ),
                            row.label && React.createElement('div', {
                                className: 'readout mt-1'
                            }, `${row.label}${row.percent ? ` ${row.percent}%` : ''}`),
                            row.deviceId && React.createElement('button', {
                                type: 'button',
                                className: 'btn-primary mt-1',
                                onClick: () => onOpenDevice && onOpenDevice(row.deviceId)
                            }, 'Open in Devices'),
                            row.error && React.createElement('p', {
                                className: 'text-xs text-red-500 mt-1'
                            }, row.error),
                            row.downloadMode && React.createElement('p', {
                                className: 'text-xs text-amber-600 dark:text-amber-400 mt-1'
                            }, 'Hold BOOT, tap RESET, release BOOT.'),
                            !row.error && row.lastLog && React.createElement('p', {
                                className: 'readout truncate mt-1'
                            }, row.lastLog)
                        )
                    );
                })
            ),
            React.createElement('div', {
                className: 'flex-none flex flex-col gap-1 p-2 border-t border-zinc-200 dark:border-zinc-800'
            },
                React.createElement('button', {
                    type: 'button',
                    className: 'btn-quiet w-full justify-center',
                    disabled: busy,
                    onClick: handleBuild
                }, buildBusy ? 'Building…' : 'Build firmware'),
                buildStatus && React.createElement('p', {
                    className: buildOk
                        ? 'text-xs text-emerald-600 dark:text-emerald-400'
                        : 'text-xs text-red-500'
                }, buildStatus)
            ),
            React.createElement('pre', {
                ref: logRef,
                className: 'flex-none h-[12.5%] overflow-auto border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-2 readout whitespace-pre-wrap'
            }, log.join('\n') || 'Log output appears here. Passwords are not printed.')
    );
    const main = React.createElement('div', {
        className: 'flex-1 min-h-0 overflow-y-auto p-3 bg-zinc-50 dark:bg-zinc-950'
    },
        React.createElement('div', {
            className: 'max-w-xl mx-auto w-full flex flex-col gap-3'
        },
            React.createElement('div', {
                className: 'status-strip'
            },
                React.createElement('div', {
                    className: 'text-sm font-medium'
                }, 'USB flash'),
                React.createElement('p', {
                    className: 'text-xs text-zinc-500'
                }, 'Shared Wi-Fi and name apply to every selected COM port (up to 4 at once). Type the password here — this app does not read it from Windows. Close any serial monitor first. If connect fails, hold BOOT, tap RESET, release BOOT.')
            ),
            React.createElement('div', {
                className: 'grid grid-cols-2 gap-2'
            },
                React.createElement(Field, { label: 'Name pattern' },
                    React.createElement('input', {
                        className: 'field',
                        value: namePattern,
                        maxLength: 40,
                        disabled: busy,
                        placeholder: 'Whip',
                        onChange: (event) => handleNamePattern(event.target.value)
                    })
                ),
                React.createElement(Field, { label: 'Suffix' },
                    React.createElement('select', {
                        className: 'field',
                        value: nameMode,
                        disabled: busy,
                        onChange: (event) => handleNameMode(event.target.value)
                    },
                        React.createElement('option', { value: 'mac' }, 'Last 4 of MAC'),
                        React.createElement('option', { value: 'seq' }, 'Numeric sequential')
                    )
                )
            ),
            nameMode === 'seq' && React.createElement('div', {
                className: 'grid grid-cols-2 gap-2'
            },
                React.createElement(Field, { label: 'Start' },
                    React.createElement('input', {
                        className: 'field',
                        type: 'number',
                        min: 0,
                        max: 999999,
                        value: nameStart,
                        disabled: busy,
                        onChange: (event) => handleNameStart(event.target.value)
                    })
                ),
                React.createElement(Field, { label: 'Digits' },
                    React.createElement('input', {
                        className: 'field',
                        type: 'number',
                        min: 1,
                        max: 6,
                        value: nameDigits,
                        disabled: busy,
                        onChange: (event) => handleNameDigits(event.target.value)
                    })
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
            ),
            React.createElement('p', {
                className: 'readout -mt-1'
            }, nameMode === 'seq'
                ? `Selected ports are ${namePattern || 'Whip'}-${String(nameStart).padStart(nameDigits, '0')}, then +1. Digits 1 → 1, digits 4 → 0001. Leave SSID empty to keep existing NVS (firmware-only).`
                : 'Long name is pattern plus last 4 hex of the MAC (Whip-A4F2), written with Wi-Fi. Leave SSID empty to keep existing NVS (firmware-only).'),
            React.createElement('div', {
                className: 'grid grid-cols-2 gap-2'
            },
                React.createElement(Field, { label: 'SSID' },
                    React.createElement('input', {
                        className: 'field',
                        value: ssid,
                        maxLength: 32,
                        disabled: busy || clearWifi,
                        placeholder: wlan.current && wlan.current.ssid
                            ? wlan.current.ssid
                            : 'Network name or hidden SSID',
                        onChange: (event) => handleSsid(event.target.value)
                    })
                ),
                React.createElement(Field, { label: 'Password' },
                    React.createElement('div', {
                        className: 'flex gap-1'
                    },
                        React.createElement('input', {
                            type: showPassword ? 'text' : 'password',
                            className: 'field',
                            value: password,
                            maxLength: 63,
                            disabled: busy || clearWifi,
                            autoComplete: 'off',
                            placeholder: 'Empty = open network',
                            onChange: (event) => handlePassword(event.target.value)
                        }),
                        React.createElement('button', {
                            type: 'button',
                            className: 'btn-quiet flex-none p-1.5',
                            disabled: busy || clearWifi,
                            title: showPassword ? 'Hide password' : 'Show password',
                            'aria-label': showPassword ? 'Hide password' : 'Show password',
                            onClick: () => setShowPassword((prev) => !prev)
                        },
                            React.createElement(EyeIcon, { off: showPassword })
                        )
                    )
                )
            ),
            wlan.current && wlan.current.ssid && React.createElement('p', {
                className: 'readout -mt-1'
            }, `PC Wi-Fi: ${wlan.current.ssid}${wlan.current.band ? ` · ${wlan.current.band}` : ''}`),
            bandWarning && React.createElement('p', {
                className: 'text-sm text-amber-600 dark:text-amber-400'
            }, bandWarning),
            password && password.length > 0 && password.length < 8 && React.createElement('p', {
                className: 'text-sm text-amber-600 dark:text-amber-400'
            }, 'WPA passwords are usually 8+ characters. Empty means an open network.'),
            React.createElement(Field, { label: 'NVS' },
                React.createElement('label', {
                    className: 'flex items-center gap-2 text-sm pt-1.5'
                },
                    React.createElement('input', {
                        type: 'checkbox',
                        checked: clearWifi,
                        disabled: busy,
                        onChange: (event) => setClearWifi(event.target.checked)
                    }),
                    'Clear saved Wi-Fi (omit STA keys)'
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
            React.createElement('div', {
                className: 'grid grid-cols-2 gap-2'
            },
                React.createElement(Field, { label: 'IC' },
                    React.createElement('select', {
                        className: 'field',
                        value: pixels.chip,
                        disabled: busy,
                        onChange: (event) => patchPixels({ chip: event.target.value })
                    },
                        CHIPS.map((item) => React.createElement('option', {
                            key: item.name,
                            value: item.name
                        }, item.label))
                    )
                ),
                React.createElement(Field, { label: 'Color order' },
                    React.createElement('select', {
                        className: 'field',
                        value: pixels.order,
                        disabled: busy,
                        onChange: (event) => patchPixels({ order: event.target.value })
                    },
                        RGB_ORDERS.map((order) => React.createElement('option', {
                            key: order,
                            value: order
                        }, order.toUpperCase()))
                    )
                ),
                React.createElement(Field, { label: 'Pixel count' },
                    React.createElement('input', {
                        type: 'number',
                        min: 1,
                        max: 1024,
                        className: 'field',
                        value: pixels.count,
                        disabled: busy,
                        onChange: (event) => patchPixels({ count: event.target.value })
                    })
                ),
                React.createElement(Field, { label: 'Brightness' },
                    React.createElement('input', {
                        type: 'number',
                        min: 0,
                        max: 255,
                        className: 'field',
                        value: pixels.bri,
                        disabled: busy,
                        onChange: (event) => patchPixels({ bri: event.target.value })
                    })
                ),
                React.createElement(Field, { label: 'LED data' },
                    React.createElement('input', {
                        type: 'number',
                        min: 0,
                        max: 48,
                        className: 'field',
                        value: pixels.data,
                        disabled: busy,
                        onChange: (event) => patchPixels({ data: event.target.value })
                    })
                ),
                needsClock
                    ? React.createElement(Field, { label: 'Clock GPIO' },
                        React.createElement('input', {
                            type: 'number',
                            min: 0,
                            max: 48,
                            className: 'field',
                            value: pixels.clk,
                            disabled: busy,
                            onChange: (event) => patchPixels({ clk: event.target.value })
                        })
                    )
                    : React.createElement('div', null),
                React.createElement(Field, { label: 'Start universe' },
                    React.createElement('input', {
                        type: 'number',
                        min: 0,
                        max: 32767,
                        className: 'field',
                        value: pixels.startUni,
                        disabled: busy,
                        onChange: (event) => patchPixels({ startUni: event.target.value })
                    })
                ),
                React.createElement(Field, { label: 'Start channel' },
                    React.createElement('input', {
                        type: 'number',
                        min: 1,
                        max: 512,
                        className: 'field',
                        value: pixels.startCh,
                        disabled: busy,
                        onChange: (event) => patchPixels({ startCh: event.target.value })
                    })
                ),
                React.createElement(Field, { label: 'Universe offset' },
                    React.createElement('input', {
                        type: 'number',
                        min: 0,
                        max: 32767,
                        className: 'field',
                        value: pixels.uniStep,
                        disabled: busy,
                        onChange: (event) => patchPixels({ uniStep: event.target.value })
                    })
                ),
                React.createElement(Field, { label: 'Channel offset' },
                    React.createElement('input', {
                        type: 'number',
                        min: 0,
                        max: 32767,
                        className: 'field',
                        value: pixels.chStep,
                        disabled: busy,
                        onChange: (event) => patchPixels({ chStep: event.target.value })
                    })
                )
            ),
            React.createElement('p', {
                className: 'readout'
            }, pixelsSummary(pixels)),
            pixels.bri > BRIGHTNESS_WARN && React.createElement('p', {
                className: 'text-sm text-amber-600 dark:text-amber-400'
            }, `Brightness ${pixels.bri} is above ${BRIGHTNESS_WARN}. This panel can overheat.`),
            artifactNote && React.createElement('p', {
                className: 'readout'
            }, `Image: ${artifactNote}`),
            artifactError && React.createElement('p', {
                className: 'text-sm text-red-500'
            }, artifactError),
            error && React.createElement('p', {
                className: 'text-sm text-red-500'
            }, error)
        )
    );
    if (!railHost) {
        return main;
    }
    return React.createElement(React.Fragment, null,
        createPortal(rail, railHost),
        main
    );
};

module.exports = FlashPanel;
