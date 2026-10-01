/**
 * Log port.
 * @typedef {Object} LogPort
 * @property {(...args: any[]) => void} info
 * @property {(...args: any[]) => void} warn
 * @property {(...args: any[]) => void} error
 */
const assertLog = (log) => {
    for (const name of ['info', 'warn', 'error']) {
        if (!log || typeof log[name] !== 'function') {
            throw new Error(`ports.log needs ${name}()`);
        }
    }
    return log;
};

const silentLog = { info: () => {}, warn: () => {}, error: () => {} };

module.exports = { assertLog, silentLog };
