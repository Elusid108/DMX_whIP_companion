/**
 * Scheduler port: the only way core defers work. Ids are opaque.
 * @typedef {Object} SchedulerPort
 * @property {(fn: Function, ms: number) => any} setTimeout
 * @property {(id: any) => void} clearTimeout
 * @property {(fn: Function, ms: number) => any} setInterval
 * @property {(id: any) => void} clearInterval
 * @property {(fn: Function) => any} setImmediate Runs after I/O callbacks, before the next timer.
 * @property {(id: any) => void} clearImmediate
 */
const METHODS = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate'];

const assertScheduler = (scheduler) => {
    for (const name of METHODS) {
        if (!scheduler || typeof scheduler[name] !== 'function') {
            throw new Error(`ports.scheduler needs ${name}()`);
        }
    }
    return scheduler;
};

module.exports = { assertScheduler, METHODS };
