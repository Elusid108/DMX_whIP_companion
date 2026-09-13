const dgram = require('dgram');
const { parseArtNetPacket, createArtPollPacket } = require('./utils');

class ArtNetReceiver {
    constructor() {
        this.socket = null;
        this.universeData = new Map();
        this.callbacks = new Map();
        this.pollReplyCallbacks = new Map();
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

                this.socket.on('listening', () => {
                    console.log('Art-Net receiver listening on port 6454');
                    this.socket.setBroadcast(true);
                    resolve();
                });

                this.socket.on('message', (msg, rinfo) => {
                    const data = parseArtNetPacket(msg, rinfo);
                    if (!data) {
                        return;
                    }
                    if (data.kind === 'pollReply') {
                        this.pollReplyCallbacks.forEach((callback) => callback(data));
                        return;
                    }
                    if (data.kind !== 'dmx') {
                        return;
                    }
                    this.universeData.set(data.universe, {
                        ...data,
                        lastSeen: Date.now()
                    });
                    this.callbacks.forEach((callback) => callback(data));
                });

                this.socket.on('error', (err) => {
                    console.error('Art-Net receiver error:', err);
                });

                this.socket.bind(6454, interfaceIp);
            } catch (error) {
                console.error('Error setting up Art-Net receiver:', error);
                reject(error);
            }
        });
    }

    sendPoll() {
        if (!this.socket) {
            return;
        }
        const packet = createArtPollPacket();
        this.socket.send(packet, 6454, '255.255.255.255', (err) => {
            if (err) {
                console.error('ArtPoll send error:', err);
            }
        });
    }

    stop() {
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
        this.universeData.clear();
    }

    onDmxData(id, callback) {
        this.callbacks.set(id, callback);
    }

    onPollReply(id, callback) {
        this.pollReplyCallbacks.set(id, callback);
    }

    removeCallback(id) {
        this.callbacks.delete(id);
        this.pollReplyCallbacks.delete(id);
    }

    getUniverseData() {
        return Array.from(this.universeData.values());
    }
}

module.exports = ArtNetReceiver;
