const test = require('node:test');
const assert = require('node:assert/strict');
const { createLiveOutput, KEEPALIVE_MS, RELEASE_MS, OPTION_TERMINATED } = require('./liveOutput');

// Fake clock and sockets; tick() is driven by hand.
const rig = () => {
    let t = 1000;
    const sent = [];
    const live = createLiveOutput({
        cid: Buffer.alloc(16),
        now: () => t,
        setTimer: () => 1,
        clearTimer: () => {},
        makeArt: async () => ({ send: (uni, data, dest) => { sent.push({ proto: 'artnet', uni, v: Array.from(data.slice(0, 4)), dest }); }, stop() {} }),
        makeSacn: async () => ({
            send: (uni, data, dest, options) => { sent.push({ proto: 'sacn', uni, v: Array.from(data.slice(0, 4)), dest, options }); },
            sendDiscovery: async () => {},
            close() {}
        })
    });
    const step = async (ms) => {
        t += ms;
        live.tick();
        await new Promise((r) => setImmediate(r));
    };
    return { live, sent, step };
};

test('sends on change, keeps alive, releases after all-zero', async () => {
    const { live, sent, step } = rig();
    live.set([{ proto: 'artnet', uni: 0, ch: 2, value: 200 }]);
    await step(0); // opens sockets
    await step(25);
    assert.deepEqual(sent.map((s) => s.v), [[0, 200, 0, 0]]);
    await step(25);
    assert.equal(sent.length, 1, 'no resend without a change');
    await step(KEEPALIVE_MS);
    assert.equal(sent.length, 2, 'keepalive');
    live.set([{ proto: 'artnet', uni: 0, ch: 2, value: 0 }]);
    await step(25);
    assert.deepEqual(sent[2].v, [0, 0, 0, 0]);
    await step(RELEASE_MS);
    const n = sent.length;
    await step(KEEPALIVE_MS * 2);
    assert.equal(sent.length, n, 'released universes stop');
    assert.equal(live.state().universes.length, 0);
});

test('zero levels on an untouched universe send nothing', async () => {
    const { live, sent, step } = rig();
    live.set([{ proto: 'artnet', uni: 5, ch: 1, value: 0 }]);
    await step(25);
    assert.equal(sent.length, 0);
});

test('sACN release sends stream-terminated', async () => {
    const { live, sent, step } = rig();
    live.set([{ proto: 'sacn', uni: 3, ch: 1, value: 10 }]);
    await step(0);
    await step(25);
    live.releaseAll();
    await step(25);
    await step(RELEASE_MS);
    const terminated = sent.filter((s) => s.options === OPTION_TERMINATED);
    assert.equal(terminated.length, 3);
    assert.deepEqual(terminated[0].v, [0, 0, 0, 0]);
});

test('playback owns a universe: merge HTP and ask for a resend', async () => {
    const { live, sent, step } = rig();
    const resends = [];
    live.attachPlayback({ owns: (p, u) => p === 'artnet' && u === 0, resend: (p, u) => resends.push(`${p}:${u}`) });
    live.set([{ proto: 'artnet', uni: 0, ch: 1, value: 50 }, { proto: 'artnet', uni: 0, ch: 3, value: 250 }]);
    await step(0);
    await step(25);
    assert.equal(sent.length, 0, 'playback sends it, not us');
    assert.deepEqual(resends, ['artnet:0']);
    const merged = live.merge('artnet', 0, Uint8Array.from([100, 7, 9]));
    assert.deepEqual(Array.from(merged.slice(0, 4)), [100, 7, 250, 0]);
    const plain = Uint8Array.from([1, 2]);
    assert.equal(live.merge('artnet', 9, plain), plain);
    // Playback stops owning it: we send ours straight away.
    live.attachPlayback(null);
    live.kick();
    await step(25);
    assert.deepEqual(sent.map((s) => s.v), [[50, 0, 250, 0]]);
});

test('destination and bad changes', async () => {
    const { live, sent, step } = rig();
    live.configure({ dest: '10.0.0.9' });
    live.set([{ proto: 'artnet', uni: 1, ch: 0, value: 9 }, { proto: 'artnet', uni: 1, ch: 513, value: 9 }, { proto: 'artnet', uni: 1, ch: 512, value: 9 }]);
    await step(0);
    await step(25);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].dest, '10.0.0.9');
});
