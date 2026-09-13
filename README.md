# DMX whIP Companion

Companion application for DMX whIP to monitor, record, and play back network DMX (Art-Net and sACN).

**Version:** 0.3.3

## How to run

```bash
npm install
npm start
```

Or double-click `start.bat` for the normal app window (no debug tools).

Double-click `startdev.bat` to log output to `debug.log` and open DevTools.

## How we work

The implementation plan below is the source of truth. Historical notes remain in `versionnotes.txt` and should not be treated as the active list.

To start the next slice of work, say:

**Let’s plan on the next section in the implementation plan**

That means: plan only the first `###` section that still has unchecked items. Do not add, remove, rename, or reorder checklist items unless we explicitly agree in that conversation. Completed items are marked `- [x]`, not deleted.

## Current state

The monitor binds Art-Net (UDP 6454) and sACN (UDP 5568) on the chosen adapter, persists woken channels until a universe vanishes, and throttles grid IPC from the main process with per-universe FPS. sACN data universes are joined only after E1.31 Universe Discovery. Recordings write a `DMXREC` `.dmx` file in chunks after New File; playback is clock-based with a working Stop control and legal sACN via the `sacn` package. The renderer is isolated (`contextIsolation`) with a local Tailwind build. Treat this as a prototype restart, not a shipping 1.0.

---

## Implementation plan

### Development setup

- [x] README implementation plan and version line
- [x] App version shown from `package.json` (window title and UI)
- [x] Cursor rules for semver and this checklist

### Phase A — Trustworthy monitor

- [x] Remove the duplicate `set-protocol` IPC handler so Art-Net/sACN sockets bind once
- [x] Stop filtering the DMX grid by comparing packet `sourceIp` to the local NIC; bind on the chosen adapter and show sources in the UI
- [x] Persist “woken” channels (not dark grey) until that universe vanishes and reappears
- [x] Fix universe channel-count stale closure so the count is channels that have woken, not the highest non-zero in the current packet
- [x] Throttle grid IPC updates (keep packet handling in the main process; do not push every frame to React at line rate)
- [x] Receive sACN universes beyond 1–64 (join on demand or use E1.31 Universe Discovery)
- [x] Compute and display universe FPS in the main process

### Phase B — Record and play

- [x] Wire receiver callbacks to `recordingHandler.addFrame()` in the main process
- [x] Send selected universes from the renderer to main and record only those
- [x] Create the `.dmx` file before recording starts (“New File”); hide Start Recording until a file exists
- [x] Stream recording to disk in chunks instead of holding the whole clip in RAM and `appendFileSync` per frame
- [x] One `load-recording` API; reject or explain empty/invalid files instead of crashing
- [x] Implement `stop-playback` in the main process
- [x] Clock-based playback (start time + elapsed), not chained `setTimeout` deltas with `await` on every UDP send
- [x] Send valid sACN (use the existing `sacn` package) so playback and the test sender are legal E1.31

### Phase C — Project hygiene

- [x] Add `.gitignore` (`node_modules`, `debug.log`, and similar)
- [x] Move Electron to `devDependencies`; add packaging later when we want a `.exe`
- [x] Preload script and `contextIsolation: true` (drop `nodeIntegration` / `webSecurity: false`)
- [x] Remove unused Babel and dead code (`renderer.js` unused bootstrap, `StatusBar.js`, `store/universe.js`, unused `dmxUtils` path, unused npm `artnet` if still unused)
- [x] Bundle Tailwind locally; stop loading the CDN
- [x] Align LICENSE (Apache-2.0 file) with `package.json` license and the app name (companion vs “DMX Monitor”)

### Backlog (not started unless agreed)

These stay here until we agree to promote an item into the active plan.

- [ ] KiNet
- [ ] Incoming / outgoing tabs above the universe list (record a show and play back toward IP-specific devices)
- [ ] Background color when channel bars are inactive
- [ ] Prioritize speed vs quality options
- [ ] SPI data output (dim, stripe, hue shift, RGB filter) assignable to a DMX channel
- [ ] File playlist (loop count including indefinite, shuffle, speed, fade in/out, hold / x-fade, reorder)
- [ ] Launch playlist via sACN / Art-Net
- [ ] Clip launch via Art-Net / sACN (rows: file, protocol, universe, channel, value; momentary vs toggle; A/B and x-fade / operate mode)
- [ ] Scheduling
