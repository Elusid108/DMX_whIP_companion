// Live tab output: its own Art-Net / sACN sources in the main process, so
// the faders keep working whatever the renderer is showing.
//
//   - Sends a universe when it changes (at most every SEND_MS) and again every
//     KEEPALIVE_MS so nodes keep it.
//   - A universe that has been all zero for RELEASE_MS stops (sACN sends
//     stream-terminated first): whIP nodes treat live input as a takeover, so
//     an idle Live tab must not hold a node's SD show at black.
//   - While show playback is sending the same universe, playback owns it and
//     merges these levels in (HTP) so nodes see one source; this module then
//     only asks playback to resend when a level changes.

const UNIVERSE = 512;
const SEND_MS = 25;
const KEEPALIVE_MS = 1000;
const RELEASE_MS = 2000;
const TERMINATE_COPIES = 3;
const DISCOVERY_MS = 10000;
const IDLE_CLOSE_MS = 5000;
const OPTION_TERMINATED = 0x40;

const keyOf = (proto, uni) => `${proto}:${uni}`;

const isZero = (data) => {
    for (let i = 0; i < data.length; i += 1) {
        if (data[i]) {
            return false;
        }
    }
    return true;
};

// deps: { makeArt(nic) -> Promise<{ send(uni, data, dest), stop() }>,
//         makeSacn(nic, cid) -> Promise<{ send(uni, data, dest, options),
//                                         sendDiscovery(unis), close() }>,
//         now(), setTimer(fn, ms), clearTimer(id), cid }
const createLiveOutput = (deps) => {
    const now = deps.now || (() => Date.now());
    const setTimer = deps.setTimer || ((fn, ms) => setInterval(fn, ms));
    const clearTimer = deps.clearTimer || ((id) => clearInterval(id));

    const universes = new Map();
    let nic = '0.0.0.0';
    let dest = '';
    let art = null;
    let sacn = null;
    let starting = null;
    let senderGen = 0;
    let timer = null;
    let idleSince = 0;
    let lastDiscovery = 0;
    let playback = null;

    const closeSenders = () => {
        senderGen += 1;
        starting = null;
        if (art) {
            art.stop();
            art = null;
        }
        if (sacn) {
            sacn.close();
            sacn = null;
        }
    };

    const needSacn = () => [...universes.values()].some((u) => u.proto === 'sacn');

    const ensureSenders = () => {
        const wantSacn = needSacn();
        if (art && (!wantSacn || sacn)) {
            return true;
        }
        if (starting) {
            return false;
        }
        const gen = senderGen;
        starting = (async () => {
            const a = art || await deps.makeArt(nic);
            const s = sacn || (wantSacn ? await deps.makeSacn(nic, deps.cid) : null);
            if (gen !== senderGen) {
                if (a !== art) {
                    a.stop();
                }
                if (s && s !== sacn) {
                    s.close();
                }
                return;
            }
            art = a;
            sacn = s;
            lastDiscovery = 0;
        })().catch((err) => {
            console.error('Live output could not open its sockets:', err.message);
        }).finally(() => {
            if (gen === senderGen) {
                starting = null;
            }
        });
        return false;
    };

    const sendUniverse = (u, options = 0) => {
        if (u.proto === 'artnet') {
            Promise.resolve(art.send(u.uni, u.data, dest)).catch((err) => {
                console.error('Live Art-Net send error:', err.message);
            });
        } else if (sacn) {
            sacn.send(u.uni, u.data, dest, options);
        }
        u.lastSent = now();
        u.dirty = false;
    };

    const owned = (u) => Boolean(playback && playback.owns(u.proto, u.uni));

    const tick = () => {
        const t = now();
        if (!universes.size) {
            if (!idleSince) {
                idleSince = t;
            }
            if (t - idleSince >= IDLE_CLOSE_MS) {
                clearTimer(timer);
                timer = null;
                idleSince = 0;
                closeSenders();
            }
            return;
        }
        idleSince = 0;
        const ready = ensureSenders();
        for (const [key, u] of universes) {
            if (owned(u)) {
                if (u.dirty) {
                    u.dirty = false;
                    playback.resend(u.proto, u.uni);
                }
                if (u.zeroSince && t - u.zeroSince >= RELEASE_MS) {
                    universes.delete(key);
                }
                continue;
            }
            if (!ready) {
                continue;
            }
            if (u.zeroSince && t - u.zeroSince >= RELEASE_MS) {
                if (u.proto === 'sacn' && sacn) {
                    for (let i = 0; i < TERMINATE_COPIES; i += 1) {
                        sendUniverse(u, OPTION_TERMINATED);
                    }
                }
                universes.delete(key);
                continue;
            }
            if (u.dirty || t - u.lastSent >= KEEPALIVE_MS) {
                sendUniverse(u);
            }
        }
        if (ready && sacn && t - lastDiscovery >= DISCOVERY_MS) {
            const list = [...universes.values()].filter((u) => u.proto === 'sacn').map((u) => u.uni);
            lastDiscovery = t;
            if (list.length) {
                Promise.resolve(sacn.sendDiscovery(list)).catch(() => {});
            }
        }
    };

    const schedule = () => {
        if (!timer) {
            timer = setTimer(tick, SEND_MS);
        }
    };

    // changes: [{ proto, uni, ch, value }]
    const set = (changes) => {
        const t = now();
        (Array.isArray(changes) ? changes : []).forEach((c) => {
            const proto = c && c.proto === 'sacn' ? 'sacn' : 'artnet';
            const uni = Math.round(Number(c && c.uni));
            const ch = Math.round(Number(c && c.ch));
            if (!Number.isFinite(uni) || uni < 0 || uni > 63999 || !(ch >= 1 && ch <= UNIVERSE)) {
                return;
            }
            const value = Math.max(0, Math.min(255, Math.round(Number(c.value) || 0)));
            const key = keyOf(proto, uni);
            let u = universes.get(key);
            if (!u) {
                if (!value) {
                    return;
                }
                u = { proto, uni, data: new Uint8Array(UNIVERSE), dirty: true, lastSent: 0, zeroSince: 0 };
                universes.set(key, u);
            }
            if (u.data[ch - 1] !== value) {
                u.data[ch - 1] = value;
                u.dirty = true;
            }
            u.zeroSince = isZero(u.data) ? (u.zeroSince || t) : 0;
        });
        if (universes.size) {
            schedule();
        }
    };

    // Everything to 0 now; the universes then release as usual.
    const releaseAll = () => {
        const t = now();
        universes.forEach((u) => {
            if (!isZero(u.data)) {
                u.data.fill(0);
                u.dirty = true;
            }
            u.zeroSince = u.zeroSince || t;
        });
    };

    // HTP of a playback frame with these levels (the frame itself when there
    // is nothing to add).
    const merge = (proto, uni, data) => {
        const u = universes.get(keyOf(proto, uni));
        if (!u || u.zeroSince) {
            return data;
        }
        const out = new Uint8Array(UNIVERSE);
        const n = Math.min(UNIVERSE, data ? data.length : 0);
        for (let i = 0; i < UNIVERSE; i += 1) {
            const a = i < n ? data[i] : 0;
            out[i] = a > u.data[i] ? a : u.data[i];
        }
        return out;
    };

    // Playback stopped owning its universes: send ours again straight away.
    const kick = () => {
        universes.forEach((u) => {
            u.dirty = true;
        });
        if (universes.size) {
            schedule();
        }
    };

    const configure = (opts = {}) => {
        if (typeof opts.nic === 'string' && opts.nic !== nic) {
            nic = opts.nic || '0.0.0.0';
            closeSenders();
            kick();
        }
        if (typeof opts.dest === 'string' && opts.dest !== dest) {
            dest = opts.dest;
            kick();
        }
    };

    const attachPlayback = (hooks) => {
        playback = hooks && typeof hooks.owns === 'function' ? hooks : null;
    };

    const state = () => ({
        nic,
        dest,
        universes: [...universes.values()].map((u) => ({ proto: u.proto, uni: u.uni, owned: owned(u) }))
    });

    const shutdown = () => {
        if (sacn) {
            universes.forEach((u) => {
                if (u.proto === 'sacn') {
                    u.data.fill(0);
                    sendUniverse(u, OPTION_TERMINATED);
                }
            });
        }
        universes.clear();
        if (timer) {
            clearTimer(timer);
            timer = null;
        }
        closeSenders();
    };

    return { set, releaseAll, merge, kick, configure, attachPlayback, state, shutdown, tick };
};

// The app's one Live output, on real sockets. Its sACN CID is kept in
// settings so consoles and nodes see the same source across launches.
let instance = null;
const getLiveOutput = () => {
    if (instance) {
        return instance;
    }
    const crypto = require('crypto');
    const ArtNetSender = require('../services/artnet/sender');
    const { SacnOutput } = require('../services/sacn/output');
    const { loadSettings, saveSettings } = require('./settings');
    let cidHex = loadSettings().liveCid;
    if (!/^[0-9a-f]{32}$/.test(cidHex || '')) {
        cidHex = crypto.randomBytes(16).toString('hex');
        saveSettings({ liveCid: cidHex });
    }
    instance = createLiveOutput({
        cid: Buffer.from(cidHex, 'hex'),
        makeArt: async (nic) => {
            const sender = new ArtNetSender();
            await sender.start(nic);
            return sender;
        },
        makeSacn: async (nic, cid) => {
            const output = new SacnOutput({ sourceName: 'DMX whIP Live', cid, priority: 100, iface: nic });
            await output.start();
            return output;
        }
    });
    return instance;
};

module.exports = {
    createLiveOutput,
    getLiveOutput,
    KEEPALIVE_MS,
    RELEASE_MS,
    SEND_MS,
    OPTION_TERMINATED
};
