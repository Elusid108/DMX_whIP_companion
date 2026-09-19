const crypto = require('crypto');
const dgram = require('dgram');
const { Sender } = require('sacn');
const { createSacnDiscoveryPacket, createSacnDmxPacket } = require('./utils');

const dmxToPayload = (dmxData) => {
    const payload = {};
    const length = dmxData ? Math.min(512, dmxData.length) : 0;
    for (let i = 0; i < 512; i++) {
        payload[i + 1] = i < length ? (Number(dmxData[i]) || 0) : 0;
    }
    return payload;
};

class SacnOutput {
    constructor(options = {}) {
        this.sourceName = options.sourceName || 'DMX whIP Companion';
        this.cid = options.cid || crypto.randomBytes(16);
        this.priority = options.priority || 100;
        this.iface = options.iface && options.iface !== '0.0.0.0' ? options.iface : undefined;
        this.senders = new Map();
        this.discoverySocket = null;
    }

    async start() {
        if (this.discoverySocket) {
            this.close();
        }

        this.discoverySocket = dgram.createSocket({
            type: 'udp4',
            reuseAddr: true
        });

        await new Promise((resolve, reject) => {
            const onError = (err) => reject(err);
            this.discoverySocket.once('error', onError);
            this.discoverySocket.bind(0, this.iface, () => {
                this.discoverySocket.removeListener('error', onError);
                try {
                    this.discoverySocket.setBroadcast(true);
                    this.discoverySocket.setMulticastTTL(128);
                    this.discoverySocket.setMulticastLoopback(true);
                    if (this.iface) {
                        this.discoverySocket.setMulticastInterface(this.iface);
                    }
                } catch (err) {
                    console.warn('Could not configure sACN discovery socket:', err.message);
                }
                resolve();
            });
        });
    }

    ensureSender(universe) {
        if (this.senders.has(universe)) {
            return this.senders.get(universe);
        }

        const sender = new Sender({
            universe,
            reuseAddr: true,
            iface: this.iface,
            defaultPacketOptions: {
                cid: this.cid,
                sourceName: this.sourceName,
                priority: this.priority,
                useRawDmxValues: true
            }
        });
        this.senders.set(universe, sender);
        return sender;
    }

    async ready() {
        await new Promise((resolve) => setTimeout(resolve, 75));
    }

    send(universe, dmxData, destIp) {
        if (typeof destIp === 'string' && destIp.trim() && this.discoverySocket) {
            try {
                const { packet } = createSacnDmxPacket(universe, dmxData, {
                    cid: this.cid,
                    sourceName: this.sourceName,
                    priority: this.priority
                });
                this.discoverySocket.send(packet, 5568, destIp.trim(), (err) => {
                    if (err) {
                        console.error('sACN unicast send error:', err);
                    }
                });
            } catch (err) {
                console.error('sACN unicast send error:', err);
            }
            return;
        }
        const sender = this.ensureSender(universe);
        sender.send({
            payload: dmxToPayload(dmxData),
            useRawDmxValues: true
        }).catch((err) => {
            console.error('sACN send error:', err);
        });
    }

    sendDiscovery(universes) {
        if (!this.discoverySocket) {
            return Promise.reject(new Error('sACN output is not started'));
        }

        return new Promise((resolve, reject) => {
            const { packet, multicastAddress } = createSacnDiscoveryPacket(universes, {
                cid: this.cid,
                sourceName: this.sourceName
            });
            this.discoverySocket.send(packet, 5568, multicastAddress, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    close() {
        for (const sender of this.senders.values()) {
            try {
                sender.close();
            } catch (err) {
                console.warn('Error closing sACN sender:', err.message);
            }
        }
        this.senders.clear();

        if (this.discoverySocket) {
            try {
                this.discoverySocket.close();
            } catch (err) {
                console.warn('Error closing sACN discovery socket:', err.message);
            }
            this.discoverySocket = null;
        }
    }
}

module.exports = {
    SacnOutput,
    dmxToPayload
};
