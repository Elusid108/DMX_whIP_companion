const { useEffect, useState } = require('react');
const ipcRenderer = require('../ipc');

// Detected whIP nodes (with their pixel patch once /status has been read).
// The main process only pushes updates while a view that wants them is open.
const useDevices = ({ enabled = true } = {}) => {
    const [devices, setDevices] = useState([]);

    useEffect(() => {
        if (!enabled) {
            return undefined;
        }
        let alive = true;
        const handleUpdate = (event, payload = {}) => {
            if (alive) {
                setDevices(Array.isArray(payload.devices) ? payload.devices : []);
            }
        };
        ipcRenderer.invoke('device-list')
            .then((payload) => handleUpdate(null, payload || {}))
            .catch(() => {});
        ipcRenderer.on('devices-update', handleUpdate);
        return () => {
            alive = false;
            ipcRenderer.removeListener('devices-update', handleUpdate);
        };
    }, [enabled]);

    return devices;
};

module.exports = useDevices;
