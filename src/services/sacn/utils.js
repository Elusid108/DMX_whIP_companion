const crypto = require('crypto');

const DISCOVERY_UNIVERSE = 64214;
const VECTOR_ROOT_E131_DATA = 4;
const VECTOR_ROOT_E131_EXTENDED = 8;
const VECTOR_E131_EXTENDED_DISCOVERY = 2;
const VECTOR_UNIVERSE_DISCOVERY_UNIVERSE_LIST = 1;

const getMulticastAddress = (universe) => {
    const low = universe % 256;
    const high = Math.floor(universe / 256);
    return `239.255.${high}.${low}`;
};

const isAcnPacket = (msg) => {
    return msg &&
        msg.length >= 38 &&
        msg[0] === 0x00 &&
        msg[1] === 0x10 &&
        msg[4] === 0x41 &&
        msg[5] === 0x53 &&
        msg[6] === 0x43 &&
        msg[7] === 0x2d &&
        msg[8] === 0x45 &&
        msg[9] === 0x31 &&
        msg[10] === 0x2e &&
        msg[11] === 0x31 &&
        msg[12] === 0x37;
};

const readSourceName = (msg) => {
    let sourceName = '';
    const end = Math.min(108, msg.length);
    for (let i = 44; i < end; i++) {
        if (msg[i] === 0) break;
        sourceName += String.fromCharCode(msg[i]);
    }
    return sourceName.trim();
};

const flagsAndLength = (pduLength) => 0x7000 | (pduLength & 0x0fff);

const createSacnDmxPacket = (universe, dmxData, options = {}) => {
    const multicastAddress = getMulticastAddress(universe);
    const sourceName = options.sourceName || 'DMX whIP Companion';
    const priority = options.priority || 100;
    const CID = options.cid || crypto.randomBytes(16);

    try {
        const normalizedData = new Uint8Array(512).fill(0);
        dmxData.forEach((value, index) => {
            if (index < 512) normalizedData[index] = value;
        });

        const packet = Buffer.alloc(638);

        packet[0] = 0x00;
        packet[1] = 0x10;
        packet.write('ASC-E1.17\0\0\0', 4);
        packet.writeUInt16BE(flagsAndLength(packet.length - 16), 16);
        packet.writeUInt32BE(VECTOR_ROOT_E131_DATA, 18);
        Buffer.from(CID).copy(packet, 22, 0, 16);

        packet.writeUInt16BE(flagsAndLength(packet.length - 38), 38);
        packet.writeUInt32BE(2, 40);
        packet.write(sourceName.padEnd(64, '\0').slice(0, 64), 44);
        packet[108] = priority;
        packet[113] = (universe >> 8) & 0xFF;
        packet[114] = universe & 0xFF;
        packet[115] = 0x00;
        packet[116] = 0x02;
        packet[117] = 0x02;
        packet[118] = 0xa1;
        packet[119] = 0x00;
        packet[124] = (normalizedData.length >> 8) & 0xFF;
        packet[125] = normalizedData.length & 0xFF;
        Buffer.from(normalizedData).copy(packet, 126);

        return {
            packet,
            multicastAddress
        };
    } catch (error) {
        console.error('Error creating sACN packet:', error);
        throw error;
    }
};

const createSacnDiscoveryPacket = (universes, options = {}) => {
    const cid = options.cid || crypto.randomBytes(16);
    const sourceName = (options.sourceName || 'DMX whIP Companion').padEnd(64, '\0').slice(0, 64);
    const page = options.page || 0;
    const lastPage = options.lastPage || 0;

    const sorted = [...new Set((universes || []).filter((u) => u >= 1 && u <= 63999))]
        .sort((a, b) => a - b);
    const pageUniverses = sorted.slice(page * 512, (page + 1) * 512);
    const packet = Buffer.alloc(120 + pageUniverses.length * 2);

    packet.writeUInt16BE(0x0010, 0);
    packet.writeUInt16BE(0x0000, 2);
    packet.write('ASC-E1.17\0\0\0', 4);
    packet.writeUInt16BE(flagsAndLength(packet.length - 16), 16);
    packet.writeUInt32BE(VECTOR_ROOT_E131_EXTENDED, 18);
    Buffer.from(cid).copy(packet, 22, 0, 16);

    packet.writeUInt16BE(flagsAndLength(packet.length - 38), 38);
    packet.writeUInt32BE(VECTOR_E131_EXTENDED_DISCOVERY, 40);
    packet.write(sourceName, 44);

    packet.writeUInt16BE(flagsAndLength(packet.length - 112), 112);
    packet.writeUInt32BE(VECTOR_UNIVERSE_DISCOVERY_UNIVERSE_LIST, 114);
    packet[118] = page;
    packet[119] = lastPage;

    for (let i = 0; i < pageUniverses.length; i++) {
        packet.writeUInt16BE(pageUniverses[i], 120 + i * 2);
    }

    return {
        packet,
        multicastAddress: getMulticastAddress(DISCOVERY_UNIVERSE)
    };
};

const parseDiscoveryPacket = (msg, rinfo) => {
    if (msg.length < 120) {
        return null;
    }

    const frameVector = msg.readUInt32BE(40);
    if (frameVector !== VECTOR_E131_EXTENDED_DISCOVERY) {
        return null;
    }

    const discoveryVector = msg.readUInt32BE(114);
    if (discoveryVector !== VECTOR_UNIVERSE_DISCOVERY_UNIVERSE_LIST) {
        return null;
    }

    const universes = [];
    for (let offset = 120; offset + 1 < msg.length; offset += 2) {
        const universe = msg.readUInt16BE(offset);
        if (universe >= 1 && universe <= 63999) {
            universes.push(universe);
        }
    }

    return {
        type: 'discovery',
        cid: msg.slice(22, 38).toString('hex'),
        sourceName: readSourceName(msg),
        sourceIp: rinfo.address,
        page: msg[118],
        lastPage: msg[119],
        universes,
        protocol: 'sacn'
    };
};

const parseDmxPacket = (msg, rinfo) => {
    if (msg.length < 126) {
        return null;
    }

    const universe = (msg[113] << 8) | msg[114];
    if (universe === DISCOVERY_UNIVERSE || universe < 1) {
        return null;
    }

    const dmxData = Array.from(msg.slice(126, 638));
    while (dmxData.length < 512) {
        dmxData.push(0);
    }

    return {
        type: 'dmx',
        universe,
        dmxData,
        sourceName: readSourceName(msg),
        sourceIp: rinfo.address,
        priority: msg.length > 108 ? msg[108] : 100,
        cid: msg.slice(22, 38).toString('hex'),
        protocol: 'sacn'
    };
};

const parseSacnPacket = (msg, rinfo) => {
    try {
        if (!isAcnPacket(msg)) {
            return null;
        }

        const rootVector = msg.readUInt32BE(18);
        if (rootVector === VECTOR_ROOT_E131_EXTENDED) {
            return parseDiscoveryPacket(msg, rinfo);
        }

        if (rootVector === VECTOR_ROOT_E131_DATA || rootVector === 0) {
            return parseDmxPacket(msg, rinfo);
        }

        return null;
    } catch (error) {
        console.error('Error parsing sACN packet:', error);
        return null;
    }
};

module.exports = {
    DISCOVERY_UNIVERSE,
    createSacnDmxPacket,
    createSacnDiscoveryPacket,
    parseSacnPacket,
    getMulticastAddress
};
