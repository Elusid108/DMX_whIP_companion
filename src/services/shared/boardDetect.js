// Which catalog board is on a USB port, and how one pin setup carries over
// to a different board. Pure (renderer and main).

const hex4 = (value) => String(value || '').replace(/^0x/i, '').toUpperCase().padStart(4, '0');

// USB class of a port from its vendor / product id (hex strings).
//   esp-usb   the chip's own USB-Serial/JTAG (Espressif 303A:1001)
//   esp-uart  a USB-UART bridge (CP210x, CH34x) in front of an ESP32
//   rp        Raspberry Pi RP2040 / RP2350 running firmware
//   ''        unknown
const usbClass = (vendorId, productId) => {
    const vid = hex4(vendorId);
    const pid = hex4(productId);
    if (vid === '303A' && pid === '1001') {
        return 'esp-usb';
    }
    if (vid === '10C4' || vid === '1A86') {
        return 'esp-uart';
    }
    if (vid === '2E8A') {
        return 'rp';
    }
    return '';
};

// catalog detect.usb entries look like "303A:1001" or "1A86:*".
const usbMatches = (patterns, vendorId, productId) => {
    if (!Array.isArray(patterns) || !vendorId) {
        return false;
    }
    const vid = hex4(vendorId);
    const pid = hex4(productId);
    return patterns.some((pattern) => {
        const [pv, pp] = String(pattern).toUpperCase().split(':');
        return hex4(pv) === vid && (pp === '*' || hex4(pp) === pid);
    });
};

const chipKey = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const sizeKey = (size) => String(size || '').toUpperCase().replace(/\s+/g, '');

// Best catalog board for what esptool read off a port (no firmware answer).
// { boardId, source: 'chip' (one match) | 'guess' (several fit) } or null.
const matchBoard = (boards, { chip, flashSize, vendorId, productId } = {}) => {
    const want = chipKey(chip);
    if (!want) {
        return null;
    }
    let list = (boards || []).filter((board) => {
        const got = chipKey(board.chip);
        return got && (want === got || want.startsWith(got));
    });
    if (!list.length) {
        return null;
    }
    const narrow = (keep) => {
        const next = list.filter(keep);
        if (next.length) {
            list = next;
        }
    };
    if (flashSize) {
        narrow((board) => sizeKey(board.detect && board.detect.flashSize) === sizeKey(flashSize));
    }
    if (vendorId) {
        narrow((board) => usbMatches(board.detect && board.detect.usb, vendorId, productId));
    }
    return { boardId: list[0].id, source: list.length === 1 ? 'chip' : 'guess' };
};

// Carry a pin setup made for formBoard over to rowBoard. A pin on a XIAO pad
// (silk D0, D1, D7-D10) moves to the same pad on the other XIAO; anything
// else falls back to the row board's own default.
const pinsForBoard = (formBoard, rowBoard, { pixels = {}, sdPins = {} } = {}) => {
    if (!rowBoard || !formBoard || rowBoard.id === formBoard.id) {
        return { pixels, sdPins, mapped: false };
    }
    const fromSilk = formBoard.silk || {};
    const toSilk = rowBoard.silk || {};
    const defaults = rowBoard.defaults || {};
    const led = defaults.led || {};
    const sd = defaults.sd || {};
    const carry = (pin, fallback) => {
        const label = Object.keys(fromSilk).find((key) => Number(fromSilk[key]) === Number(pin));
        if (label && toSilk[label] != null) {
            return Number(toSilk[label]);
        }
        return fallback != null ? Number(fallback) : Number(pin);
    };
    return {
        pixels: {
            ...pixels,
            data: carry(pixels.data, led.data),
            clk: carry(pixels.clk, led.clk)
        },
        sdPins: {
            cs: carry(sdPins.cs, sd.cs),
            mosi: carry(sdPins.mosi, sd.mosi),
            clk: carry(sdPins.clk, sd.clk),
            miso: carry(sdPins.miso, sd.miso)
        },
        mapped: true
    };
};

// First "@whip {json}" line in serial text, parsed, or null.
const parseWhipReply = (text) => {
    const lines = String(text || '').split(/\r?\n/);
    for (const line of lines) {
        const at = line.indexOf('@whip ');
        if (at < 0) {
            continue;
        }
        try {
            const json = JSON.parse(line.slice(at + 6).trim());
            if (json && typeof json === 'object') {
                return json;
            }
        } catch (err) {
            // a log line that happened to contain the marker
        }
    }
    return null;
};

module.exports = { usbClass, usbMatches, matchBoard, pinsForBoard, parseWhipReply };
