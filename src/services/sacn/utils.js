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

const SACN_DMX_LEN = 638;
const OPTION_PREVIEW = 0x80;
const OPTION_TERMINATED = 0x40;

// E1.31 data packet, written into a reused 638-byte buffer. Only the
// sequence, universe and slots change per send; the rest is constant for a
// source (see initSacnDmxPacket).
const initSacnDmxPacket = (packet, { cid, sourceName, priority = 100 } = {}) => {
    packet.fill(0);
    /* root layer */
    packet.writeUInt16BE(0x0010, 0);
    packet.writeUInt16BE(0x0000, 2);
    packet.write('ASC-E1.17\0\0\0', 4, 'latin1');
    packet.writeUInt16BE(flagsAndLength(SACN_DMX_LEN - 16), 16);
    packet.writeUInt32BE(VECTOR_ROOT_E131_DATA, 18);
    Buffer.from(cid).copy(packet, 22, 0, 16);
    /* framing layer */
    packet.writeUInt16BE(flagsAndLength(SACN_DMX_LEN - 38), 38);
    packet.writeUInt32BE(2, 40);
    packet.write(String(sourceName || 'DMX whIP Companion').slice(0, 63), 44, 'latin1');
    packet[108] = Math.max(0, Math.min(200, Number(priority) || 100));
    /* DMP layer */
    packet.writeUInt16BE(flagsAndLength(SACN_DMX_LEN - 115), 115);
    packet[117] = 0x02;
    packet[118] = 0xa1;
    packet.writeUInt16BE(0x0000, 119);
    packet.writeUInt16BE(0x0001, 121);
    packet.writeUInt16BE(0x0201, 123);
    packet[125] = 0x00;
    return packet;
};

const writeSacnDmx = (packet, universe, sequence, dmxData, options = 0) => {
    packet[111] = sequence & 0xff;
    packet[112] = options & 0xff;
    packet.writeUInt16BE(universe & 0xffff, 113);
    const n = dmxData ? Math.min(512, dmxData.length) : 0;
    for (let i = 0; i < n; i += 1) {
        packet[126 + i] = dmxData[i] || 0;
    }
    if (n < 512) {
        packet.fill(0, 126 + n, SACN_DMX_LEN);
    }
    return packet;
};

const createSacnDmxPacket = (universe, dmxData, options = {}) => {
    const packet = initSacnDmxPacket(Buffer.alloc(SACN_DMX_LEN), {
        cid: options.cid || crypto.randomBytes(16),
        sourceName: options.sourceName,
        priority: options.priority
    });
    writeSacnDmx(packet, universe, options.sequence || 0, dmxData, options.options || 0);
    return {
        packet,
        multicastAddress: getMulticastAddress(universe)
    };
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

const padTo512 = (view) => {
    const out = new Uint8Array(512);
    out.set(view.subarray(0, 512));
    return out;
};

const parseDmxPacket = (msg, rinfo) => {
    if (msg.length < 126) {
        return null;
    }

    const universe = (msg[113] << 8) | msg[114];
    if (universe === DISCOVERY_UNIVERSE || universe < 1) {
        return null;
    }
    // Only null-start-code level data. 0xDD per-address priority and other
    // alternate start codes are not levels; preview data is not for output.
    if (msg[125] !== 0x00 || (msg[112] & OPTION_PREVIEW)) {
        return null;
    }
    const terminated = (msg[112] & OPTION_TERMINATED) !== 0;
    if (terminated) {
        return null;
    }

    // A view, not a copy: dgram hands each message its own Buffer.
    const end = Math.min(msg.length, 638);
    const dmxData = end - 126 >= 512
        ? msg.subarray(126, 638)
        : padTo512(msg.subarray(126, end));

    return {
        type: 'dmx',
        universe,
        dmxData,
        sourceName: readSourceName(msg),
        sourceIp: rinfo.address,
        sourcePort: rinfo.port,
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
    SACN_DMX_LEN,
    initSacnDmxPacket,
    writeSacnDmx,
    createSacnDmxPacket,
    createSacnDiscoveryPacket,
    parseSacnPacket,
    getMulticastAddress
};
