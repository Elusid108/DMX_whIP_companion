// Advanced patch (node as one console fixture). Mirrors the firmware rules in
// DMX_whIP_embedded src/fixture.cpp and the portal's Patch -> Advanced editor.
//
// Header (every mode), then per mode:
//   dim : 2 ch per sub-fixture (dim, strobe) over the recorded look
//   rgb : 5 ch per sub-fixture (dim, strobe, R, G, B) from the console
//   full: channels-per-pixel for every LED, never split across a universe
// Pixels are the main patch's LEDs in map order (output -> segment -> pixel).

const HEADER = 10;
const UNIVERSE = 512;
const MAX_SUBS = 96;
const MAX_RANGES = 256;
const MAX_UNIVERSES = 6;
const NAME_MAX = 23;

const HEADER_NAMES = [
    'Master dimmer',
    'Strobe',
    'Hue shift',
    'Filter red',
    'Filter green',
    'Filter blue',
    'Add red',
    'Add green',
    'Add blue',
    'Clip select'
];

const MODES = {
    dim: { label: 'Dim + FX', per: 2, fields: ['Dim', 'Strobe'] },
    rgb: { label: 'RGB + FX', per: 5, fields: ['Dim', 'Strobe', 'Red', 'Green', 'Blue'] },
    full: { label: 'Full', per: 0, fields: [] }
};

const perSub = (mode) => (MODES[mode] ? MODES[mode].per : 0);

const cppOf = (seg) => Number(seg && seg.ch_px)
    || (3 + (seg && seg.white ? 1 : 0) + (seg && seg.cct ? 1 : 0));

// Segments from /status outputs, each with its first global pixel index.
const segmentsFromOutputs = (outputs) => {
    const segs = [];
    let g0 = 0;
    (Array.isArray(outputs) ? outputs : []).forEach((out, outIndex) => {
        (out.segs || []).forEach((seg, segIndex) => {
            const count = Math.max(0, Number(seg.count) || 0);
            segs.push({
                out: outIndex,
                seg: segIndex,
                data: out.data,
                parts: (out.segs || []).length,
                g0,
                count,
                cpp: cppOf(seg)
            });
            g0 += count;
        });
    });
    return segs;
};

// One entry per pixel: { out, seg, cpp }.
const pixelsFromOutputs = (outputs) => {
    const pixels = [];
    segmentsFromOutputs(outputs).forEach((seg) => {
        for (let i = 0; i < seg.count; i += 1) {
            pixels.push({ out: seg.out, seg: seg.seg, cpp: seg.cpp });
        }
    });
    return pixels;
};

// "0-11,24-35,40" -> sorted unique indices. Bad parts are reported.
const parseRanges = (text, limit = Infinity) => {
    const out = new Set();
    let error = '';
    String(text || '').split(',').forEach((part) => {
        if (!part.trim()) {
            return;
        }
        const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part);
        if (!m) {
            error = error || `Bad pixel range "${part.trim()}"`;
            return;
        }
        const a = Number(m[1]);
        const b = m[2] != null ? Number(m[2]) : a;
        if (b < a) {
            error = error || `Bad pixel range "${part.trim()}"`;
            return;
        }
        for (let g = a; g <= b && g < limit; g += 1) {
            out.add(g);
        }
    });
    return { pixels: [...out].sort((x, y) => x - y), error };
};

const rangeList = (indices) => {
    const out = [];
    let a = -1;
    let b = -1;
    [...indices].sort((x, y) => x - y).forEach((g) => {
        if (a >= 0 && g === b + 1) {
            b = g;
            return;
        }
        if (a >= 0) {
            out.push([a, b]);
        }
        a = g;
        b = g;
    });
    if (a >= 0) {
        out.push([a, b]);
    }
    return out;
};

const formatRanges = (indices) => rangeList(indices)
    .map(([a, b]) => (a === b ? String(a) : `${a}-${b}`))
    .join(',');

// Footprint, universes and (Full) every pixel's channel offset from the
// start of the fixture's universe (0-based).
const layout = (fx, pixels) => {
    const base = Math.max(0, (Number(fx.ch) || 1) - 1);
    const result = { base, footprint: 0, unis: 1, addr: null, error: '' };
    if (fx.mode === 'full') {
        let pos = base + HEADER;
        if (pos > UNIVERSE) {
            result.error = 'The header does not fit after this channel.';
        }
        result.addr = new Array(pixels.length);
        pixels.forEach((p, g) => {
            if ((pos % UNIVERSE) + p.cpp > UNIVERSE) {
                pos = (Math.floor(pos / UNIVERSE) + 1) * UNIVERSE;
            }
            result.addr[g] = pos;
            pos += p.cpp;
        });
        result.unis = Math.max(1, Math.ceil(pos / UNIVERSE));
        result.footprint = pos - base;
        if (!result.error && result.unis > MAX_UNIVERSES) {
            result.error = 'Full mode needs more than 6 universes. Use a reduced mode or fewer pixels.';
        }
    } else {
        result.footprint = HEADER + perSub(fx.mode) * (fx.subs || []).length;
        if (base + result.footprint > UNIVERSE) {
            result.error = 'The fixture does not fit in the universe from this channel.';
        }
    }
    return result;
};

// Channel numbers (1-512) for n channels starting at a 0-based offset from
// the fixture universe; universe is set when it is not the fixture's own.
const channelsAt = (fx, rel, n) => {
    const u = Math.floor(rel / UNIVERSE);
    const first = (rel % UNIVERSE) + 1;
    return {
        universe: u > 0 ? (Number(fx.uni) || 0) + u : null,
        channels: Array.from({ length: n }, (_, i) => first + i)
    };
};

const channelText = ({ universe, channels }) => (
    channels.length ? `${universe != null ? `U${universe}: ` : ''}${channels.join(',')}` : '—'
);

const subChannels = (fx, k) => {
    const per = perSub(fx.mode);
    if (!per) {
        return { universe: null, channels: [] };
    }
    return channelsAt(fx, Math.max(0, (Number(fx.ch) || 1) - 1) + HEADER + per * k, per);
};

// A pixel's channels in the current mode: its own (Full), its sub-fixture's,
// or none.
const pixelChannels = (fx, lay, subOf, pixels, g) => {
    if (fx.mode === 'full') {
        if (!lay.addr || lay.addr[g] == null) {
            return { universe: null, channels: [] };
        }
        return channelsAt(fx, lay.addr[g], pixels[g].cpp);
    }
    const k = subOf[g];
    return k >= 0 ? subChannels(fx, k) : { universe: null, channels: [] };
};

const headerChannels = (fx) => HEADER_NAMES.map((name, i) => ({
    channel: (Number(fx.ch) || 1) + i,
    name
}));

const pixelsOf = (subOf, k) => {
    const out = [];
    subOf.forEach((v, g) => {
        if (v === k) {
            out.push(g);
        }
    });
    return out;
};

// Everything the firmware would reject that can be checked here.
const validate = (fx, subOf, pixels) => {
    const ch = Number(fx.ch);
    const uni = Number(fx.uni);
    if (!Number.isInteger(ch) || ch < 1 || ch > UNIVERSE) {
        return 'Channel must be 1-512.';
    }
    if (!Number.isInteger(uni) || (fx.proto === 'sacn' ? (uni < 1 || uni > 63999) : (uni < 0 || uni > 32767))) {
        return fx.proto === 'sacn' ? 'sACN universe must be 1-63999.' : 'Art-Net universe must be 0-32767.';
    }
    if ((fx.subs || []).length > MAX_SUBS) {
        return `At most ${MAX_SUBS} sub-fixtures.`;
    }
    const lay = layout(fx, pixels);
    if (lay.error) {
        return lay.error;
    }
    let ranges = 0;
    for (let k = 0; k < (fx.subs || []).length; k += 1) {
        const count = rangeList(pixelsOf(subOf, k)).length;
        if (count > 255) {
            return `${fx.subs[k].name || `Sub ${k + 1}`} has too many separate pixel runs.`;
        }
        ranges += count;
    }
    if (ranges > MAX_RANGES) {
        return `Too many separate pixel runs across sub-fixtures (${ranges}, max ${MAX_RANGES}).`;
    }
    if (fx.en && !pixels.length) {
        return 'The main patch has no pixels.';
    }
    return '';
};

// GET /fixture -> editable state for a patch with pixelCount pixels.
const fromFixture = (json, pixelCount) => {
    const f = json || {};
    const fx = {
        en: Boolean(f.en),
        mode: MODES[f.mode] ? f.mode : 'dim',
        proto: f.proto === 'sacn' ? 'sacn' : 'artnet',
        uni: Number(f.uni) || 0,
        ch: Number(f.ch) || 1,
        subs: (f.subs || []).map((s) => ({ name: String(s.name || '') }))
    };
    const subOf = new Array(Math.max(0, pixelCount)).fill(-1);
    (f.subs || []).forEach((s, k) => {
        parseRanges(s.px, pixelCount).pixels.forEach((g) => {
            subOf[g] = k;
        });
    });
    return { fx, subOf };
};

// POST /fixture form fields.
const toFields = (fx, subOf) => {
    const fields = {
        en: fx.en ? 1 : 0,
        mode: fx.mode,
        proto: fx.proto,
        uni: Number(fx.uni) || 0,
        ch: Number(fx.ch) || 1,
        n: (fx.subs || []).length
    };
    (fx.subs || []).forEach((s, k) => {
        fields[`s${k}n`] = String(s.name || '').slice(0, NAME_MAX);
        fields[`s${k}px`] = formatRanges(pixelsOf(subOf, k));
    });
    return fields;
};

module.exports = {
    HEADER,
    HEADER_NAMES,
    MAX_SUBS,
    MAX_UNIVERSES,
    MODES,
    NAME_MAX,
    channelText,
    formatRanges,
    fromFixture,
    headerChannels,
    layout,
    parseRanges,
    perSub,
    pixelChannels,
    pixelsFromOutputs,
    pixelsOf,
    segmentsFromOutputs,
    subChannels,
    toFields,
    validate
};
