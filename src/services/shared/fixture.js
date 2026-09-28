// Advanced patch (node as one console fixture). Mirrors the firmware rules in
// DMX_whIP_embedded src/fixture.cpp and the portal's Patch -> Advanced editor.
//
// Header, then per mode:
//   basic: 5-channel header only (intensity, strobe, hue, folder, clip) over
//          the recorded look
//   dim  : 13-channel header, then 2 ch per sub-fixture (dim, strobe) over
//          the recorded look
//   rgb  : 13-channel header, then 5 ch per sub-fixture (dim, strobe, R, G, B)
//   full : 13-channel header, then channels-per-pixel for every LED (R, G, B
//          [, W][, warm W], whatever the chip's wire order), never split
//          across a universe
// Pixels are the main patch's LEDs in map order (output -> segment -> pixel).

const HEADER = 13;
const HEADER_BASIC = 5;
const UNIVERSE = 512;
const MAX_SUBS = 96;
const MAX_RANGES = 256;
const MAX_UNIVERSES = 6;
const NAME_MAX = 23;

// The header in every mode, with what the values do. 0 is "no effect" on
// every channel (firmware 0.48+), so channels a console leaves unpatched are
// ignored; dimmers stay open until the console first raises them.
const H = {
    dim: { name: 'Master dimmer', values: '0-255 · open until first raised' },
    intensity: { name: 'Intensity', values: '0-255 · open until first raised' },
    strobe: { name: 'Strobe', values: '0-9 open · 10-255 = 1-25 Hz' },
    strobeColour: { name: 'Strobe colour', values: '0 white · 1-255 round the colour wheel' },
    strobeLevel: { name: 'Strobe intensity', values: 'Off-phase level of the strobe colour · 0 blackout' },
    hue: { name: 'Hue shift', values: '0 none · 1-255 round the colour wheel' },
    folder: { name: 'Folder', values: '0 SD root · n = n-th folder (A-Z)' },
    clip: { name: 'Clip', values: '0 normal playback · n = n-th look in the folder (A-Z)' }
};

const HEADER_INFO = [
    H.dim,
    H.strobe,
    H.strobeColour,
    H.strobeLevel,
    H.hue,
    { name: 'Filter red', values: 'Red removed · 0 none' },
    { name: 'Filter green', values: 'Green removed · 0 none' },
    { name: 'Filter blue', values: 'Blue removed · 0 none' },
    { name: 'Add red', values: 'Red added · 0 none' },
    { name: 'Add green', values: 'Green added · 0 none' },
    { name: 'Add blue', values: 'Blue added · 0 none' },
    H.folder,
    H.clip
];

const HEADER_INFO_BASIC = [H.intensity, H.strobe, H.hue, H.folder, H.clip];

const headerInfo = (mode) => (mode === 'basic' ? HEADER_INFO_BASIC : HEADER_INFO);
const headerLen = (mode) => headerInfo(mode).length;

const HEADER_NAMES = HEADER_INFO.map((h) => h.name);

const GENERAL_NOTE = 'A channel left at 0 has no effect, so channels your console doesn’t patch are ignored. Dimmers stay open until the console first raises them.';

const MODES = {
    basic: {
        label: 'Basic',
        per: 0,
        fields: [],
        description: 'Five channels over what the node already plays: intensity, strobe, hue shift, folder and clip. No sub-fixtures. It uses its own universe, which never takes over playback; with no console the show plays untouched.'
    },
    dim: {
        label: 'Dim + FX',
        per: 2,
        fields: ['Dim', 'Strobe'],
        description: 'Overlays what the node already plays: its SD show, a synced group, or the live stream on its main patch. The console adds the header effects and a dimmer + strobe per sub-fixture (2 ch each); with no sub-fixtures it is a pure overlay. It uses its own universe, which never takes over playback; with no console the show plays untouched.'
    },
    rgb: {
        label: 'RGB + FX',
        per: 5,
        fields: ['Dim', 'Strobe', 'Red', 'Green', 'Blue'],
        description: 'The console colours each sub-fixture (dim, strobe, red, green, blue, 5 ch each). The node’s own show is not used, and pixels in no sub-fixture stay dark.'
    },
    full: {
        label: 'Full',
        per: 0,
        fields: [],
        description: 'The console drives every LED directly after the 13 header channels: red, green, blue (then white, warm white) per pixel, whatever order the strip wires them in. It continues into the next universes without splitting a pixel (up to 6).'
    }
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
            const cpp = cppOf(seg);
            // DMX is always R, G, B[, W][, warm W]; the chip order is only
            // the wire order, applied on the node.
            const white = seg.white != null ? Boolean(seg.white) : cpp >= 4;
            const cct = seg.cct != null ? Boolean(seg.cct) : cpp >= 5;
            const channels = `rgb${white ? 'w' : ''}${cct ? 'c' : ''}`;
            segs.push({
                out: outIndex,
                seg: segIndex,
                data: out.data,
                parts: (out.segs || []).length,
                g0,
                count,
                cpp,
                channels: channels.length === cpp ? channels : 'rgbwc'.slice(0, cpp)
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
        let pos = base + headerLen(fx.mode);
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
        result.footprint = headerLen(fx.mode) + perSub(fx.mode) * (fx.subs || []).length;
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
    return channelsAt(fx, Math.max(0, (Number(fx.ch) || 1) - 1) + headerLen(fx.mode) + per * k, per);
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

const headerChannels = (fx) => headerInfo(fx.mode).map((h, i) => ({
    channel: (Number(fx.ch) || 1) + i,
    name: h.name
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

// Channel span as text: "21-25", "7", or "U3: 1-40" / "U2: 500 - U3: 20"
// when it lies in a later universe than the fixture's own.
const spanText = (fx, rel0, rel1) => {
    const at = (rel) => {
        const u = Math.floor(rel / UNIVERSE);
        return { u, ch: (rel % UNIVERSE) + 1, tag: u > 0 ? `U${(Number(fx.uni) || 0) + u}: ` : '' };
    };
    const a = at(rel0);
    const b = at(rel1);
    if (rel0 === rel1) {
        return `${a.tag}${a.ch}`;
    }
    if (a.u === b.u) {
        return `${a.tag}${a.ch}-${b.ch}`;
    }
    return `${a.tag || `U${Number(fx.uni) || 0}: `}${a.ch} - ${b.tag}${b.ch}`;
};

const LETTERS = { r: 'R', g: 'G', b: 'B', w: 'W', c: 'WW' };

// Every channel's function for the readout: the 10 header rows, then one row
// per sub-fixture (Dim / RGB) or per segment (Full).
// Rows: { channels, name, values }.
const channelMap = (fx, outputs, subOf = []) => {
    const base = Math.max(0, (Number(fx.ch) || 1) - 1);
    const rows = headerInfo(fx.mode).map((h, i) => ({
        channels: spanText(fx, base + i, base + i),
        name: h.name,
        values: h.values
    }));
    if (fx.mode === 'full') {
        const segs = segmentsFromOutputs(outputs);
        const pixels = pixelsFromOutputs(outputs);
        const lay = layout(fx, pixels);
        segs.forEach((seg) => {
            if (!seg.count || !lay.addr) {
                return;
            }
            const first = lay.addr[seg.g0];
            const last = lay.addr[seg.g0 + seg.count - 1] + seg.cpp - 1;
            rows.push({
                channels: spanText(fx, first, last),
                name: `Out ${seg.out + 1} Seg ${seg.seg + 1}`,
                values: `px ${seg.g0}-${seg.g0 + seg.count - 1} · ${seg.cpp} ch each (${seg.channels.split('').map((l) => LETTERS[l] || l.toUpperCase()).join(', ')})`
            });
        });
        return rows;
    }
    const mode = MODES[fx.mode];
    if (!mode.per) {
        return rows;
    }
    (fx.subs || []).forEach((sub, k) => {
        const rel = base + headerLen(fx.mode) + (mode.per * k);
        const count = pixelsOf(subOf, k).length;
        rows.push({
            channels: spanText(fx, rel, rel + mode.per - 1),
            name: sub.name || `Sub ${k + 1}`,
            values: `${mode.fields.join(', ')} · ${count} px`
        });
    });
    return rows;
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
    GENERAL_NOTE,
    HEADER,
    HEADER_BASIC,
    HEADER_INFO,
    HEADER_NAMES,
    headerInfo,
    headerLen,
    MAX_SUBS,
    MAX_UNIVERSES,
    MODES,
    NAME_MAX,
    channelMap,
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
