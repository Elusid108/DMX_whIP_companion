// Byte helpers for core code: Uint8Array only, no Buffer. Integer reads and
// writes are plain byte arithmetic (no per-call DataView allocation) because
// the packet parsers run on every received datagram.

const readU16LE = (b, o) => b[o] | (b[o + 1] << 8);
const readU16BE = (b, o) => (b[o] << 8) | b[o + 1];
const readU32LE = (b, o) => ((b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + (b[o + 3] * 0x1000000)) >>> 0;
const readU32BE = (b, o) => ((b[o] * 0x1000000) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3])) >>> 0;

const writeU16LE = (b, value, o) => {
    b[o] = value & 0xff;
    b[o + 1] = (value >>> 8) & 0xff;
};
const writeU16BE = (b, value, o) => {
    b[o] = (value >>> 8) & 0xff;
    b[o + 1] = value & 0xff;
};
const writeU32LE = (b, value, o) => {
    const v = value >>> 0;
    b[o] = v & 0xff;
    b[o + 1] = (v >>> 8) & 0xff;
    b[o + 2] = (v >>> 16) & 0xff;
    b[o + 3] = (v >>> 24) & 0xff;
};
const writeU32BE = (b, value, o) => {
    const v = value >>> 0;
    b[o] = (v >>> 24) & 0xff;
    b[o + 1] = (v >>> 16) & 0xff;
    b[o + 2] = (v >>> 8) & 0xff;
    b[o + 3] = v & 0xff;
};

// Node's 'ascii' decoder masks the high bit; keep that so parsed names are
// byte-for-byte what the Buffer code produced.
const ascii = (b, start = 0, end = b.length) => {
    let s = '';
    const stop = Math.min(end, b.length);
    for (let i = start; i < stop; i += 1) {
        s += String.fromCharCode(b[i] & 0x7f);
    }
    return s;
};

const latin1 = (b, start = 0, end = b.length) => {
    let s = '';
    const stop = Math.min(end, b.length);
    for (let i = start; i < stop; i += 1) {
        s += String.fromCharCode(b[i]);
    }
    return s;
};

// Writes the low byte of each char code (Buffer 'latin1'); returns the count.
const writeLatin1 = (b, text, offset, maxLen = b.length - offset) => {
    const s = String(text || '');
    const n = Math.min(s.length, maxLen, b.length - offset);
    for (let i = 0; i < n; i += 1) {
        b[offset + i] = s.charCodeAt(i) & 0xff;
    }
    return n;
};

let encoder = null;
const utf8 = (text) => {
    if (!encoder) {
        encoder = new TextEncoder();
    }
    return encoder.encode(String(text || ''));
};

const HEX = '0123456789abcdef';
const hex = (b, start = 0, end = b.length) => {
    let s = '';
    for (let i = start; i < Math.min(end, b.length); i += 1) {
        s += HEX[b[i] >> 4] + HEX[b[i] & 15];
    }
    return s;
};

const fromHex = (text) => {
    const clean = String(text || '').trim();
    const out = new Uint8Array(clean.length >> 1);
    for (let i = 0; i < out.length; i += 1) {
        out[i] = parseInt(clean.substr(i * 2, 2), 16) || 0;
    }
    return out;
};

const startsWith = (b, text, offset = 0) => {
    if (b.length < offset + text.length) {
        return false;
    }
    for (let i = 0; i < text.length; i += 1) {
        if (b[offset + i] !== text.charCodeAt(i)) {
            return false;
        }
    }
    return true;
};

const concat = (parts, total) => {
    const size = total != null ? total : parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(size);
    let at = 0;
    for (const p of parts) {
        out.set(p, at);
        at += p.length;
    }
    return out;
};

const equals = (a, b) => {
    if (a === b) {
        return true;
    }
    if (!a || !b || a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i += 1) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
};

// Accepts a Uint8Array (Buffer included), a hex string or an array of bytes.
const toBytes = (value) => {
    if (value instanceof Uint8Array) {
        return value;
    }
    if (typeof value === 'string') {
        return fromHex(value);
    }
    if (Array.isArray(value)) {
        return Uint8Array.from(value);
    }
    return new Uint8Array(0);
};

module.exports = {
    readU16LE, readU16BE, readU32LE, readU32BE,
    writeU16LE, writeU16BE, writeU32LE, writeU32BE,
    ascii, latin1, writeLatin1, utf8, hex, fromHex, startsWith, concat, equals, toBytes
};
