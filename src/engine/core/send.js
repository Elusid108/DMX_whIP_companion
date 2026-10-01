// Art-Net and sACN senders over the udp port. Same behaviour as the dgram
// classes they replace: an ephemeral socket per sender, broadcast on,
// ownOutput told about the bound port (and the sACN CID), one E1.31
// sequence per universe, discovery pages on request.
const { createArtNetDmxPacket } = require('./artnet/packet');
const {
    SACN_DMX_LEN,
    createSacnDiscoveryPacket,
    getMulticastAddress,
    initSacnDmxPacket,
    writeSacnDmx
} = require('./sacn/packet');

const ARTNET_PORT = 6454;
const SACN_PORT = 5568;

// deps: { udp, ownOutput, log, port (destination, default 6454) }
const createArtNetSender = ({ udp, ownOutput, log, port } = {}) => {
    const destPort = Number(port) || ARTNET_PORT;
    let socket = null;

    const stop = () => {
        if (socket) {
            ownOutput.removePort(socket.port);
            socket.close();
            socket = null;
        }
    };

    const start = async (interfaceIp) => {
        if (socket) {
            stop();
        }
        const s = await udp.open({
            port: 0,
            address: interfaceIp && interfaceIp !== '0.0.0.0' ? interfaceIp : undefined,
            reuseAddr: true,
            broadcast: true
        });
        s.onError((err) => log.error('Art-Net sender error:', err));
        socket = s;
        ownOutput.addPort(s.port);
    };

    const send = async (universe, dmxData, destIp) => {
        if (!socket) {
            throw new Error('Art-Net sender not initialized');
        }
        const dest = typeof destIp === 'string' && destIp.trim() ? destIp.trim() : '255.255.255.255';
        return socket.send(createArtNetDmxPacket(universe, dmxData), destPort, dest);
    };

    return {
        start,
        send,
        stop,
        get port() {
            return socket ? socket.port : 0;
        }
    };
};

// deps: { udp, ownOutput, log, cid (16 bytes), sourceName, priority, iface,
//         port (destination, default 5568) }
const createSacnOutput = ({ udp, ownOutput, log, cid, sourceName, priority, iface, port } = {}) => {
    if (!(cid instanceof Uint8Array) || cid.length < 16) {
        throw new Error('sACN output needs a 16-byte CID');
    }
    const name = sourceName || 'DMX whIP Companion';
    const prio = priority || 100;
    const bindIface = iface && iface !== '0.0.0.0' ? iface : undefined;
    const destPort = Number(port) || SACN_PORT;
    let socket = null;
    const universes = new Map();

    const close = () => {
        universes.clear();
        if (socket) {
            ownOutput.removePort(socket.port);
            socket.close();
            socket = null;
        }
        ownOutput.removeCid(cid);
    };

    const start = async () => {
        if (socket) {
            close();
        }
        const s = await udp.open({
            port: 0,
            address: bindIface,
            reuseAddr: true,
            broadcast: true,
            multicastTtl: 128,
            multicastLoopback: true,
            multicastInterface: bindIface
        });
        s.onError((err) => log.error('sACN output error:', err));
        socket = s;
        ownOutput.addCid(cid);
        ownOutput.addPort(s.port);
    };

    const universeState = (universe) => {
        let state = universes.get(universe);
        if (!state) {
            state = {
                sequence: 0,
                multicast: getMulticastAddress(universe),
                packet: initSacnDmxPacket(new Uint8Array(SACN_DMX_LEN), { cid, sourceName: name, priority: prio })
            };
            universes.set(universe, state);
        }
        return state;
    };

    // options: E1.31 framing options (0x40 stream terminated).
    const send = (universe, dmxData, destIp, options = 0) => {
        if (!socket) {
            return;
        }
        const state = universeState(universe);
        state.sequence = (state.sequence + 1) & 0xff;
        const unicast = typeof destIp === 'string' && destIp.trim();
        // Each packet is its own copy: the socket may still hold the last one.
        const packet = Uint8Array.from(writeSacnDmx(state.packet, universe, state.sequence, dmxData, options));
        socket.send(packet, destPort, unicast ? destIp.trim() : state.multicast).catch((err) => {
            log.error('sACN send error:', err);
        });
    };

    const sendDiscovery = (list) => {
        if (!socket) {
            return Promise.reject(new Error('sACN output is not started'));
        }
        const { packet, multicastAddress } = createSacnDiscoveryPacket(list, { cid, sourceName: name });
        return socket.send(packet, destPort, multicastAddress);
    };

    return { start, send, sendDiscovery, close, cid };
};

module.exports = { createArtNetSender, createSacnOutput, ARTNET_PORT, SACN_PORT };
