// Art-Net and sACN receive sockets over the udp port. Behaviour unchanged
// from the dgram classes: 1 MiB receive buffer, broadcast on; the sACN
// socket joins the E1.31 discovery universe and every second syncs its
// multicast membership to the universes advertised by complete discovery
// pages seen within 20 s.
const { parseArtNetPacket, createArtPollPacket } = require('./artnet/packet');
const { parseSacnPacket, getMulticastAddress, DISCOVERY_UNIVERSE } = require('./sacn/packet');
const { ARTNET_PORT, SACN_PORT } = require('./send');

const RECV_BUFFER = 1024 * 1024;
const DISCOVERY_TIMEOUT_MS = 20000;
const DISCOVERY_SWEEP_MS = 1000;

const bindAddress = (interfaceIp) => (interfaceIp ? interfaceIp : undefined);

// deps: { udp, log, port (listen and poll port, default 6454) }
const createArtNetReceiver = ({ udp, log, port } = {}) => {
    const listenPort = Number(port) || ARTNET_PORT;
    let socket = null;
    const callbacks = new Map();
    const pollReplyCallbacks = new Map();

    const stop = () => {
        if (socket) {
            socket.close();
            socket = null;
        }
    };

    const start = async (interfaceIp) => {
        if (socket) {
            stop();
        }
        let s;
        try {
            s = await udp.open({
                port: listenPort,
                address: bindAddress(interfaceIp),
                reuseAddr: true,
                broadcast: true,
                recvBufferSize: RECV_BUFFER
            });
        } catch (err) {
            log.error('Art-Net receiver bind failed:', err);
            throw err;
        }
        log.info(`Art-Net receiver listening on port ${listenPort}`);
        s.onError((err) => log.error('Art-Net receiver error:', err));
        s.onMessage((msg, rinfo) => {
            const data = parseArtNetPacket(msg, rinfo);
            if (!data) {
                return;
            }
            if (data.kind === 'pollReply') {
                pollReplyCallbacks.forEach((callback) => callback(data));
                return;
            }
            if (data.kind === 'dmx') {
                callbacks.forEach((callback) => callback(data));
            }
        });
        socket = s;
    };

    // dest: broadcast by default; a unicast IP for the unicast strategies.
    const sendPoll = (dest) => {
        if (!socket) {
            return false;
        }
        socket.send(createArtPollPacket(), listenPort, dest || '255.255.255.255').catch((err) => {
            log.error('ArtPoll send error:', err);
        });
        return true;
    };

    return {
        start,
        stop,
        sendPoll,
        onDmxData: (id, callback) => callbacks.set(id, callback),
        onPollReply: (id, callback) => pollReplyCallbacks.set(id, callback),
        removeCallback: (id) => {
            callbacks.delete(id);
            pollReplyCallbacks.delete(id);
        },
        isBound: () => Boolean(socket)
    };
};

const membershipIface = (interfaceIp) => (!interfaceIp || interfaceIp === '0.0.0.0' ? undefined : interfaceIp);

// deps: { udp, clock, scheduler, log, port (listen port, default 5568) }
const createSacnReceiver = ({ udp, clock, scheduler, log, port } = {}) => {
    const listenPort = Number(port) || SACN_PORT;
    let socket = null;
    let interfaceIp = null;
    const callbacks = new Map();
    const joinedUniverses = new Set();
    const discoverySources = new Map();
    let discoveryTimer = null;

    const joinUniverse = (universe) => {
        if (!socket || joinedUniverses.has(universe)) {
            return;
        }
        const address = getMulticastAddress(universe);
        try {
            socket.addMembership(address, membershipIface(interfaceIp));
            joinedUniverses.add(universe);
        } catch (err) {
            log.warn(`Failed to join sACN universe ${universe} (${address}):`, err.message);
        }
    };

    const leaveUniverse = (universe) => {
        if (!socket || universe === DISCOVERY_UNIVERSE || !joinedUniverses.has(universe)) {
            return;
        }
        const address = getMulticastAddress(universe);
        try {
            socket.dropMembership(address, membershipIface(interfaceIp));
        } catch (err) {
            log.warn(`Failed to leave sACN universe ${universe} (${address}):`, err.message);
        }
        joinedUniverses.delete(universe);
    };

    const advertisedUniverses = () => {
        const now = clock.now();
        const wanted = new Set();
        for (const [cid, source] of discoverySources) {
            if (now - source.lastSeen > DISCOVERY_TIMEOUT_MS) {
                discoverySources.delete(cid);
                continue;
            }
            let complete = true;
            for (let page = 0; page <= source.lastPage; page += 1) {
                if (!source.pages.has(page)) {
                    complete = false;
                    break;
                }
            }
            if (!complete) {
                continue;
            }
            for (const universes of source.pages.values()) {
                for (const universe of universes) {
                    if (universe >= 1 && universe <= 63999 && universe !== DISCOVERY_UNIVERSE) {
                        wanted.add(universe);
                    }
                }
            }
        }
        return wanted;
    };

    const syncMembership = () => {
        if (!socket) {
            return;
        }
        const wanted = advertisedUniverses();
        for (const universe of wanted) {
            if (!joinedUniverses.has(universe)) {
                joinUniverse(universe);
            }
        }
        for (const universe of [...joinedUniverses]) {
            if (universe !== DISCOVERY_UNIVERSE && !wanted.has(universe)) {
                leaveUniverse(universe);
            }
        }
    };

    const handleDiscovery = (parsed) => {
        const existing = discoverySources.get(parsed.cid) || {
            pages: new Map(),
            lastPage: parsed.lastPage,
            lastSeen: 0,
            sourceName: parsed.sourceName
        };
        existing.lastSeen = clock.now();
        existing.lastPage = parsed.lastPage;
        existing.sourceName = parsed.sourceName || existing.sourceName;
        existing.pages.set(parsed.page, parsed.universes);
        for (const page of existing.pages.keys()) {
            if (page > existing.lastPage) {
                existing.pages.delete(page);
            }
        }
        discoverySources.set(parsed.cid, existing);
        syncMembership();
    };

    const stop = () => {
        if (discoveryTimer) {
            scheduler.clearInterval(discoveryTimer);
            discoveryTimer = null;
        }
        if (socket) {
            socket.close();
            socket = null;
        }
        joinedUniverses.clear();
        discoverySources.clear();
    };

    const start = async (nic) => {
        if (socket) {
            stop();
        }
        interfaceIp = nic;
        let s;
        try {
            s = await udp.open({
                port: listenPort,
                address: bindAddress(nic),
                reuseAddr: true,
                broadcast: true,
                multicastTtl: 128,
                multicastLoopback: true,
                recvBufferSize: RECV_BUFFER
            });
        } catch (err) {
            log.error('sACN receiver bind failed:', err);
            throw err;
        }
        log.info(`sACN receiver listening on port ${listenPort}`);
        s.onError((err) => log.error('sACN receiver error:', err));
        s.onMessage((msg, rinfo) => {
            const data = parseSacnPacket(msg, rinfo);
            if (!data) {
                return;
            }
            if (data.type === 'discovery') {
                handleDiscovery(data);
                return;
            }
            callbacks.forEach((callback) => callback(data));
        });
        socket = s;
        joinUniverse(DISCOVERY_UNIVERSE);
        discoveryTimer = scheduler.setInterval(syncMembership, DISCOVERY_SWEEP_MS);
    };

    return {
        start,
        stop,
        onDmxData: (id, callback) => callbacks.set(id, callback),
        removeCallback: (id) => callbacks.delete(id),
        isBound: () => Boolean(socket),
        joinedUniverses
    };
};

module.exports = { createArtNetReceiver, createSacnReceiver, RECV_BUFFER, DISCOVERY_TIMEOUT_MS, DISCOVERY_SWEEP_MS };
