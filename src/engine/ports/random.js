/**
 * Random port: ids and the sACN CID.
 * @typedef {Object} RandomPort
 * @property {(n: number) => Uint8Array} bytes
 * @property {() => string} uuid RFC 4122 string.
 */
const assertRandom = (random) => {
    if (!random || typeof random.bytes !== 'function' || typeof random.uuid !== 'function') {
        throw new Error('ports.random needs bytes() and uuid()');
    }
    return random;
};

module.exports = { assertRandom };
