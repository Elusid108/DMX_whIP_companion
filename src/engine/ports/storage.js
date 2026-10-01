/**
 * Storage port: files, directories and path arithmetic. Paths are host
 * strings the core never interprets beyond these helpers. Synchronous calls
 * exist because the recorder flushes on the UDP path and the library store
 * reads small JSON files inline, as the companion always did.
 *
 * @typedef {Object} StoragePort
 * @property {(p: string) => Promise<Uint8Array>} readFile
 * @property {(p: string) => Promise<string>} readText
 * @property {(p: string) => Uint8Array} readFileSync
 * @property {(p: string) => string} readTextSync
 * @property {(p: string, data: Uint8Array | string) => void} writeFileSync
 * @property {(p: string) => any} openWriteSync Handle for writeSync/closeSync; truncates.
 * @property {(handle: any, bytes: Uint8Array, offset?: number, length?: number, position?: number|null) => number} writeSync
 * @property {(handle: any) => void} closeSync
 * @property {(p: string) => boolean} existsSync
 * @property {(p: string) => void} mkdirSync Recursive.
 * @property {(p: string) => { size: number, mtimeMs: number, birthtimeMs: number, ctimeMs: number, isDirectory: () => boolean }} statSync
 * @property {(p: string) => Array<{ name: string, isDirectory: () => boolean }>} readdirSync
 * @property {(from: string, to: string) => void} renameSync
 * @property {(p: string) => void} unlinkSync
 * @property {(from: string, to: string) => void} copyFileSync
 * @property {(p: string) => string} realpathSync Throws when the path does not exist.
 * @property {(p: string) => void} rmSync Recursive, force.
 * @property {(prefix: string, ext: string) => string} tempFile A fresh path in the host's temp dir.
 * @property {(...parts: string[]) => string} join
 * @property {(p: string) => string} dirname
 * @property {(p: string, ext?: string) => string} basename
 * @property {(p: string) => { dir: string, base: string, name: string, ext: string }} parse
 * @property {(...parts: string[]) => string} resolve
 * @property {(from: string, to: string) => string} relative
 * @property {(p: string) => boolean} isAbsolute
 */
const METHODS = [
    'readFile', 'readText', 'readFileSync', 'readTextSync', 'writeFileSync', 'openWriteSync', 'writeSync',
    'closeSync', 'existsSync', 'mkdirSync', 'statSync', 'readdirSync', 'renameSync', 'unlinkSync',
    'copyFileSync', 'realpathSync', 'rmSync', 'tempFile', 'join', 'dirname', 'basename', 'parse',
    'resolve', 'relative', 'isAbsolute'
];

const assertStorage = (storage) => {
    for (const name of METHODS) {
        if (!storage || typeof storage[name] !== 'function') {
            throw new Error(`ports.storage needs ${name}()`);
        }
    }
    return storage;
};

module.exports = { assertStorage, METHODS };
