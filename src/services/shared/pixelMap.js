// Shim: the pixel map lives in engine core (Uint8Array blob); the Flash
// tab's callers keep getting a Buffer from buildPmapBlob.
const core = require('../../engine/core/pixelMap');

module.exports = {
    ...core,
    buildPmapBlob: (rows) => Buffer.from(core.buildPmapBlob(rows))
};
