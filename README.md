# code-health

Size, cyclomatic complexity and maintainability index of EmailEngine and the libraries it is built on, measured at every release tag and at the current default branch, charted on GitHub Pages.

A scheduled workflow (`.github/workflows/measure.yml`, Mondays) fetches each repository listed in `repos.json`, measures any release it has not measured yet plus the default branch, commits the numbers to `site/data/` and deploys `site/` to Pages.

## Running it locally

```
npm install
npm run measure            # all repositories, only what is new
npm run measure -- --repo imapflow
npm run serve              # preview at http://127.0.0.1:8080/
```

Bare mirrors of the measured repositories are kept in `.cache/repos/`. A full backfill of every release takes a couple of minutes.

## What is measured

Library source only: `lib/`, `src/`, `workers/`, `bin/` and top-level source files, minus tests, examples, tooling, type declarations and minified or generated files (`lib/select.js`). A repository can name its own roots with `include` in `repos.json`.

- **Source lines**: lines carrying code, blank lines and comments left out.
- **Cyclomatic complexity**: per function, 1 plus every branch (`lib/metrics.js` lists what counts).
- **Maintainability index**: per function, `max(0, (171 - 5.2 ln(V) - 0.23 CC - 16.2 ln(SLOC)) * 100 / 171)` with V the Halstead volume; the repository figure is the line-weighted mean. Code outside any function counts toward size only.

Changing how anything is computed means bumping `METRICS_VERSION` in `bin/measure.js`, which makes the next run measure every release again.
