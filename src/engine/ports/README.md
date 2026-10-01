# Engine ports

The engine core (`src/engine/core`) never touches the outside world. Everything
it needs arrives through the port interfaces documented in this directory and
supplied by a host from an adapter set (`src/adapters/node` today, a browser or
native shell later). Each file here is the interface: a JSDoc typedef plus a
small `assert*` validator the engine runs once at start so a missing method
fails loudly instead of at 2 a.m. during a show.

| Port | Gives core | Node adapter |
|---|---|---|
| `clock` | `now()` ms epoch, `monotonicNs()` BigInt | `Date.now`, `process.hrtime.bigint` |
| `scheduler` | `setTimeout/clearTimeout`, `setInterval/clearInterval`, `setImmediate/clearImmediate` | timers |
| `udp` | `open(options)` → socket (`send`, `onMessage`, `addMembership`, `dropMembership`, `setMulticastInterface`, `close`, `port`), `interfaces()`, `localIps()` | `dgram`, `os.networkInterfaces` |
| `storage` | files, directories, paths, temp names (sync and async) | `fs`, `path`, `os.tmpdir` |
| `workers` | `run(op, args)` for whole-file scans, `stop()` | `worker_threads` with inline fallback |
| `random` | `bytes(n)`, `uuid()` | `crypto` |
| `log` | `info`, `warn`, `error` | `console` |
| `discovery` | strategy interface (ArtPoll broadcast, unicast poll, manual IP, known nodes); the merge rule is core | strategies are core code over `udp`, so no adapter |
| `midi` | interface only (no implementation yet; Web MIDI stays in the renderer) | none |

Rules: core requires only files under `src/engine/core` and `src/engine/ports`;
it never names `Buffer`, `process`, `console`, `Date.now`, `new Date()`, a
timer global or a DOM global (`src/engine/boundary.test.js`). Adapters may use
Node built-ins but never `electron`.
