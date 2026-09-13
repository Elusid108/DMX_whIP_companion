const React = require('react');
const { useState, useEffect, useRef } = React;
const ipcRenderer = require('../../ipc');
const DeviceList = require('./DeviceList');
const DeviceInspector = require('./DeviceInspector');

const DevicesPanel = () => {
    const [devices, setDevices] = useState([]);
    const [nic, setNic] = useState({ name: '', ip: '' });
    const [selectedId, setSelectedId] = useState(null);
    const [status, setStatus] = useState(null);
    const [statusError, setStatusError] = useState('');
    const [identifying, setIdentifying] = useState(false);
    const selectedRef = useRef(null);

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
                setStatus(result.status);
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
                    devices,
                    selectedId,
                    onSelect: setSelectedId
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
                    onIdentify: handleIdentify
                })
            )
        )
    );
};

module.exports = DevicesPanel;
