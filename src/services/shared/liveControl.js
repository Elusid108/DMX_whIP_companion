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

// MIDI section is filled in by 5c; kept as-is when it looks right.
const normalizeMidi = (raw) => {
    const r = raw && typeof raw === 'object' ? raw : {};
    return {
        maps: Array.isArray(r.maps) ? r.maps.slice(0, 256) : [],
        devices: r.devices && typeof r.devices === 'object' ? r.devices : {}
    };
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
