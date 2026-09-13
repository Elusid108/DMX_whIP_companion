const ARTNET_ID = 'Art-Net\0';
const OP_POLL = 0x2000;
const OP_POLL_REPLY = 0x2100;
const OP_DMX = 0x5000;
const POLL_REPLY_LEN = 239;

const createArtNetDmxPacket = (universe, dmxData) => {
    const packet = Buffer.alloc(18 + dmxData.length);

    packet.write(ARTNET_ID, 0);
    packet.writeUInt16LE(OP_DMX, 8);
    packet.writeUInt16LE(14, 10);
    packet.writeUInt8(0, 12);
    packet.writeUInt8(0, 13);
    packet.writeUInt16LE(universe, 14);
    packet.writeUInt16BE(dmxData.length, 16);

    Buffer.from(dmxData).copy(packet, 18);

    return packet;
};

const createArtPollPacket = () => {
    const packet = Buffer.alloc(14);
    packet.write(ARTNET_ID, 0);
    packet.writeUInt16LE(OP_POLL, 8);
    packet.writeUInt16LE(14, 10);
    packet.writeUInt8(0, 12);
    packet.writeUInt8(0, 13);
    return packet;
};

const artNetString = (msg, start, length) => {
    const end = Math.min(start + length, msg.length);
    let text = msg.toString('ascii', start, end);
    const z = text.indexOf('\0');
    if (z >= 0) {
        text = text.slice(0, z);
    }
    return text.replace(/\s+$/g, '');
};

const formatMac = (bytes) => {
    if (!bytes || bytes.length < 6) {
        return '';
    }
    return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(':');
};

const formatIp = (bytes) => {
    if (!bytes || bytes.length < 4) {
        return '';
    }
    return `${bytes[0]}.${bytes[1]}.${bytes[2]}.${bytes[3]}`;
};

const parseArtPollReply = (msg, rinfo) => {
    if (!msg || msg.length < POLL_REPLY_LEN) {
        return null;
    }
    if (msg.toString('utf8', 0, 8) !== ARTNET_ID) {
        return null;
    }
    if (msg.readUInt16LE(8) !== OP_POLL_REPLY) {
        return null;
    }

    const numPorts = msg[173] || 0;
    const universes = [];
    const portCount = Math.min(numPorts || 1, 4);
    for (let i = 0; i < portCount; i += 1) {
        universes.push(msg[190 + i]);
    }

    const ip = formatIp(msg.slice(10, 14)) || (rinfo && rinfo.address) || '';
    const mac = formatMac(msg.slice(201, 207));

    return {
        ip,
        sourceIp: rinfo && rinfo.address,
        port: msg.readUInt16LE(14),
        shortName: artNetString(msg, 26, 18),
        longName: artNetString(msg, 44, 64),
        numPorts,
        universe: universes[0] ?? 0,
        universes,
        mac,
        bindIp: formatIp(msg.slice(207, 211)),
        bindIndex: msg[211]
    };
};

const parseArtNetPacket = (msg, rinfo) => {
    if (msg.length > 10 && msg.toString('utf8', 0, 8) === ARTNET_ID) {
        const opcode = msg.readUInt16LE(8);
        if (opcode === OP_DMX) {
            const universe = msg.readUInt16LE(14);
            const length = msg.readUInt16BE(16);
            const dmxData = Array.from(msg.slice(18, 18 + length));
            return {
                kind: 'dmx',
                universe,
                dmxData,
                sourceIp: rinfo.address,
                protocol: 'artnet'
            };
        }
        if (opcode === OP_POLL_REPLY) {
            const reply = parseArtPollReply(msg, rinfo);
            if (reply) {
                return { kind: 'pollReply', ...reply };
            }
        }
    }
    return null;
};

module.exports = {
    createArtNetDmxPacket,
    createArtPollPacket,
    parseArtNetPacket,
    parseArtPollReply
};
