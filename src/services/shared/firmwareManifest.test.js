const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { parseManifest, pickNewest } = require('./firmwareManifest');

const sha = 'a'.repeat(64);
const part = (role, file, offset, extra = {}) => ({ role, file, offset, size: 10, sha256: sha, ...extra });
const board = (id, version, over = {}) => ({
    env: 'xiao-c6',
    family: 'esp',
    chip: 'esp32c6',
    flash: { mode: 'dio', freq: '80m', size: '4MB' },
    layout: { appSize: 1966080, nvs: 36864, nvsSize: 20480, otadata: 57344, otadataSize: 8192 },
    parts: [
        part('bootloader', `${id}/bootloader.bin`, 0),
        part('partitions', `${id}/partitions.bin`, 32768),
        part('app', `${id}/firmware.bin`, 65536, { tag: `WHIPFW:${id}:${version}:3;` })
    ],
    ...over
});
const manifest = (over = {}) => ({
    schema: 1,
    version: '0.53.0',
    api: 3,
    boards: { 'seeed-xiao-esp32-c6': board('seeed-xiao-esp32-c6', '0.53.0') },
    ...over
});

test('parses a schema-1 bundle', () => {
    const m = parseManifest(manifest());
    const c6 = m.boards['seeed-xiao-esp32-c6'];
    assert.strictEqual(m.version, '0.53.0');
    assert.strictEqual(c6.parts.app.offset, 65536);
    assert.strictEqual(c6.parts.bootloader.offset, 0);
    assert.deepStrictEqual(c6.parts.app.tag, { board: 'seeed-xiao-esp32-c6', version: '0.53.0', api: 3 });
    assert.strictEqual(c6.layout.nvs, 36864);
});

test('rejects bad bundles', () => {
    assert.throws(() => parseManifest(manifest({ schema: 2 })), /schema/);
    assert.throws(() => parseManifest(manifest({ boards: {} })), /no boards/);
    const wrongTag = manifest();
    wrongTag.boards['seeed-xiao-esp32-c6'].parts[2].tag = 'WHIPFW:other:0.53.0:3;';
    assert.throws(() => parseManifest(wrongTag), /tag/);
    const oldTag = manifest();
    oldTag.boards['seeed-xiao-esp32-c6'].parts[2].tag = 'WHIPFW:seeed-xiao-esp32-c6:0.52.0:3;';
    assert.throws(() => parseManifest(oldTag), /tag/);
    const escape = manifest();
    escape.boards['seeed-xiao-esp32-c6'].parts[0].file = '../../evil.bin';
    assert.throws(() => parseManifest(escape), /file path/);
    const missing = manifest();
    missing.boards['seeed-xiao-esp32-c6'].parts.pop();
    assert.throws(() => parseManifest(missing), /missing app/);
});

test('newest version wins, ties go to the newer file', () => {
    const a = { version: '0.53.0', mtimeMs: 10, id: 'a' };
    const b = { version: '0.52.9', mtimeMs: 99, id: 'b' };
    const c = { version: '0.53.0', mtimeMs: 20, id: 'c' };
    assert.strictEqual(pickNewest([a, b]).id, 'a');
    assert.strictEqual(pickNewest([a, b, c]).id, 'c');
    assert.strictEqual(pickNewest([]), null);
});

test('a real release bundle parses (when one has been built)', (t) => {
    const dist = path.join(__dirname, '..', '..', '..', '..', 'DMX_whIP_embedded', 'dist');
    let dirs = [];
    try {
        dirs = fs.readdirSync(dist).filter((name) => fs.existsSync(path.join(dist, name, 'manifest.json')));
    } catch (err) {
        dirs = [];
    }
    if (!dirs.length) {
        t.skip('no DMX_whIP_embedded/dist bundle');
        return;
    }
    dirs.forEach((dir) => {
        const m = parseManifest(JSON.parse(fs.readFileSync(path.join(dist, dir, 'manifest.json'), 'utf8')));
        Object.values(m.boards).forEach((b) => {
            Object.values(b.parts).forEach((p) => {
                assert.ok(fs.existsSync(path.join(dist, dir, p.file)), `${dir}/${p.file}`);
            });
        });
    });
});

test('an RP board carries a uf2', () => {
    const rp = (over = {}) => ({
        env: 'xiao-rp2040',
        family: 'rp',
        chip: 'rp2040',
        uf2: {
            file: 'seeed-xiao-rp2040/firmware.uf2',
            familyId: '0xe48bff56',
            size: 352768,
            sha256: sha,
            tag: 'WHIPFW:seeed-xiao-rp2040:0.53.0:3;',
            ...over
        }
    });
    const m = parseManifest(manifest({ boards: { 'seeed-xiao-rp2040': rp() } }));
    const board = m.boards['seeed-xiao-rp2040'];
    assert.strictEqual(board.family, 'rp');
    assert.strictEqual(board.uf2.size, 352768);
    assert.strictEqual(board.uf2.tag.version, '0.53.0');
    assert.throws(() => parseManifest(manifest({ boards: { 'seeed-xiao-rp2040': rp({ tag: 'WHIPFW:other:0.53.0:3;' }) } })), /uf2 tag/);
    assert.throws(() => parseManifest(manifest({ boards: { 'seeed-xiao-rp2040': rp({ file: '../x.uf2' }) } })), /missing uf2/);
    assert.throws(() => parseManifest(manifest({ boards: { 'seeed-xiao-rp2040': { family: 'rp' } } })), /missing uf2/);
});
