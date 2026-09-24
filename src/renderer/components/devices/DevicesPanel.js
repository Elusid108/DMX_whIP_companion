const React = require('react');
const { createPortal } = require('react-dom');
const { useState, useEffect, useRef } = React;
const ipcRenderer = require('../../ipc');
const DeviceList = require('./DeviceList');
const DeviceInspector = require('./DeviceInspector');
const NetworkSelect = require('../controls/NetworkSelect');

const showSortName = (sdPath) => String(sdPath || '')
    .split('/')
    .pop()
    .replace(/\.dmx$/i, '')
    .replace(/^\d{2}_/, '');

const sortShows = (paths) => paths.slice().sort((a, b) =>
    showSortName(a).localeCompare(showSortName(b), undefined, { numeric: true, sensitivity: 'base' })
);

const pickPullPath = (files, play, current) => {
    if (current && files.includes(current)) {
        return current;
    }
    if (play && play.now && files.includes(play.now)) {
        return play.now;
    }
    if (play && play.src === 'file' && play.path && files.includes(play.path)) {
        return play.path;
    }
    return files[0] || '';
};

const DevicesPanel = ({
    focusDeviceId,
    selectedNic,
    networkInterfaces,
    onNetworkChange,
    railHost
} = {}) => {
    const [devices, setDevices] = useState([]);
    const [selectedId, setSelectedId] = useState(null);
    const [status, setStatus] = useState(null);
    const [statusError, setStatusError] = useState('');
    const [liveLocked, setLiveLocked] = useState(false);
    const [via, setVia] = useState('');
    const [files, setFiles] = useState([]);
    const [pullPath, setPullPath] = useState('');
    const [busy, setBusy] = useState(false);
    const [nodeName, setNodeName] = useState('');

    const focusRef = useRef(focusDeviceId || null);
    const selectedRef = useRef(null);
    const pullPathRef = useRef('');

    focusRef.current = focusDeviceId || null;
    selectedRef.current = selectedId;
    pullPathRef.current = pullPath;

    useEffect(() => {
        const handleUpdate = (event, payload = {}) => {
            const next = payload.devices || [];
            setDevices(next);
            setSelectedId((current) => {
                const wanted = focusRef.current;
                if (wanted && next.some((device) => device.id === wanted)) {
                    return wanted;
                }
                if (current && next.some((device) => device.id === current)) {
                    return current;
                }
                if (wanted) {
                    return wanted;
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

    useEffect(() => {
        if (focusDeviceId) {
            setSelectedId(focusDeviceId);
        }
    }, [focusDeviceId]);

    const selected = devices.find((device) => device.id === selectedId) || null;
    const selectedIp = selected ? selected.ip : null;
    const selectedStale = Boolean(selected && selected.stale);

    useEffect(() => {
        setStatus(null);
        setStatusError('');
        setLiveLocked(false);
        setVia('');
        setFiles([]);
        setPullPath('');
        setNodeName('');
        setBusy(false);
    }, [selectedId]);

    const applyStatus = (next, host) => {
        setStatus(next);
        if (host) {
            setVia(host);
        }
        const play = next && next.play ? next.play : {};
        const nextFiles = sortShows(Array.isArray(play.files) ? play.files : []);
        setFiles(nextFiles);
        setPullPath(pickPullPath(nextFiles, play, pullPathRef.current));
        if (next && next.name) {
            setNodeName(next.name);
        }
    };

    useEffect(() => {
        if (!selectedId || !selectedIp || selectedStale) {
            setLiveLocked(false);
            setStatus(null);
            setVia('');
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
                applyStatus(result.status, result.via || selectedIp);
                setStatusError('');
                setLiveLocked(false);
            } else {
                const err = (result && result.error) || 'Unable to read /status';
                const live = /live|busy|lighting/i.test(err);
                setLiveLocked(live);
                if (!live) {
                    setStatus(null);
                    setVia('');
                    setStatusError(err);
                } else {
                    setStatusError('');
                }
            }
        };

        load();
        const timer = setInterval(load, 4000);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [selectedId, selectedIp, selectedStale]);

    const handlePullShow = async () => {
        if (!selected || busy || !pullPath) {
            return;
        }
        setBusy(true);
        try {
            const result = await ipcRenderer.invoke('device-pull-show', {
                ip: selected.ip,
                path: pullPath
            });
            if (!result || !result.success) {
                setStatusError((result && result.error) || 'Pull failed');
                return;
            }
            setStatusError('');
        } catch (err) {
            setStatusError(err.message);
        } finally {
            setBusy(false);
        }
    };

    const handleReboot = async () => {
        if (!selected || !selected.ip || selected.stale || busy) {
            return;
        }
        if (!window.confirm('Reboot this node?')) {
            return;
        }
        setBusy(true);
        try {
            const result = await ipcRenderer.invoke('device-reboot', { ip: selected.ip });
            if (!result || !result.success) {
                setStatusError((result && result.error) || 'Reboot failed');
                return;
            }
            setStatusError('');
        } catch (err) {
            setStatusError(err.message);
        } finally {
            setBusy(false);
        }
    };

    const handleScan = () => {
        ipcRenderer.send('devices-scan');
    };

    const rail = React.createElement(React.Fragment, null,
        React.createElement('div', {
            className: 'flex-none p-2 border-b border-zinc-200 dark:border-zinc-800 flex flex-col gap-1.5'
        },
            React.createElement(NetworkSelect, {
                selectedNic,
                networkInterfaces: networkInterfaces || [],
                onChange: onNetworkChange
            }),
            React.createElement('button', {
                type: 'button',
                className: 'btn-quiet w-full justify-center',
                onClick: handleScan
            }, 'Scan')
        ),
        React.createElement('div', {
            className: 'flex-1 min-h-0 overflow-y-auto p-2'
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
        )
    );
    const main = React.createElement('div', {
        className: 'flex flex-1 flex-col p-3 min-h-0 overflow-y-auto bg-zinc-50 dark:bg-zinc-950'
    },
        React.createElement(DeviceInspector, {
            device: selected,
            status,
            statusError,
            liveLocked,
            via,
            files,
            pullPath,
            busy,
            onPullPathChange: setPullPath,
            onPullShow: handlePullShow,
            onReboot: handleReboot
        })
    );
    if (!railHost) {
        return main;
    }
    return React.createElement(React.Fragment, null,
        createPortal(rail, railHost),
        main
    );
};

module.exports = DevicesPanel;
