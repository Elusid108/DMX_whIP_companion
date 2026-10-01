/**
 * Clock port.
 * @typedef {Object} ClockPort
 * @property {() => number} now Milliseconds since the epoch (wall clock; stats, stale timers, file names).
 * @property {() => bigint} monotonicNs Monotonic nanoseconds (playback and recording origins).
 */
const assertClock = (clock) => {
    if (!clock || typeof clock.now !== 'function' || typeof clock.monotonicNs !== 'function') {
        throw new Error('ports.clock needs now() and monotonicNs()');
    }
    return clock;
};

module.exports = { assertClock };
