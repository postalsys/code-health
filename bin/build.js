#!/usr/bin/env node
'use strict';

// Renders the measurements into the static site under dist/ with
// EmailEngine's own admin UI: its ui/* partials, Handlebars helpers, Tailwind
// entry (brand themes, FlyonUI components), scripts, fonts and logo are read
// from the emailengine mirror at its default branch, so the page tracks
// whatever the admin UI looks like today instead of a copy of it.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const Handlebars = require('handlebars');
const { syncMirror } = require('../lib/git');
const { buildPages } = require('../lib/pages');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const DATA_DIR = path.join(ROOT, 'data');
const EE_MIRROR = path.join(ROOT, '.cache', 'repos', 'emailengine.git');
const EE_DIR = path.join(ROOT, '.cache', 'emailengine');
const EE_URL = 'https://github.com/postalsys/emailengine.git';

// What the build takes from EmailEngine
const EE_PATHS = [
    'package.json',
    'lib/handlebars-helpers.js',
    'views/partials',
    'static/css/src',
    'static/js',
    'static/fonts',
    'static/logo',
    'static/favicon'
];

// Build dependencies that have to match EmailEngine's, or the same partials
// render against a different component library
const SHARED_DEV_DEPENDENCIES = ['tailwindcss', '@tailwindcss/cli', 'flyonui', '@iconify/tailwind4', '@iconify-json/tabler', 'handlebars'];

async function extractEmailEngine() {
    fs.mkdirSync(path.dirname(EE_MIRROR), { recursive: true });
    await syncMirror(EE_URL, EE_MIRROR);
    fs.rmSync(EE_DIR, { recursive: true, force: true });
    fs.mkdirSync(EE_DIR, { recursive: true });
    const archive = execFileSync('git', ['--git-dir', EE_MIRROR, 'archive', '--format=tar', 'HEAD', ...EE_PATHS], { maxBuffer: 256 * 1024 * 1024 });
    execFileSync('tar', ['-x', '-C', EE_DIR], { input: archive });
}

function checkVersions() {
    const ours = require(path.join(ROOT, 'package.json'));
    const theirs = JSON.parse(fs.readFileSync(path.join(EE_DIR, 'package.json'), 'utf8'));
    const theirVersions = { ...theirs.dependencies, ...theirs.devDependencies };
    for (const name of SHARED_DEV_DEPENDENCIES) {
        const mine = (ours.devDependencies || {})[name];
        if (theirVersions[name] && mine !== theirVersions[name]) {
            console.warn(`warning: ${name} is ${mine} here and ${theirVersions[name]} in EmailEngine`);
        }
    }
}

function registerPartials(handlebars, dir, prefix = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            registerPartials(handlebars, full, prefix + entry.name + '/');
        } else if (entry.name.endsWith('.hbs')) {
            handlebars.registerPartial(prefix + entry.name.slice(0, -4), fs.readFileSync(full, 'utf8'));
        }
    }
}

function setupHandlebars() {
    const handlebars = Handlebars.create();
    const { registerHandlebarsHelpers } = require(path.join(EE_DIR, 'lib', 'handlebars-helpers.js'));
    // the pages are English only; the translation helper passes text through
    const gt = { gettext: text => text, useLocale: () => gt };
    registerHandlebarsHelpers(handlebars, { gt });
    registerPartials(handlebars, path.join(EE_DIR, 'views', 'partials'));
    registerPartials(handlebars, path.join(ROOT, 'templates', 'partials'));
    return handlebars;
}

function copy(from, to) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(from, to, { recursive: true });
}

async function main() {
    await extractEmailEngine();
    checkVersions();

    fs.rmSync(DIST, { recursive: true, force: true });
    fs.mkdirSync(DIST, { recursive: true });

    const handlebars = setupHandlebars();
    const layout = handlebars.compile(fs.readFileSync(path.join(ROOT, 'templates', 'layout.hbs'), 'utf8'));
    const views = {};
    for (const name of ['index', 'repo']) {
        views[name] = handlebars.compile(fs.readFileSync(path.join(ROOT, 'templates', name + '.hbs'), 'utf8'));
    }

    const repos = require(path.join(ROOT, 'repos.json'));
    for (const page of buildPages(DATA_DIR, repos)) {
        const body = views[page.view](page.context);
        const html = layout({ ...page.context, body });
        const file = path.join(DIST, page.path, 'index.html');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, html);
    }

    // The URLs match EmailEngine's own /static/ layout, so its font stylesheet
    // and partials resolve unchanged
    copy(path.join(EE_DIR, 'static', 'js', 'ui.js'), path.join(DIST, 'static', 'js', 'ui.js'));
    copy(path.join(ROOT, 'node_modules', 'flyonui', 'flyonui.js'), path.join(DIST, 'static', 'js', 'flyonui.js'));
    copy(path.join(ROOT, 'src', 'charts.js'), path.join(DIST, 'static', 'js', 'charts.js'));
    copy(path.join(EE_DIR, 'static', 'fonts'), path.join(DIST, 'static', 'fonts'));
    copy(path.join(EE_DIR, 'static', 'logo'), path.join(DIST, 'static', 'logo'));
    copy(path.join(EE_DIR, 'static', 'favicon'), path.join(DIST, 'static', 'favicon'));
    copy(path.join(EE_DIR, 'static', 'favicon', 'favicon.ico'), path.join(DIST, 'favicon.ico'));
    copy(DATA_DIR, path.join(DIST, 'data'));

    execFileSync(
        path.join(ROOT, 'node_modules', '.bin', 'tailwindcss'),
        ['-i', path.join(ROOT, 'src', 'site.tailwind.css'), '-o', path.join(DIST, 'static', 'css', 'app.css'), '--minify'],
        { stdio: ['ignore', 'ignore', 'inherit'] }
    );

    console.log(`Built ${path.relative(ROOT, DIST)}/`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
