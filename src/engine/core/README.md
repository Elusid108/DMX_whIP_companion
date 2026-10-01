# src/engine/core

Pure engine logic. Nothing in this directory may require anything outside
`src/engine/core` and `src/engine/ports`, name `Buffer`, `process`, `console`,
`Date.now`, `new Date()`, a timer global or a DOM global. Bytes are
`Uint8Array`; time comes from the `clock` port; deferred work goes through the
`scheduler` port; sockets, files, workers and randomness are ports too.
`src/engine/boundary.test.js` enforces this on every `npm test`.

Contents grow with the Phase K extraction; the shims under `src/services`
keep the old require paths (and the firmware-compat rule's paths) valid.
