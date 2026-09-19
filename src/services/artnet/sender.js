const dgram = require('dgram');
const { createArtNetDmxPacket } = require('./utils');

class ArtNetSender {
    constructor() {
        this.socket = null;
    }

    async start(interfaceIp) {
        if (this.socket) {
            this.stop();
        }

        return new Promise((resolve, reject) => {
            try {
                this.socket = dgram.createSocket({ 
                    type: 'udp4',
                    reuseAddr: true 
                });

                this.socket.bind(0, interfaceIp, () => {
                    this.socket.setBroadcast(true);
                    resolve();
                });

                this.socket.on('error', (err) => {
                    console.error('Art-Net sender error:', err);
                });

            } catch (error) {
                console.error('Error setting up Art-Net sender:', error);
                reject(error);
            }
        });
    }

    async send(universe, dmxData, destIp) {
        if (!this.socket) {
            throw new Error('Art-Net sender not initialized');
        }

        const dest = typeof destIp === 'string' && destIp.trim()
            ? destIp.trim()
            : '255.255.255.255';

        return new Promise((resolve, reject) => {
            const packet = createArtNetDmxPacket(universe, dmxData);
            this.socket.send(packet, 6454, dest, (err) => {
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

module.exports = ArtNetSender;