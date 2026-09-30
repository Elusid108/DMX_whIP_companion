const dgram = require('dgram');
const { parseArtNetPacket, createArtPollPacket } = require('./utils');

const RECV_BUFFER = 1024 * 1024;

const ARTNET_PORT = 6454;

class ArtNetReceiver {
    // options.port: listen and poll port (default 6454; tests use others).
    constructor(options = {}) {
        this.port = Number(options.port) || ARTNET_PORT;
        this.socket = null;
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

                const onBindError = (err) => {
                    console.error('Art-Net receiver bind failed:', err);
                    this.stop();
                    reject(err);
                };
                this.socket.once('error', onBindError);

                this.socket.on('listening', () => {
                    this.socket.removeListener('error', onBindError);
                    console.log(`Art-Net receiver listening on port ${this.port}`);
                    try {
                        this.socket.setRecvBufferSize(RECV_BUFFER);
                    } catch (err) {
                        // OS may clamp the buffer
                    }
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
                    this.callbacks.forEach((callback) => callback(data));
                });

                this.socket.on('error', (err) => {
                    console.error('Art-Net receiver error:', err);
                });

                this.socket.bind(this.port, interfaceIp);
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
        this.socket.send(packet, this.port, '255.255.255.255', (err) => {
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
}

module.exports = ArtNetReceiver;
module.exports.ARTNET_PORT = ARTNET_PORT;
