/**
 * MIDI port (interface only). Web MIDI stays in the renderer today
 * (src/renderer/midiStore.js); when a host can provide MIDI natively it
 * supplies this and the Control surface mapping can move into core.
 *
 * @typedef {Object} MidiPort
 * @property {() => Promise<Array<{ id: string, name: string, input: boolean, output: boolean }>>} list
 * @property {(fn: (message: { portId: string, bytes: Uint8Array, at: number }) => void) => () => void} onMessage
 * @property {(portId: string, bytes: Uint8Array) => void} send
 */
const assertMidi = (midi) => {
    if (midi && (typeof midi.list !== 'function' || typeof midi.onMessage !== 'function' || typeof midi.send !== 'function')) {
        throw new Error('ports.midi needs list(), onMessage() and send()');
    }
    return midi || null;
};

module.exports = { assertMidi };
