# DMX whIP Companion

Companion application for DMX whIP to monitor, record, and play back network DMX (Art-Net and sACN).

**Version:** 0.52.0

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

The monitor binds Art-Net (UDP 6454) and sACN (UDP 5568) on the chosen adapter, marks a universe Inactive after 2.5 s without a packet (the E1.31 data-loss time, so a console's once-a-second keep-alive stays active) and drops it after 10 s, persists woken channels until a universe vanishes, and throttles grid IPC from the main process with per-universe FPS. Universe cards show a 32×16 live channel heatmap (visible rows only, 5 fps) and freeze while recording; the Monitor channel grid still updates at ~20 Hz when that tab is visible. Hidden tabs do not paint, and ArtPoll / universe snapshots / the DMX grid stay off the UDP capture path during a take. sACN data universes are joined only after E1.31 Universe Discovery. Punch-in Record writes a temp `DMXREC` from the playhead onto the selected lighting track (last selected, or Track 1), even with nothing loaded; only armed universes are captured, compilation audio plays, and live frames are averaged with look-at output without writing into other clips. A growing take that hits another clip on that row moves to the next track. Stop writes the take as an independent library `.dmx` look named with the local timestamp `YYYY-MM-DD HH-mm-ss` (a typed clip name renames that file) and focuses the inline clip name. Record can wait to start on the first armed-universe packet, on a change from the levels seen when armed, or on one channel (that channel is left out of the file and the live blend). Stop can be manual, after 5 seconds of all-zero levels, after 2.5 seconds without packets, or on a channel change. A single unmodified library take does not ask to save a compilation; leaving Studio or New File asks Save / Don't Save / Cancel only after a trim, fade, remap, extra clip, or audio. A Library tab is a cue stack: display names only, drag-reorder and collapsible virtual folders in `library.json`, click-to-edit names and notes (folder titles keep the folder id on blur), Ctrl/Shift multi-select on visible rows, group drag, and Import to Studio, a Push-to-SD icon, and a New-folder+ icon on the left rail. Hover Play (left of a look name) replaces the left-rail player queue and starts that file; hover + on a look or folder appends nested looks without autoplay. Import to Studio only appends to the Studio canvas. The chrome follows a zinc/cyan dark theme with a light-mode toggle. Colours, radii and fonts are CSS tokens (`src/renderer/input.css`, named in `tailwind.config.js` as `bg-surface`, `border-line`, `text-muted`, `text-accent`, and so on); the timeline and universe canvases read the same tokens through `src/renderer/theme.js`. Shared controls live in `src/renderer/components/ui/` (Button, IconButton, Field, Select, Checkbox, Toggle, Slider, Popover that flips and clamps to the window, Dialog that becomes a bottom sheet under 640 px, Tabs with arrow-key focus, EmptyState, ProgressBar, StatusPill, Toast, and one icon set), and display formatters in `src/services/shared/format.js`. The player scrubber is a slider (drag or arrow keys; the seek applies on release). Ctrl+Shift+U opens a hidden UI-kit gallery. The shell is responsive: from 1024 px the left column is docked with the full player; narrower, it becomes a drawer (header button named for what it holds: Universes, Shows, Nodes, Ports) and the player becomes a mini bar that opens the full player and queue as a sheet; below 768 px the views move to a bottom tab bar. The window opens at its last size and place (min 360×480), shows only once drawn, uses the theme colour behind the page, and Inter is bundled (`src/renderer/fonts`, SIL OFL) so nothing loads from the network. Touch: 44 px targets on touch screens, the queue row and Library Play / + actions stay visible, long-press a Studio clip for its inspector, tap a gap to close it, two-finger pinch zooms the timeline (Ctrl+wheel with a mouse or trackpad), fingers scrub on the ruler and get wider trim grips. The Monitor grid is one canvas with Auto / 8 / 16 / 32 columns (Auto follows the panel width); timeline row heights come from one place (`studio/timelineMetrics.js`); the clip inspector stays inside the window; the Devices portal view fills the panel. Format / Grid / Bars / Nodes / Group / Colour sit on the Monitor tab and are remembered. Nodes draws a labelled bracket over the channels each detected whIP node listens to (read from each node's `/status` patch, stacked in up to three lanes when nodes overlap, including an Advanced patch fixture's footprint); Group outlines each pixel's channels (Auto from the node's channels per pixel, Off, or a fixed 1–5 channels for gear the app can't detect, saved per universe); Colour tints each bar by the node's colour order (GRB shows green, red, blue; W and warm white too). Hover (or tap) a channel for its node, output, segment, pixel and colour. The placement maths is `src/services/shared/monitorOverlay.js`, tested against the firmware's rules. A **Live** tab has two banks of 16 faders and a 5×5 pad; each control has its own protocol, universe and channel (Edit → press a control; Patch… numbers a bank or the pad consecutively, rolling into the next universe), and pads are Flash (lit while held) or Toggle with their own on level. Faders take several fingers at once and the keyboard (arrows, PgUp/PgDn, Home/End). The layout is saved; levels start at 0 each launch. Output comes from the main process (`src/main/liveOutput.js`, its own Art-Net source and an sACN source "DMX whIP Live" with a saved CID) on the Settings Output NIC, which is now remembered, to broadcast/multicast or one unicast IP (Live rail). A changed universe goes out at up to 40 Hz with a 1 s keep-alive, and one left at 0 for 2 s is released (sACN stream-terminated) so a whIP node falls back to its own show. While a show is playing on the same universe, the Live levels are merged into playback's packets (highest wins) so nodes see one source. USB MIDI controllers drive the faders and pads from any tab (Web MIDI, allowed for the app window only; Chromium asks for the `midiSysex` permission for any MIDI access, so both names are allowed). Every connected controller is opened and listed in the Live rail, any number at once and hot-plugged (Rescan looks again), with its recognised profile, an activity dot that flashes when it sends, and a warning when another program holds the port; identical controllers get #2, #3. **Learn MIDI**, click a fader or pad (it pulses while listening), then move or press a control on the device; the first note, CC or pitch bend is captured, that control stops listening, and Learn stays on for the next one (Esc cancels listening, Esc again or Done leaves Learn). A message belongs to one control; learning it again moves it. Mappings are saved by controller name (so they come back when it is plugged in again) and show a MIDI badge; the editor shows and clears a control's mapping, and the Live rail lists controllers with Clear and a Feedback switch. Feedback lights mapped pads through a profile (`src/services/shared/midiProfiles.js`): Akai APC mini mk2 / APC Key 25 mk2 / APC40 mk2 RGB pads (palette green at full brightness) and single-colour buttons (velocity 1), APC mk1 (1 = green), Behringer X-Touch Mini standard mode (buttons 8-23 / 32-47 on channel 11 light LEDs 0-15 with velocity 1) and Mackie Control mode (127), other Behringer X-Touch / CMD (1, or 127 on channel 1), BCF/BCR2000 and anything else by echoing 127/0. A per-controller Light on value overrides the profile, and Test lights flashes every mapped pad. Fader levels go back when they change in the app, never echoing the controller's own moves. CC and pitch bend scale to 0-255; note pads follow press/release, CC pads press at 64 and above. Input NIC and Output NIC live in the Settings popup. Each tab’s left rail rises to the tabs; a player module pinned at the bottom of the left column (under the Flash console) has a short scrolling queue (Clear, hover up/down/delete), Pixel-style Back / Play triangle (Pause only while playing) / Stop / Next, a repeat toggle for the current item, and a scrubber with 0 / current / total. Pause holds the current frame; Stop blacks out then closes output. Cyan Record stays on the Studio timeline only. Studio keeps Cancel while recording or while waiting for a start trigger, and stays mounted while hidden so a recording is not reset. Fit / − / + zoom sit in the Studio timeline footer. Import to Studio from Library; selecting a folder stacks its looks (including nested folders) in the inspector; Import appends them onto the selected Studio track (or Track 1 of a new canvas) without replacing existing clips. Delete/Backspace removes the selected Studio clip. Studio Stop releases Art-Net/sACN sockets and rewinds to 0:00:00; the timeline uses the same icon transport (Back / Next seek clip starts). Heatmaps are protocol lanes (Art-Net plus sACN when present). Lighting clips sit on overlapping tracks with click-to-select, second-click rename, drag-reorder (`trackNames` in `project.json`), free start times, look-at averaging when they share protocol/universe/dest, fade in/out curves, universe/channel remap, optional unicast dest IP, and a right-click inspector. Hover a hole between clips for a snap-together ripple. Ctrl+C/X/V/Z/Y edit the Studio EDL (100-step undo); Library Ctrl+C/V duplicates looks. Text fields keep native clipboard. A stereo audio lane imports common containers via ffmpeg to 16-bit 44.1 kHz WAV under `.comp/audio`. Save compilation writes an independent companion-only `.comp` package (reloadable and editable even if the source looks are deleted); Export flattened writes a lighting-only `DMXREC` `.dmx` for firmware/Push. Library, Devices, Studio, and Flash use the same left-rail width as Monitor. A Flash tab lists USB serial ports in that rail (log in the bottom eighth), can run `pio run` for the sibling `matrix` env (Build firmware), identifies catalog chips, and writes that board’s image (bundled artifacts or sibling PIO `pioEnv` build) plus an NVS provision blob (Wi-Fi, node name, SD pins) at 0x9000; several COM ports can flash at once. After a provisioned write the tab waits for that MAC on ArtPoll and can jump to Devices. Matrix SD pin defaults stay editable (LED pin read-only). The flash form is a narrow column: it prefills the PC WLAN SSID, stores the last password (peek to reveal), and names nodes with last-4 MAC or a padded sequential suffix. It does not read the OS Wi-Fi key. A Devices tab ArtPolls the selected NIC and lists only paired whip ArtPollReply nodes (OEM 0x00FF, bind index 1, firmware node report; list popout opens the node portal in the default browser), and embeds the node's live SoftAP/STA portal plus a companion Pull to library control from `/status` `play.files`. Park Yes + live parks HTTP (amber live note, portal covered). Park No keeps the portal up during a light stream. Library can push a look, folder, or multi-select of looks to one or more idle node SDs from a fit-analysis dialog (output-0 start U/ch, pixels, ch/px, protocol vs the file’s per-universe woken ranges: green fit, amber shift, split when the batch covers the span, amber partial Push to overlapping nodes when the rest of the show is uncovered). Push stays enabled while nodes are selected (ArtPoll refresh does not disable it); the dialog closes on a full successful upload. The library `.dmx` is left intact; each node gets a temp slice at its start address, the same dest basename, nested dest paths, parallel nodes, byte/percent progress, idle 60 s, overall at least 10 min, then `POST /meta` with the display name plus a sync-group sidecar so firmware lockstep follows whoever hit Play (auto-boot elects by numeric-aware long name). Nested SD folders need sibling firmware mkdir on `/upload`. Playback is clock-based (high-res origin; universes due within 3 ms go out in one tick, so there is no busy-wait) with a working Stop control that blacks out before the sockets close, and legal E1.31 from one socket per output (byte-identical to the `sacn` reference encoder, checked by `npm test`; sequence numbers per universe). Records that arrive in one console burst share one timestamp, and the Studio flatten sends each recorded packet once (with fades and look-at averaging) instead of every universe at every timestamp. Our own playback looping back into the receivers shows on the monitor but is never recorded or used as a record trigger. Whole-file scans, slices and timeline overviews run in a worker thread. Push slices every node in one pass, uploads to up to three nodes at once, then writes the title/sync sidecars naming only nodes that received their slice; an Art-Net look pushed to an sACN-patched node is renumbered to that node's sACN universes. Node HTTP falls back to SoftAP `4.3.2.1` only when this PC has a `4.3.2.x` address, and never re-sends a POST that may have reached the node. Devices → **Show sync** puts the companion on the node cue bus v3 (firmware API 2): it keeps the shared network clock (as clock master once it has joined the running timeline, otherwise by PING/PONG), lists the nodes and the group cues they are running, and launches, pauses, resumes and stops synced groups found in each node's `/status` `play.groups`. Pushes write the group length (`sync_dur`) so every member loops together. `MIN_FIRMWARE_API` is 2. Show sync → **Show network** picks a Show Host and members and writes `/shownet` to each (they reboot onto the Host's own 2.4 GHz network at 10.77.0.1, no router); the Flash tab can provision the same role, SSID, password and channel into NVS. Push to SD has a **Mode**: Split (this PC slices, every node gets its part) or Distribute (the whole show goes to one holder node, which slices it for every node on the network by their own patch and uploads the parts; progress comes from the holder's `/status` `dist`) or Stream (the holder plays the whole show and streams every node its universes live with ArtSync; the others need nothing on their SD; Show sync lists running streams with Stop). Devices → **Update firmware** updates nodes over Wi-Fi (firmware API 3, `POST /ota`). For each catalog board the app uses the newest image it has (bundled `firmware/artifacts/<class>/firmware.bin` or the sibling `DMX_whIP_embedded` PIO build), reading board and version from the image's `WHIPFW:` tag. The dialog lists every node with its version, target and verdict (update, current, busy, needs one USB flash, no image), pre-ticks idle outdated nodes, updates up to three at once with byte progress, then waits for each to come back on the new version and pass its health check, or reports a rollback. Busy nodes (playing or live input) are skipped unless "Include busy nodes" is on. The device list shows each node's version plus an amber pill when an update is available (red `USB` when it needs one USB flash first); the inspector has Update firmware next to Reboot and shows a rolled-back warning. The Flash tab also blanks otadata, so a USB flash always boots the app it wrote even after an OTA. The inspector's **Advanced patch** (firmware 0.45+) edits the node as one console fixture: enable, mode (Dim + FX over the recorded look, RGB + FX, Full per LED), protocol, universe and channel, with the footprint, universe range and the 10 header channels (master dimmer, strobe, hue shift, filter R/G/B, add R/G/B, clip select). Sub-fixtures can be renamed, reordered, deleted and selected, and show their channels; the pixel list (virtualised, by output and segment) names every pixel and shows its channels for the mode. Select, Shift-select a run or a whole segment, then Group as new, Add to, Ungroup or Locate (lights them white on the node for 10 s). Save writes `POST /fixture` and the pixel names. Each mode is described in full under the Mode select (Dim + FX overlays whatever the node already plays and is a pure overlay with no sub-fixtures), with a note that 0 is "no effect" on every channel; a **Channel map** lists every header channel with what its values do, then one row per sub-fixture (Dim / RGB) or per segment with its colour order (Full), matching the node portal. Clip select at 0 returns the node to its startup playlist (firmware 0.49). The channel maths and checks live in `src/services/shared/fixture.js` (tested against the firmware's rules), matching the node portal's Patch → Advanced. Art-Net and sACN sockets use a 1 MiB receive buffer. The renderer is isolated (`contextIsolation`) with a local Tailwind build. ESP32 nodes live in the sibling repo `DMX_whIP_embedded` (ArtPollReply, SoftAP portal `/status`, idle SD playback of companion `DMXREC`, `POST /upload`). Treat this as a prototype restart, not a shipping 1.0.

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

Prebuilt catalog image (not compiled in this app). PlatformIO stays in `DMX_whIP_embedded`. Build firmware runs the selected board’s `pioEnv`.

- [x] Cursor compat rules and `MIN_FIRMWARE_API`
- [x] Board catalog for Waveshare ESP32-S3-Matrix plus artifact lookup
- [x] Catalog row for ESP32-C5-DevKitC-1-N8R4 (identity / defaults)
- [x] USB port list, identify/flash catalog chips (port chip must match selected board)
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

### Phase I — Push fit and multi-node sync

- [x] Scan looks for first/last woken channel span (start universe/channel, active channels)
- [x] Push-to-SD dialog compares that span to each idle node’s output-0 patch
- [x] Green / shift / split / uncovered verdicts; block Push when channels are uncovered
- [x] Upload a per-node shifted or sliced `DMXREC` (library file unchanged) and a sync-group sidecar
- [x] Firmware SD play assembles consecutive universes onto output 0; cue v2 master/follow by `t_ms`

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
