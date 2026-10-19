'use strict';

// Draws the time-series charts on a repository page from the JSON the build
// embedded in #chart-data. Plain SVG, no chart library: the colors come from
// the theme tokens, so the theme toggle restyles the charts without a redraw.

(() => {
    const SVG_NS = 'http://www.w3.org/2000/svg';

    const CHARTS = {
        size: {
            zeroBase: true,
            series: [{ label: 'Source lines', key: 'sloc', format: v => Math.round(v).toLocaleString('en-US') }]
        },
        mi: {
            series: [{ label: 'MI', key: 'mi', format: v => v.toFixed(1) }]
        },
        cc: {
            zeroBase: true,
            series: [
                { label: 'Mean', key: 'ccMean', format: v => v.toFixed(2) },
                { label: '90th percentile', key: 'ccP90', format: v => String(v) }
            ]
        },
        share: {
            zeroBase: true,
            series: [
                { label: 'Functions with CC > 10', key: 'ccHighShare', format: v => v.toFixed(1) + '%' },
                { label: 'Code in functions with MI < 20', key: 'lowMiShare', format: v => v.toFixed(1) + '%' }
            ]
        }
    };

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) {
            node.className = className;
        }
        if (text !== undefined) {
            node.textContent = text;
        }
        return node;
    }

    function svg(tag, attrs) {
        const node = document.createElementNS(SVG_NS, tag);
        for (const [key, value] of Object.entries(attrs)) {
            node.setAttribute(key, value);
        }
        return node;
    }

    function niceStep(span, count) {
        const raw = span / count;
        const magnitude = 10 ** Math.floor(Math.log10(raw));
        const residual = raw / magnitude;
        return (residual > 5 ? 10 : residual > 2 ? 5 : residual > 1 ? 2 : 1) * magnitude;
    }

    function yScale(values, zeroBase) {
        let min = zeroBase ? 0 : Math.min(...values);
        let max = Math.max(...values);
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

    function tickLabel(value) {
        return value >= 10000 ? Math.round(value / 1000) + 'k' : String(value);
    }

    let tooltip = null;

    function getTooltip() {
        if (!tooltip) {
            tooltip = el('div', 'bg-base-100 border-base-content/20 rounded-box pointer-events-none fixed z-50 hidden border px-3 py-2 text-xs shadow-md');
            tooltip.setAttribute('role', 'status');
            document.body.append(tooltip);
        }
        return tooltip;
    }

    function render(container, config, points) {
        container.replaceChildren();

        const width = Math.max(260, container.clientWidth);
        const height = 240;
        const margin = { top: 10, right: 10, bottom: 24, left: 44 };
        const plotW = width - margin.left - margin.right;
        const plotH = height - margin.top - margin.bottom;

        const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': config.series.map(s => s.label).join(', ') + ' over time' });
        container.append(root);
        if (!points.length) {
            return;
        }

        const t0 = points[0].time;
        const t1 = Math.max(points[points.length - 1].time, t0 + 1);
        const y = yScale(
            config.series.flatMap(series => points.map(p => p[series.key])),
            config.zeroBase
        );
        const px = time => margin.left + ((time - t0) / (t1 - t0)) * plotW;
        const py = value => margin.top + plotH - ((value - y.low) / (y.high - y.low)) * plotH;

        for (const tick of y.ticks) {
            root.append(
                svg('line', {
                    class: tick === y.low ? 'stroke-base-content/25' : 'stroke-base-content/10',
                    x1: margin.left,
                    x2: width - margin.right,
                    y1: py(tick),
                    y2: py(tick)
                })
            );
            const label = svg('text', { class: 'fill-base-content/60 text-[11px]', x: margin.left - 8, y: py(tick) + 4, 'text-anchor': 'end' });
            label.textContent = tickLabel(tick);
            root.append(label);
        }
        for (const tick of yearTicks(t0, t1, plotW)) {
            const label = svg('text', { class: 'fill-base-content/60 text-[11px]', x: px(tick.time), y: height - 6, 'text-anchor': 'middle' });
            label.textContent = tick.label;
            root.append(label);
        }

        config.series.forEach((series, i) => {
            const d = points.map((p, j) => `${j ? 'L' : 'M'}${px(p.time).toFixed(1)},${py(p[series.key]).toFixed(1)}`).join('');
            root.append(
                svg('path', { d, fill: 'none', stroke: `var(--chart-${i + 1})`, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' })
            );
        });

        if (config.series.length > 1) {
            const legend = el('div', 'text-base-content/70 mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs');
            config.series.forEach((series, i) => {
                const item = el('span', 'inline-flex items-center gap-1.5');
                const key = el('span', 'inline-block h-0.5 w-3.5 rounded-full');
                key.style.background = `var(--chart-${i + 1})`;
                item.append(key, document.createTextNode(series.label));
                legend.append(item);
            });
            container.append(legend);
        }

        const crosshair = svg('line', {
            class: 'stroke-base-content/40',
            'stroke-dasharray': '3 3',
            y1: margin.top,
            y2: margin.top + plotH,
            visibility: 'hidden'
        });
        const markers = config.series.map((series, i) =>
            svg('circle', { class: 'stroke-base-100', r: 4, 'stroke-width': 2, fill: `var(--chart-${i + 1})`, visibility: 'hidden' })
        );
        root.append(crosshair, ...markers);

        const tip = getTooltip();
        const hide = () => {
            crosshair.setAttribute('visibility', 'hidden');
            markers.forEach(m => m.setAttribute('visibility', 'hidden'));
            tip.classList.add('hidden');
        };
        const show = event => {
            const box = root.getBoundingClientRect();
            const x = ((event.clientX - box.left) / box.width) * width;
            let nearest = points[0];
            for (const p of points) {
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
                markers[i].setAttribute('cy', py(nearest[series.key]));
                markers[i].setAttribute('visibility', 'visible');
            });

            tip.replaceChildren(el('div', 'text-base-content/70 mb-1', `${nearest.label}, ${nearest.date.slice(0, 10)}`));
            config.series.forEach((series, i) => {
                const row = el('div', 'flex items-center gap-1.5 tabular-nums');
                const key = el('span', 'inline-block h-0.5 w-3.5 rounded-full');
                key.style.background = `var(--chart-${i + 1})`;
                row.append(key, el('strong', 'text-base-content', series.format(nearest[series.key])), el('span', 'text-base-content/60', series.label));
                tip.append(row);
            });
            tip.classList.remove('hidden');
            const left = Math.min(event.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
            tip.style.left = `${Math.max(8, left)}px`;
            tip.style.top = `${event.clientY + 14}px`;
        };
        root.addEventListener('pointermove', show);
        root.addEventListener('pointerleave', hide);
    }

    function init() {
        const source = document.getElementById('chart-data');
        if (!source) {
            return;
        }
        const points = JSON.parse(source.textContent).map(p => ({ ...p, time: Date.parse(p.date) }));
        const containers = [...document.querySelectorAll('[data-chart]')];
        const draw = () => {
            for (const container of containers) {
                render(container, CHARTS[container.dataset.chart], points);
            }
        };
        draw();

        let pending = null;
        let lastWidth = containers[0] && containers[0].clientWidth;
        window.addEventListener('resize', () => {
            if (!containers[0] || containers[0].clientWidth === lastWidth) {
                return;
            }
            lastWidth = containers[0].clientWidth;
            clearTimeout(pending);
            pending = setTimeout(draw, 150);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
