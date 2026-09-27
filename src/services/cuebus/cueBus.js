const crypto = require('crypto');
const dgram = require('dgram');
const os = require('os');
const {
    PORT,
    API,
    OP,
    ROLE,
    encode,
    decode,
    pingSample,
    cuePosition
} = require('./protocol');

// The companion on the cue bus v3 (firmware sync_net). It keeps the shared
// network clock (as master when elected, otherwise by PING/PONG to the
// master), tracks the roster from HELLO, and sends group cues. It is not a
// playback member itself.

const PEER_TIMEOUT_MS = 7000;
const HELLO_MS = 2000;
const INCUMBENT_MS = 5000;
const SAMPLES = 8;
const PING_FAST_MS = 1000;
const PING_SLOW_MS = 4000;
const STEP_US = 30000;
const LAUNCH_LEAD_MS = 300;
const PAUSE_LEAD_MS = 120;
const RESUME_LEAD_MS = 200;

const localUs = () => Number(process.hrtime.bigint() / 1000n);

const fnv = (bytes) => {
    let h = 2166136261;
    for (const b of bytes) {
        h ^= b;
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
};

const nicFor = (interfaceIp) => {
    for (const list of Object.values(os.networkInterfaces())) {
        for (const addr of list || []) {
            if (addr && addr.family === 'IPv4' && addr.address === interfaceIp) {
                return addr;
            }
        }
    }
    return null;
};

const directedBroadcast = (address, netmask) => {
    const a = address.split('.').map(Number);
    const m = netmask.split('.').map(Number);
    return a.map((octet, i) => (octet | (~m[i] & 255)) & 255).join('.');
};

class CueBus {
    constructor({ name = 'DMX whIP Companion', onChange } = {}) {
        this.name = name;
        this.onChange = typeof onChange === 'function' ? onChange : () => {};
        this.socket = null;
        this.interfaceIp = '0.0.0.0';
        this.broadcastIp = '255.255.255.255';
        this.selfId = fnv(crypto.randomBytes(6)) || 1;
        this.seq = 0;
        this.peers = new Map();
        this.off = 0;
        this.target = 0;
        this.everSynced = false;
        this.isMaster = false;
        this.masterId = 0;
        this.masterSince = Date.now();
        this.samples = [];
        this.bestRtt = 0;
        this.pendingT1 = new Set();
        this.lastPing = 0;
        this.timer = null;
        this.helloTimer = null;
    }

    masterUs() {
        return localUs() + this.off;
    }

    async start(interfaceIp = '0.0.0.0') {
        this.stop();
        this.interfaceIp = interfaceIp || '0.0.0.0';
        const nic = nicFor(this.interfaceIp);
        this.broadcastIp = nic && nic.netmask
            ? directedBroadcast(nic.address, nic.netmask)
            : '255.255.255.255';
        if (nic && nic.mac) {
            this.selfId = fnv(Buffer.from(nic.mac.replace(/:/g, ''), 'hex')) || 1;
        }
        const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        await new Promise((resolve, reject) => {
            const onError = (err) => {
                try {
                    socket.close();
                } catch (closeErr) {
                    // already closed
                }
                reject(err);
            };
            socket.once('error', onError);
            socket.bind(PORT, this.interfaceIp === '0.0.0.0' ? undefined : this.interfaceIp, () => {
                socket.removeListener('error', onError);
                socket.setBroadcast(true);
                resolve();
            });
        });
        socket.on('error', (err) => console.error('Cue bus error:', err));
        socket.on('message', (buf, rinfo) => this.onMessage(buf, rinfo));
        this.socket = socket;
        this.timer = setInterval(() => this.tick(), 100);
        // First HELLO after one interval: by then the roster is known, so the
        // companion never announces itself as a master it will not stay.
        this.helloTimer = setInterval(() => this.sendHello(), HELLO_MS);
    }

    stop() {
        clearInterval(this.timer);
        clearInterval(this.helloTimer);
        this.timer = null;
        this.helloTimer = null;
        if (this.socket) {
            try {
                this.socket.close();
            } catch (err) {
                // already closed
            }
            this.socket = null;
        }
        this.peers.clear();
    }

    send(buf, ip) {
        if (this.socket) {
            this.socket.send(buf, PORT, ip, (err) => {
                if (err && err.code !== 'ENETUNREACH') {
                    console.error('Cue bus send error:', err.message);
                }
            });
        }
    }

    // Unicast to every peer plus one broadcast, three times; receivers drop
    // repeats by (sender, seq).
    fanOut(buf) {
        const blast = () => {
            for (const peer of this.peers.values()) {
                this.send(buf, peer.ip);
            }
            this.send(buf, this.broadcastIp);
        };
        blast();
        setTimeout(blast, 20);
        setTimeout(blast, 60);
    }

    sendHello() {
        if (!this.socket) {
            return;
        }
        this.send(encode({
            op: OP.HELLO,
            seq: ++this.seq,
            sender: this.selfId,
            role: ROLE.COMPANION,
            api: API,
            synced: this.isMaster || this.everSynced,
            isMaster: this.isMaster,
            master: this.masterId,
            rttUs: this.isMaster ? 0 : this.bestRtt,
            name: this.name
        }), this.broadcastIp);
    }

    onMessage(buf, rinfo) {
        const rxLocal = localUs();
        const msg = decode(buf);
        if (!msg || msg.sender === this.selfId) {
            return;
        }
        if (msg.op === OP.HELLO) {
            const now = Date.now();
            const prev = this.peers.get(msg.sender);
            let masterFor = prev ? prev.masterFor : 0;
            if (msg.isMaster && prev && prev.isMaster) {
                masterFor += now - prev.lastSeen;
            } else if (!msg.isMaster) {
                masterFor = 0;
            }
            this.peers.set(msg.sender, {
                id: msg.sender,
                ip: rinfo.address,
                name: msg.name,
                role: msg.role,
                api: msg.api,
                synced: msg.synced,
                isMaster: msg.isMaster,
                master: msg.master,
                rttUs: msg.rttUs,
                waitGroup: msg.waitGroup,
                cue: msg.cueState,
                masterFor,
                lastSeen: now
            });
            if (!prev) {
                this.onChange();
            }
            return;
        }
        if (msg.op === OP.PING) {
            if (!this.isMaster) {
                return;
            }
            const t2 = rxLocal + this.off;
            this.send(encode({
                op: OP.PONG,
                seq: ++this.seq,
                sender: this.selfId,
                t1: msg.t1,
                t2,
                t3: this.masterUs()
            }), rinfo.address);
            return;
        }
        if (msg.op === OP.PONG) {
            if (this.isMaster || msg.sender !== this.masterId || !this.pendingT1.has(msg.t1)) {
                return;
            }
            this.pendingT1.delete(msg.t1);
            const { offset, rtt } = pingSample({ t1: msg.t1, t2: msg.t2, t3: msg.t3, t4: rxLocal });
            if (rtt >= 0 && rtt < 500000) {
                this.addSample(offset, rtt);
            }
        }
    }

    addSample(offset, rtt) {
        this.samples.push({ offset, rtt });
        if (this.samples.length > SAMPLES) {
            this.samples.shift();
        }
        const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
        this.target = best.offset;
        this.bestRtt = best.rtt;
        if (!this.everSynced || Math.abs(this.target - this.off) > STEP_US) {
            this.off = this.target;
        }
        this.everSynced = true;
    }

    elect() {
        const now = Date.now();
        const cands = [...this.peers.values()]
            .filter((p) => p.api >= API)
            .map((p) => ({
                id: p.id,
                role: p.role,
                incumbent: p.isMaster && p.masterFor >= INCUMBENT_MS,
                synced: p.synced || p.isMaster
            }));
        // The companion outranks nodes, but only after it has joined the
        // running timeline: it follows the incumbent first, then takes over
        // with the same clock (nodes never step).
        const othersSynced = cands.some((c) => c.synced);
        const self = {
            id: this.selfId,
            role: ROLE.COMPANION,
            incumbent: this.isMaster && now - this.masterSince >= INCUMBENT_MS,
            synced: this.everSynced || (this.isMaster && !othersSynced)
        };
        const anySynced = self.synced || othersSynced;
        const better = (a, b) => {
            if (a.role !== b.role) return a.role > b.role;
            if (a.incumbent !== b.incumbent) return a.incumbent;
            return a.id < b.id;
        };
        let best = (!anySynced || self.synced) ? self : null;
        for (const c of cands) {
            if (anySynced && !c.synced && c.role !== ROLE.HOST) {
                continue;
            }
            if (!best || better(c, best)) {
                best = c;
            }
        }
        if (!best || best.id === this.masterId) {
            return;
        }
        const nowMaster = best.id === this.selfId;
        if (nowMaster && !this.isMaster) {
            this.target = this.off;
            this.masterSince = now;
        }
        const wasKnown = this.masterId !== 0;
        this.isMaster = nowMaster;
        this.masterId = best.id;
        this.samples = [];
        this.pendingT1.clear();
        this.lastPing = 0;
        if (wasKnown && this.helloTimer) {
            this.sendHello();
        }
        this.onChange();
    }

    tick() {
        const now = Date.now();
        let changed = false;
        for (const [id, peer] of this.peers) {
            if (now - peer.lastSeen > PEER_TIMEOUT_MS) {
                this.peers.delete(id);
                changed = true;
            }
        }
        this.elect();
        if (!this.isMaster) {
            // slew <= 0.5 % toward the measured offset
            const maxAdj = 500;
            const d = this.target - this.off;
            this.off += Math.max(-maxAdj, Math.min(maxAdj, d));
            const master = this.peers.get(this.masterId);
            const gap = this.samples.length < SAMPLES ? PING_FAST_MS : PING_SLOW_MS;
            if (master && now - this.lastPing >= gap) {
                this.lastPing = now;
                const t1 = localUs();
                this.pendingT1.add(t1);
                if (this.pendingT1.size > 4) {
                    this.pendingT1.delete(this.pendingT1.values().next().value);
                }
                this.send(encode({ op: OP.PING, seq: ++this.seq, sender: this.selfId, t1 }), master.ip);
            }
        }
        if (changed) {
            this.onChange();
        }
    }

    // Newest running cue per group, from the peers' HELLO.
    activeCues() {
        const byGroup = new Map();
        for (const peer of this.peers.values()) {
            const cue = peer.cue;
            if (!cue) {
                continue;
            }
            const entry = byGroup.get(cue.group);
            if (!entry || cue.createdAt > entry.cue.createdAt) {
                byGroup.set(cue.group, { cue, members: [peer.id] });
            } else if (entry.cue.cue === cue.cue) {
                entry.members.push(peer.id);
            }
        }
        return byGroup;
    }

    cueOp(op, group, fields) {
        const entry = this.activeCues().get(group);
        const cue = entry ? entry.cue : null;
        this.fanOut(encode({
            op,
            seq: ++this.seq,
            sender: this.selfId,
            group,
            cue: cue ? cue.cue : 0,
            loop: cue ? cue.loop : false,
            ...fields
        }));
        return cue;
    }

    launch(group, { startPos = 0, loop = false, dur = 0 } = {}) {
        const now = this.masterUs();
        this.fanOut(encode({
            op: OP.LAUNCH,
            seq: ++this.seq,
            sender: this.selfId,
            group,
            cue: (crypto.randomBytes(4).readUInt32LE(0) | 1) >>> 0,
            loop,
            createdAt: now,
            startAt: now + LAUNCH_LEAD_MS * 1000,
            startPos,
            dur
        }));
    }

    pause(group) {
        const entry = this.activeCues().get(group);
        if (!entry || entry.cue.paused) {
            return false;
        }
        const at = this.masterUs() + PAUSE_LEAD_MS * 1000;
        this.cueOp(OP.PAUSE, group, { at, pos: cuePosition(entry.cue, at) });
        return true;
    }

    resume(group) {
        const entry = this.activeCues().get(group);
        if (!entry || !entry.cue.paused) {
            return false;
        }
        this.cueOp(OP.RESUME, group, {
            startAt: this.masterUs() + RESUME_LEAD_MS * 1000,
            startPos: entry.cue.pausePos
        });
        return true;
    }

    seek(group, posMs) {
        const entry = this.activeCues().get(group);
        if (!entry) {
            return false;
        }
        this.cueOp(OP.SEEK, group, {
            startAt: this.masterUs() + LAUNCH_LEAD_MS * 1000,
            startPos: Math.max(0, Math.round(posMs)),
            paused: entry.cue.paused
        });
        return true;
    }

    stop(group) {
        this.cueOp(OP.STOP, group, { at: this.masterUs() });
        return true;
    }

    snapshot() {
        const now = this.masterUs();
        const cues = [...this.activeCues().entries()].map(([group, { cue, members }]) => ({
            group,
            cue: cue.cue,
            paused: cue.paused,
            loop: cue.loop,
            dur: cue.dur,
            posMs: cuePosition(cue, now),
            members
        }));
        return {
            selfId: this.selfId,
            masterId: this.masterId,
            isMaster: this.isMaster,
            synced: this.isMaster || this.everSynced,
            rttUs: this.isMaster ? 0 : this.bestRtt,
            peers: [...this.peers.values()].map((p) => ({
                id: p.id,
                ip: p.ip,
                name: p.name,
                role: p.role,
                api: p.api,
                isMaster: p.isMaster,
                rttUs: p.rttUs,
                waitGroup: p.waitGroup,
                cueGroup: p.cue ? p.cue.group : 0
            })),
            cues
        };
    }
}

module.exports = CueBus;
