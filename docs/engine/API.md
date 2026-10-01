# Engine API (version 1)

The engine (`src/engine/`) is a headless Node package. Every UI, the companion's Electron renderer today and the console kiosk later, talks to it through one message-shaped, asynchronous API: **commands** (request/reply, change state), **queries** (request/reply, read state) and **events** (engine → client, subscription based). The same envelope works over Electron IPC now (through the in-process adapter in the main process) and over a WebSocket later. High-rate data uses a separate binary stream.

`ENGINE_API_VERSION` lives in `src/engine/api/version.js` and is `1`. Sections 8 to 10 (capabilities, lifecycle, discovery) are additive designs for the core/ports extraction (Phase K) and do not bump the version; the handshake already carries `capabilities`, and the new names are registered as they are built.

Inside the engine the API router is the only thing a host talks to. The router calls **core** (`src/engine/core`, pure logic) which reaches the outside world only through **ports** (`src/engine/ports`: clock, scheduler, udp, storage, workers, discovery, midi, log) implemented by **adapters** (`src/adapters/node` today). A host assembles engine = core + adapters and gets a client; the envelope below is the same whatever the adapters are.

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
- `capabilities` in the hello reply is the short feature list; the full, structured answer is the `engine.capabilities` query (§8).

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
| `engine.capabilities` | query | `{}` → capabilities object (§8) |
| `engine.suspend` | command | `{ reason? }` → `{ success, suspended: true }` (§9) |
| `engine.resume` | command | `{}` → `{ success, restored: { receive, live, playback } }` (§9) |
| `engine.state` | query | `{}` → `{ lifecycle: "running" \| "suspended", since }` |
| `engine.lifecycle` | event | `{ lifecycle, reason? }` on every transition |
| `discovery.setStrategies` | command | `{ strategies: [...] }` (§10) → `{ success }` |
| `discovery.state` | query | `{}` → `{ strategies, nodes: Node[] }` |
| `discovery.nodes` | event | `{ nodes: Node[] }` debounced 150 ms |

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

The companion adapter (`src/main/engineHost.js`, tables in `src/main/engineChannels.js`) keeps every channel name and payload shape above, so `src/preload.js` and the renderer are unchanged in Phase J. `src/main/engineChannels.test.js` reconciles the tables with the preload allow-lists on every `npm test`.

Additional queries built for hosts and tests: `playback.state` (source, transport flags, playhead, frame count, duration, network, session summary) and `record.state` (recording, filePath, elapsedMs, totalFrames). The `record.stats` event carries `forced: true` on the start/stop emits so a host can forward those even while Studio is hidden.

## 8. Capabilities

`engine.capabilities` tells a UI what this host can do, so one UI bundle can hide what is not there (no Flash tab on the console, no ffmpeg on a kiosk, no file dialogs on a tablet). The answer is a plain object; every key is optional and a missing key means "no". Hosts fill it from the adapters they wired; core never guesses.

```json
{
  "apiVersion": 1,
  "appVersion": "0.61.0",
  "host": { "kind": "companion" | "console" | "headless" | "test", "platform": "win32" | "darwin" | "linux", "node": "22.22.2" },
  "features": ["monitor", "live", "playback", "record", "library", "stream"],
  "io": {
    "udp": { "artnet": true, "sacn": true, "broadcast": true, "multicast": true },
    "storage": { "library": true, "watch": false, "tmp": true },
    "workers": true,
    "midi": false,
    "dialogs": false,
    "ffmpeg": false,
    "serial": false,
    "cuebus": false
  },
  "discovery": ["artpollBroadcast", "unicastPoll", "manual", "knownNodes"],
  "limits": { "maxUniverses": 64, "gridStreamHz": 20, "snapshotHz": 5 }
}
```

- `features` is the same list the hello reply carries.
- `io` mirrors the ports the host wired: a key is `true` only when an adapter exists and reports ready. `dialogs`, `ffmpeg`, `serial` and `cuebus` are companion-side today and appear as `false` from the headless host; they are listed so a UI never has to probe.
- `discovery` lists the strategies the `discovery` port supports on this host (§10).
- `limits` are informational; the engine still enforces its own.

The query is answered from state the host set at `createEngine({ capabilities })`, merged with what the ports report. It is cheap and may be called at any time.

## 9. Lifecycle

Hosts need to park the engine without losing show state: a tablet going to the background, a console switching user, a Wi-Fi interface disappearing, a companion window hidden for a long time. Two commands and one event:

| name | behavior |
|---|---|
| `engine.suspend` | Stops every timer and closes every socket (receivers, Live, playback senders, discovery) and flushes any open recording to disk (a recording in progress is stopped and saved, not lost, and `record.saved` is emitted). Playback is paused at its current position (the hold frame is not sent). Monitor state is frozen, not cleared; universes will be marked stale on resume if nothing arrives. Subscriptions are kept. Settings and the library index are already on disk. Replies `{ success, suspended: true }` and emits `engine.lifecycle { lifecycle: "suspended", reason }`. Idempotent. |
| `engine.resume` | Rebinds the receivers on the saved NIC, reopens Live output (same CID, levels restored, nothing is sent until a level changes or the keep-alive tick fires), restores playback senders and leaves playback paused at the saved position (the UI decides whether to resume), restarts discovery with the saved strategies, and resumes the monitor tick if anyone is subscribed. Replies `{ success, restored: { receive: bool, live: bool, playback: bool } }`; a port that fails to come back (NIC gone) is `false` with an `unavailable` error in `result.errors[]`, and the rest still restores. Emits `engine.lifecycle { lifecycle: "running" }`. Idempotent. |
| `engine.state` | `{ lifecycle, since }`. |

Rules: while suspended every command that would touch I/O (`receive.setNic`, `live.set`, `playback.toggle`, `record.start`, `artnet.poll`, `discovery.*`) returns `conflict` with `data.lifecycle: "suspended"`; queries keep answering from frozen state. `engine.close()` (the host API, not a message) suspends first, then drops subscriptions. Suspend and resume are implemented in Phase K only to the depth the headless host needs (receivers, Live, playback senders); the companion keeps closing the engine on quit.

## 10. Discovery strategies

Node discovery must never depend on broadcast reaching the nodes (Wi-Fi client isolation, routed show networks, the console's second interface). The `discovery` port runs a list of strategies and merges their results into one node table keyed by MAC (falling back to IP):

| strategy | config | what it does |
|---|---|---|
| `artpollBroadcast` | `{ nic, intervalMs: 2500 }` | today's behavior: ArtPoll to the broadcast address on the NIC, parse ArtPollReply, pairing rule from `src/main/ipc/network.js` `whipRejectReason()` |
| `unicastPoll` | `{ ips: [...], intervalMs }` | the same ArtPoll sent unicast to each IP (ArtPollReply comes back unicast too) |
| `manual` | `{ ip }` | one node by IP with no ArtPoll at all; identity comes from `/status` (companion side today) or stays `unknown` |
| `knownNodes` | `{ nodes: [{ mac, ip, name }] }` | a persisted list (settings key `knownNodes`, additive, `version: 1`) polled by unicast and kept even while silent, marked stale instead of dropped |

`discovery.setStrategies { strategies: [{ kind, ...config }] }` replaces the active set; `discovery.state` returns it with the merged `Node[]` (`{ id, mac, ip, name, longName, universes, bindIndex, api?, stale, lastSeen, sources: ["artpollBroadcast", ...] }`); `discovery.nodes` is the debounced event. ArtPollReply parsing stays pure core; sending and receiving use the `udp` port. The HTTP side of a node (`/status`) is **not** part of discovery in this phase; the companion keeps doing it. Phase K designs the port and ships `artpollBroadcast` as the only strategy wired (it is what `artnet.poll` does today); the other three are interfaces plus tests on the merge rule, not live code.

