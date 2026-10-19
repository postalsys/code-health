'use strict';

// Turns the stored measurements into the view contexts the templates render

const fs = require('node:fs');
const path = require('node:path');

const YEAR_MS = 365 * 24 * 3600 * 1000;

function formatInt(value) {
    return Math.round(value).toLocaleString('en-US');
}

function formatDate(iso) {
    return new Date(iso).toISOString().slice(0, 10);
}

// Releases plus the default branch, when it has moved past the last release
function points(data) {
    const list = data.snapshots.map(snapshot => ({ ...snapshot, label: snapshot.ref }));
    const last = list[list.length - 1];
    if (data.head && (!last || data.head.commit !== last.commit)) {
        list.push({ ...data.head, label: 'default branch' });
    }
    return list;
}

// The newest release at least a year older than the default branch
function yearAgo(data) {
    const cutoff = Date.parse(data.head.date) - YEAR_MS;
    let match = null;
    for (const snapshot of data.snapshots) {
        if (Date.parse(snapshot.date) <= cutoff) {
            match = snapshot;
        }
    }
    return match;
}

function signed(value, digits, suffix = '') {
    return (value > 0 ? '+' : '') + value.toFixed(digits) + suffix;
}

function slocChange(now, before) {
    return before ? signed(((now.sloc - before.sloc) / Math.max(before.sloc, 1)) * 100, 1, '%') : null;
}

// MI moving by less than half a point is noise, not a trend worth a color
function miChange(now, before) {
    if (!before) {
        return null;
    }
    const change = now.mi - before.mi;
    return { label: signed(change, 1), variant: Math.abs(change) < 0.5 ? 'neutral' : change > 0 ? 'success' : 'error' };
}

// JSON inside a <script> element must not be able to close it
function scriptJson(value) {
    return JSON.stringify(value).replace(/</g, '\\u003c');
}

function buildPages(dataDir, repos) {
    const index = JSON.parse(fs.readFileSync(path.join(dataDir, 'index.json'), 'utf8'));
    const all = repos.map(repo => ({
        repo,
        data: JSON.parse(fs.readFileSync(path.join(dataDir, 'repos', repo.name + '.json'), 'utf8'))
    }));

    const menu = active => ({
        menuOverview: active === null,
        menuApps: all
            .filter(entry => entry.repo.kind === 'app')
            .map(entry => ({ name: entry.repo.name, href: `/${entry.repo.name}/`, active: entry.repo.name === active })),
        menuLibraries: all
            .filter(entry => entry.repo.kind !== 'app')
            .map(entry => ({ name: entry.repo.name, href: `/${entry.repo.name}/`, active: entry.repo.name === active }))
    });

    const common = { updated: new Date(index.updated).toUTCString(), sourceUrl: 'https://github.com/postalsys/code-health' };

    const rows = all.map(({ repo, data }) => {
        const head = data.head;
        const before = yearAgo(data);
        return {
            name: repo.name,
            href: `/${repo.name}/`,
            sloc: formatInt(head.sloc),
            slocChange: slocChange(head, before),
            functions: formatInt(head.functions),
            mi: head.mi.toFixed(1),
            miChange: miChange(head, before),
            ccMean: head.ccMean.toFixed(2),
            ccVeryHigh: formatInt(head.ccVeryHigh)
        };
    });

    const sum = key => all.reduce((total, { data }) => total + data.head[key], 0);

    const pages = [
        {
            view: 'index',
            path: '',
            context: {
                ...common,
                ...menu(null),
                pageTitle: 'Code health',
                totals: {
                    repositories: formatInt(all.length),
                    sloc: formatInt(sum('sloc')),
                    releases: formatInt(all.reduce((total, { data }) => total + data.snapshots.length, 0)),
                    ccVeryHigh: formatInt(sum('ccVeryHigh'))
                },
                rows
            }
        }
    ];

    for (const { repo, data } of all) {
        const head = data.head;
        const before = yearAgo(data);
        const list = points(data);
        pages.push({
            view: 'repo',
            path: repo.name,
            context: {
                ...common,
                ...menu(repo.name),
                pageTitle: `${repo.name} - Code health`,
                name: repo.name,
                url: data.url,
                releaseCount: formatInt(data.snapshots.length),
                head: {
                    commit: head.commit,
                    shortCommit: head.commit.slice(0, 8),
                    date: formatDate(head.date),
                    files: formatInt(head.files)
                },
                stats: {
                    sloc: formatInt(head.sloc),
                    slocChange: slocChange(head, before),
                    mi: head.mi.toFixed(1),
                    miChange: miChange(head, before),
                    ccMean: head.ccMean.toFixed(2),
                    ccVeryHigh: formatInt(head.ccVeryHigh),
                    functions: formatInt(head.functions)
                },
                worst: (data.worst || []).map(fn => ({
                    name: fn.name,
                    location: `${fn.file}:${fn.line}`,
                    href: `${data.url}/blob/${head.commit}/${fn.file}#L${fn.line}`,
                    mi: fn.mi.toFixed(1),
                    cc: String(fn.cc),
                    sloc: formatInt(fn.sloc)
                })),
                releases: list
                    .slice()
                    .reverse()
                    .map(point => ({
                        label: point.label,
                        date: formatDate(point.date),
                        files: formatInt(point.files),
                        sloc: formatInt(point.sloc),
                        functions: formatInt(point.functions),
                        mi: point.mi.toFixed(1),
                        ccMean: point.ccMean.toFixed(2),
                        ccP90: String(point.ccP90),
                        ccMax: String(point.ccMax),
                        ccHigh: formatInt(point.ccHigh),
                        ccVeryHigh: formatInt(point.ccVeryHigh)
                    })),
                chartJson: scriptJson(
                    list.map(point => ({
                        label: point.label,
                        date: point.date,
                        sloc: point.sloc,
                        mi: point.mi,
                        ccMean: point.ccMean,
                        ccP90: point.ccP90,
                        ccHighShare: point.functions ? (point.ccHigh / point.functions) * 100 : 0,
                        lowMiShare: point.lowMiShare
                    }))
                )
            }
        });
    }

    return pages;
}

module.exports = { buildPages };
