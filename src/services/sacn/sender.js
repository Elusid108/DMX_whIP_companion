const dgram = require('dgram');
const { createSacnDmxPacket, createSacnDiscoveryPacket } = require('./utils');
const crypto = require('crypto');

class SacnSender {
    constructor(options = {}) {
        this.socket = null;
        this.cid = options.cid || crypto.randomBytes(16);
        this.sourceName = options.sourceName || 'DMX Monitor';
        this.interfaceIp = null;
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

                this.socket.bind(0, interfaceIp, () => {
                    this.socket.setBroadcast(true);
                    this.socket.setMulticastTTL(128);
                    this.socket.setMulticastLoopback(true);
                    if (interfaceIp && interfaceIp !== '0.0.0.0') {
                        try {
                            this.socket.setMulticastInterface(interfaceIp);
                        } catch (err) {
                            console.warn('Could not set multicast interface:', err.message);
                        }
                    }
                    resolve();
                });

                this.socket.on('error', (err) => {
                    console.error('sACN sender error:', err);
                });

            } catch (error) {
                console.error('Error setting up sACN sender:', error);
                reject(error);
            }
        });
    }

    async send(universe, dmxData, options = {}) {
        if (!this.socket) {
            throw new Error('sACN sender not initialized');
        }

        return new Promise((resolve, reject) => {
            const { packet, multicastAddress } = createSacnDmxPacket(universe, dmxData, {
                ...options,
                cid: this.cid,
                sourceName: this.sourceName
            });

            this.socket.send(packet, 5568, multicastAddress, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    async sendDiscovery(universes, options = {}) {
        if (!this.socket) {
            throw new Error('sACN sender not initialized');
        }

        return new Promise((resolve, reject) => {
            const { packet, multicastAddress } = createSacnDiscoveryPacket(universes, {
                ...options,
                cid: this.cid,
                sourceName: this.sourceName
            });

            this.socket.send(packet, 5568, multicastAddress, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    stop() {
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
    }
}

module.exports = SacnSender;