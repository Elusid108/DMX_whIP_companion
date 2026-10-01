// The port set a host hands to createEngine. Validated once, up front.
const { assertClock } = require('./clock');
const { assertScheduler } = require('./scheduler');
const { assertUdp } = require('./udp');
const { assertStorage } = require('./storage');
const { assertWorkers } = require('./workers');
const { assertRandom } = require('./random');
const { assertLog, silentLog } = require('./log');
const { assertMidi } = require('./midi');

/**
 * @typedef {Object} Ports
 * @property {import('./clock').ClockPort} clock
 * @property {import('./scheduler').SchedulerPort} scheduler
 * @property {import('./udp').UdpPort} udp
 * @property {import('./storage').StoragePort} storage
 * @property {import('./workers').WorkersPort} workers
 * @property {import('./random').RandomPort} random
 * @property {import('./log').LogPort} [log]
 * @property {import('./midi').MidiPort} [midi]
 */
const assertPorts = (ports) => {
    if (!ports || typeof ports !== 'object') {
        throw new Error('createEngine needs a ports object');
    }
    return {
        clock: assertClock(ports.clock),
        scheduler: assertScheduler(ports.scheduler),
        udp: assertUdp(ports.udp),
        storage: assertStorage(ports.storage),
        workers: assertWorkers(ports.workers),
        random: assertRandom(ports.random),
        log: ports.log ? assertLog(ports.log) : silentLog,
        midi: assertMidi(ports.midi)
    };
};

module.exports = { assertPorts };
