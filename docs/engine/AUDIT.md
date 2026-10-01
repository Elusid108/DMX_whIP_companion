# Engine audit (ecosystem setup, Stage 1)

Read-only audit of DMX_whIP_companion before the engine-core split (the Phase K extraction). No code was moved for this document. Sources: `README.md` (plan and Current state), `package.json`, `.cursor/rules/*.mdc`, the tail of `versionnotes.txt`, `firmware/README.md`, `firmware/catalog.json`, all of `src/`, and `git log`. `filestructure.txt` is stale and was ignored.

The earlier Phase J audit (written at 0.60.0, before the first extraction) has been folded into this one. Facts that still hold were kept; everything that referred to deleted `src/main` files was rewritten against the files that exist now.

## 0. Baseline

| Item | Value |
|---|---|
| Baseline commit (`main` HEAD when this branch started) | `964d84c` "Merge pull request #1: Phase J headless engine extraction + project rules (0.61.0)" |
| `package.json` `version` | `0.61.0` |
| README **Version:** line | `0.61.0` (the two agree; nothing to report) |
| Node in the sandbox | 22.22.0 |
| Node that Yocto Wrynose ships | 22.22.2 |
| Node bundled by Electron `33.2.0` (lockfile) | 20.18 |
| `package.json` `engines` | `node >= 22` |

Behavior at `964d84c` is the reference for the extraction phase: same packets, same timing model, same highest-wins merge, same persistence.

### `npm test` headless

`ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install --ignore-scripts` then `npm test` on Linux with no Electron, no LAN, no USB:

```
# tests 113  pass 111  fail 0  skipped 2  duration ~3 s
```

- The two skips need the sibling firmware repo (`parseFwTag reads a real sibling build when present`, `a real release bundle parses`). They skip cleanly, they do not fail.
- Nothing in `npm test` needs Electron, Windows, a display, serial or a LAN. The loopback regression test uses UDP on `127.0.0.1` with ports from `DMXWHIP_TEST_PORT_BASE` (default 46454/46455) and forks one child process.
- `--ignore-scripts` skips the `serialport` native rebuild and the `ffmpeg-static` binary download. Neither is needed by the tests. With scripts enabled, `serialport` has prebuilt `bindings-cpp` for linux-x64/arm64, so no compiler is needed on the Pi either; `ffmpeg-static` downloads a platform binary at install time (network required).
- The Electron GUI (`npm start`) cannot run here. `npm run headless` runs (`node src/engine/headless.js`).

## 1. What changed in the most recent version (0.60.0 → 0.61.0)

`versionnotes.txt` was last written in the pre-plan era (its tail is the original "NEXT (in order)" todo list for the sACN monitor); it is history only and says nothing about 0.61.0. From `git log db00161^..964d84c` (14 commits, 48 files, +3378 / −819):

- `docs/engine/AUDIT.md`, `docs/engine/API.md` (engine API v1), `CLAUDE.md` and `.claude/rules/*.md` mirroring the Cursor rules, Phase J added to the README plan.
- `src/engine/` created with `boundary.test.js` (no `electron`, no DOM globals, no requires into `src/main` or `src/renderer`, transitively) in `npm test`.
- Envelope, router, in-process client (`src/engine/api/`), `ENGINE_API_VERSION = 1`.
- Receive, universe monitor, Live output, recording, playback (whole, including Studio EDL and punch-in), settings store and library store moved into the engine. `src/main/ipc/live.js`, `recording.js`, `playback.js`, `monitor/`, `liveOutput.js`, `fileTasks.js`, `fileWorker.js` deleted from `src/main`.
- `src/main/engineHost.js` + `engineChannels.js` make the Electron IPC handlers thin adapters; `engineChannels.test.js` reconciles the tables with the preload allow-lists.
- Loopback regression test (`src/engine/loopback.test.js`): a synthetic 2×Art-Net + 2×sACN look is played by a child-process engine and recorded by the parent engine; universes, data and order compared.
- Headless entry `src/engine/headless.js` + smoke test; `npm run headless`.
- `MANUAL_CHECKLIST.md` for the hand walkthrough (still unticked in the README).
- Last commit: companion device polling pauses on the engine's take state.
- Version 0.61.0, README Current state updated.

## 2. Electron coupling per file (as of 0.61.0)

"Direct" = the file requires `electron`. `src/engine/**` and `src/services/**` have no direct or transitive Electron import (enforced by `src/engine/boundary.test.js`).

### `src/main/`

| File | Electron | What it uses | Other platform coupling |
|---|---|---|---|
| `main.js` | direct: `app`, `BrowserWindow`, `protocol`, `net`, `screen` | window creation and saved bounds, `compmedia://` protocol serving Studio audio, webview lockdown, Web MIDI permission handlers (`midi`, `midiSysex`), handler wiring, `will-quit` cleanup; `process.platform !== 'darwin'` quit rule | `fs`, `path`, `url` |
| `engineHost.js` | direct: `webContents.send` | creates the engine, maps IPC channels to engine names (tables in `engineChannels.js`), forwards events with today's payloads, subscribes/unsubscribes monitor events from `set-ui-view` | none |
| `settings.js` | direct: `app.getPath('userData')`, `app.getPath('documents')` | feeds the engine's `createSettingsStore` | `path` |
| `firmwareCatalog.js` | direct: `app.isPackaged` | `process.resourcesPath` when packaged; sibling root `../DMX_whIP_embedded` | `fs`, `path` |
| `firmwareFlash.js` | direct: `ipcMain`, lazy `app.isPackaged` | 8 `ipcMain.handle` (`flash-*`), `flash-log` / `flash-progress` to the window | `child_process` (`python scripts/release.py`), `serialport`, `./generated/esptool.cjs`, `crypto`, `os`, `fs`, NVS image at the catalog `nvs` offset (default 0x9000) |
| `ipc/network.js` | direct: `ipcMain`, `shell.openExternal` | 27 `device-*` handles, `devices-scan`, `set-ui-view`, `set-protocol` (second listener: cue bus restart); hears `artnet.pollReply` through the engine host | `crypto`, `fs`, `os.tmpdir()` for push slices, `Date.now`, timers (ArtPoll every 2.5 s, stale after 9 s) |
| `ipc/library.js` | direct: `ipcMain`, `dialog` | 16 `library-*` handles, `fs.watch` on the library folder (200 ms debounce), re-exports the engine library store | `crypto`, `fs`, `path` |
| `ipc/studioDialogs.js` | direct: `dialog`, `BrowserWindow` | `load-recording` picker, `import-audio` picker + ffmpeg, `confirm-unsaved-compilation` | `path`, `./audioConvert` |
| `ipc/cuebus.js` | direct: `ipcMain` | 7 `cuebus-*` handles, `cuebus-update` at 1 Hz while Devices is shown | timers |
| `ipc/settings.js` | direct: `BrowserWindow`, `ipcMain`, `shell` | theme, UI settings, allow-listed external URLs | none |
| `uiView.js` | none | module-global "which tab is visible" state read by network, cuebus | none |
| `deviceHttp.js` | none | plain `http` to nodes on port 80, SoftAP `4.3.2.1` fallback, upload/OTA progress | `fs`, `http`, `os`, `path`, `Buffer`, timers |
| `firmwareImages.js` | none (uses `firmwareCatalog`) | release bundles, sibling `dist`, `firmware/artifacts`, sibling `.pio/build` | `crypto`, `fs`, `path` |
| `nvsImage.js` | none | ESP-IDF NVS page builder | `zlib.crc32` (Node 22.2+; has a software fallback), `Buffer` |
| `uf2Flash.js`, `portProbe.js`, `nodeSerialDevice.js` | none | `serialport`, bootloader drive roots | `fs`, `os`, `path`, `process.platform` |
| `audioConvert.js` | none | `spawn(ffmpeg-static)` to 16-bit 44.1 kHz WAV in `os.tmpdir()` | `child_process` |
| `wlanInfo.js` | none | `netsh wlan show …` on Windows only; other platforms return nothing | `child_process`, `process.platform` |
| `engineChannels.js` | none | pure tables | none |

`src/preload.js` (direct: `contextBridge`, `ipcRenderer`) exposes `window.dmx = { invoke, send, on }` behind three allow-lists (83 invoke, 13 send, 21 receive). `src/renderer/ipc.js` is the only renderer file that touches `window.dmx`; every hook, store and component goes through it. That wrapper is already the "thin platform adapter" the rules ask for.

### `src/engine/` (Electron-free, but not Node-free)

| File | Node built-ins | Clock / timers / bytes |
|---|---|---|
| `api/envelope.js`, `api/inProcess.js`, `api/version.js`, `index.js`, `receive.js` | none | none |
| `api/router.js` | none | `Date.now` and `setTimeout` as **injectable defaults** (`options.now`, `options.setTimer`) for subscription rate limits |
| `monitor/universeMonitor.js` | none | `setInterval` 50 ms tick, `Date.now` for FPS, stale and removal (not injectable today) |
| `output/liveOutput.js` | `crypto` (random CID when none is saved) | `Date.now` / `setInterval` as injectable defaults; `Buffer` via the Art-Net / sACN packet builders |
| `playback.js` (2096 lines) | `fs`, `os`, `path` | `Date.now`, `process.hrtime.bigint()` origin, `setTimeout` / `setImmediate` scheduler (23 sites) |
| `recording.js` | `fs`, `os`, `path` | `process.hrtime.bigint()` origin, `Date.now` for stats, sync `fs.writeSync` on the UDP path, `Buffer` frames |
| `library/store.js`, `settingsStore.js` | `fs`, `path` | sync JSON read/write |
| `fileTasks.js`, `fileWorker.js` | `worker_threads`, `path` | one lazy unref'd worker, inline fallback |
| `headless.js` | `os`, `path`, `process` | CLI entry, `SIGINT`/`SIGTERM` |

### `src/services/` (Electron-free; the contract code lives here)

| File | Node built-ins | Bytes |
|---|---|---|
| `artnet/receiver.js`, `artnet/sender.js` | `dgram` | `Buffer` views from dgram |
| `artnet/utils.js` | none | `Buffer` (packet build and parse) |
| `sacn/receiver.js` | `dgram`, `Date.now`, timers (1 s membership sweep) | `Buffer` |
| `sacn/output.js` | `dgram`, `crypto` | `Buffer` |
| `sacn/utils.js` | `crypto` | `Buffer` (our own E1.31 encoder) |
| `cuebus/cueBus.js` | `dgram` (UDP 4777), `crypto`, `os`, `Date.now`, `hrtime`, timers | `Buffer` |
| `cuebus/protocol.js` | none | `Buffer`, `BigInt` i64 |
| `shared/dmxRecording.js`, `shared/dmxSlice.js`, `shared/timelineOverview.js` | `fs` (sync walkers) | `Buffer` |
| `shared/networkUtils.js`, `shared/ownOutput.js` | `os.networkInterfaces()` | `Buffer` (CID compare) |
| `shared/firmwareCompat.js`, `shared/pixelMap.js`, `shared/recordTriggers.js` | none | `Buffer` |
| `shared/compilationEdl.js` | none | `Date.now` (ids only) |
| everything else in `shared/` | none | none |

Takeaway for the core/ports split: the pure logic (packet encode/decode, monitor arithmetic, burst stamper, DMXREC frame codec, triggers, fixture maths, cue bus wire format) is already free of I/O, but it is written against `Buffer`, and the clock is `Date.now` / `hrtime` taken directly in four places (monitor, recording, playback, sACN receiver). Those are the two mechanical conversions the extraction has to make.

## 3. Data flows

### 3.1 Receivers → monitor state

- `ArtNetReceiver.start(nic)` binds UDP 6454 (`reuseAddr`, 1 MiB receive buffer, broadcast on). `parseArtNetPacket` yields `{ kind:'dmx', universe (15-bit port-address), dmxData (view, may be < 512), sourceIp, sourcePort }` or `{ kind:'pollReply', … }`. `sendPoll()` broadcasts ArtPoll from the same socket.
- `SacnReceiver.start(nic)` binds UDP 5568, joins the E1.31 discovery universe 64214 and every second syncs multicast membership to the universes advertised by complete discovery pages seen within 20 s. Data universes are joined only after discovery (as the README says); unicast reaches the socket regardless. Non-zero start codes, preview and stream-terminated packets are dropped. No per-source priority arbitration, no sequence check.
- `src/engine/receive.js` restarts both receivers on `receive.setNic` (generation-guarded), clears the monitor, emits `monitor.cleared`, then dispatches each packet: `own` packets (`ownOutput.isOwn`) show on the monitor when not recording and are never recorded or used as a trigger; otherwise the record-trigger observer sees the packet, then either `recording.addFrame` (only armed universes, keyed `proto-uni`) while recording, or `monitor.ingest` while not. **The monitor is not fed while recording.**
- `UniverseMonitor`: per `proto-uni` entry with `values` (512 × `null | 0..255`; a channel wakes on its first non-zero value and stays woken), a 1 s FPS window, `stale` after 2.5 s, removed after 10 s. A 50 ms tick emits the snapshot every 200 ms (5 Hz) and the selected-universe grid whenever dirty (≤ 20 Hz). The tick runs only while someone is subscribed.
- `ownOutput.js` is **process-global**: senders register their bound port and the sACN CID; `isOwn` matches CID, or source port + a local IPv4 (cached 5 s). This is why the loopback test plays from a child process.

### 3.2 Live output and the highest-wins merge

- `createLiveOutput(deps)` (`src/engine/output/liveOutput.js`): per `proto:uni` a `Uint8Array(512)`, `dirty`, `lastSent`, `zeroSince`. `set(changes)` validates and marks dirty; a 25 ms tick sends dirty universes (≤ 40 Hz), re-sends every 1 s (keep-alive), after 2 s all-zero sends 3 × sACN stream-terminated then drops the universe; idle 5 s closes the sockets; sACN discovery every 10 s. Own Art-Net sender and sACN source "DMX whIP Live" (priority 100, CID persisted as `settings.liveCid`) on `settings.outputNic`; `dest` '' = broadcast/multicast, else one unicast IP. `now`, `setTimer`, `clearTimer`, `makeArt`, `makeSacn` are injectable (the unit test uses fakes).
- Merge: `playback.js` attaches `{ owns, resend }`. `owns(proto, uni)` is true while playback has sent a frame for that universe and its sockets are open. Every playback packet passes through `liveOutput.merge`, which returns `max(frame[i], live[i])` into a fresh `Uint8Array` when the universe is live and not releasing, else the frame itself (**highest wins**). While owned, the live tick does not send; on a level change it asks `playback.resend`. Closing the playback senders clears ownership and `kick()`s the live output to send from its own sockets again. Blackout frames also pass through `merge`, so live levels survive a playback blackout.
- Playback creates a **new random sACN CID on every Play**; receivers see a new source each time (preserved behavior).

### 3.3 Clock-based playback

- State lives in one closure in `src/engine/playback.js`: two frame sources (Studio flatten and Player file), `activeSource`, `playbackOriginNs` (`hrtime.bigint`), `pausedElapsed`, current and last-sent frame, hold frames, timers.
- Scheduler: sends every frame with `timestamp <= elapsed + 3 ms` lookahead, emits `playback.stats` at most every 100 ms, loops by re-basing the origin, otherwise stops at the end (blackout, then sockets close 120 ms later). Arming: `setImmediate` when due, else `setTimeout(max(1, wait − 1))`. No busy-wait. `firstFrameAfter` is a binary search; `lookAt` scans keeping the latest frame per `proto:uni:dest`.
- Senders: an `ArtNetSender` on `playbackNetwork` and a `SacnOutput` "DMX whIP Playback" only when the clip has sACN universes. sACN sequence per universe; Art-Net sequence always 0.
- Pause holds `lookAt(t)` every 100 ms. Seek is token-guarded. Queue and repeat are renderer-driven (`usePlayerQueue.js`): each item is a new `player.play` (new sockets, new CID).
- Studio flatten (`compilationEdl.flattenToFrames`, pure): keyed `proto:uni:dest`, times coalesced within 4 ms, overlapping clips averaged, remap = `universeOffset` + `channelOffset` mod 512, unicast `destIp` per clip. Reruns on the main thread on every edit.

### 3.4 Recording

- The file is created by the companion (`library-new-file`: 0-frame header + sidecar) and handed to the engine with `record.setPath`. `record.start` opens the fd, writes the header, takes an `hrtime` origin and quiets monitor emits and ArtPoll.
- `addFrame` runs synchronously in the UDP callback: `maskedRecordData` zeroes the trigger channel, `shouldRecordUniverseFrame` skips a universe until its first non-zero packet, `createBurstStamper` (4 ms window, first record t = 0) stamps, `encodeFrame` (522 B) into a pending list flushed at 64 KiB with `fs.writeSync` and a header-count rewrite. Stats ≤ 10 Hz. `record.stop` flushes and emits `record.saved`; `record.cancel` closes without deleting.
- Punch-in: temp file in `os.tmpdir()`, latest incoming frame kept per universe, a 40 ms timer sends `lookAt(startMs + elapsed)` averaged with live frames minus the trigger channel; on stop the take is copied into the library as `YYYY-MM-DD HH-mm-ss.dmx` + sidecar, added as a clip, reflattened. Triggers (`recordTriggers.js`, pure) are polled every 200 ms.

### 3.5 Worker-thread scans

`src/engine/fileTasks.js` runs one lazy unref'd `Worker(fileWorker.js)` with ops `scan`, `slice`, `overview`; inline fallback if the worker cannot start. Callers: library inspect (mtime-cached), push analyse/slice (companion), timeline overview of a file. `parseRecording`, flatten, `listLibrary` and `listImages` run on the main thread.

## 4. IPC channels today

117 names in `src/preload.js`: 83 `invoke`, 13 `send`, 21 receive. `src/main/engineChannels.js` says for each whether it is routed to the engine (18 invoke, 11 send, 10 events + 4 host-managed streams/events) or companion-only, and `engineChannels.test.js` proves the two lists agree. The full channel → engine-name mapping with payload shapes is the table in `docs/engine/API.md` §7; the rates are below so they are not repeated there.

| Group | Channels | Direction | Rate |
|---|---|---|---|
| Settings | `get-settings`, `set-theme`, `set-ui-settings`, `open-external-url` | R→M invoke | startup / user |
| Live | `live-get`, `live-save` (400 ms debounce), `live-release-all`, `set-output-nic`; `live-set` (send, changes only, once per microtask while faders or MIDI move) | R→M | user / fader rate |
| Network | `get-network-interfaces`; `set-protocol` (send, NIC change, two listeners: engine receive restart + companion cue bus restart); `set-ui-view` (send, tab change); `select-monitor-universe`, `update-selected-universes` (send) | R→M | user |
| Devices (27 `device-*` + `devices-scan`) | status, identify, reboot, list, fixture get/set/locate, ota plan/run, push analyze/show/batch/stream/distribute, stream-stop, play, stop, brightness, live, wifi scan/connect/forget, shownet, name, rename-show, open-portal, pull-show | R→M invoke | user; push/OTA long-running |
| Library (16 `library-*`) | list, new-file, inspect, save-meta, import, export, rename, delete, choose-dir, create/rename/delete-folder, move, set-collapsed, save-compilation-meta, duplicate | R→M invoke | user; import/export/choose-dir open dialogs |
| Recording | `cancel-recording` (invoke); `start-recording`, `stop-recording` (send, unused by the renderer: Studio records through punch-in) | R→M | user |
| Playback / Studio | `load-recording`, `timeline-overview`, `load-compilation`, `inspect-clip`, `import-audio`, `edit-compilation` (pointer rate during drags), `undo-`/`redo-compilation`, `confirm-unsaved-compilation`, `save-compilation`, `export-flattened`, `start-`/`stop-`/`cancel-punch-in`, `player-play`; sends `toggle-playback`, `set-playback-loop`, `stop-playback`, `seek-playback` (pointer rate, stale seeks dropped), `unload-recording` | R→M | user |
| Flash (8 `flash-*`) | catalog, ports, wlan, set-settings, probe, identify, run, build | R→M invoke | user; run/build long-running |
| Cue bus (7 `cuebus-*`) | state, refresh, launch, pause, resume, stop, seek | R→M invoke | user |
| Monitor events | `universes-snapshot` (rows + one `Uint8Array(512)` per universe, 5 Hz, Monitor/Studio only, off while recording), `dmx-data-update` (`{protocol, universe, sourceIp, sourceName, data: Array(512)}`, ≤ 20 Hz, Monitor only; decoded by the host from the engine's binary grid stream), `clear-universes`, `universe-removed` (never sent) | M→R | as stated |
| Device events | `devices-update` (150 ms debounce; ArtPoll every 2.5 s while Devices/Flash/Library/Monitor shown and not recording), `device-ota-progress` (≤ ~6.7 Hz per node, 3 parallel), `device-push-progress` (≤ 10 Hz per node) | M→R | as stated |
| Playback / Studio events | `file-loaded`, `compilation-updated` (per edit), `playback-stats` (~10 Hz while playing + transitions), `punch-in-progress` (≤ 10 Hz, Studio visible), `punch-in-started` / `-auto-stopped` / `-failed` | M→R | as stated |
| Recording events | `recording-stats-update` (≤ 10 Hz, Studio visible), `recording-saved`, `recording-error` | M→R | as stated |
| Library / cue bus / flash events | `library-updated` (`fs.watch` debounced 200 ms + after mutations), `cuebus-update` (1 Hz while Devices shown + on change), `flash-progress`, `flash-log` (unthrottled) | M→R | as stated |

Dead or unused today: `universe-removed` is allow-listed and listened for but never sent; 18 channels are handled but not called by the renderer (`library-new-file`, `library-export`, `library-rename`, `cancel-recording`, `device-push-show`, `device-play`, `device-stop`, `device-set-brightness`, `device-set-live`, `device-wifi-scan`, `device-wifi-connect`, `device-wifi-forget`, `device-set-name`, `device-rename-show`, `flash-identify`, `cuebus-seek`, `start-recording`, `stop-recording`).

## 5. sACN encoding: ours or the `sacn` package?

Ours. The runtime encoder and parser are `src/services/sacn/utils.js` (`createSacnDmxPacket`, discovery pages, stream-terminated, `parseSacnPacket`). No file under `src/` requires `sacn`. The `sacn` package (`^4.6.2`) is a **devDependency** used only by `src/services/sacn/sacnPacket.test.js`, which imports `sacn/dist/packet` and asserts our bytes are identical to its encoder's. That matches the rule "the `sacn` package may remain as a test reference".

## 6. Electron's Node vs Node 22

Electron `33.2.0` (lockfile) bundles Node **20.18**. Yocto Wrynose ships **22.22.2**; the sandbox has 22.22.0. `package.json` declares `engines.node >= 22`, which is true for the headless host but not for the Electron host, so engine code must stay inside the Node 20 API surface:

- `zlib.crc32` is Node 22.2+: `src/main/nvsImage.js` already falls back to a software CRC (companion-only code anyway).
- `node --test` with `node:test` / `node:assert/strict` works on both.
- `process.hrtime.bigint`, `worker_threads`, `dgram` multicast, `structuredClone`, `Array.prototype.at`, `Object.hasOwn`, `BigInt` are all fine on 20.
- Avoid: `node:sqlite`, `fs.glob`, `util.styleText`, `Promise.withResolvers` (22+), `Set` methods (`union`, 22+), `Array.fromAsync` (22+), `--experimental-strip-types`.

`.nvmrc` does not exist; there is no CI.

## 7. Windows-only assumptions

| Where | What | Portability |
|---|---|---|
| `start.bat`, `startdev.bat` | double-click launchers (`npm start`, DevTools + `debug.log`) | Windows only; Mac/Linux use `npm start` |
| `src/main/wlanInfo.js` | `netsh wlan show interfaces` / `networks mode=bssid` for the Flash tab's SSID prefill and scan | returns nothing on other platforms (handled) |
| `src/main/uf2Flash.js` | bootloader drive discovery: `D:\`–`Z:\` on win32, `/Volumes` on darwin, `/media/<user>` and `/run/media/<user>` on Linux | handled per platform |
| `src/main/firmwareFlash.js` | `python` executable lookup adds `.exe` on win32; `~/.platformio/penv` | handled; needs the sibling checkout |
| `serialport` | native module, rebuilt for Electron with `electron-rebuild`; prebuilds exist for win32/darwin/linux x64 and arm64 | Linux/Pi fine with `--ignore-scripts` for headless, since nothing in the engine uses it |
| `ffmpeg-static` | downloads a per-platform binary at `npm install`; Studio audio import only | not available offline or with `--ignore-scripts`; the engine never spawns it |
| `src/main/main.js` | `process.platform !== 'darwin'` quit-on-close | standard Electron idiom |
| Paths | `path.join` everywhere; `INVALID_NAME` regexes reject the Windows-forbidden characters on every platform (so names stay portable) | fine |
| `Documents/DMX whIP/Shows` | `app.getPath('documents')` | Electron resolves it per OS; headless uses `~/.dmxwhip/Shows` |

Nothing in `src/engine` or `src/services` is Windows-specific.

## 8. Web MIDI in the renderer (map only)

- `src/renderer/midiStore.js:306-311` is the only call: `navigator.requestMIDIAccess({ sysex: false })`, guarded by `typeof navigator`. It opens every input/output, parses notes / CC / pitch bend, runs Learn, and lights pads through `src/services/shared/midiProfiles.js` (pure, tested).
- MIDI input becomes `live-set` changes (`src/renderer/liveStore.js`), so the engine only ever sees fader/pad level changes; it has no MIDI knowledge.
- `src/main/main.js` grants the `midi` and `midiSysex` permissions for the app window only (Chromium asks for `midiSysex` for any MIDI access).
- Consequence for the ecosystem: a WebKit kiosk shell has no Web MIDI, so MIDI will eventually need a `midi` port on the engine side. The rules now forbid new Web MIDI in UI code; the existing store stays where it is (out of scope).

## 9. Proposed engine boundary (Phase K)

Phase J already produced an Electron-free `src/engine/`. Phase K tightens it into **core / ports / adapters**:

```
src/engine/core/      pure logic: no electron, no Node built-ins, no DOM; Uint8Array + DataView; injected clock and scheduler
src/engine/ports/     interfaces (JSDoc'd factories) the core calls: clock, scheduler, udp, storage, workers, discovery, midi, log
src/adapters/node/    Node 20/22 implementations of the ports: dgram, fs, hrtime/timers, worker_threads
src/engine/api/       envelope, router, in-process client (stays; router's now/setTimer come from the clock and scheduler ports)
```

### Moves into `core` (behavior-preserving)

| Today | Core module | Mechanical change |
|---|---|---|
| `services/artnet/utils.js` | `core/artnet/packet.js` | `Buffer` → `Uint8Array` + `DataView`; same bytes (ArtDmx, ArtPoll, ArtPollReply parse) |
| `services/sacn/utils.js` | `core/sacn/packet.js` | same; CID generation moves to the adapter (`crypto`) and is injected; `sacnPacket.test.js` keeps proving byte identity against the `sacn` package |
| `engine/monitor/universeMonitor.js` | `core/monitor.js` | `Date.now`/`setInterval` → injected `clock` and `scheduler` |
| `engine/output/liveOutput.js` | `core/liveOutput.js` | already injectable; the default fallbacks go away; senders are `udp` port handles |
| `engine/playback.js` transport (scheduler, senders, merge, blackout, seek, pause) | `core/transport.js` | `hrtime` → `clock.monotonicNs()`, `setTimeout`/`setImmediate` → `scheduler`; `fs` reads of `.dmx` via `storage` |
| `engine/playback.js` Studio session, punch-in | `core/studio.js`, `core/punchIn.js` or kept whole in `core/playback.js` | see risk 1 |
| `engine/recording.js` | `core/recording.js` (stamper, encoder, flush policy) | `fs.writeSync` → `storage.writeSync` port; `hrtime` → clock |
| `services/shared/dmxRecording.js` frame codec, `recordTriggers.js`, `compilationEdl.js`, `pushFit.js`, `fixture.js`, `monitorOverlay.js`, `pixelMap.js`, `firmwareCompat.js`, `cuebus/protocol.js` | `core/…` | `Buffer` → `Uint8Array` where used; the `fs` walkers in `dmxRecording.js`, `dmxSlice.js`, `timelineOverview.js` split into core (parse one block) + adapter (read blocks) |
| `services/shared/ownOutput.js` | `core/ownOutput.js`, per-engine instance | local-IP list comes from the `udp`/network port |
| `engine/receive.js` | `core/receive.js` | sockets through the `udp` port; multicast membership sweep uses `scheduler` |
| `engine/settingsStore.js` `normalize`, `library/store.js` path and index logic | `core/settings.js`, `core/library.js` | reads/writes through `storage` |

### Ports (`src/engine/ports/`)

`clock` (`now()` ms epoch, `monotonicNs()`), `scheduler` (`setTimer`, `clearTimer`, `setInterval`, `clearInterval`, `immediate`), `udp` (`open({ port, nic, reuseAddr, broadcast, bufferSize })` → `{ send(bytes, port, host), onMessage(fn), joinMulticast, dropMulticast, close }`, plus `interfaces()`), `storage` (`readFile`, `writeFile`, `open/writeSync/close`, `exists`, `mkdir`, `list`, `stat`, `tmpPath`), `workers` (`runTask(op, args)`), `discovery` (strategy factories: `artpollBroadcast`, `unicastPoll(ips)`, `manual(ip)`, `knownNodes(list)`; design only in this phase), `midi` (interface only), `log`.

### Node adapters (`src/adapters/node/`)

`clock.js` (`Date.now`, `process.hrtime.bigint`), `scheduler.js` (timers), `udp.js` (`dgram`, `os.networkInterfaces`), `storage.js` (`fs`, `path`, `os.tmpdir`), `workers.js` (`worker_threads`, with the inline fallback), `random.js` (`crypto.randomUUID`, CID bytes).

### Stays companion-only (`src/main/`, unchanged by Phase K)

Window and `compmedia://` (`main.js`), Electron paths (`settings.js`, `firmwareCatalog.js`), the whole Flash tab (`firmwareFlash.js`, `firmwareImages.js`, `nvsImage.js`, `uf2Flash.js`, `portProbe.js`, `nodeSerialDevice.js`, `wlanInfo.js`), ffmpeg import (`audioConvert.js`, `studioDialogs.js`), file dialogs and `fs.watch` (`ipc/library.js`), devices / push / OTA / node HTTP (`ipc/network.js`, `deviceHttp.js`), cue bus (`ipc/cuebus.js`, `services/cuebus/cueBus.js` socket side), theme and external URLs (`ipc/settings.js`), `start.bat` / `startdev.bat` and the `build:*` scripts, library scans stay where they are (`fileTasks.js` becomes the `workers` adapter). Studio UI logic, the renderer, `preload.js` and `src/renderer/ipc.js` are untouched.

### Automated boundary check

`src/engine/boundary.test.js` grows a second walk: every file under `src/engine/core` and `src/engine/ports` may require only files inside those two directories; any `require` of a bare module name (Node built-ins with or without `node:`, `electron`, npm packages) fails; the source is also scanned for `Buffer`, `process.`, `Date.now`, `setTimeout`, `setInterval`, `setImmediate`, `window`, `document`, `navigator`. Adapters may use Node built-ins but still not `electron`.

## 10. Security observations (EU CRA alignment; record, do not fix in this phase)

- **Wi-Fi passwords at rest**: `settings.json` stores `flashPassword` and `flashShowPass` in plaintext (`src/engine/settingsStore.js` normalises them; `src/main/settings.js` points it at `userData`). README documents "stores the last password (peek to reveal)".
- **Wi-Fi passwords in flight**: `device-wifi-connect` (`POST /connect`) and `device-set-shownet` (`POST /shownet`) send SSID and password to nodes over plain HTTP on the LAN; the Flash tab writes them into the NVS blob (`wifi.pass`, `show.pass`) over USB.
- **Node HTTP has no authentication**: every endpoint on port 80 (`/status`, `/upload`, `/meta`, `/fixture`, `/shownet`, `/pins`, `/ota`, `/play`, `/connect`, …) is open to anyone on the LAN. The companion is a client only; the gap is in the firmware contract and belongs to whip-spec.
- **OTA**: images are verified against the bundle manifest sha256 (integrity) before upload; nothing is signed (authenticity). Loose images from `firmware/artifacts` or the sibling PIO build have no hash at all. Known gap.
- **Listeners**: the companion and the headless engine open only UDP 6454 and 5568 receivers (plus 4777 for the cue bus in the companion) and no TCP listener. `headless.test.js` asserts no TCP listener. Any WebSocket transport later must be authenticated or loopback-only.
- **Imported files**: `parseRecording` checks magic, frame count and exact length before reading; `project.json` media ids are validated by `SAFE_MEDIA_ID`; `firmwareManifest.js` rejects absolute and `..` paths and non-hex sha256; `library.json` and sidecars are parsed with `JSON.parse` inside try/catch with field-type checks but no size cap. A size cap before `JSON.parse` on all three is a cheap future hardening.
- **Shell-outs**: `python scripts/release.py` and `ffmpeg-static` are spawned with argument arrays (no shell); `shell.openExternal` is allow-listed.
- **Cue bus**: UDP 4777 "WHP3" has no authentication; any LAN host can launch or stop groups. Firmware-side contract.

## 11. Risks

1. **`playback.js` is one 2096-line closure** (transport, Studio EDL, punch-in). Splitting it into core modules is a refactor; moving it whole into `core/` keeps behavior but the clock and `fs` conversions still touch all 23 timer/clock sites. Proposal: move whole first behind the ports, split later (NOTES.md).
2. **Locked contract paths in `.cursor/rules`**: `firmware-compat.mdc` names `src/services/shared/dmxRecording.js` and `whipRejectReason()` in `src/main/ipc/network.js`. `.cursor/rules` must not be edited by me. Moving `dmxRecording.js` into `core/` therefore needs either a re-export shim at the old path or your edit of the Cursor rule. Decision needed (§12).
3. **`Buffer` → `Uint8Array` in the byte-identical encoders**: the sACN check against the `sacn` package and the loopback test guard this, but `dmxRecording.js`'s `Buffer` API (`readUInt32LE`, `subarray`, `toString('ascii')`) is used by `dmxSlice.js`, `timelineOverview.js`, `scanRecording` and the push code too; the fs walkers stay in adapters and only the frame codec moves.
4. **`ownOutput` is process-global**; the regression test needs two processes. Making it per-engine is a behavior-neutral change but touches the senders' registration.
5. **Clock injection into the universe monitor and recording** changes nothing for a real clock but every stale/removal/FPS test must then use the fake clock.
6. **Node 20 vs 22**: the Electron host is still Node 20.18; `engines >= 22` is misleading for the companion (§6).
7. **`set-protocol` has two listeners** (engine receive restart and companion cue bus restart). Unchanged.
8. **Sync disk I/O on the UDP path** (recording flushes with `fs.writeSync` inside the dgram callback) and flatten on the main thread are existing behavior. Keep in Phase K.
9. **`CueBus` defines `stop` twice** (`services/cuebus/cueBus.js`: the later definition wins, so `start()`/cleanup send a group-0 STOP and leak the 4777 socket and two intervals per NIC change). Not an engine file in this phase; flagged.
10. **`ffmpeg-static` and `serialport` install steps** need network or a compiler; both are companion-only. The headless host should be installable with `--omit=dev --ignore-scripts`.
11. **No CI.** Every commit relies on a local `npm test`.
12. **README Current state still says** "Output comes from the main process (`src/main/liveOutput.js` …)" although the file is now `src/engine/output/liveOutput.js`. Text drift, fixed when Current state is next updated (Phase K last item).

## 12. Decisions needed from you

1. **Phase letter and overlap.** A Phase J already exists and is nearly all ticked, so the new section was inserted verbatim as **Phase K**. Several Phase K items restate Phase J items (API doc, boundary check, adapters, receive/playback/IPC moves, loopback test, walkthrough, headless entry). Confirm you want them done again at the stricter core/ports standard, or tell me which to treat as already satisfied.
2. **Cursor rule paths** (risk 2): keep `src/services/shared/dmxRecording.js` and `src/main/ipc/network.js` `whipRejectReason()` as thin re-export shims so `.cursor/rules` stays true, or will you update the `.mdc` paths yourself?
3. **Fate of `src/services/`**: dissolve it into `core/` and `adapters/node/` (every pure file moves, every `dgram`/`fs` file becomes an adapter), or keep the directory with shims? Dissolving is cleaner; shims keep the Cursor rule and README paths valid.
4. **`engines` field**: change to `>= 20.18` (true for both hosts) or keep `>= 22` as the console target and document the Electron exception?
5. **Capabilities and lifecycle**: `engine.capabilities` is trivial and I propose implementing it in Phase K. `engine.suspend` / `engine.resume` (close sockets and timers, keep show state, rebind on resume) touches receive, Live and playback; implement minimally in Phase K or leave as a documented stub until a host needs it?
6. **Discovery strategies** need a persisted known-nodes list and a manual-IP entry. Designing the port is in scope; adding a `knownNodes` key to `settings.json` is a schema addition. OK to add the key (additive, versioned) in Phase K, or design only?
7. **`ownOutput` per engine** (risk 4): do it in Phase K so the loopback test can run in one process, or keep the child-process test?
8. **Version bump for Stage 1**: the project's semver rule says README-checkbox progress alone takes a PATCH, so this stage bumps `0.61.0` → `0.61.1`. Stage 2 then bumps MINOR from the baseline as its last item. Say so if you want Stage 1 left at 0.61.0 instead.
