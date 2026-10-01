# src/engine

The headless DMX whIP engine: Art-Net/sACN receive and monitor state, Live output, DMXREC recording, clock-based playback with the live-output merge, the Studio session, the library store, settings, discovery and lifecycle, behind the message-shaped API described in `docs/engine/API.md`.

Layout:

- `core/`: pure logic. Requires only `core` and `ports`; `Uint8Array` not `Buffer`; the clock, scheduler, sockets, files, workers and randomness are ports. No Electron, DOM, Node built-ins, timers or wall clock (`boundary.test.js`).
- `ports/`: the interfaces core calls (clock, scheduler, udp, storage, workers, random, log, discovery, midi) with validators.
- `api/`: envelope, router (commands, queries, events, subscriptions with rate limits, the lifecycle guard) and the in-process client.
- `index.js`: `createEngine({ settings, appVersion, ports, udpPorts, hostIo })` assembles core over a port set (default: `src/adapters/node`).
- `headless.js`: starts the engine with no window; `settingsStore.js` is the settings store on the Node storage adapter.

Hosts: the companion's Electron main process (`src/main/engineHost.js`) and the headless entry. Adapters for other hosts (browser, native shell) go in `src/adapters/<host>`.
