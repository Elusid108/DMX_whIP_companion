const { compareVersions, parseFwTag } = require('./firmwareCompat');

// Release bundle manifest written by DMX_whIP_embedded scripts/release.py
// (schema 1). One bundle = one firmware version for every release board.
//
// { schema, version, api, git, built,
//   boards: { <boardId>: { env, family, chip, flash{mode,freq,size},
//     layout{appSize,nvs,nvsSize,otadata,otadataSize},
//     parts: [{ role, file, offset, size, sha256, tag? }] } } }
//
// An RP2040 / RP2350 board (family "rp") has no parts, only
//   uf2: { file, familyId, size, sha256, tag }

const MANIFEST_SCHEMA = 1;
const ESP_ROLES = ['bootloader', 'partitions', 'app'];

const isInt = (value) => Number.isInteger(value) && value >= 0;
const safeFile = (file) => typeof file === 'string' && file.length > 0
    && !file.startsWith('/') && !file.startsWith('\\') && !/(^|[\\/])\.\.([\\/]|$)/.test(file)
    && !/^[a-zA-Z]:/.test(file);

const parsePart = (raw, where) => {
    if (!raw || typeof raw !== 'object') {
        throw new Error(`${where}: bad part`);
    }
    if (!safeFile(raw.file)) {
        throw new Error(`${where}: bad file path`);
    }
    if (!isInt(raw.offset) || !isInt(raw.size)) {
        throw new Error(`${where}: bad offset or size`);
    }
    if (typeof raw.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(raw.sha256)) {
        throw new Error(`${where}: bad sha256`);
    }
    return {
        role: String(raw.role || ''),
        file: raw.file,
        offset: raw.offset,
        size: raw.size,
        sha256: raw.sha256,
        tag: raw.tag ? parseFwTag(String(raw.tag)) : null
    };
};

const parseBoard = (id, raw, version) => {
    if (!raw || typeof raw !== 'object') {
        throw new Error(`${id}: bad board`);
    }
    const family = raw.family || 'esp';
    const parts = {};
    (Array.isArray(raw.parts) ? raw.parts : []).forEach((part, i) => {
        const parsed = parsePart(part, `${id} part ${i}`);
        if (parsed.role) {
            parts[parsed.role] = parsed;
        }
    });
    if (family === 'esp') {
        ESP_ROLES.forEach((role) => {
            if (!parts[role]) {
                throw new Error(`${id}: missing ${role}`);
            }
        });
        const tag = parts.app.tag;
        if (!tag || tag.board !== id || tag.version !== version) {
            throw new Error(`${id}: app tag does not match board ${id} v${version}`);
        }
    }
    let uf2 = null;
    if (family === 'rp') {
        const u = raw.uf2;
        if (!u || typeof u !== 'object' || !safeFile(u.file)) {
            throw new Error(`${id}: missing uf2`);
        }
        if (!isInt(u.size) || typeof u.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(u.sha256)) {
            throw new Error(`${id}: bad uf2 size or sha256`);
        }
        const tag = u.tag ? parseFwTag(String(u.tag)) : null;
        if (!tag || tag.board !== id || tag.version !== version) {
            throw new Error(`${id}: uf2 tag does not match board ${id} v${version}`);
        }
        uf2 = { file: u.file, familyId: String(u.familyId || ''), size: u.size, sha256: u.sha256, tag };
    }
    const layout = raw.layout && typeof raw.layout === 'object' ? raw.layout : {};
    return {
        id,
        env: String(raw.env || ''),
        family,
        chip: String(raw.chip || ''),
        flash: raw.flash && typeof raw.flash === 'object' ? raw.flash : {},
        layout: {
            appSize: isInt(layout.appSize) ? layout.appSize : 0,
            nvs: isInt(layout.nvs) ? layout.nvs : null,
            nvsSize: isInt(layout.nvsSize) ? layout.nvsSize : null,
            otadata: isInt(layout.otadata) ? layout.otadata : null,
            otadataSize: isInt(layout.otadataSize) ? layout.otadataSize : null
        },
        parts,
        uf2
    };
};

// Throws with a reason when the manifest is not a usable schema-1 bundle.
const parseManifest = (raw) => {
    if (!raw || typeof raw !== 'object') {
        throw new Error('manifest is not an object');
    }
    if (raw.schema !== MANIFEST_SCHEMA) {
        throw new Error(`unsupported manifest schema ${raw.schema}`);
    }
    const version = String(raw.version || '');
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
        throw new Error('bad manifest version');
    }
    const boards = {};
    Object.entries(raw.boards || {}).forEach(([id, board]) => {
        boards[id] = parseBoard(id, board, version);
    });
    if (!Object.keys(boards).length) {
        throw new Error('manifest lists no boards');
    }
    return {
        schema: raw.schema,
        version,
        api: Number(raw.api) || 0,
        git: String(raw.git || ''),
        built: String(raw.built || ''),
        boards
    };
};

// Highest version wins; a tie goes to the newer file (a fresh dev build of
// the same version beats an older bundle).
const pickNewest = (candidates) => (candidates || []).reduce((best, cand) => {
    if (!cand) {
        return best;
    }
    if (!best) {
        return cand;
    }
    const cmp = compareVersions(cand.version, best.version);
    if (cmp > 0 || (cmp === 0 && (cand.mtimeMs || 0) > (best.mtimeMs || 0))) {
        return cand;
    }
    return best;
}, null);

module.exports = {
    MANIFEST_SCHEMA,
    parseManifest,
    pickNewest
};
