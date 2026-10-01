const crypto = require('crypto');

const createRandom = () => ({
    bytes: (n) => new Uint8Array(crypto.randomBytes(n)),
    uuid: () => crypto.randomUUID()
});

module.exports = { createRandom };
