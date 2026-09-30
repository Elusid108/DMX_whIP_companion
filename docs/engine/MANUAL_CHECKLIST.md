# Manual walkthrough (Phase J, hand checks)

These steps need a person, hardware or a LAN. None of them was run in the sandbox that built Phase J, so the README box "Walk the README behaviors by hand" stays unticked until you have done them. Fill in the Result column and commit this file with the results.

Setup for every section: a PC with the companion at the Phase J commit (`npm install`, `npm start`), one whIP node on the same 2.4 GHz network (firmware API 3 or newer), a lighting console or any Art-Net/sACN source, and an optional USB MIDI controller. Set **Settings → Input NIC** and **Output NIC** to the LAN adapter.

## 1. Monitor

| # | Step | Expected | Result |
|---|---|---|---|
| 1.1 | Open Monitor with the console sending Art-Net universe 0 and sACN universe 1 | Both universes appear within a second, FPS matches the console, heatmaps move | |
| 1.2 | Stop the console for 3 s, then 11 s | Universe goes Inactive after ~2.5 s and disappears after ~10 s | |
| 1.3 | Switch to Library for 10 s, back to Monitor | Grid resumes at ~20 Hz; nothing painted while hidden (Task Manager CPU flat) | |
| 1.4 | Change Input NIC | Universe list clears and refills on the new adapter | |

## 2. Record

| # | Step | Expected | Result |
|---|---|---|---|
| 2.1 | Studio → arm universes 0 and 1 → Record (start mode none, stop manual) → wait 5 s → Stop | A take named `YYYY-MM-DD HH-mm-ss` appears in Library and on the timeline; inspector shows both universes and about 5 s | |
| 2.2 | During 2.1 open Monitor | No universe cards update while recording (quiet capture path); they resume after Stop | |
| 2.3 | Record with start mode "first packet", console silent, then send | Recording begins on the first armed packet; `punch-in-started` toast/clip appears | |
| 2.4 | Record with stop mode "blackout", then black the console for 5 s | Take stops itself and lands in the library | |
| 2.5 | Record with a trigger channel (e.g. Art-Net 0 ch 512) | That channel is zero in the take (inspect the file) and Stop-on-change works | |

## 3. Play

| # | Step | Expected | Result |
|---|---|---|---|
| 3.1 | Library → hover Play on the 2.1 take with a node listening on universe 0 | Node follows the take; player scrubber advances; ends at the take length | |
| 3.2 | Pause mid-way | Node holds the frame (packets keep flowing at 10 Hz) | |
| 3.3 | Stop | Node goes black then falls back to its own SD show (sockets close ~120 ms after the blackout) | |
| 3.4 | Repeat on; let it wrap | Loops without a gap; scrubber returns to 0 | |
| 3.5 | Queue two looks, hover +, Play | Second starts after the first ends (`playerEnded`) | |
| 3.6 | Studio: load a `.comp` with fades and a remapped clip, Play | Fades audible on the node; remapped universe is the one that moves | |

## 4. Live merge (highest wins)

| # | Step | Expected | Result |
|---|---|---|---|
| 4.1 | Control tab: fader on Art-Net 0 ch 1 to 100 %, nothing playing | Node ch 1 full; every other channel unchanged | |
| 4.2 | Play a look on universe 0 whose ch 1 is at ~30 %, keep the fader at 100 % | Node ch 1 stays full (highest wins) while the rest follows the look; one source only (node `/status` shows one live source) | |
| 4.3 | Lower the fader to 20 % while playing | Node ch 1 follows the look (30 %) | |
| 4.4 | Stop playback with the fader at 100 % | Node ch 1 stays full from the Live source (Live kicks in on its own sockets) | |
| 4.5 | Fader to 0 and wait 2 s | Node releases: sACN stream-terminated ×3 on a sACN fader, Art-Net just stops; node returns to its SD show | |
| 4.6 | Play sACN universe 1 from Studio and move a sACN fader on universe 1 | Same merge on sACN; sACN source name in a Wireshark capture is "DMX whIP Playback" while playing | |

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

## 7. Studio audio and dialogs

| # | Step | Expected | Result |
|---|---|---|---|
| 7.1 | Studio → Import audio → pick an MP3 | Converted with ffmpeg, waveform lane appears, plays with the timeline | |
| 7.2 | Load recording with no path (File picker) → cancel | "No file selected", Studio unchanged | |
| 7.3 | Edit a compilation, switch tab | Save / Don't Save / Cancel prompt appears and each choice works | |

## 8. Headless engine on a Pi 5 (or any Linux box)

| # | Step | Expected | Result |
|---|---|---|---|
| 8.1 | On the Pi: `git clone`, `npm install --omit=dev --ignore-scripts` (no Electron, no serialport build), `node --version` is 22.x | Install succeeds without a compiler | |
| 8.2 | `DMXWHIP_DATA_DIR=$HOME/.dmxwhip node src/engine/headless.js --nic 0.0.0.0` | Log line `engine ready api=1 version=<app> data=<dir> nic=0.0.0.0`; process stays up | |
| 8.3 | `ss -ulpn \| grep node` and `ss -tlpn \| grep node` | Two UDP sockets (6454, 5568) on the chosen adapter; **no TCP listener** | |
| 8.4 | Send Art-Net from the console; run `node src/engine/headless.js --probe` in another shell | Probe prints the monitor state from a fresh in-process engine on other ports (proof the module runs); the long-running instance keeps receiving (CPU steady) | |
| 8.5 | `npm test` on the Pi | All tests pass, including the loopback regression test | |
| 8.6 | Ctrl-C | "engine stopped" and a clean exit | |

## 9. Regression across the extraction

| # | Step | Expected | Result |
|---|---|---|---|
| 9.1 | Compare `settings.json` before and after first launch of the Phase J build | Same keys; `liveCid` unchanged | |
| 9.2 | Library folder and `library.json` | Unchanged; folders, order and collapsed state preserved | |
| 9.3 | Wireshark: record a 10 s playback of the same `.dmx` on the pre-Phase-J build and this build | Same packet count per universe, same E1.31 fields (except CID/sequence), same Art-Net bytes | |
