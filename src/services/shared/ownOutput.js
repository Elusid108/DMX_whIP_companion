const os = require('os');

// Sources this app is sending from. Art-Net broadcast and sACN multicast
// loop back into our own receivers; those packets may show on the monitor
// but must never be recorded or fire a record trigger.

const cids = new Set();
const ports = new Set();
let localIps = new Set();
let localIpsAt = 0;
const LOCAL_IP_TTL_MS = 5000;

const refreshLocalIps = () => {
    const now = Date.now();
    if (now - localIpsAt < LOCAL_IP_TTL_MS) {
        return localIps;
    }
    localIpsAt = now;
    const next = new Set(['127.0.0.1']);
    for (const list of Object.values(os.networkInterfaces())) {
        for (const addr of list || []) {
            if (addr && addr.family === 'IPv4') {
                next.add(addr.address);
            }
        }
    }
    localIps = next;
    return localIps;
};

const cidKey = (cid) => (Buffer.isBuffer(cid) ? cid.toString('hex') : String(cid || '')).toLowerCase();

const addCid = (cid) => {
    cids.add(cidKey(cid));
};

const removeCid = (cid) => {
    cids.delete(cidKey(cid));
};

const addPort = (port) => {
    if (port) {
        ports.add(port);
    }
};

const removePort = (port) => {
    ports.delete(port);
};

const isOwn = ({ cid, sourceIp, sourcePort } = {}) => {
    if (cid && cids.has(cidKey(cid))) {
        return true;
    }
    if (!sourcePort || !ports.has(sourcePort)) {
        return false;
    }
    return refreshLocalIps().has(sourceIp);
};

module.exports = {
    addCid,
    removeCid,
    addPort,
    removePort,
    isOwn
};
