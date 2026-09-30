# Engine rules

- `src/engine/` never imports `electron`, touches the DOM, or uses renderer globals; `src/engine/boundary.test.js` (in `npm test`) checks the transitive require graph.
- The engine owns show and output state; UIs hold view state only.
- API is message-shaped and async (commands, queries, events with optional rate limit), one envelope for Electron IPC now and WebSocket later; `ENGINE_API_VERSION` travels in the handshake. See `docs/engine/API.md`.
- High-rate data (DMX grids) goes over the throttled binary stream, never per-frame JSON.
- Formats stay backward compatible: `.dmx` unchanged, metadata in sidecars, every new schema versioned.
- Node 22 and Electron's Node; CommonJS; no TypeScript; minimal pinned dependencies with a stated reason and Apache-2.0-compatible licence.
- Output and playback paths: clock-based, no busy-waits, no per-frame allocations or JSON in hot loops, heavy scans in worker threads.
- Security: imported files are untrusted (validate size and schema first); no unauthenticated or non-loopback network listener; no plaintext secrets beyond what exists; OTA images are sha256-checked, not signed (known gap).
- Tests are headless, with injectable clocks and configurable loopback ports; loose timing, strict content and order.
