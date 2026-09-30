# Engine notes (ideas, not built)

Ideas noted during Phase J. None of these is in the plan; they stay here until agreed.

- Split `src/engine/playback.js` into transport (scheduler, senders, live merge), Studio session (EDL, undo/redo) and punch-in, once the regression test covers all three.
- Make `ownOutput` per engine instance instead of process-global so two engines can share a process (and the loopback test can run in one process).
- WebSocket transport for the envelope (same router, one binary frame type for the grid stream) for the kiosk UI; authenticated or loopback-only.
- Shows as immutable revisions with a revision chain (schema version in the sidecar, never in the `.dmx`).
- Drop `uiView.js` entirely once every UI-gated emit is a subscription.
- Playback could keep one sACN CID per engine (today each Play is a new source).
- Fix the double `stop` in `services/cuebus/cueBus.js` when show sync moves into the engine.
- Retire the dead `universe-removed` channel and the 18 unused handlers when the renderer is next touched.
