const dgram = require('dgram');
const {
    parseSacnPacket,
    getMulticastAddress,
    DISCOVERY_UNIVERSE
} = require('./utils');

const DISCOVERY_TIMEOUT_MS = 20000;
const DISCOVERY_SWEEP_MS = 1000;
const RECV_BUFFER = 1024 * 1024;

const membershipIface = (interfaceIp) => {
    if (!interfaceIp || interfaceIp === '0.0.0.0') {
        return undefined;
    }
    return interfaceIp;
};

class SacnReceiver {
    constructor() {
        this.socket = null;
        this.interfaceIp = null;
        this.universeData = new Map();
        this.callbacks = new Map();
        this.joinedUniverses = new Set();
        this.discoverySources = new Map();
        this.discoveryTimer = null;
    }

    async start(interfaceIp) {
        if (this.socket) {
            this.stop();
        }

        this.interfaceIp = interfaceIp;

        return new Promise((resolve, reject) => {
            try {
                this.socket = dgram.createSocket({
                    type: 'udp4',
                    reuseAddr: true,
                    ttl: 128
                });

                this.socket.on('listening', () => {
                    console.log('sACN receiver listening on port 5568');

                    try {
                        this.socket.setRecvBufferSize(RECV_BUFFER);
                    } catch (err) {
                        // OS may clamp the buffer
                    }

                    try {
                        this.socket.setBroadcast(true);
                        this.socket.setMulticastTTL(128);
                        this.socket.setMulticastLoopback(true);
                        this.joinUniverse(DISCOVERY_UNIVERSE);
                        this.discoveryTimer = setInterval(
                            () => this.syncMembership(),
                            DISCOVERY_SWEEP_MS
                        );
                        resolve();
                    } catch (err) {
                        console.error('Error configuring sACN socket:', err);
                        reject(err);
                    }
                });

                this.socket.on('message', (msg, rinfo) => {
                    const data = parseSacnPacket(msg, rinfo);
                    if (!data) {
                        return;
                    }

                    if (data.type === 'discovery') {
                        this.handleDiscovery(data);
                        return;
                    }

                    this.universeData.set(data.universe, {
                        ...data,
                        lastSeen: Date.now()
                    });

                    this.callbacks.forEach((callback) => callback(data));
                });

                this.socket.on('error', (err) => {
                    console.error('sACN receiver error:', err);
                });

                this.socket.bind(5568, interfaceIp);
            } catch (error) {
                console.error('Error setting up sACN receiver:', error);
                reject(error);
            }
        });
    }

    handleDiscovery(parsed) {
        const existing = this.discoverySources.get(parsed.cid) || {
            pages: new Map(),
            lastPage: parsed.lastPage,
            lastSeen: 0,
            sourceName: parsed.sourceName
        };

        existing.lastSeen = Date.now();
        existing.lastPage = parsed.lastPage;
        existing.sourceName = parsed.sourceName || existing.sourceName;
        existing.pages.set(parsed.page, parsed.universes);

        for (const page of existing.pages.keys()) {
            if (page > existing.lastPage) {
                existing.pages.delete(page);
            }
        }

        this.discoverySources.set(parsed.cid, existing);
        this.syncMembership();
    }

    advertisedUniverses() {
        const now = Date.now();
        const wanted = new Set();

        for (const [cid, source] of this.discoverySources) {
            if (now - source.lastSeen > DISCOVERY_TIMEOUT_MS) {
                this.discoverySources.delete(cid);
                continue;
            }

            let complete = true;
            for (let page = 0; page <= source.lastPage; page++) {
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
    }

    syncMembership() {
        if (!this.socket) {
            return;
        }

        const wanted = this.advertisedUniverses();
        for (const universe of wanted) {
            if (!this.joinedUniverses.has(universe)) {
                this.joinUniverse(universe);
            }
        }
        for (const universe of [...this.joinedUniverses]) {
            if (universe !== DISCOVERY_UNIVERSE && !wanted.has(universe)) {
                this.leaveUniverse(universe);
            }
        }
    }

    joinUniverse(universe) {
        if (!this.socket || this.joinedUniverses.has(universe)) {
            return;
        }

        const address = getMulticastAddress(universe);
        const iface = membershipIface(this.interfaceIp);

        try {
            if (iface) {
                this.socket.addMembership(address, iface);
            } else {
                this.socket.addMembership(address);
            }
            this.joinedUniverses.add(universe);
        } catch (err) {
            console.warn(`Failed to join sACN universe ${universe} (${address}):`, err.message);
        }
    }

    leaveUniverse(universe) {
        if (!this.socket || universe === DISCOVERY_UNIVERSE || !this.joinedUniverses.has(universe)) {
            return;
        }

        const address = getMulticastAddress(universe);
        const iface = membershipIface(this.interfaceIp);

        try {
            if (iface) {
                this.socket.dropMembership(address, iface);
            } else {
                this.socket.dropMembership(address);
            }
        } catch (err) {
            console.warn(`Failed to leave sACN universe ${universe} (${address}):`, err.message);
        }

        this.joinedUniverses.delete(universe);
    }

    stop() {
        if (this.discoveryTimer) {
            clearInterval(this.discoveryTimer);
            this.discoveryTimer = null;
        }
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
        this.joinedUniverses.clear();
        this.discoverySources.clear();
        this.universeData.clear();
    }

    onDmxData(id, callback) {
        this.callbacks.set(id, callback);
    }

    removeCallback(id) {
        this.callbacks.delete(id);
    }

    getUniverseData() {
        return Array.from(this.universeData.values());
    }
}

module.exports = SacnReceiver;
