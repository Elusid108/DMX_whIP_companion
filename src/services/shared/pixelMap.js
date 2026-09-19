const RGB_CHANNELS = 3;
const UNIVERSE_SIZE = 512;
const MAX_UNIVERSES = 6;
const MAX_ARTNET_UNI = 32767;
const MAX_COUNT = 1024;
const S3_GPIO_MAX = 48;
const BRIGHTNESS_WARN = 64;

const RGB_ORDERS = ['grb', 'rgb', 'rbg', 'gbr', 'brg', 'bgr'];

const CHIPS = [
    { id: 0, name: 'ws2812b', label: 'WS2812B', needsClock: false },
    { id: 1, name: 'ws2812', label: 'WS2812', needsClock: false },
    { id: 2, name: 'sk6812', label: 'SK6812', needsClock: false },
    { id: 3, name: 'ws2811', label: 'WS2811', needsClock: false },
    { id: 4, name: 'ws2813', label: 'WS2813', needsClock: false },
    { id: 5, name: 'ws2815', label: 'WS2815', needsClock: false },
    { id: 6, name: 'ws2816', label: 'WS2816', needsClock: false },
    { id: 7, name: 'ws2818', label: 'WS2818', needsClock: false },
    { id: 8, name: 'sk6822', label: 'SK6822', needsClock: false },
    { id: 9, name: 'tm1803', label: 'TM1803', needsClock: false },
    { id: 10, name: 'tm1804', label: 'TM1804', needsClock: false },
    { id: 11, name: 'tm1809', label: 'TM1809', needsClock: false },
    { id: 12, name: 'tm1829', label: 'TM1829', needsClock: false },
    { id: 13, name: 'ucs1903', label: 'UCS1903', needsClock: false },
    { id: 14, name: 'ucs1903b', label: 'UCS1903B', needsClock: false },
    { id: 15, name: 'ucs1904', label: 'UCS1904', needsClock: false },
    { id: 16, name: 'ucs2903', label: 'UCS2903', needsClock: false },
    { id: 17, name: 'apa106', label: 'APA106', needsClock: false },
    { id: 18, name: 'pl9823', label: 'PL9823', needsClock: false },
    { id: 19, name: 'sm16703', label: 'SM16703', needsClock: false },
    { id: 20, name: 'ge8822', label: 'GE8822', needsClock: false },
    { id: 21, name: 'gw6205', label: 'GW6205', needsClock: false },
    { id: 22, name: 'gs1903', label: 'GS1903', needsClock: false },
    { id: 23, name: 'lpd1886', label: 'LPD1886', needsClock: false },
    { id: 24, name: 'apa102', label: 'APA102', needsClock: true },
    { id: 25, name: 'sk9822', label: 'SK9822', needsClock: true },
    { id: 26, name: 'hd107s', label: 'HD107S', needsClock: true },
    { id: 27, name: 'ws2801', label: 'WS2801', needsClock: true },
    { id: 28, name: 'lpd8806', label: 'LPD8806', needsClock: true },
    { id: 29, name: 'p9813', label: 'P9813', needsClock: true },
    { id: 30, name: 'lpd6803', label: 'LPD6803', needsClock: true }
];

const DEFAULT_PIXELS = {
    chip: 'ws2812b',
    order: 'grb',
    count: 64,
    data: 14,
    clk: 0,
    bri: 10,
    startUni: 0,
    startCh: 1,
    uniStep: 1,
    chStep: 0
};

const clampInt = (value, min, max, fallback) => {
    const n = Number(value);
    if (!Number.isFinite(n)) {
        return fallback;
    }
    return Math.max(min, Math.min(max, Math.round(n)));
};

const chipByName = (name) => {
    const key = String(name || '').trim().toLowerCase();
    return CHIPS.find((row) => row.name === key) || null;
};

const chipById = (id) => CHIPS.find((row) => row.id === Number(id)) || null;

const resolveChip = (raw) => {
    if (typeof raw === 'number' || (typeof raw === 'string' && /^\d+$/.test(raw))) {
        return chipById(Number(raw));
    }
    return chipByName(raw);
};

const channelCount = (count) => Math.max(0, Number(count) || 0) * RGB_CHANNELS;

const nodeSpanUniverses = (startCh, count) => {
    const first = clampInt(startCh, 1, UNIVERSE_SIZE, 1) - 1;
    const last = first + channelCount(count) - 1;
    if (last < first) {
        return 1;
    }
    return Math.floor(last / UNIVERSE_SIZE) - Math.floor(first / UNIVERSE_SIZE) + 1;
};

const addressAt = (pixels, index) => {
    const i = Math.max(0, Math.round(Number(index) || 0));
    const startCh = clampInt(pixels && pixels.startCh, 1, UNIVERSE_SIZE, 1);
    const startUni = clampInt(pixels && pixels.startUni, 0, MAX_ARTNET_UNI, 0);
    const uniStep = clampInt(pixels && pixels.uniStep, 0, MAX_ARTNET_UNI, 0);
    const chStep = clampInt(pixels && pixels.chStep, 0, 32767, 0);
    const slot = (startCh - 1) + (i * chStep);
    return {
        uni: startUni + (i * uniStep) + Math.floor(slot / UNIVERSE_SIZE),
        ch: (slot % UNIVERSE_SIZE) + 1
    };
};

const formatAddr = (addr) => `U${addr.uni} ch ${addr.ch}`;

const sdPinList = (sdPins = {}) => [
    Number(sdPins.cs),
    Number(sdPins.mosi),
    Number(sdPins.clk),
    Number(sdPins.miso)
];

const validDataGpio = (pin, sdPins) => {
    const n = Number(pin);
    if (!Number.isInteger(n) || n < 0 || n > S3_GPIO_MAX) {
        return false;
    }
    if (n === 19 || n === 20) {
        return false;
    }
    if (n >= 26 && n <= 32) {
        return false;
    }
    return !sdPinList(sdPins).includes(n);
};

const normalizePixels = (raw = {}) => {
    const chip = resolveChip(raw.chip) || chipByName(DEFAULT_PIXELS.chip);
    const orderRaw = String(raw.order || DEFAULT_PIXELS.order).trim().toLowerCase();
    return {
        chip: chip.name,
        order: RGB_ORDERS.includes(orderRaw) ? orderRaw : DEFAULT_PIXELS.order,
        count: clampInt(raw.count, 1, MAX_COUNT, DEFAULT_PIXELS.count),
        data: clampInt(raw.data, 0, S3_GPIO_MAX, DEFAULT_PIXELS.data),
        clk: clampInt(raw.clk, 0, S3_GPIO_MAX, DEFAULT_PIXELS.clk),
        bri: clampInt(raw.bri, 0, 255, DEFAULT_PIXELS.bri),
        startUni: clampInt(raw.startUni, 0, MAX_ARTNET_UNI, DEFAULT_PIXELS.startUni),
        startCh: clampInt(raw.startCh, 1, UNIVERSE_SIZE, DEFAULT_PIXELS.startCh),
        uniStep: clampInt(raw.uniStep, 0, MAX_ARTNET_UNI, DEFAULT_PIXELS.uniStep),
        chStep: clampInt(raw.chStep, 0, 32767, DEFAULT_PIXELS.chStep)
    };
};

const validatePixels = (raw, sdPins, nodeCount = 1) => {
    const pixels = normalizePixels(raw);
    const chip = chipByName(pixels.chip);
    if (!chip) {
        return { ok: false, error: 'Unknown IC type', pixels };
    }
    if (!validDataGpio(pixels.data, sdPins)) {
        return { ok: false, error: 'LED data GPIO is reserved or collides with an SD pin', pixels };
    }
    if (chip.needsClock) {
        if (!validDataGpio(pixels.clk, sdPins)) {
            return { ok: false, error: 'Clock GPIO is reserved or collides with an SD pin', pixels };
        }
        if (pixels.clk === pixels.data) {
            return { ok: false, error: 'Clock GPIO must differ from LED data', pixels };
        }
    }
    const count = Math.max(1, Math.round(Number(nodeCount) || 1));
    for (let i = 0; i < count; i += 1) {
        const addr = addressAt(pixels, i);
        if (addr.uni < 0 || addr.uni > MAX_ARTNET_UNI) {
            return { ok: false, error: `Start universe for node ${i + 1} is out of range`, pixels };
        }
        if (nodeSpanUniverses(addr.ch, pixels.count) > MAX_UNIVERSES) {
            return {
                ok: false,
                error: `Node ${i + 1} needs more than ${MAX_UNIVERSES} universes at U${addr.uni} ch ${addr.ch}`,
                pixels
            };
        }
    }
    return { ok: true, error: '', pixels, chip };
};

const pixelsSummary = (raw) => {
    const pixels = normalizePixels(raw);
    const next = addressAt(pixels, 1);
    return `${pixels.count} px · ${channelCount(pixels.count)} ch · next node ${formatAddr(next)}`;
};

module.exports = {
    RGB_CHANNELS,
    UNIVERSE_SIZE,
    MAX_UNIVERSES,
    MAX_ARTNET_UNI,
    MAX_COUNT,
    S3_GPIO_MAX,
    BRIGHTNESS_WARN,
    RGB_ORDERS,
    CHIPS,
    DEFAULT_PIXELS,
    clampInt,
    chipByName,
    chipById,
    resolveChip,
    channelCount,
    nodeSpanUniverses,
    addressAt,
    formatAddr,
    validDataGpio,
    normalizePixels,
    validatePixels,
    pixelsSummary
};
