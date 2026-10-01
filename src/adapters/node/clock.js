// Clock port on Node: wall clock for stats and names, hrtime for origins.
const createClock = () => ({
    now: () => Date.now(),
    monotonicNs: () => process.hrtime.bigint()
});

module.exports = { createClock };
