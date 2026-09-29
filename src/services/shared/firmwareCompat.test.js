const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { compareVersions, groupOtaRows, otaVerdict, parseFwTag } = require('./firmwareCompat');

test('compareVersions orders dotted versions numerically', () => {
    assert.equal(compareVersions('0.43.0', '0.44.0'), -1);
    assert.equal(compareVersions('0.44.0', '0.44.0'), 0);
    assert.equal(compareVersions('0.44.10', '0.44.9'), 1);
    assert.equal(compareVersions('1.0', '0.99.99'), 1);
    assert.equal(compareVersions('', '0.1.0'), -1);
});

test('parseFwTag finds the build tag and skips look-alikes', () => {
    const bin = Buffer.concat([
        Buffer.from([0xe9, 0x03, 0x02, 0x20]),
        Buffer.from('WHIPFW:\0\0\0junk'),
        Buffer.from('xxWHIPFW:waveshare-s3-matrix:0.44.0:3;yy', 'latin1')
    ]);
    assert.deepEqual(parseFwTag(bin), { board: 'waveshare-s3-matrix', version: '0.44.0', api: 3 });
    assert.equal(parseFwTag(Buffer.from('no tag here')), null);
});

test('parseFwTag reads a real sibling build when present', (t) => {
    const bin = path.join(__dirname, '../../../../DMX_whIP_embedded/.pio/build/matrix/firmware.bin');
    if (!fs.existsSync(bin)) {
        t.skip('no sibling matrix build');
        return;
    }
    const tag = parseFwTag(fs.readFileSync(bin));
    assert.ok(tag, 'tag found');
    assert.equal(tag.board, 'waveshare-s3-matrix');
    assert.ok(tag.api >= 3);
});

const image = { board: 'b', version: '0.44.0', size: 1300000 };
const status = (over = {}) => ({
    ver: '0.44.0',
    api: 3,
    board: 'b',
    ota: { max: 1966080, busy: false, pending: false },
    ...over
});

test('otaVerdict covers every case', () => {
    assert.equal(otaVerdict(null, image).verdict, 'unknown');
    assert.equal(otaVerdict(status(), null).verdict, 'no-image');
    assert.equal(otaVerdict(status({ board: 'other' }), image).verdict, 'no-image');
    assert.equal(otaVerdict(status(), image).verdict, 'current');
    assert.equal(otaVerdict(status({ ver: '0.45.0' }), image).verdict, 'current');
    assert.equal(otaVerdict(status({ ver: '0.43.0', api: 2, ota: undefined }), image).verdict, 'needs-usb');
    assert.equal(otaVerdict(status({ ver: '0.43.0', ota: { max: 1310720 } }), { ...image, size: 1400000 }).verdict, 'needs-usb');
    assert.equal(otaVerdict(status({ ver: '0.43.0', ota: { max: 1966080, pending: true } }), image).verdict, 'busy');
    const busy = status({ ver: '0.43.0', ota: { max: 1966080, busy: true } });
    assert.equal(otaVerdict(busy, image).verdict, 'busy');
    const forced = otaVerdict(busy, image, { includeBusy: true });
    assert.equal(forced.verdict, 'update');
    assert.equal(forced.busy, true);
    assert.equal(otaVerdict(status({ ver: '0.43.0' }), image).verdict, 'update');
});

test('groupOtaRows splits a mixed rig by board', () => {
    const images = [
        { board: 'seeed-xiao-esp32-c6', boardName: 'Seeed Studio XIAO ESP32-C6' },
        { board: 'seeed-xiao-esp32-c3', boardName: 'Seeed Studio XIAO ESP32-C3' }
    ];
    const row = (id, name, board) => ({ id, name, fw: board === undefined ? null : { board }, image: null });
    const groups = groupOtaRows([
        row('a', 'Stage-10', 'seeed-xiao-esp32-c6'),
        row('b', 'Stage-2', 'seeed-xiao-esp32-c6'),
        row('c', 'Stage-3', 'seeed-xiao-esp32-c3'),
        row('d', 'Old', 'mystery-board'),
        row('e', 'Gone', undefined),
        row('f', 'Blank', '')
    ], images);
    assert.deepEqual(groups.map((g) => g.name), [
        'Seeed Studio XIAO ESP32-C3',
        'Seeed Studio XIAO ESP32-C6',
        'Unknown board mystery-board',
        'Board not reported',
        'No reply'
    ]);
    assert.deepEqual(groups[1].rows.map((r) => r.id), ['b', 'a']);
    assert.equal(groups[0].image.board, 'seeed-xiao-esp32-c3');
    assert.equal(groups[2].image, null);
});
