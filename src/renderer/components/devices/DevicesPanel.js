const React = require('react');
const { useState, useEffect, useRef } = React;
const ipcRenderer = require('../../ipc');
const DeviceList = require('./DeviceList');
const DeviceInspector = require('./DeviceInspector');

const showSortName = (sdPath) => String(sdPath || '')
    .split('/')
    .pop()
    .replace(/\.dmx$/i, '')
    .replace(/^\d{2}_/, '');

const sortShows = (paths) => paths.slice().sort((a, b) =>
    showSortName(a).localeCompare(showSortName(b), undefined, { numeric: true, sensitivity: 'base' })
);

const DevicesPanel = () => {
    const [devices, setDevices] = useState([]);
    const [nic, setNic] = useState({ name: '', ip: '' });
    const [selectedId, setSelectedId] = useState(null);
    const [status, setStatus] = useState(null);
    const [statusError, setStatusError] = useState('');
    const [identifying, setIdentifying] = useState(false);
    const [busy, setBusy] = useState(false);
    const [sdPath, setSdPath] = useState(null);
    const [files, setFiles] = useState([]);
    const [nodeName, setNodeName] = useState('');
    const [brightness, setBrightness] = useState(10);
    const [proto, setProto] = useState('auto');
    const [fps, setFps] = useState(40);
    const [buf, setBuf] = useState(0);
    const [wifiSsid, setWifiSsid] = useState('');
    const [wifiPassword, setWifiPassword] = useState('');
    const [networks, setNetworks] = useState([]);
    const [scanning, setScanning] = useState(false);
    const [renaming, setRenaming] = useState(false);
    const [renameDraft, setRenameDraft] = useState('');
    const selectedRef = useRef(null);
    const dirtyRef = useRef(false);
    const nameDirtyRef = useRef(false);

    selectedRef.current = selectedId;

    useEffect(() => {
        const handleUpdate = (event, payload = {}) => {
            const next = payload.devices || [];
            setNic(payload.nic || { name: '', ip: '' });
            setDevices(next);
            setSelectedId((current) => {
                if (current && next.some((device) => device.id === current)) {
                    return current;
                }
                return next[0] ? next[0].id : null;
            });
        };

        ipcRenderer.on('devices-update', handleUpdate);
        ipcRenderer.send('devices-scan');
        return () => {
            ipcRenderer.removeListener('devices-update', handleUpdate);
        };
    }, []);

    const selected = devices.find((device) => device.id === selectedId) || null;
    const selectedIp = selected ? selected.ip : null;
    const selectedStale = Boolean(selected && selected.stale);

    useEffect(() => {
        dirtyRef.current = false;
        nameDirtyRef.current = false;
        setNetworks([]);
        setWifiPassword('');
        setSdPath(null);
        setFiles([]);
        setNodeName('');
        setRenaming(false);
        setRenameDraft('');
    }, [selectedId]);

    const applyStatus = (next) => {
        setStatus(next);
        const nextFiles = sortShows(next && next.play && Array.isArray(next.play.files) ? next.play.files : []);
        setFiles(nextFiles);
        setSdPath((current) => {
            if (current && nextFiles.includes(current)) {
                return current;
            }
            if (next.play && next.play.now && nextFiles.includes(next.play.now)) {
                return next.play.now;
            }
            return nextFiles[0] || null;
        });
        if (!nameDirtyRef.current && next.name) {
            setNodeName(next.name);
        }
        if (!dirtyRef.current) {
            if (next.bri != null) {
                setBrightness(next.bri);
            }
            if (next.proto) {
                setProto(next.proto);
            }
            if (next.fps != null) {
                setFps(next.fps);
            }
            if (next.buf != null) {
                setBuf(next.buf);
            }
            if (next.ssid || next.saved) {
                setWifiSsid(next.ssid || next.saved || '');
            }
        }
    };

    useEffect(() => {
        if (!selectedId || !selectedIp || selectedStale) {
            setStatus(null);
            setStatusError(selectedStale ? 'Node is stale — waiting for ArtPollReply.' : '');
            return undefined;
        }

        let cancelled = false;
        const load = async () => {
            const result = await ipcRenderer.invoke('device-status', { ip: selectedIp });
            if (cancelled || selectedRef.current !== selectedId) {
                return;
            }
            if (result && result.success) {
                applyStatus(result.status);
                setStatusError('');
            } else {
                setStatus(null);
                setStatusError((result && result.error) || 'Unable to read /status');
            }
        };

        load();
        const timer = setInterval(load, 4000);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [selectedId, selectedIp, selectedStale]);

    const runDevice = async (work) => {
        if (!selected || busy) {
            return;
        }
        setBusy(true);
        try {
            const result = await work();
            if (!result || !result.success) {
                setStatusError((result && result.error) || 'Request failed');
                return;
            }
            if (result.status && result.status.ver) {
                dirtyRef.current = false;
                applyStatus(result.status);
            } else {
                const refresh = await ipcRenderer.invoke('device-status', { ip: selected.ip });
                if (refresh && refresh.success) {
                    dirtyRef.current = false;
                    applyStatus(refresh.status);
                }
            }
            setStatusError('');
        } catch (err) {
            setStatusError(err.message);
        } finally {
            setBusy(false);
        }
    };

    const handleIdentify = async () => {
        if (!selected || identifying) {
            return;
        }
        setIdentifying(true);
        const result = await ipcRenderer.invoke('device-identify', { ip: selected.ip, ms: 3000 });
        setIdentifying(false);
        if (!result || !result.success) {
            setStatusError((result && result.error) || 'Identify failed');
        }
    };

    const playPath = (target) => runDevice(async () => {
        ipcRenderer.send('stop-playback');
        return ipcRenderer.invoke('device-play', { ip: selected.ip, path: target });
    });

    const adjacentPath = (step) => {
        if (!files.length) {
            return null;
        }
        const current = sdPath && files.includes(sdPath) ? sdPath : files[0];
        const index = files.indexOf(current);
        const next = files[(index + step + files.length) % files.length];
        setSdPath(next);
        return next;
    };

    const handlePlay = () => playPath(sdPath);

    const handleStop = () => runDevice(async () => {
        return ipcRenderer.invoke('device-stop', { ip: selected.ip });
    });

    const handlePrev = () => {
        const target = adjacentPath(-1);
        if (target) {
            playPath(target);
        }
    };

    const handleNext = () => {
        const target = adjacentPath(1);
        if (target) {
            playPath(target);
        }
    };

    const handleSaveName = () => runDevice(async () => {
        const result = await ipcRenderer.invoke('device-set-name', {
            ip: selected.ip,
            name: nodeName
        });
        if (result && result.success) {
            nameDirtyRef.current = false;
        }
        return result;
    });

    const handleRenameShow = () => {
        if (!sdPath) {
            return;
        }
        const current = (sdPath.split('/').pop() || '').replace(/\.dmx$/i, '').replace(/^\d{2}_/, '');
        setRenameDraft(current);
        setRenaming(true);
    };

    const handleRenameCancel = () => {
        setRenaming(false);
        setRenameDraft('');
    };

    const handleRenameConfirm = () => runDevice(async () => {
        if (!sdPath) {
            return { success: false, error: 'Select a .dmx on the node SD' };
        }
        const next = String(renameDraft || '').trim();
        const result = await ipcRenderer.invoke('device-rename-show', {
            ip: selected.ip,
            from: sdPath,
            name: next
        });
        if (result && result.success) {
            setRenaming(false);
        }
        return result;
    });

    const handlePullShow = () => runDevice(async () => {
        return ipcRenderer.invoke('device-pull-show', { ip: selected.ip, path: sdPath });
    });

    const handleApplyBrightness = () => runDevice(async () => {
        const v = Math.max(0, Math.min(255, Number(brightness)));
        return ipcRenderer.invoke('device-set-brightness', { ip: selected.ip, v });
    });

    const handleApplyLive = () => runDevice(async () => {
        return ipcRenderer.invoke('device-set-live', {
            ip: selected.ip,
            proto,
            fps: Number(fps),
            buf: Number(buf)
        });
    });

    const handleWifiScan = async () => {
        if (!selected || scanning || busy) {
            return;
        }
        setScanning(true);
        const result = await ipcRenderer.invoke('device-wifi-scan', { ip: selected.ip });
        setScanning(false);
        if (!result || !result.success) {
            setStatusError((result && result.error) || 'Scan failed');
            return;
        }
        const next = result.networks || [];
        setNetworks(next);
        if (next[0] && !wifiSsid) {
            setWifiSsid(next[0].ssid);
        }
        setStatusError('');
    };

    const handleWifiConnect = () => runDevice(async () => {
        return ipcRenderer.invoke('device-wifi-connect', {
            ip: selected.ip,
            ssid: wifiSsid,
            password: wifiPassword
        });
    });

    const handleWifiForget = () => runDevice(async () => {
        const result = await ipcRenderer.invoke('device-wifi-forget', { ip: selected.ip });
        setWifiPassword('');
        return result;
    });

    const handleScan = () => {
        ipcRenderer.send('devices-scan');
    };

    return React.createElement('div', {
        className: 'flex-1 min-h-0 flex flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-950'
    },
        React.createElement('div', {
            className: 'flex items-center justify-between gap-2 px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-800'
        },
            React.createElement('div', {
                className: 'text-xs text-zinc-500 truncate'
            }, nic.ip ? `NIC: ${nic.name} (${nic.ip})` : 'Devices'),
            React.createElement('button', {
                type: 'button',
                className: 'btn-quiet',
                onClick: handleScan
            }, 'Scan')
        ),
        React.createElement('div', {
            className: 'flex flex-1 min-h-0'
        },
            React.createElement('div', {
                className: 'w-72 border-r border-zinc-200 dark:border-zinc-800 p-2 overflow-y-auto'
            },
                React.createElement(DeviceList, {
                    devices: devices.map((device) => (
                        device.id === selectedId && nodeName
                            ? { ...device, longName: nodeName }
                            : device
                    )),
                    selectedId,
                    onSelect: setSelectedId,
                    onOpenPortal: (device) => {
                        if (!device || !device.ip) {
                            return;
                        }
                        ipcRenderer.invoke('device-open-portal', { ip: device.ip });
                    }
                })
            ),
            React.createElement('div', {
                className: 'flex-1 p-3 min-h-0 overflow-hidden'
            },
                React.createElement(DeviceInspector, {
                    device: selected,
                    status,
                    statusError,
                    identifying,
                    busy: busy || scanning,
                    nodeName,
                    sdPath,
                    files,
                    brightness,
                    proto,
                    fps,
                    buf,
                    wifiSsid,
                    wifiPassword,
                    networks,
                    scanning,
                    onNameChange: (value) => {
                        nameDirtyRef.current = true;
                        setNodeName(value);
                    },
                    onSaveName: handleSaveName,
                    onIdentify: handleIdentify,
                    onSdPathChange: setSdPath,
                    onPlay: handlePlay,
                    onStop: handleStop,
                    onPrev: handlePrev,
                    onNext: handleNext,
                    renaming,
                    renameDraft,
                    onRenameShow: handleRenameShow,
                    onRenameDraftChange: setRenameDraft,
                    onRenameConfirm: handleRenameConfirm,
                    onRenameCancel: handleRenameCancel,
                    onPullShow: handlePullShow,
                    onBrightnessChange: (value) => {
                        dirtyRef.current = true;
                        setBrightness(value);
                    },
                    onApplyBrightness: handleApplyBrightness,
                    onProtoChange: (value) => {
                        dirtyRef.current = true;
                        setProto(value);
                    },
                    onFpsChange: (value) => {
                        dirtyRef.current = true;
                        setFps(value);
                    },
                    onBufChange: (value) => {
                        dirtyRef.current = true;
                        setBuf(value);
                    },
                    onApplyLive: handleApplyLive,
                    onWifiSsidChange: setWifiSsid,
                    onWifiPasswordChange: setWifiPassword,
                    onWifiScan: handleWifiScan,
                    onWifiConnect: handleWifiConnect,
                    onWifiForget: handleWifiForget
                })
            )
        )
    );
};

module.exports = DevicesPanel;
