# Engine notes (ideas, not built)

Ideas noted during Phases J and K. None of these is in the plan; they stay here until agreed.

## Out of scope for Phase K (named in the brief)

- Fixture / attribute model, programmer, cues, palettes, FX, pixel mapping, GPU rendering: nothing in core yet; `fixture.js`, `monitorOverlay.js`, `pushFit.js` stay in `src/services/shared` as companion and renderer code until a devices phase moves them.
- MIDI out of the renderer: the `midi` port interface exists (`src/engine/ports/midi.js`); `src/renderer/midiStore.js` keeps Web MIDI until a host implements the port.
- WebSocket transport: the router and envelope are transport-free; a WebSocket host would be another client factory like `createInProcessClient`, authenticated or loopback-only.
- Show signing, immutable show revisions with a revision chain (schema version in the sidecar, never in the `.dmx`).
- Workspace / monorepo restructure, the whip-spec repo, Yocto / OS work, iPad / Android shells, firmware changes.

## Follow-ups seen while extracting

- Split `src/engine/core/playback.js` into transport (scheduler, senders, live merge), Studio session (EDL, undo/redo) and punch-in, once the regression test covers all three.
- Move the file walkers (`walkRecording`, `sliceRecordingMulti`, `buildTimelineOverview` in `src/services/shared`) onto the storage port so the workers adapter is the only place that reads a `.dmx` with `fs`.
- Devices, push, OTA and show sync into core over the `udp` port plus an `http` port; `whipRejectReason` is already core and `discovery` already keeps the node table, so the companion's device loop can become a `discovery.setStrategies` call.
- `engine.capabilities.limits` is informational today; wire it to real limits when a host needs them.
- Drop `uiView.js` entirely once every UI-gated emit is a subscription.
- Playback could keep one sACN CID per engine (today each Play is a new source).
- Fix the double `stop` in `src/services/cuebus/cueBus.js` when show sync moves into the engine.
- Retire the dead `universe-removed` channel and the 18 unused handlers when the renderer is next touched.
- The API router (`src/engine/api/router.js`) still falls back to `Date.now` / `setTimeout` when a host passes no clock; make them required once every host passes ports.
- `src/services/sacn/utils.js` and `src/services/artnet/utils.js` are shims; delete them when nothing outside the engine requires them.
