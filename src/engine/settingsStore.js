// Settings store on the Node storage adapter: what hosts and tests call.
// The schema and normalisation are core (src/engine/core/settings.js).
const core = require('./core/settings');
const { createStorage } = require('../adapters/node/storage');

const createSettingsStore = ({ filePath, defaultLibraryDir, storage } = {}) => core.createSettingsStore({
    storage: storage || createStorage(),
    filePath,
    defaultLibraryDir
});

module.exports = { createSettingsStore, normalize: core.normalize };
