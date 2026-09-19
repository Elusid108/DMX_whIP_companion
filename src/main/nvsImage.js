const zlib = require('zlib');

const PAGE_SIZE = 4096;
const HEADER_SIZE = 32;
const BITMAP_OFFSET = 32;
const BITMAP_SIZE = 32;
const FIRST_ENTRY = 64;
const ENTRY_SIZE = 32;
const MAX_ENTRIES = 126;
const PAGE_ACTIVE = 0xFFFFFFFE;
const VERSION2 = 0xFE;
const CHUNK_ANY = 0xFF;
const TYPE_U8 = 0x01;
const TYPE_U16 = 0x02;
const TYPE_SZ = 0x21;

const nvsCrc = (buf) => {
    if (typeof zlib.crc32 === 'function') {
        return zlib.crc32(buf, 0xFFFFFFFF) >>> 0;
    }
    let crc = 0xFFFFFFFF;
    const data = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    for (let i = 0; i < data.length; i += 1) {
        crc ^= data[i];
        for (let b = 0; b < 8; b += 1) {
            crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
        }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
};

const putKey = (entry, key) => {
    entry.fill(0, 8, 24);
    const raw = Buffer.from(String(key), 'utf8');
    if (raw.length < 1 || raw.length > 15) {
        throw new Error(`NVS key "${key}" must be 1–15 bytes`);
    }
    raw.copy(entry, 8);
};

const setEntryCrc = (entry) => {
    const crcBuf = Buffer.alloc(28);
    entry.copy(crcBuf, 0, 0, 4);
    entry.copy(crcBuf, 4, 8, 32);
    entry.writeUInt32LE(nvsCrc(crcBuf), 4);
};

const createPage = (seq) => {
    const page = Buffer.alloc(PAGE_SIZE, 0xff);
    page.writeUInt32LE(PAGE_ACTIVE, 0);
    page.writeUInt32LE(seq, 4);
    page[8] = VERSION2;
    const headerCrc = nvsCrc(page.subarray(4, 28));
    page.writeUInt32LE(headerCrc, 28);
    return { page, entryNum: 0 };
};

const markWritten = (page, entryNum) => {
    const bitnum = entryNum * 2;
    const byteIdx = BITMAP_OFFSET + Math.floor(bitnum / 8);
    const bitOffset = bitnum & 7;
    page[byteIdx] = page[byteIdx] & ~(1 << bitOffset);
};

const writeEntries = (state, data) => {
    const blob = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const count = Math.ceil(blob.length / ENTRY_SIZE) || 1;
    if (state.entryNum + count > MAX_ENTRIES) {
        throw new Error('NVS page is full');
    }
    const padded = Buffer.alloc(count * ENTRY_SIZE, 0xff);
    blob.copy(padded);
    padded.copy(state.page, FIRST_ENTRY + state.entryNum * ENTRY_SIZE);
    for (let i = 0; i < count; i += 1) {
        markWritten(state.page, state.entryNum);
        state.entryNum += 1;
    }
};

const writePrimitiveU8 = (state, nsIndex, key, value) => {
    const entry = Buffer.alloc(ENTRY_SIZE, 0xff);
    entry[0] = nsIndex;
    entry[1] = TYPE_U8;
    entry[2] = 1;
    entry[3] = CHUNK_ANY;
    putKey(entry, key);
    entry[24] = value & 0xff;
    setEntryCrc(entry);
    writeEntries(state, entry);
};

const writePrimitiveU16 = (state, nsIndex, key, value) => {
    const entry = Buffer.alloc(ENTRY_SIZE, 0xff);
    entry[0] = nsIndex;
    entry[1] = TYPE_U16;
    entry[2] = 1;
    entry[3] = CHUNK_ANY;
    putKey(entry, key);
    entry.writeUInt16LE(value & 0xffff, 24);
    setEntryCrc(entry);
    writeEntries(state, entry);
};

const writeString = (state, nsIndex, key, value) => {
    const payload = Buffer.concat([Buffer.from(String(value), 'utf8'), Buffer.from([0])]);
    const dataSlots = Math.ceil(payload.length / ENTRY_SIZE);
    const entry = Buffer.alloc(ENTRY_SIZE, 0xff);
    entry[0] = nsIndex;
    entry[1] = TYPE_SZ;
    entry[2] = dataSlots + 1;
    entry[3] = CHUNK_ANY;
    putKey(entry, key);
    entry.writeUInt16LE(payload.length, 24);
    entry.writeUInt32LE(nvsCrc(payload), 28);
    setEntryCrc(entry);
    writeEntries(state, entry);
    writeEntries(state, payload);
};

const buildNvsImage = (opts = {}, size = 20480) => {
    if (size < PAGE_SIZE * 2 || size % PAGE_SIZE !== 0) {
        throw new Error('NVS size must be a multiple of 4096 and at least two pages');
    }
    const state = createPage(0);
    let ns = 0;

    const addNs = (name) => {
        ns += 1;
        writePrimitiveU8(state, 0, name, ns);
        return ns;
    };

    if (opts.wifi && opts.wifi.ssid) {
        const wifi = addNs('wifi');
        writeString(state, wifi, 'ssid', opts.wifi.ssid);
        writeString(state, wifi, 'pass', opts.wifi.pass || '');
    }

    if (opts.node && opts.node.long) {
        const node = addNs('node');
        writeString(state, node, 'long', opts.node.long);
        writeString(state, node, 'short', opts.node.short || opts.node.long.slice(0, 17));
    }

    if (opts.board && opts.board.pins) {
        const board = addNs('board');
        const pins = opts.board.pins;
        writePrimitiveU8(state, board, 'sd_cs', pins.cs);
        writePrimitiveU8(state, board, 'sd_mosi', pins.mosi);
        writePrimitiveU8(state, board, 'sd_clk', pins.clk);
        writePrimitiveU8(state, board, 'sd_miso', pins.miso);
    }

    if (opts.pmap) {
        const pmap = addNs('pmap');
        writePrimitiveU8(state, pmap, 'chip', opts.pmap.chip);
        writeString(state, pmap, 'ords', opts.pmap.ords || 'grb');
        writePrimitiveU8(state, pmap, 'data', opts.pmap.data);
        writePrimitiveU8(state, pmap, 'clk', opts.pmap.clk);
        writePrimitiveU16(state, pmap, 'count', opts.pmap.count);
        writePrimitiveU16(state, pmap, 'uni', opts.pmap.uni);
        writePrimitiveU16(state, pmap, 'ch', opts.pmap.ch);
    }

    if (opts.led && opts.led.bri != null) {
        const led = addNs('led');
        writePrimitiveU8(state, led, 'bri', opts.led.bri);
    }

    const out = Buffer.alloc(size, 0xff);
    state.page.copy(out, 0);
    return Uint8Array.from(out);
};

const shouldWriteNvs = ({ ssid, clearWifi, pixels }) => {
    if (pixels) {
        return true;
    }
    if (clearWifi) {
        return true;
    }
    return Boolean(ssid && String(ssid).trim());
};

module.exports = {
    PAGE_SIZE,
    buildNvsImage,
    shouldWriteNvs
};
