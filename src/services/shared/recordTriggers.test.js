const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    BLACKOUT_MS,
    SIGNAL_CUT_MS,
    normalizeTriggerConfig,
    zeroChannel,
    createWatch,
    feedArmed,
    beginRecordingWatch,
    feedRecording,
    pollStop,
    omitTriggerChannel,
    formatLookTimestamp,
    isRedundantCompilation
} = require('./recordTriggers');

const frame = (universe, fill, protocol = 'artnet') => {
    const data = Buffer.alloc(512);
    if (typeof fill === 'function') {
        fill(data);
    } else if (fill) {
        data.fill(fill);
    }
    return { protocol, universe, data };
};

test('signal start fires on the first armed packet, including black', () => {
    const watch = createWatch(normalizeTriggerConfig({ startMode: 'signal-start' }));
    assert.equal(feedArmed(watch, frame(1, 0), false), null);
    assert.equal(feedArmed(watch, frame(0, 0), true), 'start');
});

test('signal modified snapshots the first packet and starts on a later change', () => {
    const watch = createWatch(normalizeTriggerConfig({ startMode: 'signal-modified' }));
    const parked = frame(0, 40);
    assert.equal(feedArmed(watch, parked, true), null);
    assert.equal(feedArmed(watch, frame(0, 40), true), null);
    const changed = frame(0, (data) => {
        data.fill(40);
        data[3] = 41;
    });
    assert.equal(feedArmed(watch, changed, true), 'start');
});

test('channel start ignores the level seen at arm and fires on the next change', () => {
    const watch = createWatch(normalizeTriggerConfig({
        startMode: 'channel',
        startChannel: { protocol: 'sacn', universe: 2, channel: 4 }
    }));
    const held = frame(2, (data) => {
        data[3] = 200;
    }, 'sacn');
    assert.equal(feedArmed(watch, held, false), null);
    assert.equal(feedArmed(watch, frame(2, (data) => {
        data[3] = 200;
    }, 'sacn'), false), null);
    assert.equal(feedArmed(watch, frame(2, (data) => {
        data[3] = 255;
    }, 'sacn'), false), 'start');
});

test('the start edge does not also stop when start and stop share a channel', () => {
    const watch = createWatch(normalizeTriggerConfig({
        startMode: 'channel',
        stopMode: 'channel',
        startChannel: { protocol: 'artnet', universe: 0, channel: 1 },
        stopChannel: { protocol: 'artnet', universe: 0, channel: 1 }
    }));
    const go = frame(0, (data) => {
        data[0] = 255;
    });
    beginRecordingWatch(watch, go, true, 1000);
    assert.equal(feedRecording(watch, frame(0, (data) => {
        data[0] = 255;
    }), true, 1100), null);
    assert.equal(feedRecording(watch, frame(0, (data) => {
        data[0] = 0;
    }), true, 1200), 'stop');
});

test('blackout stop waits 5s of zeros and resets when a channel rises', () => {
    const watch = createWatch(normalizeTriggerConfig({ stopMode: 'blackout' }), 0);
    beginRecordingWatch(watch, null, false, 0);
    assert.equal(feedRecording(watch, frame(0, 0), true, 1000), null);
    assert.equal(pollStop(watch, 1000 + BLACKOUT_MS - 1), null);
    assert.equal(pollStop(watch, 1000 + BLACKOUT_MS), 'stop');

    const again = createWatch(normalizeTriggerConfig({ stopMode: 'blackout' }), 0);
    beginRecordingWatch(again, null, false, 0);
    feedRecording(again, frame(0, 0), true, 1000);
    feedRecording(again, frame(0, 10), true, 2000);
    assert.equal(again.blackoutSince, null);
    assert.equal(pollStop(again, 2000 + BLACKOUT_MS), null);
});

test('signal cut stops 2.5s after the last armed packet', () => {
    const watch = createWatch(normalizeTriggerConfig({ stopMode: 'signal-cut' }), 0);
    beginRecordingWatch(watch, frame(0, 0), true, 500);
    assert.equal(pollStop(watch, 500 + SIGNAL_CUT_MS - 1), null);
    feedRecording(watch, frame(3, 0), false, 2000);
    assert.equal(pollStop(watch, 500 + SIGNAL_CUT_MS), 'stop');
    const live = createWatch(normalizeTriggerConfig({ stopMode: 'signal-cut' }), 0);
    beginRecordingWatch(live, null, false, 0);
    feedRecording(live, frame(0, 1), true, 2000);
    assert.equal(pollStop(live, 2000 + SIGNAL_CUT_MS - 1), null);
});

test('zeroChannel copies the buffer and clears only the trigger channel', () => {
    const data = Buffer.alloc(512, 7);
    const masked = zeroChannel(data, 2);
    assert.equal(data[1], 7);
    assert.equal(masked[1], 0);
    assert.equal(masked[0], 7);
});

test('omitTriggerChannel keeps the look-at level for the trigger channel', () => {
    const look = frame(0, (data) => {
        data[4] = 80;
    });
    look.data = Array.from(look.data);
    const live = {
        protocol: 'artnet',
        universe: 0,
        data: Array.from({ length: 512 }, () => 10)
    };
    live.data[4] = 255;
    const [out] = omitTriggerChannel([live], [look], {
        protocol: 'artnet',
        universe: 0,
        channel: 5
    });
    assert.equal(out.data[4], 80);
    assert.equal(out.data[0], 10);
    assert.equal(live.data[4], 255);
});

test('default look name is a filesystem-safe local timestamp', () => {
    const name = formatLookTimestamp(new Date(2026, 8, 24, 19, 4, 5));
    assert.equal(name, '2026-09-24 19-04-05');
    assert.equal(name.includes(':'), false);
});

test('a single full library take is redundant until it is edited or joined', () => {
    const take = {
        kind: 'compilation',
        audioClips: [],
        media: { m1: [{ timestamp: 1500 }] },
        clips: [{
            mediaId: 'm1',
            libraryPath: 'C:/shows/look.dmx',
            sourceInMs: 0,
            sourceOutMs: 1500,
            fadeInMs: 0,
            fadeOutMs: 0,
            universeOffset: 0,
            channelOffset: 0,
            destIp: ''
        }]
    };
    assert.equal(isRedundantCompilation(take), true);
    assert.equal(isRedundantCompilation({
        ...take,
        clips: [{ ...take.clips[0], sourceOutMs: 400 }]
    }), false);
    assert.equal(isRedundantCompilation({
        ...take,
        audioClips: [{ id: 'a' }]
    }), false);
    assert.equal(isRedundantCompilation({
        ...take,
        clips: [take.clips[0], { ...take.clips[0], libraryPath: 'C:/shows/b.dmx' }]
    }), false);
    assert.equal(isRedundantCompilation({
        kind: null,
        clips: [],
        audioClips: []
    }), true);
});
