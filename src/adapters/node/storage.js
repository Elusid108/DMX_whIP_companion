// Storage port on fs / path / os.tmpdir.
const fs = require('fs');
const os = require('os');
const path = require('path');

let tempSeq = 0;

const createStorage = () => ({
    readFile: (p) => fs.promises.readFile(p),
    readText: (p) => fs.promises.readFile(p, 'utf8'),
    readFileSync: (p) => fs.readFileSync(p),
    readTextSync: (p) => fs.readFileSync(p, 'utf8'),
    writeFileSync: (p, data) => fs.writeFileSync(p, data),
    openWriteSync: (p) => fs.openSync(p, 'w'),
    writeSync: (handle, bytes, offset, length, position) => fs.writeSync(
        handle,
        bytes,
        offset == null ? 0 : offset,
        length == null ? bytes.length : length,
        position == null ? null : position
    ),
    closeSync: (handle) => fs.closeSync(handle),
    existsSync: (p) => fs.existsSync(p),
    mkdirSync: (p) => fs.mkdirSync(p, { recursive: true }),
    statSync: (p) => fs.statSync(p),
    readdirSync: (p) => fs.readdirSync(p, { withFileTypes: true }),
    renameSync: (from, to) => fs.renameSync(from, to),
    unlinkSync: (p) => fs.unlinkSync(p),
    copyFileSync: (from, to) => fs.copyFileSync(from, to),
    realpathSync: (p) => fs.realpathSync.native(p),
    rmSync: (p) => fs.rmSync(p, { recursive: true, force: true }),
    tempFile: (prefix, ext) => path.join(os.tmpdir(), `${prefix}-${process.pid}-${Date.now()}-${tempSeq++}${ext || ''}`),
    join: (...parts) => path.join(...parts),
    dirname: (p) => path.dirname(p),
    basename: (p, ext) => path.basename(p, ext),
    parse: (p) => path.parse(p),
    resolve: (...parts) => path.resolve(...parts),
    relative: (from, to) => path.relative(from, to),
    isAbsolute: (p) => path.isAbsolute(p),
    describe: () => ({ library: true, watch: false, tmp: true })
});

module.exports = { createStorage };
