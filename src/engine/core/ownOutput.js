// Sources this engine is sending from. Art-Net broadcast and sACN multicast
// loop back into our own receivers; those packets may show on the monitor
// but must never be recorded or fire a record trigger. One instance per
// engine (two engines in one process see each other's packets as foreign).
const { hex } = require('./bytes');

const LOCAL_IP_TTL_MS = 5000;

const cidKey = (cid) => (cid instanceof Uint8Array ? hex(cid) : String(cid || '')).toLowerCase();

// deps: { localIps(): Set<string>, now(): ms }
const createOwnOutput = ({ localIps, now }) => {
    const cids = new Set();
    const ports = new Set();
    let cached = new Set();
    let cachedAt = -Infinity;

    const refreshLocalIps = () => {
        const t = now();
        if (t - cachedAt < LOCAL_IP_TTL_MS) {
            return cached;
        }
        cachedAt = t;
        cached = localIps();
        return cached;
    };

    return {
        addCid: (cid) => {
            cids.add(cidKey(cid));
        },
        removeCid: (cid) => {
            cids.delete(cidKey(cid));
        },
        addPort: (port) => {
            if (port) {
                ports.add(port);
            }
        },
        removePort: (port) => {
            ports.delete(port);
        },
        isOwn: ({ cid, sourceIp, sourcePort } = {}) => {
            if (cid && cids.has(cidKey(cid))) {
                return true;
            }
            if (!sourcePort || !ports.has(sourcePort)) {
                return false;
            }
            return refreshLocalIps().has(sourceIp);
        }
    };
};

module.exports = { createOwnOutput, cidKey };
