// Art-Net / sACN receive: the two sockets on the chosen adapter, the
// universe monitor they feed, the armed universes for recording, and the
// ArtPoll send. Behaviour unchanged from Phase J; sockets and timers now
// come from the ports and own-output filtering is per engine.
//
// recording hooks (set with setRecording): { isRecording(), addFrame(frame),
// wantsObserve(), watchesUniverse(protocol, universe), observe(frame, meta) }.
const { createArtNetReceiver, createSacnReceiver } = require('./receivers');
const { createUniverseMonitor } = require('./monitor');

const GRID_FRAME_BYTES = 512 + 64;

// Monitor grid (512 x number|null) -> stream frame bytes: 512 levels then a
// 64-byte woken bitmap (bit set = the channel has carried a non-zero value).
const encodeGridFrame = (values) => {
    const bytes = new Uint8Array(GRID_FRAME_BYTES);
    for (let i = 0; i < 512; i += 1) {
        const v = values[i];
        if (v != null) {
            bytes[i] = v;
            bytes[512 + (i >> 3)] |= 1 << (i & 7);
        }
    }
    return bytes;
};

const decodeGridFrame = (bytes) => {
    const values = new Array(512).fill(null);
    if (!bytes || bytes.length < GRID_FRAME_BYTES) {
        return values;
    }
    for (let i = 0; i < 512; i += 1) {
        if (bytes[512 + (i >> 3)] & (1 << (i & 7))) {
            values[i] = bytes[i];
        }
    }
    return values;
};

// deps: { router, udp, clock, scheduler, log, ownOutput, udpPorts: { artnet, sacn } }
const createReceive = ({ router, udp, clock, scheduler, log, ownOutput, udpPorts = {} } = {}) => {
    const monitor = createUniverseMonitor({ clock, scheduler });
    let artnetReceiver = null;
    let sacnReceiver = null;
    let selectedUniverses = new Set();
    let setupGeneration = 0;
    let nic = '0.0.0.0';
    let wantBound = false;
    let recording = null;
    const pollReplyListeners = new Set();

    const isRecording = () => Boolean(recording && recording.isRecording && recording.isRecording());

    monitor.start(
        (snapshot) => router.emit('monitor.snapshot', snapshot),
        (grid) => router.emitStream(
            'monitor.grid',
            { protocol: grid.protocol, universe: grid.universe, sourceIp: grid.sourceIp, sourceName: grid.sourceName },
            encodeGridFrame(grid.data)
        )
    );

    // The monitor timer runs only while someone listens and no take is
    // being captured (snapshots and the grid stay off the UDP path then).
    const syncEmit = () => {
        const quiet = isRecording();
        monitor.setEmit({
            snapshot: !quiet && router.hasSubscribers('monitor.snapshot'),
            grid: !quiet && router.hasSubscribers('monitor.grid')
        });
    };
    const stopWatch = router.onSubscriptionChange((name) => {
        if (name === 'monitor.snapshot' || name === 'monitor.grid') {
            syncEmit();
        }
    });

    const stopReceivers = () => {
        if (artnetReceiver) {
            artnetReceiver.stop();
            artnetReceiver = null;
        }
        if (sacnReceiver) {
            sacnReceiver.stop();
            sacnReceiver = null;
        }
    };

    // keepMonitor: rebind without clearing what the monitor knows (resume).
    const setupReceivers = async (interfaceIp, { keepMonitor = false } = {}) => {
        const generation = ++setupGeneration;
        nic = interfaceIp || '0.0.0.0';
        wantBound = true;
        stopReceivers();
        if (!keepMonitor) {
            monitor.clear();
            router.emit('monitor.cleared', {});
        }

        const nextArtnet = createArtNetReceiver({ udp, log, port: udpPorts.artnet });
        const nextSacn = createSacnReceiver({ udp, clock, scheduler, log, port: udpPorts.sacn });

        try {
            await nextArtnet.start(nic);
            if (generation !== setupGeneration) {
                nextArtnet.stop();
                return false;
            }
            await nextSacn.start(nic);
            if (generation !== setupGeneration) {
                nextArtnet.stop();
                nextSacn.stop();
                return false;
            }
            artnetReceiver = nextArtnet;
            sacnReceiver = nextSacn;

            const maybeRecord = (protocol, universe, dmxData) => {
                if (!isRecording()) {
                    return;
                }
                if (!selectedUniverses.has(`${protocol}-${universe}`)) {
                    return;
                }
                recording.addFrame({ protocol, universe, data: dmxData });
            };

            const observeDmx = (protocol, universe, dmxData) => {
                if (!recording || !recording.wantsObserve || !recording.wantsObserve()) {
                    return;
                }
                const selected = selectedUniverses.has(`${protocol}-${universe}`);
                const watched = recording.watchesUniverse && recording.watchesUniverse(protocol, universe);
                if (!selected && !watched) {
                    return;
                }
                recording.observe({ protocol, universe, data: dmxData }, { selected });
            };

            const dispatchDmx = (protocol, universe, dmxData, ingest, own) => {
                // Our own playback looping back: show it, never record it or
                // let it fire a record trigger.
                if (own) {
                    if (!isRecording()) {
                        ingest();
                    }
                    return;
                }
                const wasRecording = isRecording();
                if (!wasRecording) {
                    observeDmx(protocol, universe, dmxData);
                }
                if (isRecording()) {
                    maybeRecord(protocol, universe, dmxData);
                    if (wasRecording) {
                        observeDmx(protocol, universe, dmxData);
                    }
                    return;
                }
                ingest();
            };

            artnetReceiver.onDmxData('main', (data) => {
                dispatchDmx('artnet', data.universe, data.dmxData, () => {
                    monitor.ingest({
                        protocol: 'artnet',
                        universe: data.universe,
                        sourceIp: data.sourceIp,
                        dmxData: data.dmxData
                    });
                }, ownOutput.isOwn(data));
            });

            artnetReceiver.onPollReply('main', (reply) => {
                router.emit('artnet.pollReply', reply);
                pollReplyListeners.forEach((fn) => fn(reply));
            });

            sacnReceiver.onDmxData('main', (data) => {
                dispatchDmx('sacn', data.universe, data.dmxData, () => {
                    monitor.ingest({
                        protocol: 'sacn',
                        universe: data.universe,
                        sourceIp: data.sourceIp,
                        sourceName: data.sourceName,
                        dmxData: data.dmxData
                    });
                }, ownOutput.isOwn(data));
            });

            syncEmit();
            return true;
        } catch (error) {
            nextArtnet.stop();
            nextSacn.stop();
            log.error('Error setting up receivers:', error);
            return false;
        }
    };

    const sendPoll = (dest) => Boolean(artnetReceiver && artnetReceiver.sendPoll(dest));

    const state = () => {
        const rows = [];
        for (const entry of monitor.universes.values()) {
            rows.push(monitor.toRow(entry));
        }
        rows.sort((a, b) => (a.protocol === b.protocol ? a.id - b.id : a.protocol.localeCompare(b.protocol)));
        return {
            nic,
            bound: Boolean(artnetReceiver && sacnReceiver),
            selected: monitor.selectedUniverse != null
                ? { protocol: monitor.selectedProtocol, universe: monitor.selectedUniverse }
                : null,
            armed: [...selectedUniverses],
            universes: rows
        };
    };

    router.command('receive.setNic', async ({ nic: wanted } = {}) => {
        const ok = await setupReceivers(typeof wanted === 'string' && wanted ? wanted : '0.0.0.0');
        return { success: ok, nic };
    });
    router.command('receive.setUniverses', ({ universes } = {}) => {
        selectedUniverses = new Set(Array.isArray(universes) ? universes : []);
        return { success: true };
    });
    router.command('monitor.select', ({ protocol, universe } = {}) => {
        monitor.setSelected(protocol, universe);
        return { success: true };
    });
    router.query('monitor.state', () => state());
    router.command('artnet.poll', ({ dest } = {}) => ({ success: sendPoll(typeof dest === 'string' && dest ? dest : undefined) }));

    // Lifecycle: suspend closes the sockets and freezes the monitor (nothing
    // is cleared); resume rebinds on the remembered NIC if we were bound.
    const suspend = () => {
        const wasBound = Boolean(artnetReceiver && sacnReceiver);
        setupGeneration += 1;
        stopReceivers();
        return wasBound;
    };
    const resume = async () => {
        if (!wantBound) {
            return true;
        }
        return setupReceivers(nic, { keepMonitor: true });
    };

    const close = () => {
        setupGeneration += 1;
        stopWatch();
        monitor.stop();
        stopReceivers();
        pollReplyListeners.clear();
    };

    return {
        monitor,
        setRecording: (hooks) => {
            recording = hooks || null;
            syncEmit();
        },
        syncEmit,
        setupReceivers,
        sendPoll,
        onPollReply: (fn) => {
            pollReplyListeners.add(fn);
            return () => pollReplyListeners.delete(fn);
        },
        state,
        isRecording,
        isBound: () => Boolean(artnetReceiver && sacnReceiver),
        armedUniverses: () => selectedUniverses,
        suspend,
        resume,
        close
    };
};

module.exports = { createReceive, encodeGridFrame, decodeGridFrame, GRID_FRAME_BYTES };
