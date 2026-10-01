const createLog = () => ({
    info: (...args) => console.log(...args),
    warn: (...args) => console.warn(...args),
    error: (...args) => console.error(...args)
});

module.exports = { createLog };
