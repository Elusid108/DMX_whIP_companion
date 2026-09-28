const { app } = require('electron');
const fs = require('fs');
const path = require('path');

// firmware/catalog.json (board profiles) and the folder it lives in. When
// packaged, firmware/ ships under process.resourcesPath.

const repoRoot = () => {
    if (app && app.isPackaged) {
        return process.resourcesPath;
    }
    return path.join(__dirname, '../..');
};

// Sibling firmware checkout (dev only): its .pio builds and dist/ bundles.
const siblingRoot = () => path.join(repoRoot(), '..', 'DMX_whIP_embedded');

const catalogPath = () => path.join(repoRoot(), 'firmware', 'catalog.json');

const loadCatalog = () => {
    const raw = JSON.parse(fs.readFileSync(catalogPath(), 'utf8'));
    if (!raw || !Array.isArray(raw.boards) || !raw.boards.length) {
        throw new Error('firmware/catalog.json has no boards');
    }
    return raw;
};

const boardById = (catalog, id) => {
    const wanted = id || (catalog.boards[0] && catalog.boards[0].id);
    return catalog.boards.find((board) => board.id === wanted) || catalog.boards[0];
};

module.exports = { repoRoot, siblingRoot, catalogPath, loadCatalog, boardById };
