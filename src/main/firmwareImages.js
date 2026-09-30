const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { loadCatalog, repoRoot, siblingRoot } = require('./firmwareCatalog');
const { parseFwTag } = require('../services/shared/firmwareCompat');
const { parseManifest, pickNewest } = require('../services/shared/firmwareManifest');

// Where the app finds firmware for a catalog board, for USB flash and OTA.
// Every source is a candidate; the highest WHIPFW version wins (a tie goes
// to the newer file, so a fresh single-board dev build beats a bundle of the
// same version):
//
//   firmware/releases/<name>/manifest.json   release bundles shipped with the app
//   ../DMX_whIP_embedded/dist/<name>/        bundles from scripts/release.py
//   firmware/artifacts/<class>/              loose bootloader/partitions/firmware
//                                            (RP boards: firmware.uf2 + firmware.bin)
//   ../DMX_whIP_embedded/.pio/build/<env>/   the last PIO build of that env
//
// Bundles carry their own offsets and layout; loose images use the catalog's
// board.flash offsets.

const statOf = (file) => {
    try {
        return fs.statSync(file);
    } catch (err) {
        return null;
    }
};

const tagCache = new Map();

const readTag = (file) => {
    const stat = statOf(file);
    if (!stat) {
        return null;
    }
    const hit = tagCache.get(file);
    if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) {
        return hit;
    }
    let tag = null;
    try {
        tag = parseFwTag(fs.readFileSync(file));
    } catch (err) {
        tag = null;
    }
    const entry = { tag, mtimeMs: stat.mtimeMs, size: stat.size };
    tagCache.set(file, entry);
    return entry;
};

const bundleCache = new Map();

// [{ dir, source, manifest }] for every parseable bundle under root.
const bundlesIn = (root, label) => {
    let names = [];
    try {
        names = fs.readdirSync(root);
    } catch (err) {
        return [];
    }
    const out = [];
    names.forEach((name) => {
        const dir = path.join(root, name);
        const file = path.join(dir, 'manifest.json');
        const stat = statOf(file);
        if (!stat) {
            return;
        }
        let hit = bundleCache.get(file);
        if (!hit || hit.mtimeMs !== stat.mtimeMs) {
            try {
                hit = { mtimeMs: stat.mtimeMs, manifest: parseManifest(JSON.parse(fs.readFileSync(file, 'utf8'))) };
            } catch (err) {
                hit = { mtimeMs: stat.mtimeMs, manifest: null, error: err.message };
                console.warn(`firmware bundle ${file}: ${err.message}`);
            }
            bundleCache.set(file, hit);
        }
        if (hit.manifest) {
            out.push({ dir, source: `${label}/${name}`, manifest: hit.manifest });
        }
    });
    return out;
};

const allBundles = () => [
    ...bundlesIn(path.join(repoRoot(), 'firmware', 'releases'), 'firmware/releases'),
    ...bundlesIn(path.join(siblingRoot(), 'dist'), 'DMX_whIP_embedded/dist')
];

// RP2040 / RP2350: one firmware.uf2, copied onto the board's USB drive.
const fromBundleRp = (bundle, board, entry) => {
    const file = path.join(bundle.dir, ...entry.uf2.file.split('/'));
    const stat = statOf(file);
    if (!stat) {
        return null;
    }
    return {
        board: board.id,
        family: 'rp',
        version: bundle.manifest.version,
        api: entry.uf2.tag.api,
        source: bundle.source,
        mtimeMs: stat.mtimeMs,
        size: entry.uf2.size,
        path: file,
        files: { uf2: file },
        sha256: { uf2: entry.uf2.sha256 }
    };
};

const fromBundle = (bundle, board) => {
    const entry = bundle.manifest.boards[board.id];
    if (!entry || entry.family !== (board.family || 'esp')) {
        return null;
    }
    if (entry.family === 'rp') {
        return fromBundleRp(bundle, board, entry);
    }
    if (entry.family !== 'esp') {
        return null;
    }
    const abs = (part) => path.join(bundle.dir, ...part.file.split('/'));
    const app = entry.parts.app;
    const appStat = statOf(abs(app));
    if (!appStat || !statOf(abs(entry.parts.bootloader)) || !statOf(abs(entry.parts.partitions))) {
        return null;
    }
    return {
        board: board.id,
        version: bundle.manifest.version,
        api: app.tag.api,
        source: bundle.source,
        mtimeMs: appStat.mtimeMs,
        size: app.size,
        path: abs(app),
        files: {
            bootloader: abs(entry.parts.bootloader),
            partitions: abs(entry.parts.partitions),
            firmware: abs(app)
        },
        sha256: {
            bootloader: entry.parts.bootloader.sha256,
            partitions: entry.parts.partitions.sha256,
            firmware: app.sha256
        },
        offsets: {
            bootloader: entry.parts.bootloader.offset,
            partitions: entry.parts.partitions.offset,
            app: app.offset
        },
        layout: entry.layout
    };
};

const looseDirs = (board) => {
    const flashClass = board.artifact || board.flashClass;
    const env = String(board.pioEnv || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const dirs = [];
    if (flashClass) {
        dirs.push({ dir: path.join(repoRoot(), 'firmware', 'artifacts', flashClass), source: `firmware/artifacts/${flashClass}` });
    }
    if (env) {
        dirs.push({ dir: path.join(siblingRoot(), '.pio', 'build', env), source: `DMX_whIP_embedded/.pio/build/${env}` });
    }
    return dirs;
};

// The tag is read from firmware.bin next to the UF2: inside a UF2 it can
// straddle two blocks.
const fromLooseRp = ({ dir, source }, board) => {
    const uf2 = path.join(dir, 'firmware.uf2');
    const stat = statOf(uf2);
    if (!stat) {
        return null;
    }
    const read = readTag(path.join(dir, 'firmware.bin'));
    const tag = read && read.tag;
    if (tag && tag.board !== board.id) {
        return null;
    }
    return {
        board: board.id,
        family: 'rp',
        version: tag ? tag.version : '0.0.0',
        api: tag ? tag.api : 0,
        tagged: Boolean(tag),
        source,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        path: uf2,
        files: { uf2 },
        sha256: null
    };
};

const fromLoose = ({ dir, source }, board) => {
    if (board.family === 'rp') {
        return fromLooseRp({ dir, source }, board);
    }
    const files = {
        bootloader: path.join(dir, 'bootloader.bin'),
        partitions: path.join(dir, 'partitions.bin'),
        firmware: path.join(dir, 'firmware.bin')
    };
    if (!Object.values(files).every((file) => statOf(file))) {
        return null;
    }
    const read = readTag(files.firmware);
    const tag = read && read.tag;
    if (tag && tag.board !== board.id) {
        return null;
    }
    const flash = board.flash || {};
    const num = (value, fallback) => (Number.isInteger(Number(value)) && value !== '' && value != null ? Number(value) : fallback);
    return {
        board: board.id,
        // Untagged (pre-OTA) images can still be flashed over USB.
        version: tag ? tag.version : '0.0.0',
        api: tag ? tag.api : 0,
        tagged: Boolean(tag),
        source,
        mtimeMs: read ? read.mtimeMs : 0,
        size: read ? read.size : 0,
        path: files.firmware,
        files,
        sha256: null,
        offsets: {
            bootloader: num(flash.bootloader, 0),
            partitions: num(flash.partitions, 0x8000),
            app: num(flash.app, 0x10000)
        },
        layout: {
            nvs: num(flash.nvs, 0x9000),
            nvsSize: num(flash.nvsSize, 20480),
            otadata: flash.otadata ? Number(flash.otadata) : null,
            otadataSize: num(flash.otadataSize, 0x2000)
        }
    };
};

// Best image for one catalog board, or null.
const imageFor = (board) => {
    if (!board) {
        return null;
    }
    const candidates = [
        ...allBundles().map((bundle) => fromBundle(bundle, board)),
        ...looseDirs(board).map((dir) => fromLoose(dir, board))
    ];
    return pickNewest(candidates.filter(Boolean));
};

const describeImage = (image) => (image.version !== '0.0.0'
    ? `${image.source} (v${image.version})`
    : image.source);

// For USB flash: throws when there is nothing to write.
const resolveImage = (board) => {
    const image = imageFor(board);
    if (image) {
        return image;
    }
    const env = board && board.pioEnv;
    throw new Error(
        `No firmware for ${board ? board.name : 'this board'}. Use Build all (runs scripts/release.py in DMX_whIP_embedded)`
        + `${env ? `, build [env:${env}]` : ''}, or put a release bundle in firmware/releases/.`
    );
};

// Bytes of one image file; bundle files must match their manifest sha256.
const readImageFile = (image, role) => {
    const data = fs.readFileSync(image.files[role]);
    const want = image.sha256 && image.sha256[role];
    if (want && crypto.createHash('sha256').update(data).digest('hex') !== want) {
        throw new Error(`${path.basename(image.files[role])} in ${image.source} does not match its manifest (sha256)`);
    }
    return Uint8Array.from(data);
};

// OTA: { [boardId]: { board, boardName, version, api, size, path, source, sha256 } }
// for every catalog board with a tagged image.
const listImages = () => {
    let catalog;
    try {
        catalog = loadCatalog();
    } catch (err) {
        return {};
    }
    const out = {};
    catalog.boards.forEach((board) => {
        // No radio, no over-the-air update.
        if (board.family === 'rp') {
            return;
        }
        const image = imageFor(board);
        if (!image || image.version === '0.0.0') {
            return;
        }
        out[board.id] = {
            board: board.id,
            boardName: board.name,
            version: image.version,
            api: image.api,
            size: image.size,
            path: image.path,
            source: image.source,
            sha256: image.sha256 ? image.sha256.firmware : null
        };
    });
    return out;
};

// OTA: true when an image from listImages still matches its bundle sha256
// (loose images have none to check).
const verifyListedImage = (image) => {
    if (!image || !image.sha256) {
        return Boolean(image);
    }
    try {
        return crypto.createHash('sha256').update(fs.readFileSync(image.path)).digest('hex') === image.sha256;
    } catch (err) {
        return false;
    }
};

module.exports = { imageFor, resolveImage, readImageFile, describeImage, listImages, verifyListedImage };
