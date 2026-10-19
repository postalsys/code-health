'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildPages } = require('../lib/pages');

function snapshot(ref, date, sloc, mi) {
    return {
        ref,
        commit: ref + '-commit',
        date,
        files: 1,
        loc: sloc,
        sloc,
        functions: 10,
        mi,
        lowMiShare: 0,
        ccMean: 2,
        ccP90: 4,
        ccMax: 9,
        ccHigh: 1,
        ccVeryHigh: 0,
        parseErrors: 0
    };
}

test('builds an overview and one page per repository', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-health-'));
    fs.mkdirSync(path.join(dir, 'repos'));
    fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ updated: '2026-10-19T00:00:00Z', repos: [] }));
    const head = { ...snapshot('HEAD', '2026-10-01T00:00:00Z', 1500, 40), commit: 'abcdef0123456789' };
    fs.writeFileSync(
        path.join(dir, 'repos', 'lib.json'),
        JSON.stringify({
            name: 'lib',
            url: 'https://github.com/example/lib',
            snapshots: [snapshot('v1.0.0', '2025-01-01T00:00:00Z', 1000, 45), snapshot('v2.0.0', '2026-06-01T00:00:00Z', 1200, 42)],
            head,
            worst: [{ file: 'lib/a.js', line: 3, name: 'big', mi: 1.5, cc: 30, sloc: 200 }]
        })
    );

    const pages = buildPages(dir, [{ name: 'lib', url: 'https://github.com/example/lib.git' }]);
    assert.deepStrictEqual(
        pages.map(page => page.path),
        ['', 'lib']
    );

    const row = pages[0].context.rows[0];
    // compared against the newest release at least a year older than the default branch
    assert.strictEqual(row.slocChange, '+50.0%');
    assert.deepStrictEqual(row.miChange, { label: '-5.0', variant: 'error' });

    const repo = pages[1].context;
    // the default branch is charted after the last release
    assert.strictEqual(JSON.parse(repo.chartJson).length, 3);
    assert.strictEqual(repo.worst[0].href, 'https://github.com/example/lib/blob/abcdef0123456789/lib/a.js#L3');
    assert.strictEqual(repo.releases[0].label, 'default branch');
});

test('chart JSON cannot close its script element', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-health-'));
    fs.mkdirSync(path.join(dir, 'repos'));
    fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ updated: '2026-10-19T00:00:00Z', repos: [] }));
    const tag = snapshot('</script><b>', '2026-01-01T00:00:00Z', 10, 50);
    fs.writeFileSync(
        path.join(dir, 'repos', 'x.json'),
        JSON.stringify({ name: 'x', url: 'https://github.com/example/x', snapshots: [tag], head: tag, worst: [] })
    );
    const [, page] = buildPages(dir, [{ name: 'x', url: 'https://github.com/example/x.git' }]);
    assert.ok(!page.context.chartJson.includes('</script>'));
});
