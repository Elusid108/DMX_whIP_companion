# Contracts shared with the firmware (inventory)

Everything the companion agrees on with `DMX_whIP_embedded` (ESP32 C3/C5/C6/S3 and RP2040/RP2350 nodes), where it is implemented here today, its current version, and where its tests live. These contracts will be owned by the future spec hub repo (**whip-spec**); until then the firmware repo is the contract owner named in `.cursor/rules/firmware-compat.mdc` and nothing here may change without flagging it in the PR and updating the firmware consumer in the same effort.

This file is an inventory. Nothing has been moved. The "Tests" column lists the first candidates for shared test vectors.

Status at `964d84c` (0.61.0). The sibling repo was not available while this was written, so firmware-side file names are quoted from comments in this repo and from the Cursor rule.

## Version levels in play

| Level | Value | Defined in | Meaning |
|---|---|---|---|
| Firmware API (`/status.api`) | floor `MIN_FIRMWARE_API = 2`, `OTA_MIN_API = 3` | `src/services/shared/firmwareCompat.js` | 2 = cue bus v3; 3 = `POST /ota`. A missing `api` is `0`. Firmware tag `WHIPFW:<board>:<version>:<api>;` |
| Cue bus | `API = 2`, magic `WHP3` ("v3") | `src/services/cuebus/protocol.js` | wire format of `sync_net.h` |
| Board catalog | `api: 1` | `firmware/catalog.json` | must match firmware `BoardProfile` |
| Release bundle manifest | `schema: 1` | `src/services/shared/firmwareManifest.js` | written by firmware `scripts/release.py` |
| NVS pixel-map blob | version byte `1` | `src/engine/core/pixelMap.js` `buildPmapBlob` (shim at `src/services/shared/pixelMap.js`) | read by firmware at boot |
| DMXREC `.dmx` | none (magic `DMXREC` only) | `src/engine/core/dmxrec.js` via `src/services/shared/dmxRecording.js` | unversioned on purpose: never changes |
| Sidecar `.json` next to a `.dmx` | none | `src/engine/core/library.js` | companion-only, firmware never reads it |
| `library.json` | `version: 1` | `src/engine/core/library.js` | companion-only |
| `.comp/project.json` | `version: 1`, `kind: 'compilation'` | `src/engine/core/playback.js` | companion-only |
| `settings.json` `knownNodes` | `version: 1` | `src/engine/core/discovery.js` | companion / console only |
| Engine API | `ENGINE_API_VERSION = 1` | `src/engine/api/version.js` | not shared with firmware |
| ArtPollReply | Art-Net 4 layout, OEM `0x00FF`, bind index `1` | `src/services/artnet/utils.js`, `src/main/ipc/network.js` | pairing rule |

## 1. DMXREC `.dmx` recording format

| | |
|---|---|
| Owner | firmware `include/dmxrec.h` ↔ `src/services/shared/dmxRecording.js` (locked by the Cursor rule; since Phase K the codec itself is `src/engine/core/dmxrec.js` and that path re-exports it with the file walkers) |
| Layout | header 10 B: `"DMXREC"` (6 ASCII) + `frameCount` u32 LE. Then `frameCount` records of 522 B: `timestamp` u32 LE ms, `universe` u32 LE, `protocol` u16 LE (0 Art-Net, 1 sACN), 512 B levels |
| Rules | header count must equal the file length; frames are in time order; records from one console burst share a timestamp (4 ms window, `createBurstStamper`); the file is written in 64 KiB chunks with a header-count rewrite; a universe is skipped until its first non-zero packet |
| Also used by | `dmxSlice.js` (per-node shifted or sliced copies for Push), `timelineOverview.js`, `scanRecording` (woken spans, fit), the engine recorder and player, the loopback fixture |
| Firmware consumers | idle SD playback, `/upload` ingest, the Distribute holder's slicer, Stream |
| Tests | `src/services/shared/scanRecording.test.js`, `playbackFrames.test.js`, `recordTriggers.test.js` (masking), `src/engine/loopback.test.js` (record → play → record round trip). No test fixes the byte layout against a known-good file: **first shared vector** |

### Sidecars (companion-only, never read by firmware)

- `<name>.json` beside `<name>.dmx`: `{ name, notes, updatedAt }` (`src/engine/library/store.js`). Display names travel to nodes only through `POST /meta`.
- Sync-group sidecar on the node is written **by the firmware** from `POST /meta` fields (`sync_group`, `sync_members`, `sync_kind`, `sync_dur`), see §3.
- `library.json` (`{ version: 1, items, collapsed }`) and `.comp/project.json` (`{ version: 1, kind, name, notes, trackCount, trackNames, clips, audioClips }`) are companion-only.

## 2. ArtPollReply pairing

| | |
|---|---|
| Owner | firmware `artnet_rx.cpp` ↔ `whipRejectReason()` in `src/main/ipc/network.js` (locked; since Phase K implemented in `src/engine/core/artnet/pairing.js` and re-exported there) |
| Parse | `src/engine/core/artnet/packet.js` `parseArtPollReply` (shim at `src/services/artnet/utils.js`): 239-byte minimum, `Art-Net\0`, OpCode `0x2100`; reads IP (10), port (14), OEM (20-21, big-endian), ESTA (24-25), short name (26, 18), long name (44, 64), node report (108, 64), num ports (173), port type (174), `SwOut` universes (190-193), style (200), MAC (201-206), bind IP (207-210), bind index (211) |
| Pairing rule | `oem === 0x00FF`, `bindIndex === 1`, `portType === 0x80`, `style === 0`, `nodeReport` matches `/^#0001 \[[0-9a-f]{4}\] .+ v\d+\.\d+\.\d+/i` |
| Timing | companion sends ArtPoll every 2.5 s (`POLL_MS`) while a device-aware tab is visible and not recording; a node is stale after 9 s (`STALE_MS`) |
| Universe convention | ArtPollReply `SwOut` is the 4-bit low nibble per port; the node's full patch comes from `/status` (`outputs[].uni`), not from the reply |
| Tests | `src/engine/core/core.test.js` (pairing rule). None for the parser. **Shared vector candidate**: one real ArtPollReply from each board |

## 3. Node HTTP API (port 80, plain HTTP, no authentication)

Owner: firmware README **Companion PC** block. Client: `src/main/deviceHttp.js` (request helpers, SoftAP `4.3.2.1` fallback only when this PC has a `4.3.2.x` address, 503 = busy, never re-send a POST that may have reached the node) and `src/main/ipc/network.js` (handlers). All POSTs are `application/x-www-form-urlencoded` unless noted; replies are JSON `{ success, error? , ... }`. `/status` extra keys are additive; unknown keys are ignored; the portal HTML is never scraped.

| Endpoint | Method, fields | Companion use | Firmware level |
|---|---|---|---|
| `/status` | GET | everything: `api`, `ver`, `board`, `proto`, `live`, `outputs[] { uni, ch, count, ch_px, white, cct, order, … }`, legacy `map`, `fixture`, `play { files, groups, sync }`, `ota { busy, pending, max, rolled_back }`, `shownet`, `stream { on, path, peers }`, `dist`, `park` | any |
| `/identify` | POST `ms` (200–15000) | Devices Identify | any |
| `/reboot` | POST | Devices Reboot | any |
| `/upload` | POST multipart `.dmx` with dest path (nested folders need firmware mkdir) and meta fields (`name` from the local sidecar, optional `sync_*`); idle 60 s, overall ≥ 10 min budget; byte progress | Push (Split / Distribute / Stream), library push | 0.8.0+ |
| `/meta` | POST `path`, `name`, optional `sync_group`, `sync_members` (JSON `[{ n, m }]`), `sync_kind` (`uni` or `split`), `sync_dur` ms | display name + sync-group sidecar after a push | API 2 for sync |
| `/file?path=` | GET, streams a `.dmx` | Pull to library | — |
| `/play` | POST `src` (`stop`, `root`, `folder`, `file`), `path` (`/` for root), `file_loop`, `folder_rep`, `n` | Devices Play / Stop, playlist | 0.8.0+ |
| `/brightness` | POST `v` | Devices | any |
| `/live` | POST `proto`, `fps`, `buf`, `park` | Devices live settings | 0.13+ (`park`) |
| `/fixture` | GET; POST form fields from `fixture.js` `toFields` | Advanced patch | 0.45+; header 13 ch 0.50+ |
| `/fixture/names?from=&n=` | GET; POST `from`, `names` (newline-separated) | pixel names in chunks | 0.45+ |
| `/fixture/locate` | POST `px`, `ms` | light selected pixels white | 0.45+ |
| `/scan?start=1`, `/scan` | GET, poll until done | Wi-Fi scan | any |
| `/connect` | POST `ssid`, `password` (plaintext) | join a Wi-Fi network | any |
| `/forget` | POST | forget Wi-Fi | any |
| `/shownet` | POST `role` (`standalone`, `host`, `member`), `ssid`, `pass` (plaintext), `ch` (default 6) | Show network | API 2 firmware |
| `/name` | POST `long`, `short` | rename node | any |
| `/rename` | POST `from`, `to` | rename an SD show | — |
| `/pins` | POST SD pin fields, to SoftAP `4.3.2.1` right after a USB flash | Flash tab | any |
| `/ota` | POST image stream, then poll `/status.ota` up to 150 s for the new `ver` and health | Update firmware | API 3 |
| `/distribute` | POST `path`; progress in `/status.dist` | Push Mode = Distribute | firmware that reports `/status.dist` |
| `/stream` | POST `path`, `on` (1/0); peers in `/status.stream` | Push Mode = Stream, Show sync Stop | firmware that reports `/status.stream` |

Tests: none exercise the HTTP client against a node (needs hardware). `firmwareCompat.test.js` covers `statusApi`, `otaVerdict`, `groupOtaRows`; `pushFit.test.js` covers the fit verdicts over `/status` patches; `monitorOverlay.test.js` `patchFromStatus` reads `outputs`, legacy `map` and `fixture`. **Shared vector candidate**: one captured `/status` JSON per firmware level (0, 1, 2, 3) and per board.

## 4. Cue bus v3

| | |
|---|---|
| Owner | firmware `sync_net.h` ↔ `src/services/cuebus/protocol.js` (byte-for-byte) and `cueBus.js` (socket, clock) |
| Transport | UDP 4777, broadcast on the selected NIC |
| Header | 20 B LE: `"WHP3"`, `op` u8, `flags` u8, `seq` u16, `sender` u32, `group` u32, `cue` u32 |
| Ops | HELLO 1, PING 2, PONG 3, LAUNCH 4, PAUSE 5, RESUME 6, SEEK 7, STOP 8; roles NODE 1, COMPANION 2, HOST 3; flags LOOP 1, PAUSED 2; HELLO bits SYNCED 1, MASTER 2, CUE 4, CUE_PAUSED 8, CUE_LOOP 16 |
| Times | microseconds on the shared network clock as i64; positions and durations ms as u32 |
| Group id | FNV-1a 32 of the sidecar group string (`hashGroup` = firmware `SdInfo::hashGroup`) |
| Clock | companion is master once it has joined the running timeline, otherwise PING/PONG offset estimation |
| Tests | `src/services/cuebus/protocol.test.js` (FNV hash, LAUNCH layout, HELLO round trip, PING/PONG offset, cue position), `cueBus.test.js` (loopback). **Shared vectors**: the LAUNCH and HELLO byte layouts already asserted here |
| Known bug | `cueBus.js` defines `stop` twice; the later one wins (see AUDIT risk 9) |

## 5. Firmware API levels and compatibility

- `src/services/shared/firmwareCompat.js`: `MIN_FIRMWARE_API = 2`, `OTA_MIN_API = 3`, `FW_TAG` regex `WHIPFW:<board>:<version>:<api>;` (written by firmware `ota.cpp`), `statusApi`, `apiTooOld`, `parseFwTag`, `compareVersions`, `otaVerdict` (update / current / busy / needs-usb / no-image / unknown), `groupOtaRows`.
- Rule: a breaking wire change bumps firmware `kFirmwareApi`, firmware MAJOR and this app together. Product semver may differ from firmware.
- Tests: `firmwareCompat.test.js` (five tests; one skips without the sibling build).

## 6. NVS provision blob at 0x9000

| | |
|---|---|
| Owner | ESP-IDF NVS page format (version 2) ↔ `src/main/nvsImage.js` `buildNvsImage`; keys read by the firmware's settings code |
| Where | the catalog board's `flash.nvs` offset (default `0x9000` = 36864) and `nvsSize` (20480) |
| Namespaces and keys | `wifi`: `ssid`, `pass` (strings) · `node`: `long`, `short` (strings) · `board`: `sd_cs`, `sd_mosi`, `sd_clk`, `sd_miso`, `btn` (u8, 255 = none) · `pmap`: `chip`, `data`, `clk`, `white`, `cct`, `proto`, `bri`, `n` (u8), `ords` (string), `count`, `uni`, `ch` (u16), `blob` (the pixel-map blob) · `show`: `role` (u8), `ssid`, `pass` (strings), `ch` (u8, default 6) · `led`: `bri` (u8) |
| Pixel-map blob | `buildPmapBlob`: byte 0 version `1`, byte 1 segment count n (≤ 24), then n × 19 B: `proto` u8, `chip` id u8, `data` pin u8, `clk` pin u8 (0 when the chip needs none), `white` u8, `cct` u8, `bri` u8, `order` 6 B ASCII, `count` u16 LE, `startUni` u16 LE, `startCh` u16 LE. The same map goes to RP boards over serial (`whip pmap`) |
| Secrets | `wifi.pass` and `show.pass` are written in plaintext (NVS is not encrypted); see AUDIT §10 |
| Tests | none for the NVS page layout or the blob. **Shared vector candidate**: a known blob and its decoded settings as the firmware reads them |

## 7. Board catalog

- `firmware/catalog.json` (`api: 1`), eight boards: Waveshare ESP32-S3-Matrix, ESP32-C5-DevKitC-1-N8R4, Seeed XIAO ESP32-C5 / S3 / C3 / C6, Seeed XIAO RP2040 / RP2350. Each row: `id`, `name`, `chip`, `family` (esp / rp), `flashClass`, `artifact`, `pioEnv`, `usb.cdc`, `defaults.led` (data, clk, count, order, chip, maxOutputs, maxSegments, maxPixels), `defaults.sd` (cs, mosi, clk, miso), `flash` (mode, freq, size, bootloader, partitions, otadata, otadataSize, app, nvs, nvsSize), `gpio` (max, reserved, strapping), `silk` (XIAO pad → GPIO), `detect` (USB ids, flashSize, `uf2Board`), `sdSpi` (RP), `net`, `wifi5g`, `brightnessWarn`.
- Must match firmware `BoardProfile`. The firmware tag's `<board>` is the catalog `id`.
- Tests: `boardDetect.test.js` (USB class, chip + flash size + USB → board, pin carry by XIAO pad, UF2 drive → chip, `whip id` reply parse). No test checks the catalog against the firmware's `BoardProfile`: **shared vector candidate** (the firmware could emit its profiles as JSON).

## 8. Release bundle manifest

- `src/services/shared/firmwareManifest.js`, schema 1, written by firmware `scripts/release.py` into `dist/whip-<ver>/manifest.json`: `{ schema, version, api, git, built, boards: { <id>: { env, family, chip, flash, layout { appSize, nvs, nvsSize, otadata, otadataSize }, parts: [{ role, file, offset, size, sha256, tag? }] } } }`; RP boards carry `uf2: { file, familyId, size, sha256, tag }` instead of parts. Paths must be relative with no `..`; sha256 must be 64 hex.
- Image sources and precedence: `firmware/README.md` (release bundles, sibling `dist`, `firmware/artifacts`, sibling `.pio/build`; highest `WHIPFW:` version wins, ties to the newer file). sha256 is checked before OTA upload (`verifyListedImage`); loose images have no hash.
- Tests: `firmwareManifest.test.js` (parse, reject, precedence, RP uf2; one skips without a built bundle).

## 9. Advanced patch header and fixture rules

- `src/services/shared/fixture.js` mirrors firmware `src/fixture.cpp` and the portal's Patch → Advanced: modes `basic` (5-channel header: intensity, strobe, hue, folder, clip), `dim` (13-channel header + 2 ch per sub-fixture), `rgb` (13 + 5 per sub-fixture), `full` (13 + channels-per-pixel for every LED, never split across a universe). 13-channel header order: master dimmer, strobe, strobe colour, strobe intensity, hue shift, filter R/G/B, add R/G/B, folder, clip. 0 = no effect on every channel (firmware 0.48+); clip 0 = startup playlist (0.49); header 13 (0.50+); Advanced patch (0.45+). Limits: `MAX_SUBS 96`, `MAX_RANGES 256`, `MAX_UNIVERSES 6`, `NAME_MAX 23`.
- `/fixture` fields ↔ form: `toFields` / `fromFixture`, pixel names via `/fixture/names`.
- Tests: `fixture.test.js` (pixel order, range round trip, reduced-mode footprints, Full never splits a pixel, validate, JSON ↔ fields, channel map rows). **Shared vectors**: the footprint and channel-map cases.

## 10. Monitor overlay (pixel placement rules)

- `src/services/shared/monitorOverlay.js` mirrors firmware `src/pixel_map.cpp`: sACN universe = Art-Net universe + 1 per segment (as `/status` reports); a segment running past 512 channels packs pixels back to back (a pixel may straddle universes), otherwise every pixel is whole in one universe; DMX per pixel is always R, G, B[, W][, warm W] regardless of wire order (`LedBus::setPacked`); up to 3 lanes when nodes overlap; the Advanced patch footprint follows `fixture.js`.
- Tests: `monitorOverlay.test.js` (ten cases including packed straddle, sACN +1, lanes, fixture footprints).

## 11. Push fit, slices and sync sidecars

- `src/services/shared/pushFit.js`: woken-span vs output-0 patch → green fit / amber shift / split / partial / uncovered; an Art-Net look pushed to an sACN-patched node is renumbered to its sACN universes. `dmxSlice.js` writes the per-node shifted or sliced `DMXREC`. Sync fields go through `POST /meta` (§3); firmware SD play assembles consecutive universes onto output 0; cue v2/v3 master/follow by `t_ms`.
- Tests: `pushFit.test.js` (six verdict cases), `scanRecording.test.js`.

## 12. Serial protocol (RP boards and board identify)

- `whip id` (any whIP firmware on a serial port answers; parsed by `boardDetect.js`), `whip boot` (0.56+, restart into the UF2 bootloader), `whip set`, `whip pmap` (settings and pixel map over serial after a UF2 copy; firmware `serial_cmd`). Client: `src/main/nodeSerialDevice.js`, `uf2Flash.js`, `portProbe.js`. UF2 drive `INFO_UF2.TXT` `Board-ID` (`RPI-RP2`, `RP2350`) is the catalog `detect.uf2Board`.
- Tests: `boardDetect.test.js` (reply parse, UF2 drive). No wire test.

## Not shared with the firmware (for clarity)

Art-Net DMX and sACN E1.31 packets follow the public standards (`artnet/utils.js`, `sacn/utils.js`; the sACN bytes are checked against the `sacn` package in `sacnPacket.test.js`). The engine API, `.comp`, `library.json`, `settings.json`, the sidecar `.json` and MIDI profiles are companion-only.

## First shared test vectors (proposal for whip-spec)

1. A known-good `DMXREC` file (two protocols, a burst-stamped frame pair) with its decoded frame list.
2. One ArtPollReply capture per board with the expected parse and pairing result.
3. One `/status` JSON per firmware API level and board.
4. Cue bus LAUNCH and HELLO byte vectors (already asserted in `protocol.test.js`).
5. An NVS provision image and pixel-map blob with the settings the firmware reads back.
6. `catalog.json` against the firmware's `BoardProfile` table.
7. Fixture footprints and channel maps per mode (`fixture.test.js` cases).
8. Release manifest sample (`firmwareManifest.test.js` fixture).
