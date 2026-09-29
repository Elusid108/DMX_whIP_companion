const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { usbClass, usbMatches, matchBoard, pinsForBoard, parseWhipReply } = require('./boardDetect');

const catalog = require(path.join(__dirname, '..', '..', '..', 'firmware', 'catalog.json'));
const boards = catalog.boards;
const byId = (id) => boards.find((board) => board.id === id);

test('usb class', () => {
    assert.strictEqual(usbClass('303a', '1001'), 'esp-usb');
    assert.strictEqual(usbClass('10C4', 'EA60'), 'esp-uart');
    assert.strictEqual(usbClass('1a86', '55d4'), 'esp-uart');
    assert.strictEqual(usbClass('2e8a', '000a'), 'rp');
    assert.strictEqual(usbClass('', ''), '');
    assert.strictEqual(usbMatches(['1A86:*'], '1a86', '7523'), true);
    assert.strictEqual(usbMatches(['303A:1001'], '303a', '1002'), false);
});

test('chip + flash size + usb pick one board', () => {
    assert.deepStrictEqual(matchBoard(boards, { chip: 'ESP32-C6', flashSize: '4MB', vendorId: '303a', productId: '1001' }),
        { boardId: 'seeed-xiao-esp32-c6', source: 'chip' });
    assert.deepStrictEqual(matchBoard(boards, { chip: 'ESP32-C3', flashSize: '4MB' }),
        { boardId: 'seeed-xiao-esp32-c3', source: 'chip' });
    // Two S3 boards: flash size tells them apart.
    assert.deepStrictEqual(matchBoard(boards, { chip: 'ESP32-S3', flashSize: '8MB', vendorId: '303a', productId: '1001' }),
        { boardId: 'seeed-xiao-esp32-s3', source: 'chip' });
    assert.deepStrictEqual(matchBoard(boards, { chip: 'ESP32-S3', flashSize: '4MB', vendorId: '303a', productId: '1001' }),
        { boardId: 'waveshare-s3-matrix', source: 'chip' });
    // Two C5 boards: native USB vs a UART bridge.
    assert.deepStrictEqual(matchBoard(boards, { chip: 'ESP32-C5', flashSize: '8MB', vendorId: '303a', productId: '1001' }),
        { boardId: 'seeed-xiao-esp32-c5', source: 'chip' });
    assert.deepStrictEqual(matchBoard(boards, { chip: 'ESP32-C5', flashSize: '8MB', vendorId: '10c4', productId: 'ea60' }),
        { boardId: 'espressif-c5-devkitc1-n8r4', source: 'chip' });
    // Not enough to tell: a guess.
    assert.strictEqual(matchBoard(boards, { chip: 'ESP32-S3' }).source, 'guess');
    assert.strictEqual(matchBoard(boards, { chip: 'ESP32-H2' }), null);
});

test('pins carry by XIAO pad', () => {
    const s3 = byId('seeed-xiao-esp32-s3');
    const c6 = byId('seeed-xiao-esp32-c6');
    const out = pinsForBoard(s3, c6, {
        pixels: { data: s3.silk.D0, clk: s3.silk.D1, count: 50 },
        sdPins: s3.defaults.sd
    });
    assert.strictEqual(out.mapped, true);
    assert.strictEqual(out.pixels.data, c6.silk.D0);
    assert.strictEqual(out.pixels.clk, c6.silk.D1);
    assert.strictEqual(out.pixels.count, 50);
    assert.deepStrictEqual(out.sdPins, c6.defaults.sd);
    // D2 on the S3 is not a silk pad in the catalog map: row default.
    const odd = pinsForBoard(s3, c6, { pixels: { data: 3 }, sdPins: s3.defaults.sd });
    assert.strictEqual(odd.pixels.data, c6.defaults.led.data);
});

test('pins from a non-XIAO board fall back to the row defaults', () => {
    const matrix = byId('waveshare-s3-matrix');
    const c3 = byId('seeed-xiao-esp32-c3');
    const out = pinsForBoard(matrix, c3, { pixels: { data: 14, clk: 0 }, sdPins: matrix.defaults.sd });
    assert.strictEqual(out.pixels.data, c3.defaults.led.data);
    assert.deepStrictEqual(out.sdPins, c3.defaults.sd);
    const same = pinsForBoard(c3, c3, { pixels: { data: 5 }, sdPins: {} });
    assert.strictEqual(same.mapped, false);
    assert.strictEqual(same.pixels.data, 5);
});

test('whip reply is found among log lines', () => {
    const text = '[V][artnet] rx pkts=5\r\n@whip {"ok":true,"cmd":"id","board":"seeed-xiao-esp32-c6"}\r\n[V][x] y';
    assert.strictEqual(parseWhipReply(text).board, 'seeed-xiao-esp32-c6');
    assert.strictEqual(parseWhipReply('[V][log] no reply'), null);
    assert.strictEqual(parseWhipReply('@whip {broken'), null);
});
