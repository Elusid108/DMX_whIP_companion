// Monitor overlay: which detected nodes listen to which channels of one
// universe, grouped into pixels, with each channel's colour role.
//
// Placement mirrors DMX_whIP_embedded src/pixel_map.cpp:
//   - sACN universe = Art-Net universe + 1 (per segment, as /status reports)
//   - a segment whose span runs past 512 channels packs pixels back to back,
//     so a pixel may straddle two universes (mapPacked); otherwise every pixel
//     is whole in one universe (mapWholePixels)
//   - the DMX channel order is the wire order: channel k of a pixel is the
//     colour order's letter k (grb -> green, red, blue)
// The Advanced patch fixture (/status.fixture) follows src/fixture.cpp via
// fixture.js.

const {
    HEADER,
    HEADER_NAMES,
    MODES,
    layout
} = require('./fixture');

const UNIVERSE = 512;
const MAX_UNIVERSES = 6;
const MAX_LANES = 3;

const ROLE_LABELS = {
    r: 'Red',
    g: 'Green',
    b: 'Blue',
    w: 'White',
    c: 'Warm white'
};

const cppOf = (seg) => Number(seg && seg.ch_px)
    || (3 + (seg && seg.white ? 1 : 0) + (seg && seg.cct ? 1 : 0));

const orderOf = (seg, cpp) => {
    const order = String((seg && seg.order) || '').toLowerCase();
    if (order.length === cpp) {
        return order;
    }
    return 'rgbwc'.slice(0, cpp);
};

// /status -> the compact patch the device list carries.
const patchFromStatus = (status) => {
    if (!status || typeof status !== 'object') {
        return null;
    }
    let outputs = [];
    if (Array.isArray(status.outputs) && status.outputs.length) {
        outputs = status.outputs.map((out) => ({
            chip: out.chip,
            segs: (out.segs || []).map((seg) => ({
                proto: seg.proto,
                order: seg.order,
                count: Number(seg.count) || 0,
                white: Boolean(seg.white),
                cct: Boolean(seg.cct),
                artnet: Number(seg.artnet) || 0,
                sacn: seg.sacn != null ? Number(seg.sacn) : (Number(seg.artnet) || 0) + 1,
                ch: Number(seg.ch) || 1,
                ch_px: Number(seg.ch_px) || 0
            }))
        }));
    } else if (status.map && typeof status.map === 'object') {
        const m = status.map;
        outputs = [{
            chip: m.chip,
            segs: [{
                proto: m.proto || status.proto || 'auto',
                order: m.order,
                count: Number(m.count) || 0,
                white: Boolean(m.white),
                cct: Boolean(m.cct),
                artnet: Number(m.artnet) || 0,
                sacn: m.sacn != null ? Number(m.sacn) : (Number(m.artnet) || 0) + 1,
                ch: Number(m.ch) || 1,
                ch_px: Number(m.ch_px) || 0
            }]
        }];
    }
    const f = status.fixture;
    const fixture = f && typeof f === 'object' && f.en
        ? {
            mode: MODES[f.mode] ? f.mode : 'dim',
            proto: f.proto === 'sacn' ? 'sacn' : 'artnet',
            uni: Number(f.uni) || 0,
            ch: Number(f.ch) || 1,
            subs: Math.max(0, Number(f.subs) || 0),
            valid: f.valid !== false
        }
        : null;
    return { outputs, fixture };
};

// Does a segment listen to this protocol? auto listens to both.
const segListens = (seg, protocol) => {
    const proto = String(seg.proto || 'auto').toLowerCase();
    return proto === 'auto' || proto === protocol;
};

// 0-based offset of a pixel from its segment's start universe, ch 1. The
// firmware only uses whole-pixel placement when the segment fits in one
// universe, where it equals the packed offset, so one rule covers both.
const pixelBase = (seg, cpp, index) => Math.max(0, (Number(seg.ch) || 1) - 1) + index * cpp;

const nodeName = (device) => String(
    (device && (device.shortName || device.longName || device.ip)) || 'Node'
);

// Channels one node covers in (protocol, universe):
// [{ ch (1-512), group key, pixel, seg, out, role, label }]
const nodeCells = (device, protocol, universe) => {
    const cells = [];
    const patch = device && device.patch;
    if (!patch) {
        return cells;
    }
    (patch.outputs || []).forEach((out, outIndex) => {
        (out.segs || []).forEach((seg, segIndex) => {
            if (!segListens(seg, protocol)) {
                return;
            }
            const cpp = cppOf(seg);
            const order = orderOf(seg, cpp);
            const startUni = protocol === 'sacn'
                ? (seg.sacn != null ? Number(seg.sacn) : (Number(seg.artnet) || 0) + 1)
                : Number(seg.artnet) || 0;
            const count = Number(seg.count) || 0;
            for (let p = 0; p < count; p += 1) {
                const base = pixelBase(seg, cpp, p);
                const first = Math.floor(base / UNIVERSE);
                const last = Math.floor((base + cpp - 1) / UNIVERSE);
                if (first >= MAX_UNIVERSES) {
                    break;
                }
                if (startUni + last < universe || startUni + first > universe) {
                    continue;
                }
                for (let k = 0; k < cpp; k += 1) {
                    const abs = base + k;
                    if (startUni + Math.floor(abs / UNIVERSE) !== universe) {
                        continue;
                    }
                    cells.push({
                        ch: (abs % UNIVERSE) + 1,
                        group: `p:${outIndex}:${segIndex}:${p}`,
                        pixel: p,
                        seg: segIndex,
                        out: outIndex,
                        kind: 'pixel',
                        role: order[k] || '',
                        label: ROLE_LABELS[order[k]] || ''
                    });
                }
            }
        });
    });
    return cells;
};

// The Advanced patch fixture's channels in (protocol, universe).
const fixtureCells = (device, protocol, universe) => {
    const cells = [];
    const patch = device && device.patch;
    const fx = patch && patch.fixture;
    if (!fx || !fx.valid || fx.proto !== protocol) {
        return cells;
    }
    const base = Math.max(0, fx.ch - 1);
    const push = (rel, group, role, label, pixel, kind) => {
        const abs = base + rel;
        if (fx.uni + Math.floor(abs / UNIVERSE) !== universe) {
            return;
        }
        cells.push({ ch: (abs % UNIVERSE) + 1, group, pixel, seg: null, out: null, kind, role, label });
    };
    for (let i = 0; i < HEADER; i += 1) {
        push(i, `h:${i}`, 'fx', HEADER_NAMES[i], null, 'header');
    }
    if (fx.mode === 'full') {
        const segs = [];
        (patch.outputs || []).forEach((out) => (out.segs || []).forEach((seg) => {
            segs.push(seg);
        }));
        const pixels = [];
        const orders = [];
        segs.forEach((seg) => {
            const cpp = cppOf(seg);
            const order = orderOf(seg, cpp);
            for (let p = 0; p < (Number(seg.count) || 0); p += 1) {
                pixels.push({ cpp });
                orders.push(order);
            }
        });
        const lay = layout({ mode: 'full', ch: fx.ch }, pixels);
        pixels.forEach((px, g) => {
            const rel = lay.addr[g] - base;
            for (let k = 0; k < px.cpp; k += 1) {
                const role = orders[g][k] || '';
                push(rel + k, `f:${g}`, role, ROLE_LABELS[role] || '', g, 'fixpx');
            }
        });
        return cells;
    }
    const mode = MODES[fx.mode];
    const roles = fx.mode === 'rgb' ? ['fx', 'fx', 'r', 'g', 'b'] : ['fx', 'fx'];
    for (let k = 0; k < fx.subs; k += 1) {
        for (let i = 0; i < mode.per; i += 1) {
            push(HEADER + (k * mode.per) + i, `s:${k}`, roles[i], `Sub ${k + 1} ${mode.fields[i].toLowerCase()}`, k, 'sub');
        }
    }
    return cells;
};

// Contiguous runs of channels: [[first, last], ...].
const runsOf = (channels) => {
    const sorted = [...new Set(channels)].sort((a, b) => a - b);
    const runs = [];
    sorted.forEach((ch) => {
        const run = runs[runs.length - 1];
        if (run && ch === run[1] + 1) {
            run[1] = ch;
        } else {
            runs.push([ch, ch]);
        }
    });
    return runs;
};

// Fixed grouping when the user overrides (or no node is detected): n channels
// per group from channel 1, coloured as the usual n-channel order.
const MANUAL_ROLES = {
    1: [''],
    2: ['w', 'c'],
    3: ['r', 'g', 'b'],
    4: ['r', 'g', 'b', 'w'],
    5: ['r', 'g', 'b', 'w', 'c']
};

const manualGroups = (size) => {
    const n = Math.max(1, Math.min(5, Math.round(Number(size) || 1)));
    const roles = MANUAL_ROLES[n];
    const cells = new Array(UNIVERSE);
    for (let i = 0; i < UNIVERSE; i += 1) {
        const role = roles[i % n];
        cells[i] = { group: Math.floor(i / n), pixel: Math.floor(i / n), role, label: ROLE_LABELS[role] || '' };
    }
    return cells;
};

// Everything the grid draws for one universe.
//   spans: brackets [{ id, name, first, last, lane, color, fixture }]
//   cells: 512 entries, null or { span, group, pixel, seg, out, role, label,
//          names } where group is a number that changes between pixels
//   lanes: bracket lanes in use
// options.group: 'auto' | 'off' | '1'..'5'
const buildOverlay = (devices, protocol, universe, options = {}) => {
    const cells = new Array(UNIVERSE).fill(null);
    const spans = [];
    const uni = Number(universe);
    if (!Number.isFinite(uni) || (protocol !== 'artnet' && protocol !== 'sacn')) {
        return { spans, cells, lanes: 0 };
    }
    const group = options.group || 'auto';
    let groupSeq = 0;
    const groupIds = new Map();
    const groupId = (key) => {
        if (!groupIds.has(key)) {
            groupIds.set(key, groupSeq);
            groupSeq += 1;
        }
        return groupIds.get(key);
    };

    (Array.isArray(devices) ? devices : []).forEach((device, deviceIndex) => {
        const name = nodeName(device);
        const sets = [
            { cells: nodeCells(device, protocol, uni), fixture: false },
            { cells: fixtureCells(device, protocol, uni), fixture: true }
        ];
        sets.forEach((set) => {
            if (!set.cells.length) {
                return;
            }
            const label = set.fixture ? `${name} · Fixture` : name;
            const spanIds = runsOf(set.cells.map((c) => c.ch)).map(([first, last]) => {
                spans.push({
                    id: `${device.id || deviceIndex}:${set.fixture ? 'fx' : 'px'}:${first}`,
                    name: label,
                    first,
                    last,
                    lane: 0,
                    color: deviceIndex,
                    fixture: set.fixture
                });
                return { first, last, index: spans.length - 1 };
            });
            set.cells.forEach((cell) => {
                const i = cell.ch - 1;
                const span = spanIds.find((s) => cell.ch >= s.first && cell.ch <= s.last);
                const prev = cells[i];
                if (prev) {
                    prev.names.push(label);
                    return;
                }
                cells[i] = {
                    span: span ? span.index : -1,
                    group: groupId(`${deviceIndex}:${cell.group}`),
                    pixel: cell.pixel,
                    seg: cell.seg,
                    out: cell.out,
                    kind: cell.kind,
                    role: cell.role,
                    label: cell.label,
                    fixture: set.fixture,
                    names: [label]
                };
            });
        });
    });

    // Brackets: lowest free lane, at most MAX_LANES (extra share the last).
    const ends = [];
    spans
        .map((span, index) => ({ span, index }))
        .sort((a, b) => a.span.first - b.span.first || b.span.last - a.span.last)
        .forEach(({ span }) => {
            let lane = ends.findIndex((end) => end < span.first);
            if (lane < 0) {
                lane = Math.min(ends.length, MAX_LANES - 1);
            }
            ends[lane] = Math.max(ends[lane] || 0, span.last);
            span.lane = lane;
        });

    if (/^[1-5]$/.test(String(group))) {
        const manual = manualGroups(Number(group));
        for (let i = 0; i < UNIVERSE; i += 1) {
            const cell = cells[i];
            const m = manual[i];
            cells[i] = {
                span: cell ? cell.span : -1,
                group: m.group,
                pixel: m.pixel,
                seg: null,
                out: null,
                kind: 'manual',
                role: m.role,
                label: m.label,
                fixture: false,
                names: cell ? cell.names : [],
                manual: Number(group)
            };
        }
    } else if (group === 'off') {
        cells.forEach((cell) => {
            if (cell) {
                cell.group = -1;
            }
        });
    }

    return { spans, cells, lanes: spans.length ? Math.min(MAX_LANES, ends.length) : 0 };
};

// One line for a channel's tooltip.
const describeChannel = (overlay, ch) => {
    const cell = overlay && overlay.cells ? overlay.cells[ch - 1] : null;
    const parts = [`Ch ${ch}`];
    if (!cell) {
        return parts.join(' · ');
    }
    if (cell.names && cell.names.length) {
        parts.push(cell.names.join(' + '));
    }
    if (cell.kind === 'manual') {
        parts.push(`${cell.manual}-ch group ${cell.pixel + 1}`);
    } else if (cell.kind === 'pixel') {
        parts.push(`Out ${cell.out + 1} Seg ${cell.seg + 1}`);
        parts.push(`Px ${cell.pixel + 1}`);
    } else if (cell.kind === 'fixpx') {
        // Fixture pixels use the Advanced patch's 0-based global index.
        parts.push(`Pixel ${cell.pixel}`);
    }
    if (cell.label) {
        parts.push(cell.label);
    }
    return parts.join(' · ');
};

module.exports = {
    MAX_LANES,
    ROLE_LABELS,
    buildOverlay,
    describeChannel,
    manualGroups,
    nodeCells,
    fixtureCells,
    patchFromStatus,
    runsOf
};
