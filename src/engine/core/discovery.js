// Node discovery (docs/engine/API.md §10): one node table fed by strategies
// that never have to depend on broadcast reaching the nodes. The ArtPoll
// broadcast strategy is what the companion does today; unicast poll, a
// manual IP and the persisted known-nodes list poll by unicast and are kept
// (marked stale) while silent. Pairing follows core/artnet/pairing.js.
const { whipRejectReason, deviceId } = require('./artnet/pairing');
const { KINDS, assertStrategy } = require('../ports/discovery');

const DEFAULT_POLL_MS = 2500;
const STALE_MS = 9000;
const DROP_MS = 20000;
const SWEEP_MS = 1000;
const EMIT_DEBOUNCE_MS = 150;
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const MAC = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;

const cleanIp = (ip) => (typeof ip === 'string' && IPV4.test(ip.trim()) ? ip.trim() : '');
const cleanMac = (mac) => (typeof mac === 'string' && MAC.test(mac.trim()) ? mac.trim().toLowerCase() : '');

// Persisted known-nodes list (settings.knownNodes, schema version 1).
const normalizeKnownNodes = (raw) => {
    const list = raw && Array.isArray(raw.nodes) ? raw.nodes : [];
    const nodes = [];
    const seen = new Set();
    for (const item of list.slice(0, 256)) {
        if (!item || typeof item !== 'object') {
            continue;
        }
        const ip = cleanIp(item.ip);
        const mac = cleanMac(item.mac);
        if (!ip && !mac) {
            continue;
        }
        const id = mac || ip;
        if (seen.has(id)) {
            continue;
        }
        seen.add(id);
        nodes.push({ mac, ip, name: typeof item.name === 'string' ? item.name.slice(0, 64) : '' });
    }
    return { version: 1, nodes };
};

// Merge an ArtPollReply into the table entry for its node.
const nodeFromReply = (reply, now, previous, source) => ({
    id: deviceId(reply),
    mac: reply.mac || (previous && previous.mac) || '',
    ip: reply.ip || reply.sourceIp || (previous && previous.ip) || '',
    name: reply.shortName || (previous && previous.name) || '',
    longName: reply.longName || (previous && previous.longName) || '',
    universes: Array.isArray(reply.universes) ? reply.universes.slice() : [],
    bindIndex: reply.bindIndex,
    oem: reply.oem,
    nodeReport: reply.nodeReport || '',
    paired: !whipRejectReason(reply),
    rejectReason: whipRejectReason(reply),
    pinned: Boolean(previous && previous.pinned),
    stale: false,
    lastSeen: now,
    sources: [...new Set([...(previous ? previous.sources : []), source])]
});

// deps: { router, clock, scheduler, log, poll(dest?) -> bool,
//         onPollReply(fn) -> unsubscribe, settings }
const createDiscovery = ({ router, clock, scheduler, log, poll, onPollReply, settings }) => {
    const nodes = new Map();
    let active = [];
    let sweepTimer = null;
    let emitTimer = null;
    // Replies arriving while a unicast poll is outstanding are attributed to
    // it; otherwise to the broadcast strategy.
    const unicastPending = new Map();

    const scheduleEmit = () => {
        if (emitTimer || !router.hasSubscribers('discovery.nodes')) {
            return;
        }
        emitTimer = scheduler.setTimeout(() => {
            emitTimer = null;
            router.emit('discovery.nodes', { nodes: list() });
        }, EMIT_DEBOUNCE_MS);
    };

    const list = () => [...nodes.values()]
        .map((n) => ({ ...n, sources: n.sources.slice(), universes: n.universes.slice() }))
        .sort((a, b) => String(a.longName || a.name || a.ip).localeCompare(String(b.longName || b.name || b.ip), undefined, { numeric: true }));

    const ingest = (reply) => {
        if (!reply || !active.length) {
            return;
        }
        const now = clock.now();
        const id = deviceId(reply);
        const ip = reply.ip || reply.sourceIp || '';
        const source = unicastPending.has(ip) ? unicastPending.get(ip) : 'artpollBroadcast';
        const previous = nodes.get(id) || [...nodes.values()].find((n) => !n.mac && n.ip === ip) || null;
        if (previous && previous.id !== id) {
            nodes.delete(previous.id);
        }
        nodes.set(id, nodeFromReply(reply, now, previous, source));
        scheduleEmit();
    };

    const sweep = () => {
        const now = clock.now();
        let changed = false;
        for (const [id, node] of nodes) {
            const age = now - node.lastSeen;
            if (age > DROP_MS && !node.pinned) {
                nodes.delete(id);
                changed = true;
                continue;
            }
            const stale = age > STALE_MS;
            if (stale !== node.stale) {
                node.stale = stale;
                changed = true;
            }
        }
        if (changed) {
            scheduleEmit();
        }
    };

    const placeholder = (entry, source) => {
        const id = entry.mac || entry.ip;
        if (nodes.has(id)) {
            const node = nodes.get(id);
            node.pinned = true;
            if (!node.sources.includes(source)) {
                node.sources.push(source);
            }
            return;
        }
        nodes.set(id, {
            id,
            mac: entry.mac || '',
            ip: entry.ip || '',
            name: entry.name || '',
            longName: '',
            universes: [],
            bindIndex: 0,
            oem: 0,
            nodeReport: '',
            paired: false,
            rejectReason: 'no-reply',
            pinned: true,
            stale: true,
            lastSeen: 0,
            sources: [source]
        });
    };

    const pollUnicast = (ips, source) => {
        for (const ip of ips) {
            unicastPending.set(ip, source);
            poll(ip);
        }
        scheduler.setTimeout(() => ips.forEach((ip) => unicastPending.delete(ip)), SWEEP_MS);
    };

    const intervalStrategy = (kind, config, run) => {
        let timer = null;
        const intervalMs = Math.max(500, Number(config.intervalMs) || DEFAULT_POLL_MS);
        return assertStrategy({
            kind,
            start: () => {
                run();
                timer = scheduler.setInterval(run, intervalMs);
            },
            stop: () => {
                if (timer) {
                    scheduler.clearInterval(timer);
                    timer = null;
                }
            },
            describe: () => ({ kind, ...config, intervalMs })
        });
    };

    const makeStrategy = (spec = {}) => {
        const kind = spec.kind;
        if (kind === 'artpollBroadcast') {
            return intervalStrategy(kind, { intervalMs: spec.intervalMs }, () => poll());
        }
        if (kind === 'unicastPoll') {
            const ips = [...new Set((Array.isArray(spec.ips) ? spec.ips : []).map(cleanIp).filter(Boolean))];
            return intervalStrategy(kind, { ips, intervalMs: spec.intervalMs }, () => pollUnicast(ips, kind));
        }
        if (kind === 'manual') {
            const ip = cleanIp(spec.ip);
            if (!ip) {
                throw new Error('manual discovery needs an IPv4 address');
            }
            const s = intervalStrategy(kind, { ip, intervalMs: spec.intervalMs }, () => pollUnicast([ip], kind));
            const start = s.start;
            s.start = () => {
                placeholder({ ip }, kind);
                start();
            };
            return s;
        }
        if (kind === 'knownNodes') {
            const known = spec.nodes
                ? settings.save({ knownNodes: normalizeKnownNodes({ nodes: spec.nodes }) }).knownNodes
                : settings.load().knownNodes;
            const ips = known.nodes.map((n) => n.ip).filter(Boolean);
            const s = intervalStrategy(kind, { nodes: known.nodes, intervalMs: spec.intervalMs }, () => pollUnicast(ips, kind));
            const start = s.start;
            s.start = () => {
                known.nodes.forEach((n) => placeholder(n, kind));
                start();
            };
            return s;
        }
        throw new Error(`Unknown discovery strategy ${kind}; known: ${KINDS.join(', ')}`);
    };

    const stopAll = () => {
        active.forEach((s) => s.stop());
        active = [];
        if (sweepTimer) {
            scheduler.clearInterval(sweepTimer);
            sweepTimer = null;
        }
    };

    const setStrategies = (specs = []) => {
        const next = specs.map(makeStrategy);
        stopAll();
        for (const node of nodes.values()) {
            node.pinned = false;
        }
        active = next;
        if (active.length) {
            active.forEach((s) => s.start());
            sweepTimer = scheduler.setInterval(sweep, SWEEP_MS);
            // Nodes the new set no longer pins and that are already silent go now.
            sweep();
        } else {
            nodes.clear();
        }
        scheduleEmit();
    };

    const stopReplies = onPollReply(ingest);

    router.command('discovery.setStrategies', ({ strategies } = {}) => {
        try {
            setStrategies(Array.isArray(strategies) ? strategies : []);
            return { success: true, strategies: active.map((s) => s.describe()) };
        } catch (error) {
            log.error('discovery.setStrategies failed:', error.message);
            return { success: false, error: error.message };
        }
    });
    router.query('discovery.state', () => ({
        strategies: active.map((s) => s.describe()),
        knownNodes: settings.load().knownNodes,
        nodes: list()
    }));

    // Lifecycle: suspend stops polling but keeps the table; resume restarts
    // the same strategies.
    let suspendedSpecs = null;
    const suspend = () => {
        suspendedSpecs = active.map((s) => s.describe());
        active.forEach((s) => s.stop());
        if (sweepTimer) {
            scheduler.clearInterval(sweepTimer);
            sweepTimer = null;
        }
    };
    const resume = () => {
        if (!suspendedSpecs) {
            return;
        }
        const specs = suspendedSpecs;
        suspendedSpecs = null;
        if (specs.length) {
            active.forEach((s) => s.start());
            sweepTimer = scheduler.setInterval(sweep, SWEEP_MS);
        }
    };

    const close = () => {
        stopReplies();
        stopAll();
        if (emitTimer) {
            scheduler.clearTimeout(emitTimer);
            emitTimer = null;
        }
        nodes.clear();
    };

    return { setStrategies, list, ingest, sweep, suspend, resume, close, strategies: () => active.map((s) => s.describe()) };
};

module.exports = { createDiscovery, normalizeKnownNodes, STALE_MS, DROP_MS, DEFAULT_POLL_MS, EMIT_DEBOUNCE_MS };
