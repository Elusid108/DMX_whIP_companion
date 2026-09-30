# src/engine

The headless DMX whIP engine: Art-Net/sACN receive and monitor state, Live output, DMXREC recording, clock-based playback with the live-output merge, the Studio session and the library store, behind the message-shaped API described in `docs/engine/API.md`.

Rules (enforced by `boundary.test.js` in `npm test`):

- No `require('electron')`, directly or through anything this directory requires.
- No DOM or renderer globals (`window`, `document`, `navigator`, `localStorage`).
- No requires into `src/main/` or `src/renderer/`. `src/services/**` is allowed (it is Electron-free).
- CommonJS, Node 22 and Electron's bundled Node; no newer-only APIs.

Hosts: the companion's Electron main process (`src/main/engineHost.js`) and the headless entry (`src/engine/headless.js`).
