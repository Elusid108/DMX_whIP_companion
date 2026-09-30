const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const {
    validDataGpio,
    validatePixels,
    validateOutputs,
    validateSdPins,
    strappingWarning
} = require('./pixelMap');

const catalog = require(path.join(__dirname, '..', '..', '..', 'firmware', 'catalog.json'));
const boardById = (id) => catalog.boards.find((board) => board.id === id);
const SD_NONE = { cs: 60, mosi: 61, clk: 62, miso: 63 };

test('no rules keeps the S3 limits', () => {
    assert.strictEqual(validDataGpio(14, SD_NONE), true);
    assert.strictEqual(validDataGpio(19, SD_NONE), false);
    assert.strictEqual(validDataGpio(30, SD_NONE), false);
    assert.strictEqual(validDataGpio(48, SD_NONE), true);
    assert.strictEqual(validDataGpio(49, SD_NONE), false);
});

test('board rules replace the S3 limits', () => {
    const c3 = boardById('seeed-xiao-esp32-c3').gpio;
    assert.strictEqual(validDataGpio(2, SD_NONE, c3), true);
    assert.strictEqual(validDataGpio(14, SD_NONE, c3), false);
    assert.strictEqual(validDataGpio(22, SD_NONE, c3), false);
    const c6 = boardById('seeed-xiao-esp32-c6').gpio;
    assert.strictEqual(validDataGpio(3, SD_NONE, c6), false);
    assert.strictEqual(validDataGpio(14, SD_NONE, c6), false);
    assert.strictEqual(validDataGpio(0, SD_NONE, c6), true);
});

test('SD pins still collide', () => {
    const s3 = boardById('seeed-xiao-esp32-s3');
    assert.strictEqual(validDataGpio(44, s3.defaults.sd, s3.gpio), false);
});

test('validatePixels and validateOutputs use the rules', () => {
    const c3 = boardById('seeed-xiao-esp32-c3');
    const bad = validatePixels({ data: 18, count: 10 }, c3.defaults.sd, 1, c3.gpio);
    assert.strictEqual(bad.ok, false);
    const good = validatePixels({ data: 2, count: 10 }, c3.defaults.sd, 1, c3.gpio);
    assert.strictEqual(good.ok, true);
    const outs = [{ data: 18, clk: 0, chip: 'ws2812b', segs: [{ count: 10 }] }];
    assert.strictEqual(validateOutputs(outs, c3.defaults.sd, { gpio: c3.gpio }).ok, false);
});

test('strapping pins warn', () => {
    const c3 = boardById('seeed-xiao-esp32-c3').gpio;
    assert.match(strappingWarning({ data: 2, chip: 'ws2812b' }, c3), /GPIO 2/);
    assert.strictEqual(strappingWarning({ data: 3, chip: 'ws2812b' }, c3), '');
    assert.match(strappingWarning({ data: 3, clk: 8, chip: 'apa102' }, c3), /GPIO 8/);
});

test('catalog boards are self-consistent', () => {
    catalog.boards.forEach((board) => {
        const { led, sd } = board.defaults;
        assert.ok(board.gpio, `${board.id} gpio`);
        assert.ok(['esp', 'rp'].includes(board.family), `${board.id} family`);
        assert.strictEqual(validDataGpio(led.data, sd, board.gpio), true, `${board.id} led data`);
        [sd.cs, sd.mosi, sd.clk, sd.miso].forEach((pin) => {
            assert.ok(!board.gpio.reserved.includes(pin), `${board.id} sd ${pin} reserved`);
            assert.ok(pin <= board.gpio.max, `${board.id} sd ${pin} > max`);
        });
        if (board.silk) {
            assert.strictEqual(led.data, board.silk.D0, `${board.id} D0`);
            assert.strictEqual(led.clk, board.silk.D1, `${board.id} D1`);
            assert.deepStrictEqual(
                [sd.cs, sd.clk, sd.miso, sd.mosi],
                [board.silk.D7, board.silk.D8, board.silk.D9, board.silk.D10],
                `${board.id} D7-D10`
            );
        }
    });
});

test('SD pins follow the board', () => {
    const rp = boardById('seeed-xiao-rp2040');
    assert.strictEqual(validateSdPins(rp.defaults.sd, rp).ok, true);
    // D4/D5/D6 (GPIO 6, 7, 0) are the other SPI0 pins on a XIAO RP2040.
    assert.strictEqual(validateSdPins({ cs: 1, clk: 6, mosi: 7, miso: 0 }, rp).ok, true);
    assert.match(validateSdPins({ cs: 1, clk: 26, mosi: 3, miso: 4 }, rp).error, /CLK must be GPIO 2, 6, 18, 22/);
    assert.match(validateSdPins({ cs: 3, clk: 2, mosi: 3, miso: 4 }, rp).error, /different/);
    const c6 = boardById('seeed-xiao-esp32-c6');
    assert.strictEqual(validateSdPins(c6.defaults.sd, c6).ok, true);
    assert.strictEqual(validateSdPins({ cs: 3, clk: 19, mosi: 18, miso: 20 }, c6).ok, false);
    catalog.boards.forEach((board) => {
        assert.strictEqual(validateSdPins(board.defaults.sd, board).ok, true, board.id);
    });
});
