const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Three walls, checked on every npm test:
//   1. src/engine must never import Electron or reach the DOM, directly or
//      through anything it requires (transitive relative requires included).
//   2. src/engine/core and src/engine/ports require only files inside those
//      two directories (no Node built-ins, no npm packages, no electron) and
//      never name Buffer, process, console, Date.now, new Date(), a timer
//      global or a DOM global. All I/O goes through the ports.
//   3. src/adapters may use Node built-ins but never electron, and never
//      reach into src/main or src/renderer.

const ENGINE_DIR = path.join(__dirname);
const SRC_DIR = path.resolve(__dirname, '..');

const stripCommentsAndStrings = (source) => source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');

const requireSpecs = (source) => {
    const out = [];
    const re = /require\(\s*(['"])([^'"]+)\1\s*\)/g;
    let m;
    while ((m = re.exec(source))) {
        out.push(m[2]);
    }
    return out;
};

const listJs = (dir) => {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...listJs(full));
        } else if (entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) {
            out.push(full);
        }
    }
    return out;
};

const resolveRelative = (from, spec) => {
    const base = path.resolve(path.dirname(from), spec);
    for (const candidate of [base, `${base}.js`, path.join(base, 'index.js')]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return candidate;
        }
    }
    return null;
};

const FORBIDDEN_GLOBALS = /\b(window|document|navigator|localStorage|sessionStorage)\s*[.\[]/;

const CORE_DIRS = [path.join(ENGINE_DIR, 'core'), path.join(ENGINE_DIR, 'ports')];
const ADAPTERS_DIR = path.join(SRC_DIR, 'adapters');
// What core may not name: bytes, the process, the console, the wall clock,
// timers and the DOM. (Timer *methods* on a scheduler port are fine, so the
// pattern needs the bare global, not `.setTimeout`.)
const CORE_FORBIDDEN = [
    [/(^|[^.\w])Buffer\s*[.(\[]/, 'uses Buffer'],
    [/(^|[^.\w])process\s*[.\[]/, 'uses process'],
    [/(^|[^.\w])console\s*[.\[]/, 'uses console'],
    [/(^|[^.\w])Date\.now\s*\(/, 'calls Date.now'],
    [/(^|[^.\w])new\s+Date\s*\(\s*\)/, 'reads the wall clock with new Date()'],
    [/(^|[^.\w])(setTimeout|setInterval|setImmediate|clearTimeout|clearInterval|clearImmediate|queueMicrotask)\s*\(/, 'uses a timer global'],
    [/(^|[^.\w])(__dirname|__filename)\b/, 'uses a module path global'],
    [FORBIDDEN_GLOBALS, 'uses a renderer global']
];

const isInside = (file, dirs) => dirs.some((dir) => file === dir || file.startsWith(dir + path.sep));

test('src/engine and everything it requires is free of Electron and the DOM', () => {
    const queue = listJs(ENGINE_DIR);
    const seen = new Set();
    const problems = [];
    while (queue.length) {
        const file = queue.pop();
        if (seen.has(file)) {
            continue;
        }
        seen.add(file);
        const source = fs.readFileSync(file, 'utf8');
        const code = stripCommentsAndStrings(source);
        const rel = path.relative(SRC_DIR, file);
        if (FORBIDDEN_GLOBALS.test(code)) {
            problems.push(`${rel}: uses a renderer global`);
        }
        for (const spec of requireSpecs(source)) {
            if (spec === 'electron' || spec.startsWith('electron/')) {
                problems.push(`${rel}: requires ${spec}`);
                continue;
            }
            if (!spec.startsWith('.')) {
                continue;
            }
            const target = resolveRelative(file, spec);
            if (!target) {
                problems.push(`${rel}: cannot resolve ${spec}`);
                continue;
            }
            const targetRel = path.relative(SRC_DIR, target);
            if (targetRel.startsWith('main' + path.sep) || targetRel.startsWith('renderer' + path.sep)) {
                problems.push(`${rel}: requires ${targetRel} (outside the engine)`);
                continue;
            }
            queue.push(target);
        }
    }
    assert.ok(seen.size > 0, 'no engine files found');
    assert.deepEqual(problems, []);
});

test('src/engine/core and src/engine/ports are pure: only each other, no built-ins, no clock or timers', () => {
    const files = CORE_DIRS.flatMap((dir) => (fs.existsSync(dir) ? listJs(dir) : []));
    assert.ok(files.length > 0, 'no core files found');
    const problems = [];
    for (const file of files) {
        const source = fs.readFileSync(file, 'utf8');
        const code = stripCommentsAndStrings(source);
        const rel = path.relative(SRC_DIR, file);
        for (const [re, why] of CORE_FORBIDDEN) {
            if (re.test(code)) {
                problems.push(`${rel}: ${why}`);
            }
        }
        for (const spec of requireSpecs(source)) {
            if (!spec.startsWith('.')) {
                problems.push(`${rel}: requires ${spec} (core takes no built-ins or packages)`);
                continue;
            }
            const target = resolveRelative(file, spec);
            if (!target) {
                problems.push(`${rel}: cannot resolve ${spec}`);
            } else if (!isInside(target, CORE_DIRS)) {
                problems.push(`${rel}: requires ${path.relative(SRC_DIR, target)} (outside core/ports)`);
            }
        }
    }
    assert.deepEqual(problems, []);
});

test('src/adapters never import electron or reach into main or renderer', () => {
    if (!fs.existsSync(ADAPTERS_DIR)) {
        return;
    }
    const problems = [];
    for (const file of listJs(ADAPTERS_DIR)) {
        const source = fs.readFileSync(file, 'utf8');
        const rel = path.relative(SRC_DIR, file);
        if (FORBIDDEN_GLOBALS.test(stripCommentsAndStrings(source))) {
            problems.push(`${rel}: uses a renderer global`);
        }
        for (const spec of requireSpecs(source)) {
            if (spec === 'electron' || spec.startsWith('electron/')) {
                problems.push(`${rel}: requires ${spec}`);
            } else if (spec.startsWith('.')) {
                const target = resolveRelative(file, spec);
                const targetRel = target ? path.relative(SRC_DIR, target) : spec;
                if (!target || targetRel.startsWith('main' + path.sep) || targetRel.startsWith('renderer' + path.sep)) {
                    problems.push(`${rel}: requires ${targetRel}`);
                }
            }
        }
    }
    assert.deepEqual(problems, []);
});

test('the core check catches what it should and allows port methods', () => {
    const hit = (code) => CORE_FORBIDDEN.filter(([re]) => re.test(stripCommentsAndStrings(code))).map(([, why]) => why);
    assert.deepEqual(hit('const b = Buffer.alloc(4);'), ['uses Buffer']);
    assert.deepEqual(hit('const t = Date.now();'), ['calls Date.now']);
    assert.deepEqual(hit('const d = new Date();'), ['reads the wall clock with new Date()']);
    assert.deepEqual(hit('const d = new Date(clock.now());'), []);
    assert.deepEqual(hit('setTimeout(fn, 1);'), ['uses a timer global']);
    assert.deepEqual(hit('scheduler.setTimeout(fn, 1); ports.clock.now();'), []);
    assert.deepEqual(hit('process.hrtime.bigint()'), ['uses process']);
    assert.deepEqual(hit("const s = 'Buffer.alloc'; // process.exit()"), []);
    assert.deepEqual(hit('new Uint8Array(4); new TextEncoder();'), []);
});

test('the boundary check catches an electron require', () => {
    const code = stripCommentsAndStrings("const { app } = require('electron'); // require('fs')");
    assert.deepEqual(requireSpecs("const { app } = require('electron');"), ['electron']);
    assert.equal(FORBIDDEN_GLOBALS.test(code), false);
    assert.equal(FORBIDDEN_GLOBALS.test(stripCommentsAndStrings('window.dmx.send()')), true);
    assert.equal(FORBIDDEN_GLOBALS.test(stripCommentsAndStrings("const s = 'window.dmx';")), false);
});
