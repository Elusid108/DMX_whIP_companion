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

const clampBri = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) {
        return null;
    }
    return Math.max(0, Math.min(255, Math.round(n)));
};

const DevicesPanel = () => {
    const [devices, setDevices] = useState([]);
    const [nic, setNic] = useState({ name: '', ip: '' });
    const [selectedId, setSelectedId] = useState(null);
    const [status, setStatus] = useState(null);
    const [statusError, setStatusError] = useState('');
    const [liveLocked, setLiveLocked] = useState(false);
    const [identifying, setIdentifying] = useState(false);
    const [busy, setBusy] = useState(false);
    const [faceTab, setFaceTab] = useState('playback');
    const [playSrc, setPlaySrc] = useState('root');
    const [playPath, setPlayPath] = useState('/');
    const [files, setFiles] = useState([]);
    const [dirs, setDirs] = useState([]);
    const [fileLoop, setFileLoop] = useState('one');
    const [folderRep, setFolderRep] = useState('forever');
    const [folderN, setFolderN] = useState(1);
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
    const selectedIpRef = useRef(null);
    const playSrcRef = useRef(playSrc);
    const playPathRef = useRef(playPath);
    const fileLoopRef = useRef(fileLoop);
    const folderRepRef = useRef(folderRep);
    const folderNRef = useRef(folderN);
    const protoRef = useRef(proto);
    const fpsRef = useRef(fps);
    const bufRef = useRef(buf);
    const nameDirtyRef = useRef(false);
    const playDirtyRef = useRef(false);
    const briDirtyRef = useRef(false);
    const liveDirtyRef = useRef(false);
    const wifiDirtyRef = useRef(false);
    const briTimerRef = useRef(null);
    const liveTimerRef = useRef(null);

    selectedRef.current = selectedId;
    playSrcRef.current = playSrc;
    playPathRef.current = playPath;
    fileLoopRef.current = fileLoop;
    folderRepRef.current = folderRep;
    folderNRef.current = folderN;
    protoRef.current = proto;
    fpsRef.current = fps;
    bufRef.current = buf;

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
    selectedIpRef.current = selectedIp;

    useEffect(() => {
        nameDirtyRef.current = false;
        playDirtyRef.current = false;
        briDirtyRef.current = false;
        liveDirtyRef.current = false;
        wifiDirtyRef.current = false;
        clearTimeout(briTimerRef.current);
        clearTimeout(liveTimerRef.current);
        setNetworks([]);
        setWifiPassword('');
        setPlaySrc('root');
        setPlayPath('/');
        setFiles([]);
        setDirs([]);
        setFileLoop('one');
        setFolderRep('forever');
        setFolderN(1);
        setNodeName('');
        setLiveLocked(false);
        setRenaming(false);
        setRenameDraft('');
        setFaceTab('playback');
    }, [selectedId]);

    useEffect(() => {
        if (nameDirtyRef.current || !selected) {
            return;
        }
        const next = selected.longName || selected.shortName || '';
        if (next) {
            setNodeName(next);
        }
    }, [selected]);

    useEffect(() => () => {
        clearTimeout(briTimerRef.current);
        clearTimeout(liveTimerRef.current);
    }, []);

    const applyStatus = (next) => {
        setStatus(next);
        const play = next && next.play ? next.play : {};
        const nextFiles = sortShows(Array.isArray(play.files) ? play.files : []);
        const nextDirs = sortShows(Array.isArray(play.dirs) ? play.dirs : []);
        setFiles(nextFiles);
        setDirs(nextDirs);
        if (!playDirtyRef.current) {
            const src = play.src || 'root';
            setPlaySrc(src);
            if (src === 'root') {
                setPlayPath('/');
            } else if (src === 'folder') {
                setPlayPath(play.path && nextDirs.includes(play.path) ? play.path : (nextDirs[0] || '/'));
            } else {
                const path = play.path && nextFiles.includes(play.path)
                    ? play.path
                    : (play.now && nextFiles.includes(play.now) ? play.now : (nextFiles[0] || '/'));
                setPlayPath(path);
            }
            if (play.file_loop) {
                setFileLoop(play.file_loop);
            }
            if (play.folder_rep) {
                setFolderRep(play.folder_rep);
            }
            if (typeof play.n === 'number') {
                setFolderN(play.n);
            }
        }
        if (!nameDirtyRef.current && next.name) {
            setNodeName(next.name);
        }
        if (!briDirtyRef.current && next.bri != null) {
            setBrightness(next.bri);
        }
        if (!liveDirtyRef.current) {
            if (next.proto) {
                setProto(next.proto);
            }
            if (next.fps != null) {
                setFps(next.fps);
            }
            if (next.buf != null) {
                setBuf(next.buf);
            }
        }
        if (!wifiDirtyRef.current && (next.ssid || next.saved)) {
            setWifiSsid(next.ssid || next.saved || '');
        }
    };

    useEffect(() => {
        if (!selectedId || !selectedIp || selectedStale) {
            setLiveLocked(false);
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
                setLiveLocked(false);
            } else {
                const err = (result && result.error) || 'Unable to read /status';
                const live = /live|busy|lighting/i.test(err);
                setLiveLocked(live);
                if (!live) {
                    setStatus(null);
                    setStatusError(err);
                } else {
                    setStatusError('');
                }
            }
            // #region agent log
            fetch('http://127.0.0.1:7854/ingest/2d14efb0-a19b-45fd-b996-9a7138b6d6ab',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b892c6'},body:JSON.stringify({sessionId:'b892c6',runId:'post-fix',hypothesisId:'D',location:'DevicesPanel.js:status',message:'device status',data:{ok:Boolean(result&&result.success),err:result&&result.error,ip:selectedIp,stale:selectedStale,liveLocked:/live|busy|lighting/i.test((result&&result.error)||'')},timestamp:Date.now()})}).catch(()=>{});
            // #endregion
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
                applyStatus(result.status);
            } else {
                const refresh = await ipcRenderer.invoke('device-status', { ip: selected.ip });
                if (refresh && refresh.success) {
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

    const playFields = (src, path) => ({
        ip: selected.ip,
        src,
        path,
        file_loop: fileLoopRef.current,
        folder_rep: folderRepRef.current,
        n: Math.max(1, Math.min(99, Number(folderNRef.current) || 1))
    });

    const playTarget = (src, path) => runDevice(async () => {
        ipcRenderer.send('stop-playback');
        const result = await ipcRenderer.invoke('device-play', playFields(src, path));
        if (result && result.success) {
            playDirtyRef.current = false;
        }
        return result;
    });

    const adjacentFile = (step) => {
        if (!files.length) {
            return null;
        }
        const current = playSrc === 'file' && files.includes(playPath) ? playPath : files[0];
        const index = files.indexOf(current);
        return files[(index + step + files.length) % files.length];
    };

    const handleSelectPlay = (src, path) => {
        playDirtyRef.current = true;
        setPlaySrc(src);
        setPlayPath(path);
        setRenaming(false);
    };

    const handlePlay = () => playTarget(playSrc, playPath);

    const handleStop = () => runDevice(async () => {
        return ipcRenderer.invoke('device-stop', { ip: selected.ip });
    });

    const handlePrev = () => {
        const target = adjacentFile(-1);
        if (target) {
            playDirtyRef.current = true;
            setPlaySrc('file');
            setPlayPath(target);
            playTarget('file', target);
        }
    };

    const handleNext = () => {
        const target = adjacentFile(1);
        if (target) {
            playDirtyRef.current = true;
            setPlaySrc('file');
            setPlayPath(target);
            playTarget('file', target);
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
        if (playSrc !== 'file' || !playPath) {
            return;
        }
        setRenameDraft(showSortName(playPath));
        setRenaming(true);
    };

    const handleRenameCancel = () => {
        setRenaming(false);
        setRenameDraft('');
    };

    const handleRenameConfirm = () => runDevice(async () => {
        if (playSrc !== 'file' || !playPath) {
            return { success: false, error: 'Select a .dmx on the node SD' };
        }
        const next = String(renameDraft || '').trim();
        const result = await ipcRenderer.invoke('device-rename-show', {
            ip: selected.ip,
            from: playPath,
            name: next
        });
        if (result && result.success) {
            setRenaming(false);
            playDirtyRef.current = false;
        }
        return result;
    });

    const handlePullShow = () => runDevice(async () => {
        return ipcRenderer.invoke('device-pull-show', { ip: selected.ip, path: playPath });
    });

    const scheduleBrightness = (raw) => {
        const v = clampBri(raw);
        if (v == null) {
            return;
        }
        briDirtyRef.current = true;
        setBrightness(v);
        if (!selectedIpRef.current) {
            return;
        }
        clearTimeout(briTimerRef.current);
        briTimerRef.current = setTimeout(async () => {
            const ip = selectedIpRef.current;
            if (!ip) {
                return;
            }
            const result = await ipcRenderer.invoke('device-set-brightness', { ip, v });
            if (result && result.success) {
                briDirtyRef.current = false;
                if (result.status && result.status.ver) {
                    applyStatus(result.status);
                }
            } else if (result && result.error) {
                setStatusError(result.error);
            }
        }, 300);
    };

    const scheduleLive = (patch) => {
        liveDirtyRef.current = true;
        if (patch.proto !== undefined) {
            setProto(patch.proto);
            protoRef.current = patch.proto;
        }
        if (patch.fps !== undefined) {
            setFps(patch.fps);
            fpsRef.current = patch.fps;
        }
        if (patch.buf !== undefined) {
            setBuf(patch.buf);
            bufRef.current = patch.buf;
        }
        if (!selectedIpRef.current) {
            return;
        }
        clearTimeout(liveTimerRef.current);
        liveTimerRef.current = setTimeout(async () => {
            const ip = selectedIpRef.current;
            if (!ip) {
                return;
            }
            const result = await ipcRenderer.invoke('device-set-live', {
                ip,
                proto: protoRef.current,
                fps: Number(fpsRef.current),
                buf: Number(bufRef.current)
            });
            if (result && result.success) {
                liveDirtyRef.current = false;
                if (result.status && result.status.ver) {
                    applyStatus(result.status);
                }
            } else if (result && result.error) {
                setStatusError(result.error);
            }
        }, 300);
    };

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
        const result = await ipcRenderer.invoke('device-wifi-connect', {
            ip: selected.ip,
            ssid: wifiSsid,
            password: wifiPassword
        });
        if (result && result.success) {
            wifiDirtyRef.current = false;
        }
        return result;
    });

    const handleWifiForget = () => runDevice(async () => {
        const result = await ipcRenderer.invoke('device-wifi-forget', { ip: selected.ip });
        setWifiPassword('');
        wifiDirtyRef.current = false;
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
                className: 'readout truncate'
            }, nic.ip ? `NIC ${nic.name} · ${nic.ip}` : 'Devices'),
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
                    liveLocked,
                    identifying,
                    busy: busy || scanning,
                    nodeName,
                    playSrc,
                    playPath,
                    files,
                    dirs,
                    fileLoop,
                    folderRep,
                    folderN,
                    brightness,
                    proto,
                    fps,
                    buf,
                    wifiSsid,
                    wifiPassword,
                    networks,
                    scanning,
                    faceTab,
                    onFaceTab: setFaceTab,
                    onNameChange: (value) => {
                        nameDirtyRef.current = true;
                        setNodeName(value);
                    },
                    onSaveName: handleSaveName,
                    onIdentify: handleIdentify,
                    onSelectPlay: handleSelectPlay,
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
                    onFileLoopChange: setFileLoop,
                    onFolderRepChange: setFolderRep,
                    onFolderNChange: setFolderN,
                    onBrightnessChange: scheduleBrightness,
                    onProtoChange: (value) => scheduleLive({ proto: value }),
                    onFpsChange: (value) => scheduleLive({ fps: Number(value) }),
                    onBufChange: (value) => scheduleLive({ buf: Number(value) }),
                    onWifiSsidChange: (value) => {
                        wifiDirtyRef.current = true;
                        setWifiSsid(value);
                    },
                    onWifiPasswordChange: (value) => {
                        wifiDirtyRef.current = true;
                        setWifiPassword(value);
                    },
                    onWifiScan: handleWifiScan,
                    onWifiConnect: handleWifiConnect,
                    onWifiForget: handleWifiForget
                })
            )
        )
    );
};

module.exports = DevicesPanel;
