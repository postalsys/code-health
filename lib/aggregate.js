'use strict';

// Thresholds on the 0..100 MI scale Visual Studio uses: below 10 is "low",
// 10..19 "moderate", 20 and up "good"
const MI_LOW = 20;
// A function past this many paths is commonly treated as hard to test
const CC_HIGH = 10;
const CC_VERY_HIGH = 20;

const WORST_COUNT = 15;

function round(value, digits = 1) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function percentile(sorted, p) {
    if (!sorted.length) {
        return 0;
    }
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[index];
}

/**
 * Turns the per-file measurements of one snapshot into the numbers charted.
 * `<module>` units count toward size only: top-level code in these
 * repositories is mostly lookup tables, schemas and declarations, and scoring
 * a 2000-line MIME type table as one unreadable function would swamp the MI.
 *
 * @param {Array<{path: string, loc: number, sloc: number, functions: Array, errors: number}>} files
 */
function aggregate(files) {
    let loc = 0;
    let sloc = 0;
    let parseErrors = 0;
    let weightedMi = 0;
    let weight = 0;
    let lowMiSloc = 0;
    const cc = [];
    const all = [];

    for (const file of files) {
        loc += file.loc;
        sloc += file.sloc;
        parseErrors += file.errors;
        for (const fn of file.functions) {
            if (fn.name === '<module>') {
                continue;
            }
            weightedMi += fn.mi * fn.sloc;
            weight += fn.sloc;
            if (fn.mi < MI_LOW) {
                lowMiSloc += fn.sloc;
            }
            cc.push(fn.cc);
            all.push({ file: file.path, ...fn });
        }
    }

    cc.sort((a, b) => a - b);
    const ccTotal = cc.reduce((sum, value) => sum + value, 0);

    const worst = all
        .sort((a, b) => a.mi - b.mi || b.cc - a.cc)
        .slice(0, WORST_COUNT)
        .map(fn => ({ file: fn.file, line: fn.line, name: fn.name, mi: fn.mi, cc: fn.cc, sloc: fn.sloc }));

    return {
        summary: {
            files: files.length,
            loc,
            sloc,
            functions: cc.length,
            mi: weight ? round(weightedMi / weight) : 0,
            lowMiShare: weight ? round((lowMiSloc / weight) * 100) : 0,
            ccMean: cc.length ? round(ccTotal / cc.length, 2) : 0,
            ccP90: percentile(cc, 90),
            ccMax: cc.length ? cc[cc.length - 1] : 0,
            ccHigh: cc.filter(value => value > CC_HIGH).length,
            ccVeryHigh: cc.filter(value => value > CC_VERY_HIGH).length,
            parseErrors
        },
        worst
    };
}

module.exports = { aggregate, MI_LOW, CC_HIGH, CC_VERY_HIGH };
