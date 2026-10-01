# DMX whIP Companion — project rules

Electron + React + Tailwind companion app (Node main process, CommonJS, Apache-2.0) for DMX whIP nodes. A headless engine (`src/engine/`) is being extracted so the companion and the future console (Pi CM5, Yocto, Node 22) share one core.

These rules mirror `.cursor/rules/*.mdc` (semver, checklist workflow, firmware compat). **Keep the two in sync**: a change to one must be made in the other in the same commit. Topic-split copies live in `.claude/rules/`.

## Process

- The README implementation plan is the source of truth. Never add, remove, rename or reorder checklist items unless the user has agreed in that conversation (Phase J is agreed; nothing else is). Completed items are `[x]`, never deleted. Partial work stays unchecked and is described in the reply, not as new bullets.
- Next-section trigger: "Let's plan on the next section in the implementation plan" means plan only the first `###` section under Implementation plan that still has unchecked items, do not start coding until confirmed, and do not pull in later sections or Backlog.
- Follow semver in `package.json` (see Semantic versioning below). Update "Current state" in the README when behavior changes. `versionnotes.txt` is history only.
- One commit per checklist item. No drive-by refactors or formatting-only churn.
- If a step needs hardware or a decision, stop and write it down (`docs/engine/QUESTIONS.md`, `docs/engine/MANUAL_CHECKLIST.md`) instead of guessing.

## Semantic versioning (mirror of `.cursor/rules/semver.mdc`)

After any implementation change in a session, bump `package.json` `version` and the **Version:** line in `README.md`. Window title and UI read `package.json`; do not hardcode the version there.

`MAJOR.MINOR.PATCH`:
- **MAJOR**: breaking change (incompatible `.dmx` format, removed UI or protocol behavior)
- **MINOR**: new user-facing capability
- **PATCH**: bug fix, reliability, small internal cleanup, or README checkbox-only progress

One bump per session; a mixed session takes the highest level. Never skip a bump because the change is small. Checking README boxes with no other code still takes a PATCH.

## Firmware compatibility (mirror of `.cursor/rules/firmware-compat.mdc`)

Sibling firmware repo: `../DMX_whIP_embedded`. Contract owners, do not fork a second spec:
- HTTP, `/status`, 503/live/park: firmware README **Companion PC** block
- `DMXREC` `.dmx`: sibling `include/dmxrec.h` and `src/services/shared/dmxRecording.js`
- ArtPoll pairing: firmware `artnet_rx.cpp` and `whipRejectReason()` in `src/main/ipc/network.js`
- Board defaults / flash artifacts: `firmware/catalog.json` must match firmware `BoardProfile`

`/status` extra keys are additive; ignore unknowns; do not scrape portal HTML. `src/services/shared/firmwareCompat.js` `MIN_FIRMWARE_API` is the floor; a missing `api` is `0`. A breaking wire change bumps firmware `kFirmwareApi`, firmware MAJOR and this app in the same effort. When you change a locked surface, update the firmware consumer in the sibling repo or leave the change unmerged.

## Architecture

- Engine code lives in `src/engine/` and must never import `electron`, touch the DOM, or use renderer globals. `src/engine/boundary.test.js` enforces this (transitively) and runs in `npm test`.
- The engine is the source of truth for show and output state. UIs hold view state only.
- The engine API is message-shaped and async: commands (request/reply), queries, and events (subscribe, optional rate limit). One envelope format (`docs/engine/API.md`) works over Electron IPC now and a WebSocket later. `ENGINE_API_VERSION` in `src/engine/api/version.js` is carried by the handshake.
- High-rate data (DMX grids, later the visualizer canvas) uses a separate throttled binary stream, not per-frame JSON.
- Formats stay backward compatible: DMXREC `.dmx` files read by firmware must not change, and metadata stays in sidecars. Any new schema carries an explicit version number. Design intent for later, not built now: shows are immutable revisions with a revision chain.
- Engine code must run on Node 22 (Yocto Wrynose ships 22.22.2) and under Electron's bundled Node. `package.json` `engines` says so; avoid newer-only APIs, keep CommonJS, do not migrate to TypeScript.
- UI components must not call Electron-only APIs directly; route through the thin platform adapter (`src/renderer/ipc.js`) so the UI can later run in a plain browser or kiosk shell (Chromium or WebKit).
- Keep dependencies minimal and pinned by the lockfile. Any new dependency needs a stated reason and Apache-2.0-compatible licensing (an SBOM will be needed for EU CRA compliance).

## Performance

- Output and playback paths keep clock-based scheduling: no busy-waits, no per-frame allocations or JSON in hot loops, heavy scans in worker threads. Measure before optimizing.

## Security (EU CRA alignment)

- Treat imported files (USB, downloads, `.dmx`, `.comp`, future show packages) as untrusted: validate size and schema before parsing, never execute content.
- Add no network listener or HTTP endpoint without authentication or explicit loopback-only binding, and flag any in the PR.
- Never log or persist secrets (Wi-Fi passwords etc.) in plaintext beyond what already exists. Flag existing cases you find (today: `flashPassword` and `flashShowPass` in `settings.json`; Wi-Fi passwords sent to nodes over plain HTTP).
- Known gap, recorded not fixed: OTA images are checked by manifest sha256 (integrity), not signed (authenticity).

## Testing

- `npm test` passes before every commit. Tests run headless without Electron, with injectable clocks, on loopback with configurable ports. Timing assertions are loose; content and ordering are strict.
