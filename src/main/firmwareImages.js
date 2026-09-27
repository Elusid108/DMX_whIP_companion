const fs = require('fs');
const path = require('path');
const { loadCatalog, repoRoot } = require('./firmwareFlash');
const { compareVersions, parseFwTag } = require('../services/shared/firmwareCompat');

// The newest OTA image this app has for each catalog board: a bundled
// firmware/artifacts/<class>/firmware.bin or the sibling DMX_whIP_embedded
// PIO build, whichever carries the higher version in its WHIPFW tag. Images
// without a tag (older firmware) are left out; they can still be flashed
// over USB.

const cache = new Map();

const readImage = (file) => {
    let stat;
    try {
        stat = fs.statSync(file);
    } catch (err) {
        return null;
    }
    const hit = cache.get(file);
    if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) {
        return hit;
    }
    let tag = null;
    try {
        tag = parseFwTag(fs.readFileSync(file));
    } catch (err) {
        tag = null;
    }
    const image = { file, size: stat.size, mtimeMs: stat.mtimeMs, tag };
    cache.set(file, image);
    return image;
};

const candidates = (board) => {
    const flashClass = board.artifact || board.flashClass;
    const env = String(board.pioEnv || 'matrix').replace(/[^a-zA-Z0-9_-]/g, '');
    return [
        {
            file: path.join(repoRoot(), 'firmware', 'artifacts', flashClass, 'firmware.bin'),
            source: `firmware/artifacts/${flashClass}`
        },
        {
            file: path.join(repoRoot(), '..', 'DMX_whIP_embedded', '.pio', 'build', env, 'firmware.bin'),
            source: `DMX_whIP_embedded build (${env})`
        }
    ];
};

// { [boardId]: { board, boardName, version, api, size, path, source } }
const listImages = () => {
    let catalog;
    try {
        catalog = loadCatalog();
    } catch (err) {
        return {};
    }
    const out = {};
    for (const board of catalog.boards) {
        let best = null;
        for (const cand of candidates(board)) {
            const image = readImage(cand.file);
            if (!image || !image.tag || image.tag.board !== board.id) {
                continue;
            }
            if (!best || compareVersions(image.tag.version, best.version) > 0) {
                best = {
                    board: board.id,
                    boardName: board.name,
                    version: image.tag.version,
                    api: image.tag.api,
                    size: image.size,
                    path: image.file,
                    source: cand.source
                };
            }
        }
        if (best) {
            out[board.id] = best;
        }
    }
    return out;
};

module.exports = { listImages };
