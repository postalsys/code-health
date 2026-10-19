'use strict';

const SOURCE_EXTENSION = /\.(?:[cm]?js|[cm]?ts|jsx|tsx)$/;

// Directories that hold library source in the repositories measured; a
// repository moving from lib/ to src/ (the TypeScript migrations) stays
// covered without a per-version rule
const DEFAULT_ROOTS = ['lib', 'src', 'workers', 'bin'];

// Never source, wherever they appear
const EXCLUDED_DIRS = new Set([
    'node_modules',
    'test',
    'tests',
    '__tests__',
    'fixtures',
    'examples',
    'example',
    'dist',
    'build',
    'coverage',
    'vendor',
    'static',
    'public',
    'bench',
    'benchmark',
    'docs'
]);

const EXCLUDED_FILES = [/\.d\.[cm]?ts$/, /\.min\.js$/, /\.(?:test|spec)\.[cm]?[jt]sx?$/, /(?:^|[.-])config\.[cm]?[jt]s$/, /^\.|^Gruntfile|^gulpfile/i];

// Generated or minified files would dominate every number they touch
const MAX_FILE_SIZE = 512 * 1024;
const MAX_AVERAGE_LINE_LENGTH = 250;

/**
 * Picks the source files to measure from a commit's tree.
 *
 * @param {Array<{path: string, size: number}>} entries
 * @param {{include?: string[], exclude?: string[]}} config per-repository overrides from repos.json
 */
function selectSources(entries, config = {}) {
    const include = config.include || DEFAULT_ROOTS;
    const exclude = (config.exclude || []).map(pattern => new RegExp(pattern));

    return entries.filter(entry => {
        const path = entry.path;
        if (!SOURCE_EXTENSION.test(path) || entry.size > MAX_FILE_SIZE) {
            return false;
        }
        const parts = path.split('/');
        const name = parts[parts.length - 1];

        if (parts.length === 1) {
            // top-level files count only when named, or by default when not tooling
            if (config.include ? !include.includes(path) : EXCLUDED_FILES.some(pattern => pattern.test(name))) {
                return false;
            }
        } else if (!include.some(root => path === root || path.startsWith(root + '/'))) {
            return false;
        }

        if (parts.slice(0, -1).some(dir => EXCLUDED_DIRS.has(dir))) {
            return false;
        }
        if (EXCLUDED_FILES.some(pattern => pattern.test(name))) {
            return false;
        }
        return !exclude.some(pattern => pattern.test(path));
    });
}

function looksMinified(source) {
    const lines = source.split('\n').length;
    return source.length / lines > MAX_AVERAGE_LINE_LENGTH;
}

module.exports = { selectSources, looksMinified };
