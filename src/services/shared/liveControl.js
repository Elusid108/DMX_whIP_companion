// Live tab: 32 faders and a 5x5 pad, each on its own protocol / universe /
// channel. Layout (and, from 5c, MIDI mappings) are saved in settings.json;
// levels are not, so every launch starts at 0.

const FADERS = 32;
const PADS = 25;
const UNIVERSE = 512;
const NAME_MAX = 16;
const MAX_UNI = { artnet: 32767, sacn: 63999 };
const MIN_UNI = { artnet: 0, sacn: 1 };

const clampInt = (value, min, max, fallback) => {
    const n = Number(value);
    if (!Number.isFinite(n)) {
        return fallback;
    }
    return Math.max(min, Math.min(max, Math.round(n)));
};

const normalizeAddress = (raw, fallback) => {
    const r = raw && typeof raw === 'object' ? raw : {};
    const proto = r.proto === 'sacn' || r.proto === 'artnet' ? r.proto : fallback.proto;
    return {
        name: typeof r.name === 'string' ? r.name.slice(0, NAME_MAX) : fallback.name,
        proto,
        uni: clampInt(r.uni, MIN_UNI[proto], MAX_UNI[proto], Math.max(MIN_UNI[proto], fallback.uni)),
        ch: clampInt(r.ch, 1, UNIVERSE, fallback.ch)
    };
};

const defaultFader = (i) => ({ name: '', proto: 'artnet', uni: 0, ch: i + 1 });
const defaultPad = (i) => ({ name: '', proto: 'artnet', uni: 0, ch: FADERS + i + 1, mode: 'toggle', on: 255 });

const normalizePad = (raw, i) => {
    const r = raw && typeof raw === 'object' ? raw : {};
    const fallback = defaultPad(i);
    return {
        ...normalizeAddress(r, fallback),
        mode: r.mode === 'flash' ? 'flash' : 'toggle',
        on: clampInt(r.on, 1, 255, 255)
    };
};

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

// ------------------------------------------------------------------ MIDI
// Mappings are keyed by device name (port ids change between launches), so a
// controller's mappings come back whenever it is plugged in again.
//   maps: [{ target: 'f0'..'f31' | 'p0'..'p24', device, kind: 'cc' | 'note' |
//            'pb', ch: 1-16, num: 0-127 (0 for pitch bend) }]
//   devices: { [device]: { feedback: bool, on: 0 (profile) | 1-127 } }

const MIDI_KINDS = ['cc', 'note', 'pb'];
const MAX_MAPS = 256;

// "MIDIIN2 (APC MINI)" and "MIDIOUT2 (APC MINI)" are the same controller.
const deviceKey = (name) => String(name || '')
    .replace(/^MIDI(?:IN|OUT)\d*\s*\((.*)\)$/i, '$1')
    .trim()
    .slice(0, 64);

const targetInfo = (target) => {
    const m = /^([fp])(\d{1,2})$/.exec(String(target || ''));
    if (!m) {
        return null;
    }
    const index = Number(m[2]);
    const kind = m[1] === 'f' ? 'faders' : 'pads';
    if (index >= (kind === 'faders' ? FADERS : PADS)) {
        return null;
    }
    return { kind, index };
};

const targetOf = (kind, index) => `${kind === 'faders' ? 'f' : 'p'}${index}`;

const normalizeMidi = (raw) => {
    const r = raw && typeof raw === 'object' ? raw : {};
    const maps = [];
    (Array.isArray(r.maps) ? r.maps : []).forEach((m) => {
        if (!m || maps.length >= MAX_MAPS || !targetInfo(m.target) || !MIDI_KINDS.includes(m.kind)) {
            return;
        }
        const device = deviceKey(m.device);
        if (!device) {
            return;
        }
        maps.push({
            target: m.target,
            device,
            kind: m.kind,
            ch: clampInt(m.ch, 1, 16, 1),
            num: m.kind === 'pb' ? 0 : clampInt(m.num, 0, 127, 0)
        });
    });
    const devices = {};
    if (r.devices && typeof r.devices === 'object') {
        Object.entries(r.devices).slice(0, 32).forEach(([name, d]) => {
            const key = deviceKey(name);
            if (key) {
                // on: 0 = the controller's profile decides how pads light;
                // 1-127 = send that value on the same note / CC instead.
                devices[key] = { feedback: !(d && d.feedback === false), on: clampInt(d && d.on, 0, 127, 0) };
            }
        });
    }
    return { maps, devices };
};

// Raw bytes -> { kind, ch, num, value, on }, or null for anything that can't
// drive a control (clock, active sensing, sysex, aftertouch...).
const parseMidi = (data) => {
    if (!data || data.length < 2) {
        return null;
    }
    const status = data[0];
    if (status >= 0xf0 || status < 0x80) {
        return null;
    }
    const type = status & 0xf0;
    const ch = (status & 0x0f) + 1;
    const d1 = data[1] & 0x7f;
    const d2 = data.length > 2 ? data[2] & 0x7f : 0;
    if (type === 0x90) {
        return { kind: 'note', ch, num: d1, value: d2, on: d2 > 0 };
    }
    if (type === 0x80) {
        return { kind: 'note', ch, num: d1, value: 0, on: false };
    }
    if (type === 0xb0) {
        return { kind: 'cc', ch, num: d1, value: d2, on: d2 >= 64 };
    }
    if (type === 0xe0) {
        const value = d1 | (d2 << 7);
        return { kind: 'pb', ch, num: 0, value, on: value >= 8192 };
    }
    return null;
};

const sameMessage = (map, device, msg) => (
    map.device === device && map.kind === msg.kind && map.ch === msg.ch && map.num === msg.num
);

const findTargets = (maps, device, msg) => maps
    .filter((map) => sameMessage(map, device, msg))
    .map((map) => map.target);

// Learn: the control takes this message; it drops any older mapping of its
// own and any other control that had this message.
const learnMap = (maps, target, device, msg) => [
    ...maps.filter((map) => map.target !== target && !sameMessage(map, device, msg)),
    { target, device, kind: msg.kind, ch: msg.ch, num: msg.kind === 'pb' ? 0 : msg.num }
].slice(-MAX_MAPS);

const clearTarget = (maps, target) => maps.filter((map) => map.target !== target);

const clearDevice = (maps, device) => maps.filter((map) => map.device !== device);

// Fader level 0-255 from a message (a note uses its velocity).
const faderValue = (msg) => {
    if (msg.kind === 'pb') {
        return Math.round((msg.value * 255) / 16383);
    }
    if (msg.kind === 'note' && !msg.on) {
        return 0;
    }
    return Math.round((msg.value * 255) / 127);
};

// Bytes that show a control's state on the device: pads light (127) or go
// dark (0); faders send their level back (motor faders, LED rings).
const feedbackBytes = (map, value, isPad) => {
    const status = { cc: 0xb0, note: 0x90, pb: 0xe0 }[map.kind] | ((map.ch - 1) & 0x0f);
    if (map.kind === 'pb') {
        const v14 = isPad ? (value ? 16383 : 0) : Math.round((value * 16383) / 255);
        return [status, v14 & 0x7f, (v14 >> 7) & 0x7f];
    }
    const v7 = isPad ? (value ? 127 : 0) : Math.round((value * 127) / 255);
    return [status, map.num & 0x7f, v7];
};

const midiLabel = (map) => {
    if (map.kind === 'pb') {
        return `Pitch bend · ch ${map.ch}`;
    }
    return `${map.kind === 'cc' ? 'CC' : 'Note'} ${map.num} · ch ${map.ch}`;
};

const normalizeLive = (raw) => {
    const r = raw && typeof raw === 'object' ? raw : {};
    const faders = Array.isArray(r.faders) ? r.faders : [];
    const pads = Array.isArray(r.pads) ? r.pads : [];
    const dest = typeof r.dest === 'string' ? r.dest.trim() : '';
    return {
        faders: Array.from({ length: FADERS }, (_, i) => normalizeAddress(faders[i], defaultFader(i))),
        pads: Array.from({ length: PADS }, (_, i) => normalizePad(pads[i], i)),
        dest: IPV4.test(dest) ? dest : '',
        midi: normalizeMidi(r.midi)
    };
};

const defaultLive = () => normalizeLive({});

// Channel n steps after (uni, ch), rolling into the next universe.
const stepAddress = (uni, ch, n) => {
    const abs = (ch - 1) + n;
    return { uni: uni + Math.floor(abs / UNIVERSE), ch: (abs % UNIVERSE) + 1 };
};

// Controls[from..from+count) get consecutive channels from (proto, uni, ch).
const patchSequential = (controls, from, count, { proto, uni, ch }) => controls.map((c, i) => {
    if (i < from || i >= from + count) {
        return c;
    }
    const addr = stepAddress(Number(uni) || 0, Number(ch) || 1, i - from);
    const max = MAX_UNI[proto] || MAX_UNI.artnet;
    return { ...c, proto, uni: Math.min(max, addr.uni), ch: addr.ch };
});

const addressKey = (c) => `${c.proto}:${c.uni}:${c.ch}`;

const addressLabel = (c) => `${c.proto === 'sacn' ? 'S' : 'A'} ${c.uni} / ${c.ch}`;

// Level each control puts out: faders their value, pads their on level while
// lit.
const controlLevels = (layout, state) => {
    const out = [];
    layout.faders.forEach((c, i) => out.push({ c, value: clampInt(state.faders[i], 0, 255, 0) }));
    layout.pads.forEach((c, i) => out.push({ c, value: state.pads[i] ? c.on : 0 }));
    return out;
};

// HTP per address: Map 'proto:uni:ch' -> { proto, uni, ch, value }.
const levelsByAddress = (layout, state) => {
    const map = new Map();
    controlLevels(layout, state).forEach(({ c, value }) => {
        const key = addressKey(c);
        const prev = map.get(key);
        if (!prev || value > prev.value) {
            map.set(key, { proto: c.proto, uni: c.uni, ch: c.ch, value });
        }
    });
    return map;
};

// What changed between two level maps, as live-set changes. An address that
// disappeared (a control moved) goes to 0.
const diffLevels = (prev, next) => {
    const changes = [];
    next.forEach((level, key) => {
        const old = prev.get(key);
        if (!old || old.value !== level.value) {
            changes.push(level);
        }
    });
    prev.forEach((level, key) => {
        if (!next.has(key) && level.value !== 0) {
            changes.push({ ...level, value: 0 });
        }
    });
    return changes;
};

const emptyState = () => ({
    faders: new Array(FADERS).fill(0),
    pads: new Array(PADS).fill(false)
});

module.exports = {
    FADERS,
    PADS,
    clearDevice,
    clearTarget,
    deviceKey,
    feedbackBytes,
    findTargets,
    faderValue,
    learnMap,
    midiLabel,
    normalizeMidi,
    parseMidi,
    targetInfo,
    targetOf,
    NAME_MAX,
    MAX_UNI,
    MIN_UNI,
    addressKey,
    addressLabel,
    defaultLive,
    diffLevels,
    emptyState,
    levelsByAddress,
    normalizeLive,
    patchSequential,
    stepAddress
};
