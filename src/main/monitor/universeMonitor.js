// Consoles often send an idle universe only about once a second (Art-Net
// and sACN keep-alives), so "inactive" follows the E1.31 data-loss timeout
// (2.5 s) rather than the frame rate.
const STALE_MS = 2500;
const REMOVE_MS = 10000;
const TICK_MS = 50;
const SNAPSHOT_MS = 200;
const FPS_WINDOW_MS = 1000;

const emptyGrid = () => new Array(512).fill(null);

const packLevels = (values) => {
    const out = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
        const value = values[i];
        out[i] = value == null ? 0 : value;
    }
    return out;
};

const keyFor = (protocol, universe) => `${protocol}-${universe}`;

class UniverseMonitor {
    constructor() {
        this.universes = new Map();
        this.selectedProtocol = null;
        this.selectedUniverse = null;
        this.onSnapshot = null;
        this.onGrid = null;
        this.interval = null;
        this.lastSnapshotAt = 0;
        this.emitSnapshot = true;
        this.emitGrid = true;
        this.gridDirty = true;
    }

    setEmit({ snapshot, grid } = {}) {
        if (snapshot != null) {
            this.emitSnapshot = Boolean(snapshot);
        }
        if (grid != null) {
            const next = Boolean(grid);
            if (next && !this.emitGrid) {
                this.gridDirty = true;
            }
            this.emitGrid = next;
        }
        this.syncTimer();
    }

    // The timer only runs while something is shown (Monitor / Studio rail).
    // Ingest keeps state current either way; expiry catches up on the next tick.
    syncTimer() {
        const wanted = Boolean((this.onSnapshot || this.onGrid) && (this.emitSnapshot || this.emitGrid));
        if (wanted && !this.interval) {
            this.lastSnapshotAt = 0;
            this.interval = setInterval(() => this.tick(), TICK_MS);
        } else if (!wanted && this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    start(onSnapshot, onGrid) {
        this.onSnapshot = onSnapshot;
        this.onGrid = onGrid;
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        this.gridDirty = true;
        this.syncTimer();
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        this.onSnapshot = null;
        this.onGrid = null;
    }

    clear() {
        this.universes.clear();
        this.gridDirty = true;
    }

    isSelected(protocol, universe) {
        return this.selectedUniverse != null
            && protocol === this.selectedProtocol
            && String(universe) === String(this.selectedUniverse);
    }

    setSelected(protocol, universe) {
        this.selectedProtocol = protocol ?? null;
        this.selectedUniverse = universe ?? null;
        this.gridDirty = true;
        this.sendGrid();
    }

    ingest({ protocol, universe, sourceIp, sourceName, dmxData }) {
        if (!protocol || universe == null) {
            return;
        }

        const key = keyFor(protocol, universe);
        const now = Date.now();
        let entry = this.universes.get(key);

        if (!entry) {
            entry = {
                protocol,
                universe,
                values: emptyGrid(),
                sourceIp: sourceIp || 'unknown',
                sourceName: sourceName || undefined,
                lastSeen: now,
                frameTimes: [],
                fps: 0,
                activeChannels: 0,
                stale: false
            };
            this.universes.set(key, entry);
        }

        entry.sourceIp = sourceIp || entry.sourceIp;
        if (sourceName) {
            entry.sourceName = sourceName;
        }
        entry.lastSeen = now;
        entry.stale = false;
        if (this.isSelected(protocol, universe)) {
            this.gridDirty = true;
        }
        entry.frameTimes.push(now);
        this.refreshFps(entry, now);

        const data = dmxData || [];
        for (let i = 0; i < 512; i++) {
            const value = Number(data[i]) || 0;
            if (value > 0 || entry.values[i] !== null) {
                entry.values[i] = Math.min(255, Math.max(0, value));
            }
        }

        let woken = 0;
        for (let i = 0; i < 512; i++) {
            if (entry.values[i] !== null) {
                woken += 1;
            }
        }
        entry.activeChannels = woken;
    }

    refreshFps(entry, now = Date.now()) {
        const cutoff = now - FPS_WINDOW_MS;
        while (entry.frameTimes.length && entry.frameTimes[0] <= cutoff) {
            entry.frameTimes.shift();
        }
        entry.fps = entry.frameTimes.length;
    }

    tick() {
        const now = Date.now();
        for (const [key, entry] of this.universes) {
            const age = now - entry.lastSeen;
            if (age > REMOVE_MS) {
                this.universes.delete(key);
                if (this.isSelected(entry.protocol, entry.universe)) {
                    this.gridDirty = true;
                }
                continue;
            }
            this.refreshFps(entry, now);
            entry.stale = age > STALE_MS;
        }
        if (this.emitSnapshot && now - this.lastSnapshotAt >= SNAPSHOT_MS) {
            this.lastSnapshotAt = now;
            this.sendSnapshot();
        }
        if (this.emitGrid) {
            this.sendGrid();
        }
    }

    toRow(entry) {
        return {
            id: entry.universe,
            universe: entry.universe,
            sourceIp: entry.stale ? 'Disconnected' : entry.sourceIp,
            sourceName: entry.sourceName,
            activeChannels: entry.activeChannels,
            fps: entry.fps,
            stale: entry.stale,
            protocol: entry.protocol,
            lastSeen: entry.lastSeen
        };
    }

    sendSnapshot() {
        if (!this.onSnapshot) {
            return;
        }

        const artnet = [];
        const sacn = [];
        const levels = { artnet: {}, sacn: {} };
        for (const entry of this.universes.values()) {
            const row = this.toRow(entry);
            const packed = packLevels(entry.values);
            if (entry.protocol === 'artnet') {
                artnet.push(row);
                levels.artnet[String(entry.universe)] = packed;
            } else if (entry.protocol === 'sacn') {
                sacn.push(row);
                levels.sacn[String(entry.universe)] = packed;
            }
        }
        artnet.sort((a, b) => a.id - b.id);
        sacn.sort((a, b) => a.id - b.id);
        this.onSnapshot({ artnet, sacn, levels });
    }

    sendGrid() {
        if (!this.onGrid || !this.emitGrid || !this.gridDirty) {
            return;
        }
        this.gridDirty = false;

        const protocol = this.selectedProtocol;
        const universe = this.selectedUniverse;
        if (protocol == null || universe == null) {
            this.onGrid({
                protocol,
                universe,
                data: emptyGrid()
            });
            return;
        }

        const entry = this.universes.get(keyFor(protocol, universe));
        if (!entry) {
            this.onGrid({
                protocol,
                universe,
                data: emptyGrid()
            });
            return;
        }

        this.onGrid({
            protocol,
            universe,
            sourceIp: entry.sourceIp,
            sourceName: entry.sourceName,
            data: entry.values.slice()
        });
    }
}

module.exports = UniverseMonitor;
