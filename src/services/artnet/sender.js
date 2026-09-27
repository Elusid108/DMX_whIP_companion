const dgram = require('dgram');
const { createArtNetDmxPacket } = require('./utils');
const ownOutput = require('../shared/ownOutput');

class ArtNetSender {
    constructor() {
        this.socket = null;
        this.port = 0;
    }

    async start(interfaceIp) {
        if (this.socket) {
            this.stop();
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
            socket.bind(0, interfaceIp, () => {
                socket.removeListener('error', onError);
                socket.setBroadcast(true);
                resolve();
            });
        });

        socket.on('error', (err) => {
            console.error('Art-Net sender error:', err);
        });
        this.socket = socket;
        this.port = socket.address().port;
        ownOutput.addPort(this.port);
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
            ownOutput.removePort(this.port);
            this.socket.close();
            this.socket = null;
            this.port = 0;
        }
    }
}

module.exports = ArtNetSender;
