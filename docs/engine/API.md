# Engine API (version 1)

The engine (`src/engine/`) is a headless Node package. Every UI, the companion's Electron renderer today and the console kiosk later, talks to it through one message-shaped, asynchronous API: **commands** (request/reply, change state), **queries** (request/reply, read state) and **events** (engine → client, subscription based). The same envelope works over Electron IPC now (through the in-process adapter in the main process) and over a WebSocket later. High-rate data uses a separate binary stream.

`ENGINE_API_VERSION` lives in `src/engine/api/version.js` and is `1`.

## 1. Envelope

All envelopes are plain JSON-compatible objects (structured-clone safe). Names are dotted, lower camel: `area.verb`.

Request (client → engine):

```json
{ "id": "c42", "kind": "command", "name": "live.set", "payload": { "changes": [ { "proto": "artnet", "uni": 0, "ch": 1, "value": 255 } ] } }
{ "id": "q7",  "kind": "query",   "name": "monitor.state", "payload": {} }
```

- `id`: client-chosen string, unique per client while the request is in flight. Echoed on the reply.
- `kind`: `command` or `query`. A name is registered as exactly one kind; sending the other kind is a `bad_request`.
- `payload`: object, may be `{}`. Unknown fields are ignored.

Reply (engine → client), always exactly one per request:

```json
{ "id": "c42", "ok": true,  "result": { "success": true } }
{ "id": "q7",  "ok": false, "error": { "code": "not_found", "message": "Unknown query monitor.stat", "data": { "name": "monitor.stat" } } }
```

Event (engine → client), no `id`:

```json
{ "kind": "event", "name": "playback.stats", "payload": { "isPlaying": true, "playheadMs": 1234 } }
```

Handlers reply with the existing `{ success, error?, ... }` result objects the companion already uses; the envelope's `ok/error` is for transport-level failures (unknown name, invalid payload, handler threw). A handler that returns `{ success: false, error }` is still an `ok: true` reply. This keeps the renderer's existing result handling unchanged.

## 2. Error model

| code | meaning |
|---|---|
| `bad_request` | malformed envelope, wrong `kind` for the name, or a payload that failed validation |
| `not_found` | unknown command/query name, unknown subscription id |
| `conflict` | the engine is in a state that forbids the request (e.g. already recording) and the handler chose to reject rather than return `success:false` |
| `unavailable` | a resource the handler needs is not there (socket could not bind, worker gone) |
| `unsupported_version` | handshake: the client's API version is not served |
| `internal` | the handler threw; `message` carries the error text |

`error.data` is optional and handler-specific.

## 3. Handshake and versioning

The first request from any client is the query `engine.hello`:

```json
{ "id": "h1", "kind": "query", "name": "engine.hello", "payload": { "clientApiVersion": 1, "client": "companion 0.61.0" } }
→ { "id": "h1", "ok": true, "result": { "apiVersion": 1, "appVersion": "0.61.0", "capabilities": ["monitor", "live", "playback", "record", "library", "stream"] } }
```

- `apiVersion` is `ENGINE_API_VERSION`. Version 1 accepts only `clientApiVersion: 1`; anything else gets `unsupported_version` with `data.apiVersion`.
- Compatible additions (new commands, new optional payload fields, new event names) do not bump the version. Removing or renaming a name, changing a payload's meaning, or changing the stream frame layout does.

## 4. Subscriptions and rate limits

Events are delivered only to subscribed clients. Subscribing is itself a command:

```json
{ "id": "s1", "kind": "command", "name": "engine.subscribe", "payload": { "name": "monitor.snapshot", "maxHz": 5 } }
→ { "id": "s1", "ok": true, "result": { "subscriptionId": "sub-3" } }
{ "id": "s2", "kind": "command", "name": "engine.unsubscribe", "payload": { "subscriptionId": "sub-3" } }
```

- `maxHz` (optional, > 0): the engine coalesces events for that subscription, keeping the latest payload and delivering it at most `maxHz` times per second (latest wins, nothing queues). Without `maxHz` every event is delivered.
- Some emitters only run while someone is subscribed (the universe monitor's 50 ms tick). Subscription presence is therefore part of the contract: hidden tabs unsubscribe rather than filter.
- Subscriptions die with the client (`client.close()`).

Semantics preserved from the companion: the monitor snapshot is produced at 5 Hz and the grid at up to 20 Hz inside the engine regardless of `maxHz`; playback stats at ~10 Hz while playing plus one per transition; recording and punch-in stats at ≤ 10 Hz.

## 5. Binary stream

High-rate binary data never travels as per-frame JSON. A client subscribes to a stream by name through `engine.subscribe` with `{ name, maxHz, stream: true }` and receives **stream frames** on the client's stream sink (`client.onStream(fn)` in process; a binary WebSocket frame later):

```
{ name: 'monitor.grid', header: { protocol, universe, sourceIp, sourceName }, bytes: Uint8Array }
```

`monitor.grid` frame bytes (576 bytes):

| offset | length | content |
|---|---|---|
| 0 | 512 | channel levels 0..255 for the selected universe |
| 512 | 64 | woken bitmap, bit `i` set when channel `i+1` has ever carried a non-zero value since the universe appeared (a cleared bit means "never woken", which the companion renders as blank) |

`header` is small JSON metadata that changes rarely. The `universes-snapshot` levels stay inside the `monitor.snapshot` event as one `Uint8Array(512)` per universe (a structured-clone binary, as today) at 5 Hz; a later version may move them to the stream.

## 6. Command, query and event catalogue (version 1)

### Engine

| name | kind | payload → result |
|---|---|---|
| `engine.hello` | query | `{ clientApiVersion, client? }` → `{ apiVersion, appVersion, capabilities[] }` |
| `engine.subscribe` | command | `{ name, maxHz?, stream? }` → `{ subscriptionId }` |
| `engine.unsubscribe` | command | `{ subscriptionId }` → `{}` |

### Receive and monitor

| name | kind | payload → result / event payload |
|---|---|---|
| `receive.setNic` | command | `{ nic }` (IPv4 or `0.0.0.0`) rebinds Art-Net 6454 and sACN 5568 on that adapter → `{ success }` |
| `receive.setUniverses` | command | `{ universes: ["artnet-0", "sacn-1"] }` armed universes for recording → `{ success }` |
| `monitor.select` | command | `{ protocol, universe }` selects the grid universe (emits one grid frame at once) → `{ success }` |
| `monitor.state` | query | `{}` → `{ nic, selected: { protocol, universe } | null, universes: Row[] }` |
| `artnet.poll` | command | `{}` sends one ArtPoll on the receive socket → `{ success }` |
| `network.interfaces` | query | `{}` → `[{ name, ip }]` |
| `monitor.snapshot` | event | `{ artnet: Row[], sacn: Row[], levels: { artnet: { [uni]: Uint8Array(512) }, sacn: {...} } }` at 5 Hz while subscribed and not recording |
| `monitor.grid` | stream | frame described in §5, ≤ 20 Hz while subscribed and not recording |
| `monitor.cleared` | event | `{}` after `receive.setNic` |
| `artnet.pollReply` | event | parsed ArtPollReply `{ ip, mac, shortName, longName, universe, universes, bindIndex, oem, portType, style, nodeReport, sourceIp }`, per reply |

`Row = { id, universe, sourceIp, sourceName, activeChannels, fps, stale, protocol, lastSeen }`.

### Live output

| name | kind | payload → result |
|---|---|---|
| `live.set` | command | `{ changes: [{ proto, uni, ch, value }] }` → `{ success }` (fire-and-forget clients may ignore the reply) |
| `live.releaseAll` | command | `{}` → `{ success }` |
| `live.get` | query | `{}` → `{ success, live, outputNic }` (saved layout, dest, MIDI mappings, output NIC) |
| `live.save` | command | `{ faders?, pads?, dest?, midi? }` → `{ success, live }` |
| `output.setNic` | command | `{ nic }` → `{ success, outputNic }` (Live and playback output adapter) |
| `live.state` | query | `{}` → `{ nic, dest, universes: [{ proto, uni, owned }] }` |

### Recording

| name | kind | payload → result / event payload |
|---|---|---|
| `record.setPath` | command | `{ filePath }` (an existing library file created by the companion) → `{ success }` |
| `record.start` | command | `{ filePath? }` → `{ success, filePath }` |
| `record.stop` | command | `{ emitSaved? }` → `{ success, filePath, totalFrames }` |
| `record.cancel` | command | `{}` → `{ success, filePath }` |
| `record.state` | query | `{}` → `{ recording, filePath, elapsedMs }` |
| `record.stats` | event | `{ currentFps, totalFrames, droppedFrames }` ≤ 10 Hz |
| `record.saved` | event | `{ success, filePath, totalFrames }` |
| `record.error` | event | `{ error }` |

### Playback, Studio, punch-in

| name | kind | payload → result / event payload |
|---|---|---|
| `playback.load` | command | `{ filePath, displayName? }` → session payload (also emits `playback.fileLoaded`) |
| `playback.loadCompilation` | command | `{ dirPath? | sources[], name?, append?, trackId? }` → session payload |
| `playback.overview` | query | `{ filePath?, bucketMs? }` → timeline overview |
| `playback.toggle` | command | `{ loop?, playbackNetwork?, source }` play / pause / resume → `{ success }` |
| `playback.setLoop` | command | `{ loop }` → `{ success }` |
| `playback.stop` | command | `{ source? }` blackout then close → `{ success }` |
| `playback.seek` | command | `{ source, timeMs, playbackNetwork?, loop? }` → `{ success }` |
| `playback.unload` | command | `{}` → `{ success }` |
| `player.play` | command | `{ filePath, playbackNetwork?, loop? }` → `{ success, filePath, durationMs, displayName }` |
| `studio.inspectClip` | query | `{ clipId }` → `{ success, clip }` |
| `studio.audio.add` | command | `{ wavPath, name?, startMs? }` (already-converted 16-bit 44.1 kHz WAV) → `{ success, dirty }` |
| `studio.audioPath` | query | `{ mediaId }` → `{ filePath | null }` |
| `studio.edit` | command | `{ op, target?, clipId?, clipIds?, audioIds?, ..., keepPlayheadMs? }` → `{ success, dirty }` |
| `studio.undo` / `studio.redo` | command | `{}` → `{ success, dirty }` |
| `studio.save` | command | `{ name?, notes? }` → session payload |
| `studio.exportFlattened` | command | `{ name?, notes? }` → `{ success, filePath }` |
| `punchIn.start` | command | `{ trackId?, startMs?, playbackNetwork?, startMode, stopMode, startChannel?, stopChannel? }` → session payload or `{ success, armed: true }` |
| `punchIn.stop` | command | `{}` → session payload |
| `punchIn.cancel` | command | `{}` → `{ success }` |
| `playback.stats` | event | `{ currentFrame, totalFrames, clipTime, totalPlayTime, playheadMs, fps, isPlaying, isPaused, loop, source, isReset?, playerEnded? }` |
| `playback.fileLoaded` | event | session payload, `{ success:false, error }` or `{ success:true, filePath:null, cleared:true }` |
| `studio.compilationUpdated` | event | `{ clips, audioClips, audioMedia?, trackCount, trackNames, dirty, compilationSaveNeeded, name, projectPath, frameCount, durationMs, namingClipId? }` |
| `punchIn.progress` | event | `{ startMs, trackId, durationMs, trackCount, trackNames }` ≤ 10 Hz |
| `punchIn.started` / `punchIn.autoStopped` / `punchIn.failed` | event | session payload / `{ success:false, error }` |
| `library.updated` | event | `{ shows, compilations, tree, collapsed, libraryDir }` after the engine writes into the library |

The session payload is unchanged from today's `file-loaded` result: `{ success, kind, filePath, projectPath, displayName, frameCount, durationMs, clips, audioClips, audioMedia?, trackCount, trackNames, dirty, compilationSaveNeeded, skipped, ... }`.

## 7. Mapping of today's IPC channels

Direction: R→M = renderer to main (`invoke` unless marked `send`), M→R = main to renderer. "Companion" = stays in the Electron main process (dialog, shell, hardware, devices) and is not part of the engine API in this phase. "Later phase" = device discovery, push and show sync, which move after Phase J.

| IPC channel | dir | engine name | status |
|---|---|---|---|
| get-settings | R→M | — | companion (UI settings; same settings store) |
| set-theme | R→M | — | companion |
| set-ui-settings | R→M | — | companion |
| open-external-url | R→M | — | companion (shell) |
| live-release-all | R→M | `live.releaseAll` | engine |
| live-get | R→M | `live.get` | engine |
| live-save | R→M | `live.save` | engine |
| set-output-nic | R→M | `output.setNic` | engine |
| get-network-interfaces | R→M | `network.interfaces` | engine |
| device-* (27), devices-scan (send) | R→M | — | later phase (companion; `devices-scan` also sends `artnet.poll`) |
| library-list, -inspect, -save-meta, -import, -export, -rename, -delete, -choose-dir, -create-folder, -rename-folder, -delete-folder, -move, -set-collapsed, -save-compilation-meta, -duplicate | R→M | — | companion (file ops and dialogs over the engine's library store) |
| library-new-file | R→M | `record.setPath` after the file is created | companion + engine |
| cancel-recording | R→M | `record.cancel` | engine |
| start-recording / stop-recording (send) | R→M | `record.start` / `record.stop` | engine |
| load-recording | R→M | `playback.load` (companion shows the picker when no path) | engine |
| timeline-overview | R→M | `playback.overview` | engine |
| load-compilation | R→M | `playback.loadCompilation` | engine |
| inspect-clip | R→M | `studio.inspectClip` | engine |
| import-audio | R→M | `studio.audio.add` after the companion's picker + ffmpeg | companion + engine |
| edit-compilation | R→M | `studio.edit` | engine |
| undo-/redo-compilation | R→M | `studio.undo` / `studio.redo` | engine |
| confirm-unsaved-compilation | R→M | — | companion (message box only) |
| save-compilation | R→M | `studio.save` | engine |
| export-flattened | R→M | `studio.exportFlattened` | engine |
| start-/stop-/cancel-punch-in | R→M | `punchIn.start` / `punchIn.stop` / `punchIn.cancel` | engine |
| player-play | R→M | `player.play` | engine |
| flash-* (8) | R→M | — | companion (USB, esptool, sibling build) |
| cuebus-* (7) | R→M | — | later phase (companion) |
| set-ui-view (send) | R→M | subscribe / unsubscribe `monitor.snapshot`, `monitor.grid` | companion adapter |
| set-protocol (send) | R→M | `receive.setNic` (companion also restarts the cue bus) | engine |
| select-monitor-universe (send) | R→M | `monitor.select` | engine |
| update-selected-universes (send) | R→M | `receive.setUniverses` | engine |
| toggle-playback, set-playback-loop, stop-playback, seek-playback, unload-recording (send) | R→M | `playback.toggle`, `playback.setLoop`, `playback.stop`, `playback.seek`, `playback.unload` | engine |
| live-set (send) | R→M | `live.set` | engine |
| universes-snapshot | M→R | `monitor.snapshot` | engine event |
| dmx-data-update | M→R | `monitor.grid` (stream; adapter decodes to today's array) | engine stream |
| clear-universes | M→R | `monitor.cleared` | engine event |
| universe-removed | M→R | — | dead today; not carried forward |
| devices-update, device-push-progress, device-ota-progress | M→R | — | later phase (companion; devices built from `artnet.pollReply`) |
| file-loaded | M→R | `playback.fileLoaded` | engine event |
| compilation-updated | M→R | `studio.compilationUpdated` | engine event |
| playback-stats | M→R | `playback.stats` | engine event |
| recording-stats-update / recording-saved / recording-error | M→R | `record.stats` / `record.saved` / `record.error` | engine events |
| punch-in-progress / -started / -auto-stopped / -failed | M→R | `punchIn.progress` / `punchIn.started` / `punchIn.autoStopped` / `punchIn.failed` | engine events |
| library-updated | M→R | `library.updated` (engine writes) and companion `fs.watch` | both |
| cuebus-update | M→R | — | later phase |
| flash-progress / flash-log | M→R | — | companion |

The companion adapter (`src/main/engineHost.js`) keeps every channel name and payload shape above, so `src/preload.js` and the renderer are unchanged in Phase J.
