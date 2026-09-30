const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// src/engine must never import Electron or reach the DOM, directly or through
// anything it requires. Walks every .js file under src/engine and the
// transitive graph of relative requires (services included).

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

test('the boundary check catches an electron require', () => {
    const code = stripCommentsAndStrings("const { app } = require('electron'); // require('fs')");
    assert.deepEqual(requireSpecs("const { app } = require('electron');"), ['electron']);
    assert.equal(FORBIDDEN_GLOBALS.test(code), false);
    assert.equal(FORBIDDEN_GLOBALS.test(stripCommentsAndStrings('window.dmx.send()')), true);
    assert.equal(FORBIDDEN_GLOBALS.test(stripCommentsAndStrings("const s = 'window.dmx';")), false);
});
