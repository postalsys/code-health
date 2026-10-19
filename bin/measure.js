#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { measureFile } = require('../lib/metrics');
const { aggregate } = require('../lib/aggregate');
const { selectSources, looksMinified } = require('../lib/select');
const { syncMirror, listReleaseTags, headCommit, listTree, readBlobs } = require('../lib/git');

// Bump whenever a change to lib/ would alter a stored number: every snapshot
// measured under another version is measured again on the next run
const METRICS_VERSION = 1;

const ROOT = path.join(__dirname, '..');
const CACHE_DIR = path.join(ROOT, '.cache', 'repos');
const DATA_DIR = path.join(ROOT, 'site', 'data');

function parseArgs(argv) {
    const args = { only: null };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--repo') {
            args.only = argv[++i];
        }
    }
    return args;
}

function readJson(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
        if (err.code === 'ENOENT') {
            return fallback;
        }
        throw err;
    }
}

function writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 1) + '\n');
}

async function measureCommit(gitDir, commit, repo, blobCache) {
    const sources = selectSources(await listTree(gitDir, commit), repo);

    const missing = sources.filter(entry => !blobCache.has(entry.oid)).map(entry => entry.oid);
    if (missing.length) {
        const blobs = await readBlobs(gitDir, [...new Set(missing)]);
        for (const [oid, content] of blobs) {
            const source = content.toString('utf8');
            if (looksMinified(source)) {
                blobCache.set(oid, null);
                continue;
            }
            const sourcePath = sources.find(entry => entry.oid === oid).path;
            try {
                blobCache.set(oid, measureFile(source, sourcePath));
            } catch (err) {
                console.error(`  ${repo.name} ${sourcePath}: ${err.message}`);
                blobCache.set(oid, { loc: 0, sloc: 0, functions: [], errors: 1 });
            }
        }
    }

    const files = [];
    for (const entry of sources) {
        const result = blobCache.get(entry.oid);
        if (result) {
            files.push({ path: entry.path, ...result });
        }
    }
    return aggregate(files);
}

async function measureRepo(repo) {
    const gitDir = path.join(CACHE_DIR, repo.name + '.git');
    const dataFile = path.join(DATA_DIR, 'repos', repo.name + '.json');

    await syncMirror(repo.url, gitDir);

    const stored = readJson(dataFile, null);
    const current = stored && stored.metricsVersion === METRICS_VERSION ? stored : null;
    const known = new Map((current ? current.snapshots : []).map(snapshot => [snapshot.ref + '@' + snapshot.commit, snapshot]));

    const tags = await listReleaseTags(gitDir);
    const blobCache = new Map();
    const snapshots = [];
    let measured = 0;

    for (const tag of tags) {
        const existing = known.get(tag.ref + '@' + tag.commit);
        if (existing) {
            snapshots.push(existing);
            continue;
        }
        const { summary } = await measureCommit(gitDir, tag.commit, repo, blobCache);
        snapshots.push({ ref: tag.ref, commit: tag.commit, date: tag.date, ...summary });
        measured++;
    }
    snapshots.sort((a, b) => a.date.localeCompare(b.date) || a.ref.localeCompare(b.ref, 'en', { numeric: true }));

    const head = await headCommit(gitDir);
    let headSnapshot = current && current.head && current.head.commit === head.commit ? current.head : null;
    let worst = headSnapshot ? current.worst : null;
    if (!headSnapshot) {
        const result = await measureCommit(gitDir, head.commit, repo, blobCache);
        headSnapshot = { ...head, ...result.summary };
        worst = result.worst;
        measured++;
    }

    writeJson(dataFile, {
        name: repo.name,
        url: repo.url.replace(/\.git$/, ''),
        metricsVersion: METRICS_VERSION,
        snapshots,
        head: headSnapshot,
        worst
    });

    console.log(`${repo.name}: ${tags.length} releases, ${measured} measured now`);
    return { name: repo.name, url: repo.url.replace(/\.git$/, ''), releases: snapshots.length, head: headSnapshot };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const repos = readJson(path.join(ROOT, 'repos.json'));
    const indexFile = path.join(DATA_DIR, 'index.json');
    const index = new Map((readJson(indexFile, { repos: [] }).repos || []).map(entry => [entry.name, entry]));

    fs.mkdirSync(CACHE_DIR, { recursive: true });

    for (const repo of repos) {
        if (args.only && repo.name !== args.only) {
            continue;
        }
        index.set(repo.name, await measureRepo(repo));
    }

    // a repository dropped from repos.json leaves the site too
    const names = new Set(repos.map(repo => repo.name));
    writeJson(indexFile, {
        updated: new Date().toISOString(),
        repos: repos.filter(repo => index.has(repo.name)).map(repo => index.get(repo.name))
    });
    for (const file of fs.readdirSync(path.join(DATA_DIR, 'repos'))) {
        if (!names.has(path.basename(file, '.json'))) {
            fs.unlinkSync(path.join(DATA_DIR, 'repos', file));
        }
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
