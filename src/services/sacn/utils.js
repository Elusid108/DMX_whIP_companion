// Shim: the E1.31 codec lives in the engine core. The core needs a CID from
// its caller; this shim keeps the old convenience of a random one.
const crypto = require('crypto');
const core = require('../../engine/core/sacn/packet');

const withCid = (options = {}) => (options.cid ? options : { ...options, cid: crypto.randomBytes(16) });

module.exports = {
    ...core,
    createSacnDmxPacket: (universe, dmxData, options) => core.createSacnDmxPacket(universe, dmxData, withCid(options)),
    createSacnDiscoveryPacket: (universes, options) => core.createSacnDiscoveryPacket(universes, withCid(options))
};
