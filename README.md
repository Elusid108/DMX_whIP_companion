# DMX whIP Companion

Companion application for DMX whIP to monitor, record, and play back network DMX (Art-Net and sACN).

**Version:** 0.23.0

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

The monitor binds Art-Net (UDP 6454) and sACN (UDP 5568) on the chosen adapter, persists woken channels until a universe vanishes, and throttles grid IPC from the main process with per-universe FPS. Universe cards show a 32×16 live channel heatmap (visible rows only, 5 fps); the Monitor channel grid still updates at ~20 Hz. sACN data universes are joined only after E1.31 Universe Discovery. Recordings write a `DMXREC` `.dmx` file in chunks into the chosen library folder (default `Documents/DMX whIP/Shows`) after New File, using a high-res show clock so incoming packet rate (including 60 Hz) is stored in per-frame `t_ms`; playback uses the same clock so wall time matches the recording. A Library tab is a cue stack: display names only, drag-reorder and collapsible virtual folders in `library.json`, click-to-edit names and notes (folder titles keep the folder id on blur), Ctrl/Shift multi-select on visible rows, group drag, and Load / Push on the left rail. The chrome follows a zinc/cyan dark theme with a light-mode toggle. NIC / Format / Grid / Bars sit on the Monitor tab (32×16 default). Play, Stop, Loop, playback NIC, and the loaded name sit in a bar under the main tabs so they survive Library unmount; Studio keeps New File / Record / Cancel and stays mounted while hidden so a recording is not reset. Load a look from Library, not Studio. Selecting a folder stacks its looks (including nested folders) in the inspector; Load on this PC lays them back-to-back as named Studio clips. Studio Stop releases Art-Net/sACN sockets and rewinds to 0:00:00; the timeline has Play / Pause / Stop / Back / Next (clip starts). Heatmaps are protocol lanes (Art-Net plus sACN when present). Lighting clips sit on overlapping tracks with free start times, HTP merge, universe/channel remap, optional unicast dest IP, and a right-click inspector. A stereo audio lane imports common containers via ffmpeg to 16-bit 44.1 kHz WAV under `.comp/audio`. Save compilation writes an independent companion-only `.comp` package (reloadable and editable even if the source looks are deleted); Export flattened writes a lighting-only `DMXREC` `.dmx` for firmware/Push. Library, Devices, Studio, and Flash use the same left-rail width as Monitor. A Flash tab lists USB serial ports in that rail (log in the bottom eighth), can run `pio run` for the sibling `matrix` env (Build firmware), identifies ESP32-S3 chips, and writes a prebuilt 4MB QSPI image (bundled artifacts or sibling PIO `matrix` build) plus an NVS provision blob (Wi-Fi, node name, SD pins) at 0x9000; several COM ports can flash at once. After a provisioned write the tab waits for that MAC on ArtPoll and can jump to Devices. Matrix SD pin defaults stay editable (LED pin read-only). The flash form is a narrow column: it prefills the PC WLAN SSID, stores the last password (peek to reveal), and names nodes with last-4 MAC or a padded sequential suffix. It does not read the OS Wi-Fi key. A Devices tab ArtPolls the selected NIC and lists only paired whip ArtPollReply nodes (OEM 0x00FF, bind index 1, firmware node report; list popout opens the node portal in the default browser), and embeds the node's live SoftAP/STA portal plus a companion Pull to library control from `/status` `play.files`. Park Yes + live parks HTTP (amber live note, portal covered). Park No keeps the portal up during a light stream. Library can push the selected look to the node SD from the rail (byte/percent progress, idle 60 s, overall at least 10 min) and then `POST /meta` with the sidecar display name so the node portal can show the companion title. New File asks for a show name. Playback is clock-based (high-res origin, early wake / setImmediate for short gaps) with a working Stop control and legal sACN via the `sacn` package. Art-Net and sACN sockets use a 1 MiB receive buffer. The renderer is isolated (`contextIsolation`) with a local Tailwind build. ESP32 nodes live in the sibling repo `DMX_whIP_embedded` (ArtPollReply, SoftAP portal `/status`, idle SD playback of companion `DMXREC`, `POST /upload`). Treat this as a prototype restart, not a shipping 1.0.

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

### Phase D — Show library

One library folder plus import/export. Display name and notes live in a sidecar JSON next to each `.dmx`, never inside the recording. Scan the binary for inspector stats; do not load every frame into RAM just to fill the panel.

- [x] App-managed library folder (e.g. `Documents/DMX whIP/Shows`); New File / recordings land there
- [x] Library list of `.dmx` shows (watch the folder)
- [x] Inspector from the file: duration, frame count, size, dates, universes, protocol(s), packet rate and per-universe rate, woken channel counts
- [x] Sidecar JSON for display name and notes (companion-only; firmware keeps reading plain `DMXREC`)
- [x] Import a `.dmx` into the library; export a copy out of the library
- [x] Play, rename, and delete from the list (main path; keep a file picker only as a fallback)

### Phase E — Device discovery

Scan the **selected NIC**. Firmware (`DMX_whIP_embedded`) replies to Art-Net Poll and exposes `/status` on the STA IP whenever the node has an address. SoftAP `dmxwhip` is a fallback when there is no STA (**Hide AP if connected**, `/status` `park`).

- [x] Art-Net Poll on the chosen adapter; list nodes from ArtPollReply (name, IP, NIC, universes)
- [x] Stale timeout and optional Identify (flash / known pattern) so a row can be matched to a physical whip
- [x] When the node is idle, read `/status` (firmware version, brightness, protocol, FPS, buffer, SD size/used/free) via SoftAP `http://4.3.2.1` or the STA IP — do not expect HTTP during live input (superseded: firmware 0.13+ keeps HTTP on STA; SoftAP hide is `park`)
- [x] Setup stays available while live; Playback / Identify / SD routes stay 503 until the stream goes silent

### Phase F — Device transfer and control

SD via card reader stays as fallback. On-device idle playback already understands companion `DMXREC` `.dmx`. Firmware `0.8.0` accepts idle `POST /upload` and `POST /play` `src=stop`.

- [x] Push a library show to the node SD over the network (requires a node file/upload API in `DMX_whIP_embedded`)
- [x] List shows on the device SD; play/stop on the device vs play from this PC
- [x] Companion controls equivalent to the SoftAP portal (brightness, protocol, FPS, buffer, Wi-Fi) by calling the same HTTP the portal uses — not by scraping HTML

### Phase G — USB flash and board profile

Prebuilt S3 4MB QSPI image (not compiled in this app). PlatformIO stays in `DMX_whIP_embedded`.

- [x] Cursor compat rules and `MIN_FIRMWARE_API`
- [x] Board catalog for Waveshare ESP32-S3-Matrix plus artifact lookup
- [x] USB port list, S3 identify, refuse other chips
- [x] Flash prebuilt 4MB QSPI image (bootloader + partitions + app); keep NVS unless the user asks to erase
- [x] SD pin editor with Matrix defaults; LED data pin read-only
- [x] After flash, apply non-default SD pins via SoftAP `POST /pins`
- [x] Devices strip shows `api` / board / pins and warns if `api` is missing or below min

### Phase H — Flash provision and multi-COM

- [x] PC WLAN current SSID + scan + manual; no OS password read; persist last creds; 2.4 GHz warning
- [x] Flash-time node name (pattern + MAC suffix)
- [x] NVS blob (`wifi` / `node` / `board`) written at 0x9000 with the app image
- [x] Multi-select COM, per-port identify/flash, concurrency 4
- [x] After provisioned flash, wait for ArtPoll by MAC and jump to Devices

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
