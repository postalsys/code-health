'use strict';

const SVG_NS = 'http://www.w3.org/2000/svg';
const YEAR_MS = 365 * 24 * 3600 * 1000;

const CHARTS = [
    {
        id: 'chart-size',
        title: 'Size',
        sub: 'Lines of code, comments and blank lines left out',
        zeroBase: true,
        series: [{ label: 'Source lines', value: s => s.sloc, format: formatInt }]
    },
    {
        id: 'chart-mi',
        title: 'Maintainability index',
        sub: 'Mean over functions, weighted by their lines. Higher is better',
        series: [{ label: 'MI', value: s => s.mi, format: v => v.toFixed(1) }]
    },
    {
        id: 'chart-cc',
        title: 'Cyclomatic complexity per function',
        sub: 'Lower is better',
        zeroBase: true,
        series: [
            { label: 'Mean', value: s => s.ccMean, format: v => v.toFixed(2) },
            { label: '90th percentile', value: s => s.ccP90, format: v => String(v) }
        ]
    },
    {
        id: 'chart-share',
        title: 'Hard to maintain',
        sub: 'Share of functions, and of function code, past the usual limits. Lower is better',
        zeroBase: true,
        series: [
            { label: 'Functions with CC > 10', value: s => (s.functions ? (s.ccHigh / s.functions) * 100 : 0), format: v => v.toFixed(1) + '%' },
            { label: 'Code in functions with MI < 20', value: s => s.lowMiShare, format: v => v.toFixed(1) + '%' }
        ]
    }
];

const state = { index: null, repo: null, list: [], cache: new Map() };

function formatInt(value) {
    return Math.round(value).toLocaleString('en-US');
}

function formatDate(iso) {
    return new Date(iso).toISOString().slice(0, 10);
}

function el(tag, attrs = {}, text) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        node.setAttribute(key, value);
    }
    if (text !== undefined) {
        node.textContent = text;
    }
    return node;
}

function svg(tag, attrs = {}) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) {
        node.setAttribute(key, value);
    }
    return node;
}

async function fetchJson(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) {
        throw new Error(`${url}: ${res.status}`);
    }
    return res.json();
}

async function loadRepo(name) {
    if (!state.cache.has(name)) {
        state.cache.set(name, await fetchJson(`data/repos/${encodeURIComponent(name)}.json`));
    }
    return state.cache.get(name);
}

// Releases plus the default branch, when it has moved past the last release
function points(data) {
    const list = data.snapshots.map(s => ({ ...s, label: s.ref }));
    const last = list[list.length - 1];
    if (data.head && (!last || data.head.commit !== last.commit)) {
        list.push({ ...data.head, label: 'default branch' });
    }
    return list.map(p => ({ ...p, time: Date.parse(p.date) }));
}

function yearAgo(list, time) {
    let match = null;
    for (const p of list) {
        if (p.time <= time - YEAR_MS) {
            match = p;
        }
    }
    return match;
}

function niceStep(span, count) {
    const raw = span / count;
    const magnitude = 10 ** Math.floor(Math.log10(raw));
    const residual = raw / magnitude;
    return (residual > 5 ? 10 : residual > 2 ? 5 : residual > 1 ? 2 : 1) * magnitude;
}

function yScale(values, zeroBase) {
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (zeroBase) {
        min = 0;
    }
    if (max === min) {
        max = min + 1;
    }
    const step = niceStep(max - min, 4);
    const low = Math.floor(min / step) * step;
    const high = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = low; v <= high + step / 2; v += step) {
        ticks.push(Number(v.toFixed(6)));
    }
    return { low, high, ticks };
}

function yearTicks(start, end, width) {
    const first = new Date(start).getUTCFullYear() + 1;
    const last = new Date(end).getUTCFullYear();
    const years = [];
    for (let y = first; y <= last; y++) {
        years.push(y);
    }
    const every = Math.max(1, Math.ceil(years.length / Math.max(2, Math.floor(width / 70))));
    return years.filter(y => (last - y) % every === 0).map(y => ({ label: String(y), time: Date.UTC(y, 0, 1) }));
}

function renderChart(figure, config, list) {
    figure.replaceChildren();
    const caption = el('figcaption', {}, config.title);
    caption.append(el('span', { class: 'sub' }, config.sub));
    figure.append(caption);

    const width = Math.max(280, figure.clientWidth - 32);
    const height = 220;
    const margin = { top: 10, right: 12, bottom: 24, left: 48 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;

    const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `${config.title} over time` });
    figure.append(root);

    if (!list.length) {
        return;
    }

    const t0 = list[0].time;
    const t1 = Math.max(list[list.length - 1].time, t0 + 1);
    const values = config.series.flatMap(series => list.map(series.value));
    const y = yScale(values, config.zeroBase);
    const px = time => margin.left + ((time - t0) / (t1 - t0)) * plotW;
    const py = value => margin.top + plotH - ((value - y.low) / (y.high - y.low)) * plotH;

    const axis = svg('g', { class: 'axis' });
    for (const tick of y.ticks) {
        axis.append(svg('line', { class: tick === y.low ? 'baseline' : 'gridline', x1: margin.left, x2: width - margin.right, y1: py(tick), y2: py(tick) }));
        const label = svg('text', { x: margin.left - 8, y: py(tick) + 4, 'text-anchor': 'end' });
        label.textContent = tick >= 10000 ? Math.round(tick / 1000) + 'k' : String(tick);
        axis.append(label);
    }
    for (const tick of yearTicks(t0, t1, plotW)) {
        const label = svg('text', { x: px(tick.time), y: height - 6, 'text-anchor': 'middle' });
        label.textContent = tick.label;
        axis.append(label);
    }
    root.append(axis);

    config.series.forEach((series, i) => {
        const d = list.map((p, j) => `${j ? 'L' : 'M'}${px(p.time).toFixed(1)},${py(series.value(p)).toFixed(1)}`).join('');
        root.append(svg('path', { class: 'series', d, stroke: `var(--series-${i + 1})` }));
    });

    if (config.series.length > 1) {
        const legend = el('div', { class: 'legend' });
        config.series.forEach((series, i) => {
            const item = el('span');
            item.append(el('span', { class: 'key', style: `background: var(--series-${i + 1})` }), document.createTextNode(series.label));
            legend.append(item);
        });
        figure.append(legend);
    }

    const crosshair = svg('line', { class: 'crosshair', y1: margin.top, y2: margin.top + plotH, visibility: 'hidden' });
    const markers = config.series.map((series, i) => svg('circle', { class: 'marker', r: 4, fill: `var(--series-${i + 1})`, visibility: 'hidden' }));
    root.append(crosshair, ...markers);

    const tooltip = document.getElementById('tooltip');
    const hide = () => {
        crosshair.setAttribute('visibility', 'hidden');
        markers.forEach(m => m.setAttribute('visibility', 'hidden'));
        tooltip.hidden = true;
    };
    const show = event => {
        const box = root.getBoundingClientRect();
        const x = ((event.clientX - box.left) / box.width) * width;
        let nearest = list[0];
        for (const p of list) {
            if (Math.abs(px(p.time) - x) < Math.abs(px(nearest.time) - x)) {
                nearest = p;
            }
        }
        const cx = px(nearest.time);
        crosshair.setAttribute('x1', cx);
        crosshair.setAttribute('x2', cx);
        crosshair.setAttribute('visibility', 'visible');
        config.series.forEach((series, i) => {
            markers[i].setAttribute('cx', cx);
            markers[i].setAttribute('cy', py(series.value(nearest)));
            markers[i].setAttribute('visibility', 'visible');
        });

        tooltip.replaceChildren(el('div', { class: 'title' }, `${nearest.label}, ${formatDate(nearest.date)}`));
        config.series.forEach((series, i) => {
            const row = el('div', { class: 'row' });
            row.append(
                el('i', { class: 'key', style: `background: var(--series-${i + 1})` }),
                el('strong', {}, series.format(series.value(nearest))),
                el('span', {}, series.label)
            );
            tooltip.append(row);
        });
        tooltip.hidden = false;
        const left = Math.min(event.clientX + 14, window.innerWidth - tooltip.offsetWidth - 8);
        tooltip.style.left = `${Math.max(8, left)}px`;
        tooltip.style.top = `${event.clientY + 14}px`;
    };
    root.addEventListener('pointermove', show);
    root.addEventListener('pointerleave', hide);
}

function cell(text, className) {
    return el('td', className ? { class: className } : {}, text);
}

function deltaCell(now, then, { percent, higherIsBetter }) {
    if (!then) {
        return cell('-', 'num');
    }
    const change = percent ? ((now - then) / Math.max(then, 1)) * 100 : now - then;
    const text = (change > 0 ? '+' : '') + change.toFixed(1) + (percent ? '%' : '');
    let className = 'num';
    if (higherIsBetter !== undefined && Math.abs(change) >= 0.5) {
        className += change > 0 === higherIsBetter ? ' delta-good' : ' delta-bad';
    }
    return cell(text, className);
}

async function renderOverview() {
    const body = document.querySelector('#overview tbody');
    body.replaceChildren();
    for (const entry of state.index.repos) {
        const data = await loadRepo(entry.name);
        const list = points(data);
        const head = data.head;
        const before = yearAgo(list, Date.parse(head.date));
        const row = el('tr', { 'data-repo': entry.name });
        const nameCell = el('td');
        nameCell.append(el('button', { type: 'button' }, entry.name));
        row.append(
            nameCell,
            cell(formatInt(head.sloc), 'num'),
            deltaCell(head.sloc, before && before.sloc, { percent: true }),
            cell(formatInt(head.functions), 'num'),
            cell(head.mi.toFixed(1), 'num'),
            deltaCell(head.mi, before && before.mi, { higherIsBetter: true }),
            cell(head.ccMean.toFixed(2), 'num'),
            cell(formatInt(head.ccVeryHigh), 'num')
        );
        row.addEventListener('click', () => selectRepo(entry.name, true));
        body.append(row);
    }
}

function renderCharts() {
    for (const config of CHARTS) {
        renderChart(document.getElementById(config.id), config, state.list);
    }
}

async function selectRepo(name, scroll) {
    state.repo = name;
    if (location.hash !== '#' + name) {
        history.replaceState(null, '', '#' + name);
    }
    document.getElementById('repo-select').value = name;
    for (const row of document.querySelectorAll('#overview tbody tr')) {
        row.classList.toggle('selected', row.dataset.repo === name);
    }

    const data = await loadRepo(name);
    const list = points(data);

    document.getElementById('repo-title').textContent = name;
    const meta = document.getElementById('repo-meta');
    meta.replaceChildren(document.createTextNode(`${data.snapshots.length} releases measured. Default branch at `));
    const commitLink = el('a', { href: `${data.url}/commit/${data.head.commit}` }, data.head.commit.slice(0, 8));
    meta.append(commitLink, document.createTextNode(`, ${formatDate(data.head.date)}, ${formatInt(data.head.files)} files.`));

    state.list = list;
    renderCharts();

    const worst = document.querySelector('#worst tbody');
    worst.replaceChildren();
    for (const fn of data.worst || []) {
        const row = el('tr');
        const fileCell = el('td');
        fileCell.append(el('a', { href: `${data.url}/blob/${data.head.commit}/${fn.file}#L${fn.line}` }, `${fn.file}:${fn.line}`));
        row.append(cell(fn.name), fileCell, cell(fn.mi.toFixed(1), 'num'), cell(String(fn.cc), 'num'), cell(formatInt(fn.sloc), 'num'));
        worst.append(row);
    }

    const releases = document.querySelector('#releases tbody');
    releases.replaceChildren();
    for (const p of list.slice().reverse()) {
        const row = el('tr');
        row.append(
            cell(p.label),
            cell(formatDate(p.date)),
            cell(formatInt(p.files), 'num'),
            cell(formatInt(p.sloc), 'num'),
            cell(formatInt(p.functions), 'num'),
            cell(p.mi.toFixed(1), 'num'),
            cell(p.ccMean.toFixed(2), 'num'),
            cell(String(p.ccP90), 'num'),
            cell(String(p.ccMax), 'num'),
            cell(formatInt(p.ccHigh), 'num'),
            cell(formatInt(p.ccVeryHigh), 'num')
        );
        releases.append(row);
    }

    if (scroll) {
        document.querySelector('.repo').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

async function main() {
    state.index = await fetchJson('data/index.json');
    document.getElementById('updated').textContent = `Measured ${new Date(state.index.updated).toUTCString()}`;

    const select = document.getElementById('repo-select');
    for (const entry of state.index.repos) {
        select.append(el('option', { value: entry.name }, entry.name));
    }
    select.addEventListener('change', () => selectRepo(select.value, false));

    const names = state.index.repos.map(entry => entry.name);
    const fromHash = decodeURIComponent(location.hash.slice(1));
    await selectRepo(names.includes(fromHash) ? fromHash : names[0], false);
    await renderOverview();
    document.querySelector(`#overview tr[data-repo="${CSS.escape(state.repo)}"]`)?.classList.add('selected');

    let pending = null;
    let lastWidth = document.querySelector('.grid').clientWidth;
    new ResizeObserver(entries => {
        const width = entries[0].contentRect.width;
        if (width === lastWidth) {
            return;
        }
        lastWidth = width;
        clearTimeout(pending);
        pending = setTimeout(renderCharts, 150);
    }).observe(document.querySelector('.grid'));
}

main().catch(err => {
    document.getElementById('updated').textContent = `Could not load the measurements: ${err.message}`;
});
