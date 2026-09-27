// USB MIDI for the Live tab (Web MIDI in the renderer). Runs from app start
// so any number of controllers drive the faders and pads from any tab.
//
// Devices: every connected port is opened and listed, hot-plug included
// (plus Rescan). Two identical controllers get "#2", "#3" by port order.
// A port another program holds open shows as busy.
//
// Learn: turn Learn on, click a fader or pad (it listens), then move or press
// something on the controller. The first note, CC or pitch bend is captured,
// the control stops listening, and Learn stays on for the next control.
//
// Feedback: pads light through the controller's profile (midiProfiles.js)
// or a per-device on value; faders send their level back only when it
// changed in the app, so a motor fader never fights its own messages.
const liveStore = require('./liveStore');
const {
    clearDevice,
    clearTarget,
    deviceKey,
    faderValue,
    feedbackBytes,
    findTargets,
    learnMap,
    midiLabel,
    parseMidi,
    targetInfo
} = require('../services/shared/liveControl');
const { padLight, profileFor } = require('../services/shared/midiProfiles');

const FEEDBACK_MS = 20;
const ACTIVITY_MS = 400;
const TEST_MS = 1200;

let access = null;
let started = false;
let status = 'idle'; // idle | ready | unsupported | denied
let learning = false;
let armed = null;
let captured = null;
let heard = null;
const inputs = new Map(); // port id -> { port, key, busy }
const outputs = new Map(); // device key -> { port, busy }
const info = new Map(); // device key -> { name, manufacturer, profile }
const activity = new Map(); // device key -> last message time
const sent = new Map(); // 'target|device' -> last value sent back
const lastAt = new Map();
const timers = new Map();
const testing = new Set();
const listeners = new Set();
let lastMidi = null;
let snapshot = null;
let activityTimer = null;

const buildSnapshot = () => {
    const { layout } = liveStore.getSnapshot();
    const inputKeys = new Map();
    inputs.forEach((entry) => inputKeys.set(entry.key, entry));
    const keys = new Set([...inputKeys.keys(), ...outputs.keys(), ...Object.keys(layout.midi.devices)]);
    layout.midi.maps.forEach((map) => keys.add(map.device));
    const now = performance.now();
    const devices = [...keys].sort((a, b) => a.localeCompare(b)).map((key) => {
        const input = inputKeys.get(key);
        const out = outputs.get(key);
        const saved = layout.midi.devices[key] || {};
        const meta = info.get(key);
        return {
            key,
            online: Boolean(input),
            busy: Boolean((input && input.busy) || (out && out.busy)),
            output: Boolean(out && !out.busy),
            profile: meta ? meta.profile.label : '',
            manufacturer: meta ? meta.manufacturer : '',
            active: now - (activity.get(key) || -1e9) < ACTIVITY_MS,
            feedback: saved.feedback !== false,
            on: saved.on || 0,
            maps: layout.midi.maps.filter((map) => map.device === key).length
        };
    });
    snapshot = { status, learning, armed, captured, heard, devices, maps: layout.midi.maps };
};

const publish = () => {
    buildSnapshot();
    listeners.forEach((listener) => listener());
};

// ------------------------------------------------------------ feedback

const deviceOptions = (device) => {
    const d = liveStore.getSnapshot().layout.midi.devices[device] || {};
    return { feedback: d.feedback !== false, on: d.on || 0 };
};

const sendBytes = (device, messages) => {
    const out = outputs.get(device);
    if (!out || out.busy || !messages) {
        return false;
    }
    try {
        messages.forEach((bytes) => out.port.send(bytes));
        return true;
    } catch (err) {
        return false; // port went away between the check and the send
    }
};

const messagesFor = (map, value, isPad) => {
    if (!isPad) {
        return [feedbackBytes(map, value, false)];
    }
    const meta = info.get(map.device);
    return padLight(meta ? meta.profile : null, map, Boolean(value), deviceOptions(map.device).on);
};

const sendNow = (key, map, value, isPad) => {
    if (sendBytes(map.device, messagesFor(map, value, isPad))) {
        sent.set(key, value);
        lastAt.set(key, performance.now());
    }
};

const currentValue = (target) => {
    const { state } = liveStore.getSnapshot();
    const t = targetInfo(target);
    if (!t) {
        return null;
    }
    return t.kind === 'pads' ? Boolean(state.pads[t.index]) : state.faders[t.index];
};

const sendFeedback = (map, value, isPad) => {
    const key = `${map.target}|${map.device}`;
    if (sent.get(key) === value) {
        return;
    }
    const wait = FEEDBACK_MS - (performance.now() - (lastAt.get(key) || 0));
    if (wait <= 0) {
        sendNow(key, map, value, isPad);
        return;
    }
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => {
        timers.delete(key);
        const latest = currentValue(map.target);
        if (latest !== null && sent.get(key) !== latest) {
            sendNow(key, map, latest, isPad);
        }
    }, wait));
};

const syncFeedback = () => {
    const { layout } = liveStore.getSnapshot();
    layout.midi.maps.forEach((map) => {
        if (!outputs.has(map.device) || testing.has(map.device) || !deviceOptions(map.device).feedback) {
            return;
        }
        const t = targetInfo(map.target);
        if (t) {
            sendFeedback(map, currentValue(map.target), t.kind === 'pads');
        }
    });
};

const forgetSent = (device) => {
    [...sent.keys()].filter((k) => k.endsWith(`|${device}`)).forEach((k) => sent.delete(k));
};

// ------------------------------------------------------------ input

const noteActivity = (device) => {
    activity.set(device, performance.now());
    if (!activityTimer) {
        publish();
        activityTimer = setTimeout(() => {
            activityTimer = null;
            publish();
        }, ACTIVITY_MS);
    }
};

const onMessage = (device, data) => {
    const msg = parseMidi(data);
    if (!msg) {
        return;
    }
    noteActivity(device);
    const { layout } = liveStore.getSnapshot();
    if (learning) {
        heard = { device, label: midiLabel(msg) };
        // A release (note off) can't start a mapping: it is the tail of a
        // press made before the control was armed.
        if (armed && !(msg.kind === 'note' && !msg.on)) {
            const target = armed;
            armed = null;
            captured = { target, device, label: midiLabel(msg) };
            const devices = layout.midi.devices[device]
                ? layout.midi.devices
                : { ...layout.midi.devices, [device]: { feedback: true, on: 0 } };
            liveStore.setMidi({ maps: learnMap(layout.midi.maps, target, device, msg), devices });
            publish();
            return;
        }
        publish();
    }
    findTargets(layout.midi.maps, device, msg).forEach((target) => {
        const t = targetInfo(target);
        if (!t) {
            return;
        }
        if (t.kind === 'faders') {
            const value = faderValue(msg);
            // Came from the controller: don't echo it back to itself.
            sent.set(`${target}|${device}`, value);
            liveStore.setFader(t.index, value);
        } else {
            liveStore.pressPad(t.index, msg.on);
        }
    });
};

// Stable device keys: the port name without Windows' MIDIIN/MIDIOUT
// wrapper, plus "#2", "#3" for identical controllers (by port order).
const keyPorts = (map) => {
    const seen = new Map();
    const out = [];
    [...map.values()]
        .filter((port) => port.state === 'connected')
        .sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }))
        .forEach((port) => {
            const base = deviceKey(port.name) || 'MIDI device';
            const n = (seen.get(base) || 0) + 1;
            seen.set(base, n);
            out.push({ port, key: n > 1 ? `${base} #${n}` : base });
        });
    return out;
};

const openPort = (port, onBusy) => {
    if (port.connection === 'open' || typeof port.open !== 'function') {
        return;
    }
    Promise.resolve().then(() => port.open()).then(() => {
        if (port.connection === 'pending') {
            onBusy();
        }
    }).catch(() => onBusy());
};

const refresh = () => {
    if (!access) {
        return;
    }
    const nextInputs = new Map();
    keyPorts(access.inputs).forEach(({ port, key }) => {
        const prev = inputs.get(port.id);
        const entry = prev && prev.key === key ? prev : { port, key, busy: false };
        if (!prev || prev.key !== key) {
            port.onmidimessage = (event) => onMessage(key, event.data);
            openPort(port, () => {
                entry.busy = true;
                publish();
            });
        }
        nextInputs.set(port.id, entry);
        if (!info.has(key)) {
            info.set(key, { name: port.name, manufacturer: port.manufacturer || '', profile: profileFor(port.name, port.manufacturer) });
        }
    });
    inputs.forEach((entry, id) => {
        if (!nextInputs.has(id)) {
            entry.port.onmidimessage = null;
        }
    });
    inputs.clear();
    nextInputs.forEach((entry, id) => inputs.set(id, entry));

    const before = new Set(outputs.keys());
    const nextOutputs = new Map();
    keyPorts(access.outputs).forEach(({ port, key }) => {
        const prev = outputs.get(key);
        const entry = prev && prev.port === port ? prev : { port, busy: false };
        if (!prev || prev.port !== port) {
            openPort(port, () => {
                entry.busy = true;
                publish();
            });
        }
        nextOutputs.set(key, entry);
        if (!info.has(key)) {
            info.set(key, { name: port.name, manufacturer: port.manufacturer || '', profile: profileFor(port.name, port.manufacturer) });
        }
    });
    outputs.clear();
    nextOutputs.forEach((entry, key) => outputs.set(key, entry));
    // A controller that just appeared gets every mapped control's state.
    outputs.forEach((entry, key) => {
        if (!before.has(key)) {
            forgetSent(key);
        }
    });
    syncFeedback();
    publish();
};

const requestAccess = () => {
    if (typeof navigator === 'undefined' || !navigator.requestMIDIAccess) {
        status = 'unsupported';
        publish();
        return;
    }
    navigator.requestMIDIAccess({ sysex: false }).then((midi) => {
        access = midi;
        status = 'ready';
        access.onstatechange = refresh;
        refresh();
    }).catch(() => {
        status = 'denied';
        publish();
    });
};

const midiStore = {
    subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
    getSnapshot: () => {
        if (!snapshot) {
            buildSnapshot();
        }
        return snapshot;
    },

    start: () => {
        if (started) {
            return;
        }
        started = true;
        liveStore.subscribe(() => {
            const { layout } = liveStore.getSnapshot();
            if (layout.midi !== lastMidi) {
                lastMidi = layout.midi;
                publish();
            }
            syncFeedback();
        });
        requestAccess();
    },

    // Look again for controllers (and ask for MIDI again if it failed).
    rescan: () => {
        if (!access) {
            requestAccess();
            return;
        }
        info.clear();
        refresh();
    },

    setLearning: (on) => {
        learning = Boolean(on);
        armed = null;
        captured = null;
        heard = null;
        publish();
    },
    arm: (target) => {
        armed = target;
        captured = null;
        publish();
    },
    disarm: () => {
        armed = null;
        publish();
    },
    clearTarget: (target) => {
        const { layout } = liveStore.getSnapshot();
        liveStore.setMidi({ maps: clearTarget(layout.midi.maps, target) });
        if (captured && captured.target === target) {
            captured = null;
        }
        publish();
    },
    clearDevice: (key) => {
        const { layout } = liveStore.getSnapshot();
        liveStore.setMidi({ maps: clearDevice(layout.midi.maps, key) });
    },
    setDeviceOption: (key, patch) => {
        const { layout } = liveStore.getSnapshot();
        const current = layout.midi.devices[key] || { feedback: true, on: 0 };
        forgetSent(key);
        liveStore.setMidi({ devices: { ...layout.midi.devices, [key]: { ...current, ...patch } } });
    },
    // Light every mapped pad on a controller for a moment, then restore.
    testLights: (key) => {
        const { layout } = liveStore.getSnapshot();
        const pads = layout.midi.maps.filter((map) => map.device === key && targetInfo(map.target)
            && targetInfo(map.target).kind === 'pads');
        testing.add(key);
        pads.forEach((map) => sendBytes(key, messagesFor(map, true, true)));
        setTimeout(() => {
            testing.delete(key);
            forgetSent(key);
            syncFeedback();
        }, TEST_MS);
    }
};

module.exports = midiStore;
