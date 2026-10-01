// E1.31 (sACN) packet encode and decode: data packets, universe discovery
// pages and the parser. Pure Uint8Array code; byte-identical to the `sacn`
// npm package's encoder (src/services/sacn/sacnPacket.test.js). The CID is
// always supplied by the caller: randomness is an adapter concern.
const {
    readU32BE, readU16BE, writeU16BE, writeU32BE, writeLatin1, utf8, hex, toBytes
} = require('../bytes');

const DISCOVERY_UNIVERSE = 64214;
const VECTOR_ROOT_E131_DATA = 4;
const VECTOR_ROOT_E131_EXTENDED = 8;
const VECTOR_E131_EXTENDED_DISCOVERY = 2;
const VECTOR_UNIVERSE_DISCOVERY_UNIVERSE_LIST = 1;

const SACN_DMX_LEN = 638;
const OPTION_PREVIEW = 0x80;
const OPTION_TERMINATED = 0x40;
const DEFAULT_SOURCE_NAME = 'DMX whIP Companion';

const getMulticastAddress = (universe) => {
    const low = universe % 256;
    const high = Math.floor(universe / 256);
    return `239.255.${high}.${low}`;
};

const isAcnPacket = (msg) => (
    msg
    && msg.length >= 38
    && msg[0] === 0x00
    && msg[1] === 0x10
    && msg[4] === 0x41
    && msg[5] === 0x53
    && msg[6] === 0x43
    && msg[7] === 0x2d
    && msg[8] === 0x45
    && msg[9] === 0x31
    && msg[10] === 0x2e
    && msg[11] === 0x31
    && msg[12] === 0x37
);

const readSourceName = (msg) => {
    let sourceName = '';
    const end = Math.min(108, msg.length);
    for (let i = 44; i < end; i += 1) {
        if (msg[i] === 0) {
            break;
        }
        sourceName += String.fromCharCode(msg[i]);
    }
    return sourceName.trim();
};

const flagsAndLength = (pduLength) => 0x7000 | (pduLength & 0x0fff);

const requireCid = (cid) => {
    const bytes = toBytes(cid);
    if (bytes.length < 16) {
        throw new Error('sACN packets need a 16-byte CID');
    }
    return bytes;
};

// E1.31 data packet written into a reused 638-byte array. Only sequence,
// universe and slots change per send (writeSacnDmx); the rest is per source.
const initSacnDmxPacket = (packet, { cid, sourceName, priority = 100 } = {}) => {
    packet.fill(0);
    /* root layer */
    writeU16BE(packet, 0x0010, 0);
    writeU16BE(packet, 0x0000, 2);
    writeLatin1(packet, 'ASC-E1.17\0\0\0', 4);
    writeU16BE(packet, flagsAndLength(SACN_DMX_LEN - 16), 16);
    writeU32BE(packet, VECTOR_ROOT_E131_DATA, 18);
    packet.set(requireCid(cid).subarray(0, 16), 22);
    /* framing layer */
    writeU16BE(packet, flagsAndLength(SACN_DMX_LEN - 38), 38);
    writeU32BE(packet, 2, 40);
    writeLatin1(packet, String(sourceName || DEFAULT_SOURCE_NAME).slice(0, 63), 44);
    packet[108] = Math.max(0, Math.min(200, Number(priority) || 100));
    /* DMP layer */
    writeU16BE(packet, flagsAndLength(SACN_DMX_LEN - 115), 115);
    packet[117] = 0x02;
    packet[118] = 0xa1;
    writeU16BE(packet, 0x0000, 119);
    writeU16BE(packet, 0x0001, 121);
    writeU16BE(packet, 0x0201, 123);
    packet[125] = 0x00;
    return packet;
};

const writeSacnDmx = (packet, universe, sequence, dmxData, options = 0) => {
    packet[111] = sequence & 0xff;
    packet[112] = options & 0xff;
    writeU16BE(packet, universe & 0xffff, 113);
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
    const packet = initSacnDmxPacket(new Uint8Array(SACN_DMX_LEN), {
        cid: options.cid,
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
    const cid = requireCid(options.cid);
    const sourceName = utf8(String(options.sourceName || DEFAULT_SOURCE_NAME)).subarray(0, 64);
    const page = options.page || 0;
    const lastPage = options.lastPage || 0;

    const sorted = [...new Set((universes || []).filter((u) => u >= 1 && u <= 63999))]
        .sort((a, b) => a - b);
    const pageUniverses = sorted.slice(page * 512, (page + 1) * 512);
    const packet = new Uint8Array(120 + pageUniverses.length * 2);

    writeU16BE(packet, 0x0010, 0);
    writeU16BE(packet, 0x0000, 2);
    writeLatin1(packet, 'ASC-E1.17\0\0\0', 4);
    writeU16BE(packet, flagsAndLength(packet.length - 16), 16);
    writeU32BE(packet, VECTOR_ROOT_E131_EXTENDED, 18);
    packet.set(cid.subarray(0, 16), 22);

    writeU16BE(packet, flagsAndLength(packet.length - 38), 38);
    writeU32BE(packet, VECTOR_E131_EXTENDED_DISCOVERY, 40);
    packet.set(sourceName, 44);

    writeU16BE(packet, flagsAndLength(packet.length - 112), 112);
    writeU32BE(packet, VECTOR_UNIVERSE_DISCOVERY_UNIVERSE_LIST, 114);
    packet[118] = page;
    packet[119] = lastPage;

    for (let i = 0; i < pageUniverses.length; i += 1) {
        writeU16BE(packet, pageUniverses[i], 120 + i * 2);
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
    if (readU32BE(msg, 40) !== VECTOR_E131_EXTENDED_DISCOVERY) {
        return null;
    }
    if (readU32BE(msg, 114) !== VECTOR_UNIVERSE_DISCOVERY_UNIVERSE_LIST) {
        return null;
    }
    const universes = [];
    for (let offset = 120; offset + 1 < msg.length; offset += 2) {
        const universe = readU16BE(msg, offset);
        if (universe >= 1 && universe <= 63999) {
            universes.push(universe);
        }
    }
    return {
        type: 'discovery',
        cid: hex(msg, 22, 38),
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
    if ((msg[112] & OPTION_TERMINATED) !== 0) {
        return null;
    }
    // A view, not a copy: the socket hands each message its own bytes.
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
        cid: hex(msg, 22, 38),
        protocol: 'sacn'
    };
};

// Returns null for anything that is not a usable E1.31 packet; never throws.
const parseSacnPacket = (msg, rinfo) => {
    if (!isAcnPacket(msg)) {
        return null;
    }
    const rootVector = readU32BE(msg, 18);
    if (rootVector === VECTOR_ROOT_E131_EXTENDED) {
        return parseDiscoveryPacket(msg, rinfo);
    }
    if (rootVector === VECTOR_ROOT_E131_DATA || rootVector === 0) {
        return parseDmxPacket(msg, rinfo);
    }
    return null;
};

module.exports = {
    DISCOVERY_UNIVERSE,
    SACN_DMX_LEN,
    OPTION_PREVIEW,
    OPTION_TERMINATED,
    DEFAULT_SOURCE_NAME,
    initSacnDmxPacket,
    writeSacnDmx,
    createSacnDmxPacket,
    createSacnDiscoveryPacket,
    parseSacnPacket,
    getMulticastAddress
};
