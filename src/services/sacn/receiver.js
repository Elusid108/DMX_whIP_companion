const dgram = require('dgram');
const { parseSacnPacket, getMulticastAddress } = require('./utils');

class SacnReceiver {
    constructor() {
        this.socket = null;
        this.universeData = new Map();
        this.callbacks = new Map();
    }

    async start(interfaceIp) {
        if (this.socket) {
            this.stop();
        }

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
                        this.socket.setBroadcast(true);
                        this.socket.setMulticastTTL(128);
                        
                        // Join multicast groups for all potential universes
                        for (let universe = 1; universe <= 64; universe++) {
                            try {
                                const multicastAddress = getMulticastAddress(universe);
                                this.socket.addMembership(multicastAddress, interfaceIp);
                                console.log(`Joined multicast group: ${multicastAddress}`);
                            } catch (err) {
                                console.warn(`Failed to join multicast group for universe ${universe}:`, err.message);
                            }
                        }
                        
                        resolve();
                    } catch (err) {
                        console.error('Error configuring sACN socket:', err);
                        reject(err);
                    }
                });

                this.socket.on('message', (msg, rinfo) => {
                    const data = parseSacnPacket(msg, rinfo);
                    if (data) {
                        this.universeData.set(data.universe, {
                            ...data,
                            lastSeen: Date.now()
                        });

                        // Notify all callbacks
                        this.callbacks.forEach(callback => callback(data));
                    }
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

    removeCallback(id) {
        this.callbacks.delete(id);
    }

    getUniverseData() {
        return Array.from(this.universeData.values());
    }
}

module.exports = SacnReceiver;