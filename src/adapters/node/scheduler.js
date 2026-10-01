// Scheduler port on Node timers. Intervals and timeouts are unref'd on
// request only; the engine's own timers keep a headless process alive.
const createScheduler = () => ({
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (id) => clearInterval(id),
    setImmediate: (fn) => setImmediate(fn),
    clearImmediate: (id) => clearImmediate(id)
});

module.exports = { createScheduler };
