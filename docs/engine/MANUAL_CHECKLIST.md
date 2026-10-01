# Manual walkthrough (Phase K, hand checks)

These steps need a person, hardware or a LAN. None of them was run in the sandbox that built Phase K, so the README boxes "Walk the README behaviors by hand" and "Add a headless entry point … verify on Linux, then on the CM5" stay unticked until you have done them. Fill in the Result column and commit this file with the results.

What changed under the hood, so you know what to watch for: the engine core now runs on ports (clock, scheduler, UDP, storage, workers) instead of Node built-ins; packets are built on `Uint8Array`; own-output filtering is per engine; the receivers, Live output, playback, recording, library and settings all moved into `src/engine/core`. Nothing user-visible was meant to change. Anything that differs from the 0.61.0 build is a regression to report.

Setup for every section: a PC with the companion at the Phase K commit (`npm install`, `npm start`), one whIP node on the same 2.4 GHz network (firmware API 3 or newer), a lighting console or any Art-Net/sACN source, and an optional USB MIDI controller. Set **Settings → Input NIC** and **Output NIC** to the LAN adapter. Keep a 0.61.0 build (the baseline, `964d84c`) to hand for the side-by-side checks in §9.

## 1. Monitor

| # | Step | Expected | Result |
|---|---|---|---|
| 1.1 | Open Monitor with the console sending Art-Net universe 0 and sACN universe 1 | Both universes appear within a second, FPS matches the console, heatmaps move | |
| 1.2 | Stop the console for 3 s, then 11 s | Universe goes Inactive after ~2.5 s and disappears after ~10 s | |
| 1.3 | Switch to Library for 10 s, back to Monitor | Grid resumes at ~20 Hz; nothing painted while hidden (Task Manager CPU flat) | |
| 1.4 | Change Input NIC | Universe list clears and refills on the new adapter | |
| 1.5 | Send a universe with a non-ASCII sACN source name (or any name) from the console | Source name on the card matches the console's, as it did on 0.61.0 | |

## 2. Record

| # | Step | Expected | Result |
|---|---|---|---|
| 2.1 | Studio → arm universes 0 and 1 → Record (start mode none, stop manual) → wait 5 s → Stop | A take named `YYYY-MM-DD HH-mm-ss` (local time) appears in Library and on the timeline; inspector shows both universes and about 5 s | |
| 2.2 | During 2.1 open Monitor | No universe cards update while recording (quiet capture path); they resume after Stop | |
| 2.3 | Record with start mode "first packet", console silent, then send | Recording begins on the first armed packet; `punch-in-started` toast/clip appears | |
| 2.4 | Record with stop mode "blackout", then black the console for 5 s | Take stops itself and lands in the library | |
| 2.5 | Record with a trigger channel (e.g. Art-Net 0 ch 512) | That channel is zero in the take (inspect the file) and Stop-on-change works | |
| 2.6 | Open the take's `.json` sidecar | `name`, `notes`, `updatedAt` (ISO time) as before | |

## 3. Play

| # | Step | Expected | Result |
|---|---|---|---|
| 3.1 | Library → Play on the 2.1 take with a node listening on universe 0 | Node follows the take; player scrubber advances; ends at the take length | |
| 3.2 | Pause mid-way | Node holds the frame (packets keep flowing at 10 Hz) | |
| 3.3 | Stop | Node goes black then falls back to its own SD show (sockets close ~120 ms after the blackout) | |
| 3.4 | Repeat on; let it wrap | Loops without a gap; scrubber returns to 0 | |
| 3.5 | Queue two looks, Play | Second starts after the first ends (`playerEnded`) | |
| 3.6 | Studio: load a `.comp` with fades and a remapped clip, Play | Fades visible on the node; remapped universe is the one that moves | |
| 3.7 | Studio: Save compilation, then Export flattened | `.comp/project.json`, `media/*.dmx` and the flattened `.dmx` open on 0.61.0 too (same byte layout) | |

## 4. Live merge (highest wins)

| # | Step | Expected | Result |
|---|---|---|---|
| 4.1 | Control tab: fader on Art-Net 0 ch 1 to 100 %, nothing playing | Node ch 1 full; every other channel unchanged | |
| 4.2 | Play a look on universe 0 whose ch 1 is at ~30 %, keep the fader at 100 % | Node ch 1 stays full (highest wins) while the rest follows the look; one source only (node `/status` shows one live source) | |
| 4.3 | Lower the fader to 20 % while playing | Node ch 1 follows the look (30 %) | |
| 4.4 | Stop playback with the fader at 100 % | Node ch 1 stays full from the Live source (Live kicks in on its own sockets) | |
| 4.5 | Fader to 0 and wait 2 s | Node releases: sACN stream-terminated ×3 on a sACN fader, Art-Net just stops; node returns to its SD show | |
| 4.6 | Play sACN universe 1 from Studio and move a sACN fader on universe 1 | Same merge on sACN; sACN source name in a Wireshark capture is "DMX whIP Playback" while playing, "DMX whIP Live" after Stop, with the same Live CID as 0.61.0 (`settings.json` `liveCid`) | |

## 5. Push to SD

| # | Step | Expected | Result |
|---|---|---|---|
| 5.1 | Library → select the 2.1 take → Push to SD → pick an idle node | Fit dialog shows green/shift/split; Push uploads with byte progress, dialog closes on success | |
| 5.2 | Node `/status` `play.files` | Lists the pushed file with the display name from the sidecar | |
| 5.3 | Devices → Play on the node | Node plays the take from SD | |
| 5.4 | Push a folder to two nodes with Mode = Split | Each node gets its slice; sync-group sidecar written; both start together on Play | |

## 6. MIDI control

| # | Step | Expected | Result |
|---|---|---|---|
| 6.1 | Plug a USB MIDI controller, open Control | Controller listed with its profile and an activity dot | |
| 6.2 | Learn MIDI → click fader 1 → move a controller fader | Fader follows the controller; mapping badge shown; unplug/replug keeps it | |
| 6.3 | Map a pad, press it | Node channel goes to the pad level while held (Flash) or toggles (Toggle); pad LED lights via feedback | |
| 6.4 | Move a controller fader while a look plays on that universe | Merge behaves as in 4.2 | |

## 7. Studio audio, dialogs, Flash

| # | Step | Expected | Result |
|---|---|---|---|
| 7.1 | Studio → Import audio → pick an MP3 | Converted with ffmpeg, waveform lane appears, plays with the timeline | |
| 7.2 | Load recording with no path (File picker) → cancel | "No file selected", Studio unchanged | |
| 7.3 | Edit a compilation, switch tab | Save / Don't Save / Cancel prompt appears and each choice works | |
| 7.4 | Flash tab → a XIAO with a pixel patch → Flash with provisioning | Node boots with the Wi-Fi, name and pixel map written (the NVS pixel-map blob is now built on `Uint8Array` and wrapped in a Buffer for the writer) | |

## 8. Headless engine on Linux, then on the CM5

### 8a. Any Linux box (the sandbox did the automated part of this)

| # | Step | Expected | Result |
|---|---|---|---|
| 8a.1 | `git clone`, `npm install --omit=dev --ignore-scripts` (no Electron, no serialport build, no ffmpeg download), `node --version` is 22.x | Install succeeds without a compiler or network beyond npm | |
| 8a.2 | `DMXWHIP_DATA_DIR=$HOME/.dmxwhip node src/engine/headless.js --nic 0.0.0.0` | Log line `engine ready api=1 version=<app> data=<dir> nic=0.0.0.0`; process stays up | |
| 8a.3 | `ss -ulpn \| grep node` and `ss -tlpn \| grep node` | Two UDP sockets (6454, 5568) on the chosen adapter; **no TCP listener** | |
| 8a.4 | Send Art-Net from the console; run `node src/engine/headless.js --probe` in another shell | Probe prints the monitor state from a fresh in-process engine on other ports (proof the module runs); the long-running instance keeps receiving (CPU steady) | |
| 8a.5 | `npm test` | All tests pass, including the loopback regression test (two engines in one process) | |
| 8a.6 | Ctrl-C | "engine stopped" and a clean exit | |

### 8b. Raspberry Pi CM5 under Raspberry Pi OS (64-bit)

| # | Step | Expected | Result |
|---|---|---|---|
| 8b.1 | Fresh Raspberry Pi OS Lite 64-bit on the CM5; install Node 22 (NodeSource or the Yocto-matching 22.22.x tarball); `node --version` | 22.x | |
| 8b.2 | `git clone` this repo at the Phase K commit; `npm install --omit=dev --ignore-scripts` | Succeeds; `node_modules/serialport` and `ffmpeg-static` have no native binary, which is fine for the engine | |
| 8b.3 | `npm test` | All pass; note the loopback and headless timings in the Result column (they are loose by design) | |
| 8b.4 | `DMXWHIP_DATA_DIR=$HOME/.dmxwhip node src/engine/headless.js --nic <eth0 or wlan0 IP>` | `engine ready …`, `~/.dmxwhip/settings.json` created with `libraryDir` under `~/.dmxwhip/Shows` and a `knownNodes` key `{ version: 1, nodes: [] }` | |
| 8b.5 | `ss -ulpn \| grep node`, `ss -tlpn \| grep node` | UDP 6454 and 5568 on that IP; no TCP listener | |
| 8b.6 | Console sends Art-Net to the Pi's broadcast; `node src/engine/headless.js --probe --nic <same IP>` is **not** valid at the same time (port clash), so instead stop the long-running one and run it with `--probe` while the console sends | Probe JSON lists the universe with its FPS | |
| 8b.7 | Leave the engine running 30 min with the console sending 4 universes at 40 fps; `top` | CPU and RSS flat (no leak from the per-packet `Uint8Array` views) | |
| 8b.8 | Ctrl-C | "engine stopped", clean exit, no lingering sockets | |

## 9. Regression across the extraction (side by side with 0.61.0)

| # | Step | Expected | Result |
|---|---|---|---|
| 9.1 | Compare `settings.json` before and after first launch of the Phase K build | Same keys plus the new `knownNodes` (`{ "version": 1, "nodes": [] }`); `liveCid` unchanged | |
| 9.2 | Library folder and `library.json` | Unchanged; folders, order and collapsed state preserved | |
| 9.3 | Wireshark: record a 10 s playback of the same `.dmx` on the 0.61.0 build and this build | Same packet count per universe, same E1.31 fields (except CID/sequence), same Art-Net bytes | |
| 9.4 | Wireshark: Live fader move, keep-alive, release on both builds | Same cadence (≤ 40 Hz on change, 1 s keep-alive, 3 × terminated after 2 s at zero) | |
| 9.5 | Record the same console output for 10 s on both builds and `cmp` the `.dmx` files after trimming to the same frame count | Identical record layout; timestamps within burst tolerance | |
