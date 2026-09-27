// Cue bus v3 wire format. Byte-for-byte the firmware's sync_net.h
// (DMX_whIP_embedded): 20-byte little-endian header
//   0 "WHP3"  4 op  5 flags  6 seq u16  8 sender u32  12 group u32  16 cue u32
// then an op payload. Times are microseconds on the shared network clock
// (i64); positions and durations are ms (u32).

const PORT = 4777;
const API = 2;
const MAGIC = 'WHP3';
const HEADER = 20;

const OP = {
    HELLO: 1,
    PING: 2,
    PONG: 3,
    LAUNCH: 4,
    PAUSE: 5,
    RESUME: 6,
    SEEK: 7,
    STOP: 8
};

const ROLE = {
    NODE: 1,
    COMPANION: 2,
    HOST: 3
};

const FLAG_LOOP = 1;
const FLAG_PAUSED = 2;

const HELLO_SYNCED = 1;
const HELLO_MASTER = 2;
const HELLO_CUE = 4;
const HELLO_CUE_PAUSED = 8;
const HELLO_CUE_LOOP = 16;

// FNV-1a of the sidecar group string (firmware SdInfo::hashGroup).
const hashGroup = (group) => {
    let h = 2166136261;
    for (const byte of Buffer.from(String(group || ''), 'utf8')) {
        h ^= byte;
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
};

const writeHeader = (buf, { op, flags = 0, seq = 0, sender = 0, group = 0, cue = 0 }) => {
    buf.write(MAGIC, 0, 'latin1');
    buf[4] = op;
    buf[5] = flags;
    buf.writeUInt16LE(seq & 0xffff, 6);
    buf.writeUInt32LE(sender >>> 0, 8);
    buf.writeUInt32LE(group >>> 0, 12);
    buf.writeUInt32LE(cue >>> 0, 16);
};

const i64 = (value) => BigInt(Math.round(Number(value) || 0));

const encode = (msg) => {
    const flags = (msg.loop ? FLAG_LOOP : 0) | (msg.paused ? FLAG_PAUSED : 0);
    let buf;
    switch (msg.op) {
    case OP.HELLO: {
        const cue = msg.cueState || null;
        buf = Buffer.alloc(HEADER + 40 + (cue ? 28 : 0));
        writeHeader(buf, {
            ...msg,
            flags: cue && cue.loop ? FLAG_LOOP : 0,
            group: cue ? cue.group : 0,
            cue: cue ? cue.cue : 0
        });
        let hf = 0;
        if (msg.synced) hf |= HELLO_SYNCED;
        if (msg.isMaster) hf |= HELLO_MASTER;
        if (cue) {
            hf |= HELLO_CUE;
            if (cue.paused) hf |= HELLO_CUE_PAUSED;
            if (cue.loop) hf |= HELLO_CUE_LOOP;
        }
        buf[HEADER] = msg.role || ROLE.COMPANION;
        buf[HEADER + 1] = msg.api || API;
        buf[HEADER + 2] = hf;
        buf.writeUInt32LE((msg.master || 0) >>> 0, HEADER + 4);
        buf.writeUInt32LE((msg.rttUs || 0) >>> 0, HEADER + 8);
        buf.writeUInt32LE((msg.waitGroup || 0) >>> 0, HEADER + 12);
        buf.write(String(msg.name || '').slice(0, 23), HEADER + 16, 'utf8');
        if (cue) {
            const o = HEADER + 40;
            buf.writeBigInt64LE(i64(cue.createdAt), o);
            buf.writeBigInt64LE(i64(cue.startAt), o + 8);
            buf.writeUInt32LE((cue.startPos || 0) >>> 0, o + 16);
            buf.writeUInt32LE((cue.dur || 0) >>> 0, o + 20);
            buf.writeUInt32LE((cue.pausePos || 0) >>> 0, o + 24);
        }
        return buf;
    }
    case OP.PING:
        buf = Buffer.alloc(HEADER + 8);
        writeHeader(buf, msg);
        buf.writeBigInt64LE(i64(msg.t1), HEADER);
        return buf;
    case OP.PONG:
        buf = Buffer.alloc(HEADER + 24);
        writeHeader(buf, msg);
        buf.writeBigInt64LE(i64(msg.t1), HEADER);
        buf.writeBigInt64LE(i64(msg.t2), HEADER + 8);
        buf.writeBigInt64LE(i64(msg.t3), HEADER + 16);
        return buf;
    case OP.LAUNCH:
        buf = Buffer.alloc(HEADER + 24);
        writeHeader(buf, { ...msg, flags });
        buf.writeBigInt64LE(i64(msg.createdAt), HEADER);
        buf.writeBigInt64LE(i64(msg.startAt), HEADER + 8);
        buf.writeUInt32LE((msg.startPos || 0) >>> 0, HEADER + 16);
        buf.writeUInt32LE((msg.dur || 0) >>> 0, HEADER + 20);
        return buf;
    case OP.PAUSE:
        buf = Buffer.alloc(HEADER + 12);
        writeHeader(buf, { ...msg, flags });
        buf.writeBigInt64LE(i64(msg.at), HEADER);
        buf.writeUInt32LE((msg.pos || 0) >>> 0, HEADER + 8);
        return buf;
    case OP.RESUME:
    case OP.SEEK:
        buf = Buffer.alloc(HEADER + 12);
        writeHeader(buf, { ...msg, flags });
        buf.writeBigInt64LE(i64(msg.startAt), HEADER);
        buf.writeUInt32LE((msg.startPos || 0) >>> 0, HEADER + 8);
        return buf;
    case OP.STOP:
        buf = Buffer.alloc(HEADER + 8);
        writeHeader(buf, { ...msg, flags });
        buf.writeBigInt64LE(i64(msg.at), HEADER);
        return buf;
    default:
        throw new Error(`Unknown cue op ${msg.op}`);
    }
};

const num = (big) => Number(big);

const decode = (buf) => {
    if (!buf || buf.length < HEADER || buf.toString('latin1', 0, 4) !== MAGIC) {
        return null;
    }
    const msg = {
        op: buf[4],
        flags: buf[5],
        loop: (buf[5] & FLAG_LOOP) !== 0,
        paused: (buf[5] & FLAG_PAUSED) !== 0,
        seq: buf.readUInt16LE(6),
        sender: buf.readUInt32LE(8),
        group: buf.readUInt32LE(12),
        cue: buf.readUInt32LE(16)
    };
    const need = (n) => buf.length >= HEADER + n;
    switch (msg.op) {
    case OP.HELLO: {
        if (!need(40)) return null;
        const hf = buf[HEADER + 2];
        msg.role = buf[HEADER];
        msg.api = buf[HEADER + 1];
        msg.synced = (hf & HELLO_SYNCED) !== 0;
        msg.isMaster = (hf & HELLO_MASTER) !== 0;
        msg.master = buf.readUInt32LE(HEADER + 4);
        msg.rttUs = buf.readUInt32LE(HEADER + 8);
        msg.waitGroup = buf.readUInt32LE(HEADER + 12);
        const nameBytes = buf.subarray(HEADER + 16, HEADER + 40);
        const zero = nameBytes.indexOf(0);
        msg.name = nameBytes.subarray(0, zero < 0 ? nameBytes.length : zero).toString('utf8');
        msg.cueState = null;
        if ((hf & HELLO_CUE) && need(68)) {
            const o = HEADER + 40;
            msg.cueState = {
                group: msg.group,
                cue: msg.cue,
                createdAt: num(buf.readBigInt64LE(o)),
                startAt: num(buf.readBigInt64LE(o + 8)),
                startPos: buf.readUInt32LE(o + 16),
                dur: buf.readUInt32LE(o + 20),
                pausePos: buf.readUInt32LE(o + 24),
                paused: (hf & HELLO_CUE_PAUSED) !== 0,
                loop: (hf & HELLO_CUE_LOOP) !== 0
            };
        }
        return msg;
    }
    case OP.PING:
        if (!need(8)) return null;
        msg.t1 = num(buf.readBigInt64LE(HEADER));
        return msg;
    case OP.PONG:
        if (!need(24)) return null;
        msg.t1 = num(buf.readBigInt64LE(HEADER));
        msg.t2 = num(buf.readBigInt64LE(HEADER + 8));
        msg.t3 = num(buf.readBigInt64LE(HEADER + 16));
        return msg;
    case OP.LAUNCH:
        if (!need(24)) return null;
        msg.createdAt = num(buf.readBigInt64LE(HEADER));
        msg.startAt = num(buf.readBigInt64LE(HEADER + 8));
        msg.startPos = buf.readUInt32LE(HEADER + 16);
        msg.dur = buf.readUInt32LE(HEADER + 20);
        return msg;
    case OP.PAUSE:
        if (!need(12)) return null;
        msg.at = num(buf.readBigInt64LE(HEADER));
        msg.pos = buf.readUInt32LE(HEADER + 8);
        return msg;
    case OP.RESUME:
    case OP.SEEK:
        if (!need(12)) return null;
        msg.startAt = num(buf.readBigInt64LE(HEADER));
        msg.startPos = buf.readUInt32LE(HEADER + 8);
        return msg;
    case OP.STOP:
        if (!need(8)) return null;
        msg.at = num(buf.readBigInt64LE(HEADER));
        return msg;
    default:
        return null;
    }
};

// NTP-style offset (master - local) and round trip from one PING/PONG.
const pingSample = ({ t1, t2, t3, t4 }) => ({
    offset: ((t2 - t1) + (t3 - t4)) / 2,
    rtt: (t4 - t1) - (t3 - t2)
});

// Scheduled position (ms since the file's first pass) at masterUs.
const cuePosition = (cue, masterUs) => {
    if (!cue) {
        return 0;
    }
    if (cue.paused) {
        return cue.pausePos || 0;
    }
    return Math.max(0, (cue.startPos || 0) + Math.floor((masterUs - cue.startAt) / 1000));
};

module.exports = {
    PORT,
    API,
    OP,
    ROLE,
    HEADER,
    hashGroup,
    encode,
    decode,
    pingSample,
    cuePosition
};
