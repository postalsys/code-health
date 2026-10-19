# code-health

Size, cyclomatic complexity and maintainability index of EmailEngine and the libraries it is built on, measured at every release tag and at the current default branch, charted on GitHub Pages.

A scheduled workflow (`.github/workflows/measure.yml`, Mondays) fetches each repository listed in `repos.json`, measures any release it has not measured yet plus the default branch, commits the numbers to `data/`, builds the site into `dist/` and deploys it to Pages at https://code-health.emailengine.dev/.

## Running it locally

```
npm install
npm run measure            # all repositories, only what is new
npm run measure -- --repo imapflow
npm run build              # render the site into dist/
npm run serve              # preview at http://127.0.0.1:8080/
```

## The site

The pages use EmailEngine's own admin UI. `npm run build` reads its `ui/*` Handlebars partials, its view helpers (`lib/handlebars-helpers.js`), its Tailwind entry with the brand themes and FlyonUI components, `static/js/ui.js`, the fonts and the logo straight from the emailengine mirror at its default branch, so the site follows the admin UI as it changes. This repository only holds the page templates (`templates/`), the chart script (`src/charts.js`) and a thin Tailwind entry that imports EmailEngine's (`src/site.tailwind.css`).

The Tailwind, FlyonUI, Iconify and Handlebars versions in `devDependencies` have to match EmailEngine's; the build warns when they drift.

Bare mirrors of the measured repositories are kept in `.cache/repos/`. A full backfill of every release takes a couple of minutes.

## What is measured

Library source only: `lib/`, `src/`, `workers/`, `bin/` and top-level source files, minus tests, examples, tooling, type declarations and minified or generated files (`lib/select.js`). A repository can name its own roots with `include` in `repos.json`.

- **Source lines**: lines carrying code, blank lines and comments left out.
- **Cyclomatic complexity**: per function, 1 plus every branch (`lib/metrics.js` lists what counts).
- **Maintainability index**: per function, `max(0, (171 - 5.2 ln(V) - 0.23 CC - 16.2 ln(SLOC)) * 100 / 171)` with V the Halstead volume; the repository figure is the line-weighted mean. Code outside any function counts toward size only.

Changing how anything is computed means bumping `METRICS_VERSION` in `bin/measure.js`, which makes the next run measure every release again.
