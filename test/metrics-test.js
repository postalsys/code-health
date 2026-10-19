'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { measureFile, maintainabilityIndex } = require('../lib/metrics');
const { aggregate } = require('../lib/aggregate');
const { selectSources } = require('../lib/select');

test('counts one path per branch, per function', () => {
    const source = `
// a comment line
function outer(a, b = 1) {
    if (a && b) {
        return a ?? b;
    }
    const inner = x => (x ? 1 : 2);
    return inner(a);
}
`;
    const result = measureFile(source, 'file.js');
    const outer = result.functions.find(fn => fn.name === 'outer');
    const inner = result.functions.find(fn => fn.name === 'inner');
    // 1 + default param + if + && + ??
    assert.strictEqual(outer.cc, 5);
    // 1 + ternary; the nested arrow's branch is not the outer function's
    assert.strictEqual(inner.cc, 2);
    assert.strictEqual(outer.line, 3);
    assert.strictEqual(result.loc, 8);
    // the comment line does not count as source
    assert.strictEqual(result.sloc, 7);
});

test('parses TypeScript and names methods', () => {
    const source = `
export class Client {
    private count: number = 0;
    async connect(host: string): Promise<void> {
        for (const item of [host]) {
            this.count++;
        }
    }
}
`;
    const result = measureFile(source, 'client.ts');
    assert.strictEqual(result.errors, 0);
    const connect = result.functions.find(fn => fn.name === 'connect');
    assert.strictEqual(connect.cc, 2);
});

test('maintainability index falls with size and complexity', () => {
    assert.ok(maintainabilityIndex(100, 1, 5) > maintainabilityIndex(5000, 20, 200));
    assert.strictEqual(maintainabilityIndex(1e9, 500, 5000), 0);
});

test('module-level code counts toward size, not toward MI', () => {
    const table = 'const TABLE = {\n' + Array.from({ length: 500 }, (_, i) => `    key${i}: ${i},`).join('\n') + '\n};\n';
    const source = table + 'function lookup(key) {\n    return TABLE[key];\n}\n';
    const { summary } = aggregate([{ path: 'lib/table.js', ...measureFile(source, 'table.js') }]);
    assert.strictEqual(summary.functions, 1);
    assert.ok(summary.sloc > 500);
    assert.strictEqual(summary.lowMiShare, 0);
    assert.ok(summary.mi > 50);
});

test('selects library source only', () => {
    const entries = [
        'lib/a.js',
        'src/b.ts',
        'src/types.d.ts',
        'lib/test/c.js',
        'test/d.js',
        'index.js',
        'eslint.config.js',
        'examples/e.js',
        'scan.js',
        'lib/f.json'
    ].map(path => ({ path, size: 100 }));
    assert.deepStrictEqual(
        selectSources(entries).map(entry => entry.path),
        ['lib/a.js', 'src/b.ts', 'index.js', 'scan.js']
    );
    assert.deepStrictEqual(
        selectSources(entries, { include: ['lib', 'index.js'] }).map(entry => entry.path),
        ['lib/a.js', 'index.js']
    );
});
