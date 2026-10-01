// Shim: the Art-Net codec lives in the engine core. Kept so existing paths
// keep working; new code requires src/engine/core/artnet/packet directly.
module.exports = require('../../engine/core/artnet/packet');
