// Art-Net packet encode and decode (ArtDmx, ArtPoll, ArtPollReply). Pure:
// Uint8Array in and out, no sockets. Byte layout unchanged from the Buffer
// code it replaces (src/services/artnet/utils.js is now a shim over this).
const { readU16LE, readU16BE, writeU16LE, writeU16BE, writeLatin1, ascii, startsWith } = require('../bytes');

const ARTNET_ID = 'Art-Net\0';
const OP_POLL = 0x2000;
const OP_POLL_REPLY = 0x2100;
const OP_DMX = 0x5000;
const POLL_REPLY_LEN = 239;

const createArtNetDmxPacket = (universe, dmxData) => {
    const n = dmxData ? dmxData.length : 0;
    const packet = new Uint8Array(18 + n);
    writeLatin1(packet, ARTNET_ID, 0);
    writeU16LE(packet, OP_DMX, 8);
    writeU16LE(packet, 14, 10);
    packet[12] = 0;
    packet[13] = 0;
    writeU16LE(packet, universe, 14);
    writeU16BE(packet, n, 16);
    for (let i = 0; i < n; i += 1) {
        packet[18 + i] = dmxData[i] || 0;
    }
    return packet;
};

const createArtPollPacket = () => {
    const packet = new Uint8Array(14);
    writeLatin1(packet, ARTNET_ID, 0);
    writeU16LE(packet, OP_POLL, 8);
    writeU16LE(packet, 14, 10);
    packet[12] = 0;
    packet[13] = 0;
    return packet;
};

const artNetString = (msg, start, length) => {
    let text = ascii(msg, start, Math.min(start + length, msg.length));
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
    if (!startsWith(msg, ARTNET_ID)) {
        return null;
    }
    if (readU16LE(msg, 8) !== OP_POLL_REPLY) {
        return null;
    }

    const numPorts = msg[173] || 0;
    const universes = [];
    const portCount = Math.min(numPorts || 1, 4);
    for (let i = 0; i < portCount; i += 1) {
        universes.push(msg[190 + i]);
    }

    const ip = formatIp(msg.subarray(10, 14)) || (rinfo && rinfo.address) || '';
    const mac = formatMac(msg.subarray(201, 207));
    const oem = (msg[20] << 8) | msg[21];
    const esta = msg[24] | (msg[25] << 8);

    return {
        ip,
        sourceIp: rinfo && rinfo.address,
        port: readU16LE(msg, 14),
        shortName: artNetString(msg, 26, 18),
        longName: artNetString(msg, 44, 64),
        nodeReport: artNetString(msg, 108, 64),
        numPorts,
        universe: universes[0] ?? 0,
        universes,
        mac,
        oem,
        esta,
        style: msg[200],
        portType: msg[174],
        status1: msg[23],
        bindIp: formatIp(msg.subarray(207, 211)),
        bindIndex: msg[211]
    };
};

const parseArtNetPacket = (msg, rinfo) => {
    if (msg && msg.length > 10 && startsWith(msg, ARTNET_ID)) {
        const opcode = readU16LE(msg, 8);
        if (opcode === OP_DMX) {
            const universe = readU16LE(msg, 14);
            const length = Math.min(readU16BE(msg, 16), msg.length - 18, 512);
            // A view, not a copy: the socket hands each message its own bytes.
            const dmxData = msg.subarray(18, 18 + Math.max(0, length));
            return {
                kind: 'dmx',
                universe,
                dmxData,
                sourceIp: rinfo.address,
                sourcePort: rinfo.port,
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
    ARTNET_ID,
    OP_POLL,
    OP_POLL_REPLY,
    OP_DMX,
    POLL_REPLY_LEN,
    createArtNetDmxPacket,
    createArtPollPacket,
    parseArtNetPacket,
    parseArtPollReply
};
