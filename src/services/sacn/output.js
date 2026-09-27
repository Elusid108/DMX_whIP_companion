const crypto = require('crypto');
const dgram = require('dgram');
const {
    SACN_DMX_LEN,
    createSacnDiscoveryPacket,
    getMulticastAddress,
    initSacnDmxPacket,
    writeSacnDmx
} = require('./utils');
const ownOutput = require('../shared/ownOutput');

// One socket for every universe (multicast and unicast). Each universe keeps
// its own reusable packet buffer and E1.31 sequence number.
class SacnOutput {
    constructor(options = {}) {
        this.sourceName = options.sourceName || 'DMX whIP Companion';
        this.cid = options.cid || crypto.randomBytes(16);
        this.priority = options.priority || 100;
        this.iface = options.iface && options.iface !== '0.0.0.0' ? options.iface : undefined;
        this.socket = null;
        this.universes = new Map();
    }

    async start() {
        if (this.socket) {
            this.close();
        }

        const socket = dgram.createSocket({
            type: 'udp4',
            reuseAddr: true
        });

        await new Promise((resolve, reject) => {
            const onError = (err) => {
                try {
                    socket.close();
                } catch (closeErr) {
                    // already closed
                }
                reject(err);
            };
            socket.once('error', onError);
            socket.bind(0, this.iface, () => {
                socket.removeListener('error', onError);
                try {
                    socket.setBroadcast(true);
                    socket.setMulticastTTL(128);
                    socket.setMulticastLoopback(true);
                    if (this.iface) {
                        socket.setMulticastInterface(this.iface);
                    }
                } catch (err) {
                    console.warn('Could not configure sACN output socket:', err.message);
                }
                resolve();
            });
        });

        socket.on('error', (err) => {
            console.error('sACN output error:', err);
        });
        this.socket = socket;
        ownOutput.addCid(this.cid);
        ownOutput.addPort(socket.address().port);
    }

    universeState(universe) {
        let state = this.universes.get(universe);
        if (!state) {
            state = {
                sequence: 0,
                multicast: getMulticastAddress(universe),
                packet: initSacnDmxPacket(Buffer.alloc(SACN_DMX_LEN), {
                    cid: this.cid,
                    sourceName: this.sourceName,
                    priority: this.priority
                })
            };
            this.universes.set(universe, state);
        }
        return state;
    }

    send(universe, dmxData, destIp) {
        if (!this.socket) {
            return;
        }
        const state = this.universeState(universe);
        state.sequence = (state.sequence + 1) & 0xff;
        const unicast = typeof destIp === 'string' && destIp.trim();
        // Each packet is its own copy: dgram may still hold the previous one.
        const packet = Buffer.from(writeSacnDmx(state.packet, universe, state.sequence, dmxData));
        this.socket.send(packet, 5568, unicast ? destIp.trim() : state.multicast, (err) => {
            if (err) {
                console.error('sACN send error:', err);
            }
        });
    }

    sendDiscovery(universes) {
        if (!this.socket) {
            return Promise.reject(new Error('sACN output is not started'));
        }

        return new Promise((resolve, reject) => {
            const { packet, multicastAddress } = createSacnDiscoveryPacket(universes, {
                cid: this.cid,
                sourceName: this.sourceName
            });
            this.socket.send(packet, 5568, multicastAddress, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    close() {
        this.universes.clear();
        if (this.socket) {
            try {
                ownOutput.removePort(this.socket.address().port);
            } catch (err) {
                // not bound
            }
            try {
                this.socket.close();
            } catch (err) {
                console.warn('Error closing sACN output socket:', err.message);
            }
            this.socket = null;
        }
        ownOutput.removeCid(this.cid);
    }
}

module.exports = {
    SacnOutput
};
