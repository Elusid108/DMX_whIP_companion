# Engine extraction audit (Phase J, step 0)

Read-only audit of DMX_whIP_companion 0.60.0 before any code moves. Sources: `README.md` (plan and Current state), `package.json`, `.cursor/rules/*.mdc`, `versionnotes.txt`, all of `src/`. `filestructure.txt` is stale and was ignored. Line numbers are from commit `921c74a`.

The companion is CommonJS throughout (main and renderer; the renderer is bundled by esbuild). Electron is `^33.2.0` (Node 20.18 bundled). The sandbox runs Node 22.22.2, the same as Yocto Wrynose. There is no `engines` field, no CI, no lint config.

## 1. Electron coupling, per file

"Direct" = the file requires `electron`. "Transitive" = it reaches Electron only through `src/main/settings.js` or `src/main/firmwareCatalog.js` (both need `app`).

### `src/main/`

| File | Electron | What it uses | Other platform coupling |
|---|---|---|---|
| `main.js` | direct: `app`, `BrowserWindow`, `protocol`, `net`, `screen` (:1) | window creation :100-225, `compmedia` protocol :6-17, :188-200 (serves Studio audio through `playback.resolveAudioPath`), webview lockdown :83-98, MIDI permission handlers :133-143, saved window bounds :30-44, handler wiring :184-204, cleanup on `closed` :206-217, `will-quit` → `stopFileTasks` :229 | `loadSettings/saveSettings` (transitive) |
| `settings.js` | direct: `app` (:1) | `app.getPath('userData')/settings.json` :7, `app.getPath('documents')/DMX whIP/Shows` :9 | sync `fs` read/write with in-memory cache; `normalize()` :71-103 is pure |
| `firmwareCatalog.js` | direct: `app.isPackaged` (:9) | `process.resourcesPath` when packaged | `firmware/catalog.json` :18, sibling root `../DMX_whIP_embedded` :16 |
| `firmwareFlash.js` | direct: `ipcMain` (:1), lazy `app.isPackaged` (:55-56) | 8 `ipcMain.handle` (:334-829), `mainWindow.webContents.send` for `flash-log`/`flash-progress` :320-331 (no `isDestroyed` guard) | `child_process.spawn` for `python -u scripts/release.py` :145, `serialport` :223/:275/:434, `./generated/esptool.cjs` :213, `~/.platformio/penv` :98-104, sibling `platformio.ini` :60 |
| `ipc/network.js` | direct: `ipcMain`, `shell` (:1) | 28 `ipcMain.handle` (:461-1064), 5 `ipcMain.on` (:1082-1116), `sendToRenderer` :138-143 for `devices-update`, `universes-snapshot`, `dmx-data-update`, `clear-universes`, `device-ota-progress`, `device-push-progress`; `shell.openExternal` :1057 | worker `runFileTask` :632/:728, `os.tmpdir()/whip-push-*.dmx` :721-723, `uiView` gating :182-263 |
| `ipc/playback.js` | direct: `ipcMain`, `dialog`, `BrowserWindow` (:1) | 15 `ipcMain.handle` (:997-2043), 5 `ipcMain.on` (:1942-2094), `sendSafe` :188-193 for `playback-stats`, `compilation-updated`, `file-loaded` (11 sites), `library-updated` (4), `punch-in-*` (4); `dialog.showOpenDialog` :1001 (`load-recording` without a path), :1122 (`import-audio`); `dialog.showMessageBox` + `BrowserWindow.fromWebContents` :1418-1435 (`confirm-unsaved-compilation`) | `ffmpeg-static` through `../audioConvert` :48, `uiView.studioVisible` :49/:1583, `library.js` helpers :51-59 (→ settings → `app`), `os.tmpdir()/dmxwhip-punch-*` :1668 |
| `ipc/recording.js` | direct: `ipcMain` (:1) | `ipcMain.on` `start-recording`/`stop-recording` :165-166, `ipcMain.handle` `cancel-recording` :169, `sendSafe` :16-21 for `recording-stats-update`, `recording-saved`, `recording-error` | `uiView.setUiView({recording})` :118/:128/:175/:285, `studioVisible` :90, sync `fs.writeSync` on the UDP path :66/:198-235 |
| `ipc/library.js` | direct: `ipcMain`, `dialog` (:1) | 16 `ipcMain.handle` (:393-722), `dialog.showOpenDialog` :438/:536, `showSaveDialog` :474, `sendSafe` :23-28 `library-updated` | `fs.watch(libraryDir)` :311, `library.json` :198, worker scan :333; exports pure-ish helpers (:30-257) that depend only on settings |
| `ipc/cuebus.js` | direct: `ipcMain` (:1) | `ipcMain.on('set-protocol')` :124 (second listener on that channel), 7 handles :135-150, `cuebus-update` :40 | `uiView` :29/:125, `deviceHttp.fetchStatus` |
| `ipc/live.js` | direct: `ipcMain` (:1) | `live-set` :14, 4 handles :16-38 | settings, `liveOutput.getLiveOutput` |
| `ipc/settings.js` | direct: `BrowserWindow`, `ipcMain`, `shell` (:1) | 4 handles :14-49; `setBackgroundColor` :25-27; `shell.openExternal` :55 (allow-list) | — |
| `liveOutput.js` | transitive only | `getLiveOutput()` :288-316 lazily requires `./settings` for the persisted CID | `createLiveOutput(deps)` :37-284 is pure with injected `now/setTimer/clearTimer/makeArt/makeSacn` |
| `firmwareImages.js` | transitive (`./firmwareCatalog`) | — | `firmware/releases`, sibling `dist`, `firmware/artifacts/<class>`, sibling `.pio/build/<env>` :87-168 |
| `uf2Flash.js` | none | — | `serialport`; mount roots `D:`-`Z:`, `/Volumes`, `/media/<user>`, `/run/media/<user>` :29-36 |
| `audioConvert.js` | none | — | `child_process.spawn(ffmpeg-static)` :22, `os.tmpdir()/dmx-whip-audio/<id>.wav` :37 |
| `wlanInfo.js` | none | — | `execFile('netsh')` on Windows only :84-89 |
| `portProbe.js`, `nodeSerialDevice.js` | none | — | `serialport` |
| `deviceHttp.js` | none | — | `http` to nodes on port 80, SoftAP `4.3.2.1` :6, upload/OTA progress throttles :438/:565 |
| `fileTasks.js`, `fileWorker.js` | none | — | `worker_threads` (one unref'd worker, inline fallback) |
| `nvsImage.js` | none | — | `zlib` |
| `monitor/universeMonitor.js` | none (clean) | callbacks injected | timers via `setInterval` |
| `uiView.js` | none (clean) | — | module-global UI view state read by recording, network, playback, cuebus |
| `liveOutput.test.js` | none | — | injected clock and fake senders |

### `src/services/`

Every file is free of `electron`, `child_process`, `serialport`, `worker_threads`, `ffmpeg-static`, `app.getPath` and renderer globals (`window`, `document`, `navigator`). The `window` identifiers in `shared/pushFit.js` are local variables. Node built-ins used:

| File | Built-ins |
|---|---|
| `artnet/receiver.js`, `artnet/sender.js` | `dgram` |
| `sacn/receiver.js` | `dgram` (1 s membership sweep) |
| `sacn/output.js` | `dgram`, `crypto` |
| `sacn/utils.js` | `crypto` |
| `cuebus/cueBus.js` | `dgram` (UDP 4777), `crypto`, `os` |
| `shared/dmxRecording.js`, `shared/dmxSlice.js`, `shared/timelineOverview.js` | `fs` |
| `shared/networkUtils.js`, `shared/ownOutput.js` | `os` |
| everything else in `shared/` and `cuebus/protocol.js` | none |

`src/preload.js` (direct: `contextBridge`, `ipcRenderer`) exposes `window.dmx = { invoke, send, on }` behind three allow-lists. `src/renderer/ipc.js` wraps it and is the only renderer file that touches `window.dmx`; every hook, store and component imports that wrapper. The only direct browser platform call in the renderer is `navigator.requestMIDIAccess` in `src/renderer/midiStore.js:306-311` (MIDI stays in the renderer; out of scope).

## 2. Data flows

### 2.1 Receivers → monitor state

- `ArtNetReceiver.start(nic)` binds UDP 6454 (`artnet/receiver.js:63`) with `reuseAddr`, 1 MiB receive buffer, broadcast on. `parseArtNetPacket` yields `{ kind:'dmx', universe (15-bit port-address), dmxData (view, may be < 512), sourceIp, sourcePort }` or `pollReply`. `sendPoll()` :71 broadcasts ArtPoll from the same socket.
- `SacnReceiver.start(nic)` binds UDP 5568 (`sacn/receiver.js:95`), joins the E1.31 discovery universe 64214 and syncs multicast membership every 1 s to the universes advertised by complete discovery pages seen within 20 s (:103-175). Data universes are therefore joined only after discovery, as the README states; unicast reaches the socket regardless. The parser drops non-zero start codes, preview and stream-terminated packets. No per-source priority arbitration or sequence check.
- `network.js:setupReceivers` (:336-459) restarts both on `set-protocol` (generation-guarded), clears the monitor, emits `clear-universes`, then wires `dispatchDmx` (:405-426):
  - `own` packets (`ownOutput.isOwn`) are shown on the monitor when not recording and never recorded or used as a trigger;
  - otherwise the record-trigger observer sees the packet, then either `recordingHandler.addFrame` (only universes in `selectedUniverses`, keyed `proto-uni`) while recording, or `monitor.ingest` while not. **The monitor is not fed while recording.**
- `UniverseMonitor` (`monitor/universeMonitor.js`): per `proto-uni` entry with `values` (512 × `null | 0..255`, a channel wakes on its first non-zero value and stays woken), `frameTimes` for a 1 s FPS window, `stale` after 2.5 s, removed after 10 s. A 50 ms tick sends the snapshot every 200 ms (5 Hz) and the selected-universe grid whenever dirty (≤ 20 Hz). The timer runs only while an emit is wanted (`setEmit`), driven by `network.js:syncUiEmit` (:197-210) from `set-ui-view`: snapshot on Monitor/Studio, grid on Monitor, both off during a take.
- Snapshot payload: `{ artnet: Row[], sacn: Row[], levels: { artnet: { [uni]: Uint8Array(512) }, sacn: {...} } }`, `Row = { id, universe, sourceIp ('Disconnected' when stale), sourceName, activeChannels, fps, stale, protocol, lastSeen }`. Grid payload: `{ protocol, universe, sourceIp, sourceName, data: Array(512) of number|null }`.
- `ownOutput.js` is **process-global**: senders register their bound port (`artnet/sender.js:43`, `sacn/output.js:65`) and the sACN CID (`output.js:64`); `isOwn` matches CID, or source port + a local IPv4 (cached 5 s).

### 2.2 Live output and the merge into playback

- `createLiveOutput(deps)` (`liveOutput.js:37-284`): per `proto:uni` a `Uint8Array(512)`, `dirty`, `lastSent`, `zeroSince`. `set(changes)` validates and marks dirty; a 25 ms tick sends dirty universes (≤ 40 Hz), re-sends every 1 s (keep-alive), and after 2 s all-zero sends 3 × sACN stream-terminated then drops the universe; idle 5 s closes the sockets; sACN discovery every 10 s. Its own Art-Net sender and sACN source "DMX whIP Live" (priority 100, CID persisted as `settings.liveCid`) bind on `settings.outputNic`; `dest` '' = broadcast/multicast, else one unicast IP.
- Merge: `playback.js:121-132` attaches `{ owns, resend }`. `owns(proto, uni)` = `lastByUniverse.has(...)` (the last playback frame per universe while playback sockets are open). Every playback packet passes through `emitFrame` (:407-422) → `liveOutput.merge` (:220-232), which returns `max(frame[i], live[i])` into a fresh `Uint8Array` when the universe is live and not releasing, else the frame itself (**highest wins**). While owned, the live tick does not send; on a level change it asks `playback.resend`. `cleanupSenders` (:272-298) clears ownership and `kick()`s the live output to send from its own sockets again. Blackout frames also pass through `merge`, so live levels stay up through a playback blackout. Resend ignores the frame's `destIp` difference (uses the stored frame).
- Note: playback creates a **new random sACN CID** on every `initializeSenders` (:368, no `cid` passed), so each Play is a new sACN source to receivers.

### 2.3 Clock-based playback

- State lives in the `setupPlaybackHandlers` closure (`playback.js:84-2119`): two frame sources (`playbackData` = Studio flatten, `playerData` = Player file), `activeSource`, `playbackOriginNs`, `pausedElapsed`, `currentPlaybackFrame`, `lastSentFrame`, `holdFrames`, timers.
- Scheduler `scheduleTick` (:541-585): sends every frame with `timestamp <= elapsed + LOOKAHEAD_MS (3)`, emits `playback-stats` at most every 100 ms, loops by re-basing the origin, otherwise `stopPlaybackInternal(true)` at the end. `armTick` (:454-460): `setImmediate` when due, else `setTimeout(max(1, wait-1))`. No busy-wait. `firstFrameAfter` is a binary search; `lookAt` (:241-254) scans from 0 keeping the latest frame per `proto:uni:dest`.
- Senders: `initializeSenders` (:357-395) opens an `ArtNetSender` on `playbackNetwork` (renderer state seeded from `outputNic`, separate from the Live NIC) and a `SacnOutput` "DMX whIP Playback" only when the clip has sACN universes (or `forceSacn` for punch-in). sACN sequence numbers are per universe inside `SacnOutput` (`sacn/output.js:91`); Art-Net sequence is always 0.
- Stop (:622-663): blackout (zero frame per known key, merged with Live), reset, `cleanupSenders(120 ms)` so the zeros leave the NIC, stats with `isReset`/`playerEnded`. No sACN stream-terminated from playback. Pause holds `lookAt(t)` frames every 100 ms (:587-607). Seek (:609-620, :2004-2031) is token-guarded. Queue and repeat are renderer-driven (`usePlayerQueue.js`): each queue item is a new `player-play` (new sockets, new CID).
- Studio flatten: `compilationEdl.flattenToFrames` (pure): clip events keyed `proto:uni:dest`, frame times coalesced within 4 ms, a key is emitted when a clip received a packet, when the set of active clips changes, or every frame while fading; overlapping clips are averaged; remap = `universeOffset` + `channelOffset` mod 512; unicast `destIp` per clip. Flatten reruns on the main thread on every edit.

### 2.4 Recording

- File created by `library-new-file` (`library.js:361-370`: 0-frame header + sidecar, `recordingHandler.setRecordingPath`). `startAt` (`recording.js:103-121`) opens the fd, writes the header, takes an hrtime origin, `setUiView({recording:true})` (quiets monitor emits and ArtPoll).
- `addFrame` (:193-248) runs synchronously in the UDP callback: `maskedRecordData` zeroes the trigger channel, `shouldRecordUniverseFrame` skips a universe until its first non-zero packet, `createBurstStamper` (4 ms window, first record t=0) stamps, `encodeFrame` (522 B) into a pending list flushed at 64 KiB with `fs.writeSync` and a header-count rewrite. Stats ≤ 10 Hz and only while Studio is visible. `stopAt` flushes and emits `recording-saved`. `cancel-recording` closes without deleting.
- Punch-in (`playback.js:1649-1815`): temp file in `os.tmpdir()`, `setOnLiveFrame` keeps the latest incoming frame per universe, a 40 ms timer sends `lookAt(startMs+elapsed)` blended (averaged) with live frames minus the trigger channel; on stop the take is copied into the library as `YYYY-MM-DD HH-mm-ss.dmx` + sidecar, added as a clip, reflattened. Triggers (`recordTriggers.js`, pure) are fed through `recordingHandler.setObserver` (:1848-1869) and polled every 200 ms.

### 2.5 Worker-thread scans

`fileTasks.js` runs one lazy unref'd `Worker(fileWorker.js)` with ops `scan` (`scanRecording`), `slice` (`sliceRecordingMulti`), `overview` (`buildTimelineOverview`); falls back inline if the worker cannot start. Callers: `library.js:333` (inspect, mtime-cached), `network.js:632/:728` (push analyse/slice), `playback.js:1055` (overview of a file; a loaded session builds its overview on the main thread). `parseRecording`, flatten, `listLibrary` and `listImages` run on the main thread.

## 3. IPC channels today

117 names are allow-listed in `src/preload.js` (83 invoke, 13 send, 21 receive). Every invoke/send has exactly one main handler except `set-protocol` (two `ipcMain.on` listeners: `network.js:1082`, `cuebus.js:124`). `universe-removed` is allow-listed and listened for (`useUniverseData.js:60`) but never sent. 18 channels are handled but unused by the renderer: `library-new-file`, `library-export`, `library-rename`, `cancel-recording`, `device-push-show`, `device-play`, `device-stop`, `device-set-brightness`, `device-set-live`, `device-wifi-scan`, `device-wifi-connect`, `device-wifi-forget`, `device-set-name`, `device-rename-show`, `flash-identify`, `cuebus-seek`, `start-recording`, `stop-recording`.

Rates: "user" = on a user action.

### Renderer → main, request/reply (`invoke`)

| Channel | Handler | Args → result | Rate |
|---|---|---|---|
| get-settings | ipc/settings.js:14 | () → `{settings}` | startup |
| set-theme | settings.js:22 | `{theme}` → `{settings}` | user |
| set-ui-settings | settings.js:36 | `{section:'monitor', patch}` → `{value}` | user |
| open-external-url | settings.js:49 | `{url}` (allow-list) | user |
| live-release-all | ipc/live.js:16 | () | user |
| live-get | live.js:21 | () → `{live, outputNic}` | startup |
| live-save | live.js:27 | `{faders,pads,dest,midi}` → `{live}` | debounced 400 ms |
| set-output-nic | live.js:38 | `{nic}` → `{outputNic}` | user |
| get-network-interfaces | ipc/network.js:461 | () → `[{name, ip}]` | startup/user |
| device-status / -identify / -reboot | network.js:465-473 | `{ip[, ms]}` | user |
| device-list | :477 | () → `{nic, devices[]}` | user |
| device-fixture-get / -set / -locate | :482-543 | `{ip, ...}` | user |
| device-ota-plan / device-ota-run | :548 / :577 | `{ids[, includeBusy]}` | user; run streams progress |
| device-push-analyze / -show / -batch / -stream / -distribute, device-stream-stop | :670-915 | `{jobs, devices | ip, filePath, destPath | holder}` | user; long-running |
| device-play / -stop / -set-brightness / -set-live / -wifi-scan / -wifi-connect / -wifi-forget / -set-shownet / -set-name / -rename-show / -open-portal / -pull-show | :953-1064 | `{ip, ...}` | user |
| library-list … library-set-collapsed (16) | ipc/library.js:393-722 | see file | user; import/export/choose-dir open dialogs |
| cancel-recording | ipc/recording.js:169 | () → `{filePath}` | user (unused) |
| load-recording | ipc/playback.js:997 | `{filePath?, displayName}` → session payload (+ `file-loaded`); dialog when no path | user |
| timeline-overview | :1034 | `{filePath?, bucketMs}` → overview | user / on load |
| load-compilation | :1067 | `{dirPath? | sources[], name, append, trackId}` → session | user |
| inspect-clip | :1101 | `{clipId}` | user |
| import-audio | :1114 | `{startMs}`; dialog + ffmpeg | user |
| edit-compilation | :1157 | `{op, target, clipId(s), …, keepPlayheadMs}` → `{dirty}` | pointer rate during drags |
| undo-/redo-compilation | :1381/:1399 | () | user |
| confirm-unsaved-compilation | :1417 | `{reason}` → `{choice}`; message box | user |
| save-compilation / export-flattened | :1443/:1505 | `{name, notes}` | user |
| start-punch-in / stop-punch-in / cancel-punch-in | :1872/:1922/:1925 | trigger config → session or `{armed}` | user |
| player-play | :2043 | `{filePath, playbackNetwork, loop}` | user / queue advance |
| flash-catalog / -ports / -wlan / -set-settings / -probe / -identify / -run / -build | firmwareFlash.js:334-829 | see file | user; run/build long-running |
| cuebus-state / -refresh / -launch / -pause / -resume / -stop / -seek | ipc/cuebus.js:135-150 | `{hash, ...}` | user |

### Renderer → main, fire-and-forget (`send`)

| Channel | Handler | Payload | Rate |
|---|---|---|---|
| set-ui-view | network.js:1104 | `{view, recording}` | tab change |
| set-protocol | network.js:1082 and cuebus.js:124 | `{interfaceIp}` | NIC change |
| select-monitor-universe | network.js:1115 | `{protocol, universe}` | user |
| update-selected-universes | network.js:1116 | `string[]` `"proto-uni"` | user |
| start-recording / stop-recording | recording.js:165-166 | none | unused |
| toggle-playback | playback.js:2002 | `{loop, playbackNetwork, source}` | user |
| set-playback-loop | :1942 | `{loop}` | user |
| stop-playback | :2040 | `{source?}` | user |
| seek-playback | :2032 | `{source, timeMs, playbackNetwork, loop}` | pointer rate (main drops stale seeks) |
| unload-recording | :2094 | none | user |
| devices-scan | network.js:1103 | none | panel mount / refresh |
| live-set | live.js:14 | `[{proto, uni, ch, value}]` (changes only) | once per microtask while faders or MIDI move |

### Main → renderer events

| Channel | Sender | Payload | Rate / throttle |
|---|---|---|---|
| universes-snapshot | universeMonitor via network.js:332 | rows + `levels` (`Uint8Array(512)` per universe, **binary**) | 5 Hz, Monitor/Studio only, off while recording |
| dmx-data-update | universeMonitor via network.js:333 | `{protocol, universe, sourceIp, sourceName, data: Array(512)}` | ≤ 20 Hz when dirty, Monitor only |
| clear-universes | network.js:352 | none | per `set-protocol` |
| universe-removed | — | — | never sent |
| devices-update | network.js:185 | `{nic, devices[]}` | 150 ms debounce; ArtPoll every 2.5 s while Devices/Flash/Library/Monitor shown and not recording |
| device-ota-progress | network.js:587 | `{id, phase, sent, total}` | ≤ ~6.7 Hz per node, 3 parallel |
| device-push-progress | network.js:667 | `{phase, sent, total, label}` | ≤ 10 Hz per node |
| file-loaded | playback.js (11 sites) | session payload or `{success:false}` or `{cleared}` | on load/save/unload |
| compilation-updated | playback.js:694/:1793 | clips, audio, tracks, dirty (+ peaks only when audio changed) | per edit |
| playback-stats | playback.js:327 | `{currentFrame, totalFrames, clipTime, totalPlayTime, playheadMs, fps, isPlaying, isPaused, loop, source, isReset?, playerEnded?}` | ~10 Hz while playing + transitions; not view-gated |
| recording-stats-update | recording.js:96 | `{currentFps, totalFrames, droppedFrames}` | ≤ 10 Hz, Studio visible only |
| recording-saved / recording-error | recording.js:144/:153 | `{filePath, totalFrames}` / `{error}` | one-shot |
| punch-in-progress | playback.js:1591 | `{startMs, trackId, durationMs, trackCount, trackNames}` | ≤ 10 Hz, Studio visible only |
| punch-in-started / -auto-stopped / -failed | playback.js:1831/:1798/:1806 | session payload / `{error}` | one-shot |
| library-updated | library.js:275, playback.js (4) | `listLibrary()` | `fs.watch` debounced 200 ms + after mutations |
| cuebus-update | cuebus.js:40 | bus snapshot + groups | 1 Hz while Devices shown + on change |
| flash-progress / flash-log | firmwareFlash.js:331/:327 | `{port, percent, label}` / `{port, line}` | unthrottled |

## 4. External dependencies

- **Sibling repo `../DMX_whIP_embedded`**: `firmwareCatalog.js:16` (root), `firmwareImages.js:87-168` (`dist/<name>/manifest.json`, `.pio/build/<env>/*.bin|firmware.uf2`), `firmwareFlash.js:54-64` (`platformio.ini`), `:142-164` (`python -u scripts/release.py`). Tests `firmwareCompat.test.js:26` and `firmwareManifest.test.js:67` also read it. The Cursor firmware-compat rule locks `include/dmxrec.h` ↔ `src/services/shared/dmxRecording.js`.
- **ffmpeg** (`ffmpeg-static`): `audioConvert.js` only, spawned for Studio audio import.
- **Serial / esptool / UF2**: `firmwareFlash.js`, `portProbe.js`, `nodeSerialDevice.js`, `uf2Flash.js`, `generated/esptool.cjs` (esbuild bundle of `esptool-js`). `serialport` is a native module (`electron-rebuild`).
- **Filesystem paths**: `settings.json` under `app.getPath('userData')`; library default `Documents/DMX whIP/Shows` (`settings.libraryDir`), `library.json` index, `.comp/{project.json,media/*.dmx,audio/*.wav}`; `os.tmpdir()` for punch-in takes, push slices and converted audio; `firmware/catalog.json`, `firmware/releases`, `firmware/artifacts`.
- **Node HTTP** (`deviceHttp.js`): plain `http` on port 80 to nodes (`/status`, `/upload`, `/ota`, `/fixture`, `/connect`, …), SoftAP `4.3.2.1` fallback only when the PC has a `4.3.2.x` address.
- **Cue bus** (`services/cuebus`): UDP 4777 "WHP3".

## 5. Proposed engine boundaries

Engine (`src/engine/`, Electron-free, Node 22 and Electron's Node):

| Module | From | Notes |
|---|---|---|
| `api/version.js`, `api/envelope.js`, `api/router.js`, `api/inProcess.js` | new | envelope, error model, commands/queries/events, subscriptions with optional rate limit, binary stream, in-process client |
| `settingsStore.js` | `main/settings.js` `normalize` | `createSettingsStore({ filePath, defaultLibraryDir })`; the companion supplies `app.getPath` values |
| `library/store.js` | `main/ipc/library.js:30-257` | path/sidecar/index helpers, `listLibrary`; no dialogs, no `fs.watch` |
| `monitor/universeMonitor.js` | `main/monitor/universeMonitor.js` | moved as is |
| `output/liveOutput.js` (+test) | `main/liveOutput.js` | `createLiveOutput` unchanged; the singleton is replaced by an instance owned by the engine |
| `receive.js` | `main/ipc/network.js:336-459, 1082-1116` | receivers, dispatch, selected universes, ArtPoll send, `artnet.pollReply` event |
| `recording.js` | `main/ipc/recording.js` | `ipcMain` → commands, `sendSafe` → events, `setUiView` → engine recording state |
| `playback.js` | `main/ipc/playback.js` | moved whole (transport, Studio EDL, punch-in) minus the three dialog-bound paths |
| `index.js`, `headless.js` | new | `createEngine(deps)`, headless entry |

`src/services/**` stays in place (already Electron-free; the Cursor rule references its paths) and is required by the engine. The boundary check walks the transitive require graph so a future Electron import in services fails too.

Companion-only (stays in `src/main/`): `main.js` (window, `compmedia`, MIDI permission), `settings.js` wrapper, `ipc/settings.js` (theme, external URL), `ipc/library.js` handlers with their dialogs and `fs.watch`, `ipc/network.js` devices/push/OTA/HTTP, `ipc/cuebus.js`, `firmwareFlash.js` and the whole Flash tab, `audioConvert.js` (ffmpeg), `fileTasks.js`/`fileWorker.js` (shared by both sides, Electron-free), release scripts (`start.bat`, `startdev.bat`, `build:*`). Renderer, preload and `src/renderer/ipc.js` are unchanged: channel names and payload shapes are preserved by the adapter.

Adapter: `src/main/engineHost.js` creates the engine, maps each IPC channel to an engine command/query (table), forwards engine events to `webContents.send` with today's payload shapes (the grid stream frame is decoded back to the 512-entry array with `null` for never-woken channels), and subscribes/unsubscribes the monitor events on `set-ui-view` so hidden tabs still get nothing.

## 6. Risks and things that make a move non-trivial

1. **`playback.js` is one 2100-line closure.** Transport, EDL editing and punch-in share mutable `let` state and call each other directly. Splitting it is a real refactor; moving it whole keeps behavior but the module keeps its size. Deferred (NOTES.md).
2. **`ownOutput.js` is process-global.** Two engines in one process would share it, and an engine that plays and records in the same process filters its own packets. The loopback regression test therefore plays from a child process. Making it per-engine is deferred.
3. **`uiView.js` gating.** Main-process throttling depends on which renderer tab is visible. In the engine this becomes "emit only while subscribed"; the adapter mirrors the tab state into subscriptions. Recording-quiet behavior stays inside the engine.
4. **`getLiveOutput()` singleton** reads settings through Electron; replaced by an engine-owned instance with the CID from the injected settings store.
5. **Library helpers import settings.** `ensureLibrary` → `getLibraryDir` → `app.getPath`. Solved by the injectable settings store.
6. **Hard-coded ports** 6454/5568 in four socket classes. Made configurable with unchanged defaults so tests do not clash.
7. **`set-protocol` has two listeners** (network and cuebus). The adapter keeps both: the engine receiver restart and the companion cue bus restart.
8. **Sync disk I/O on the UDP path** (`recording.js`) and flatten on the main thread are existing behavior; unchanged.
9. **`CueBus` defines `stop` twice** (`services/cuebus/cueBus.js:123` closes the socket, `:428` sends a STOP cue; the later definition wins). `start()` and the cuebus cleanup therefore send a group-0 STOP and leak the 4777 socket and two intervals per NIC change. Not touched in this phase (show sync moves later); flagged for a fix.
10. **Playback opens a new random sACN CID per Play**; receivers see a new source each time. Preserved.
11. **Electron GUI cannot run in the sandbox.** Everything that needs the window, hardware or a LAN is in `MANUAL_CHECKLIST.md`.

## 7. Security notes (EU CRA alignment, record only)

- `settings.json` stores `flashPassword` and `flashShowPass` (Wi-Fi passwords) in plaintext (`settings.js:83, :93`); the README documents this ("stores the last password (peek to reveal)"). Existing; not changed.
- `device-wifi-connect` and `device-set-shownet` send Wi-Fi passwords to nodes over plain HTTP on the LAN (`deviceHttp.js`). Existing.
- OTA images are verified by manifest sha256 (integrity) only, not signed (authenticity). Known gap.
- No network listener or HTTP endpoint is added by this phase. The engine binds only the UDP receive sockets it already bound (6454, 5568) when asked.
- Imported files: `parseRecording` checks magic, count and exact length; `project.json` media ids are validated by `SAFE_MEDIA_ID`. Untouched.

## 8. Decisions taken for this phase

- Move `playback.js` whole (see risk 1) rather than transport-only.
- Keep `src/services/**` in place.
- Keep every IPC channel name and payload shape; the renderer is not modified.
- The first Phase J box (API doc) is ticked in the same commit that inserts the section, since the section does not exist before Step 3.

Nothing found requires a design decision before extraction can be behavior-preserving, so no `QUESTIONS.md` is written.
