const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { INVOKE, SEND, EVENTS, HOST_EVENTS, companionReason } = require('./engineChannels');

// Every channel the preload allow-lists is either routed to the engine or
// named as companion-only, and every engine route has an engine handler.
const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
const listOf = (name) => {
    const m = preload.match(new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`));
    return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
};

test('every allow-listed request channel is an engine route or companion-only', () => {
    const unrouted = [];
    for (const channel of listOf('INVOKE')) {
        if (!INVOKE[channel] && !companionReason(channel)) unrouted.push(channel);
        if (INVOKE[channel] && SEND[channel]) unrouted.push(`${channel} (both invoke and send)`);
    }
    for (const channel of listOf('SEND')) {
        if (!SEND[channel] && !companionReason(channel)) unrouted.push(channel);
    }
    assert.deepEqual(unrouted, []);
});

test('every allow-listed event channel comes from the engine or the companion', () => {
    const fromEngine = new Set([...Object.values(EVENTS).map((e) => e.channel), ...Object.keys(HOST_EVENTS)]);
    const unrouted = listOf('RECEIVE').filter((channel) => !fromEngine.has(channel) && !companionReason(channel));
    assert.deepEqual(unrouted, []);
});

test('every engine route names a registered command or query', () => {
    const os = require('os');
    const { createSettingsStore } = require('../engine/settingsStore');
    const { createEngine } = require('../engine');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whip-channels-'));
    const engine = createEngine({
        settings: createSettingsStore({ filePath: path.join(dir, 'settings.json'), defaultLibraryDir: path.join(dir, 'Shows') })
    });
    try {
        const missing = [];
        for (const [channel, spec] of Object.entries(INVOKE)) {
            if (!engine.router.has(spec.name)) missing.push(`${channel} -> ${spec.name}`);
        }
        for (const [channel, spec] of Object.entries(SEND)) {
            if (!engine.router.has(spec.name)) missing.push(`${channel} -> ${spec.name}`);
        }
        assert.deepEqual(missing, []);
    } finally {
        engine.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
