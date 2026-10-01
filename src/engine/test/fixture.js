// Synthetic DMXREC fixture for the loopback regression test: two Art-Net
// and two sACN universes, a burst of all four every 40 ms, deterministic
// non-zero data so every frame is "woken" and recorded.
const { writeRecording } = require('../../services/shared/dmxRecording');

const UNIVERSES = [
    { protocol: 'artnet', universe: 0 },
    { protocol: 'artnet', universe: 1 },
    { protocol: 'sacn', universe: 1 },
    { protocol: 'sacn', universe: 2 }
];
const FRAME_MS = 40;
const FRAMES = 12;

const patternByte = (protocol, universe, step, channel) => {
    const v = (channel * 3 + step * 7 + universe * 11 + (protocol === 'sacn' ? 50 : 0)) & 255;
    return channel === 0 ? 1 + (step & 0x7f) : v;
};

// Frames in the order flatten emits them: per timestamp, protocols then
// universes ascending.
const buildFixtureFrames = () => {
    const frames = [];
    for (let step = 0; step < FRAMES; step += 1) {
        for (const { protocol, universe } of UNIVERSES) {
            const data = new Uint8Array(512);
            for (let ch = 0; ch < 512; ch += 1) {
                data[ch] = patternByte(protocol, universe, step, ch);
            }
            frames.push({ timestamp: step * FRAME_MS, universe, protocol, data });
        }
    }
    return frames;
};

const writeFixture = (filePath) => {
    const frames = buildFixtureFrames();
    writeRecording(filePath, frames);
    return frames;
};

// Ports for a test run; DMXWHIP_TEST_PORT_BASE keeps parallel runs apart.
const testPorts = () => {
    const base = Number(process.env.DMXWHIP_TEST_PORT_BASE) || 46454;
    return { artnet: base, sacn: base + 1 };
};

module.exports = { UNIVERSES, FRAME_MS, FRAMES, buildFixtureFrames, writeFixture, testPorts };
