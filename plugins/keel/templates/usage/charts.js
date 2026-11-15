'use strict';
// keel usage page: charts drawn with the design system's own components (keel.css), no chart library.
// window.KeelCharts({ esc, t, order }) gives the helpers below; each returns an HTML string.
//   `order` is filled by the page (dimension -> keys, biggest spender first): a key keeps its colour on
//   every chart. Colours come only from classes of keel.css, never from a value in a script.
//
//   seriesClass(dim, key)  the class that paints a series: model families -> fable|opus|sonnet|haiku
//                          (-2 for an older model of the family, m-other for an unknown one), token kinds
//                          (out, cw5/cw1h, cr, in) -> kind1..kind4, any other dimension -> s1..s8.
//   niceScale(max)         { max, ticks }: four equal steps, the top one at or above `max`.
//   columns({ cols, fmt, summary })  stacked columns. cols: [{ label, tip, parts: [{ cls, value }], pick }];
//                          parts stack from the bottom, `pick` (a string) makes the column a button with
//                          data-pick, `fmt` writes the y ticks. The chart is a labelled group when a
//                          column can be picked (the buttons stay reachable), an image otherwise.
//   bars(items)            ranked bars. items: [{ name, value, pct, width, cls, sub, note, pick }] (value
//                          and pct are text, width is 0-100; pick makes the name a button with data-pick).
//   stack(parts, summary)  the one-line stack. parts: [{ cls, share }] (share is 0-100).
//   legend(items)          [{ cls, label }].
//   line({ series, xMin, xMax, yMax, fmtY, xTicks, summary })  an SVG line chart. series: [{ pts, area,
//                          dashed, dot, label }]; pts: [{ x, y }], a null in the list breaks the line.
//   table(head, rows)      the numbers as a table (first column left, the rest right; cells are escaped).
//   tableDetails(head, rows)  the same table inside a closed <details> ("Show as a table").
window.KeelCharts = function ({ esc, t, order }) {
  const FAMILIES = ['fable', 'opus', 'sonnet', 'haiku'];
  const KIND_CLASS = { out: 'kind1', cw5: 'kind2', cw1h: 'kind2', cr: 'kind3', in: 'kind4' };
  const version = (key) => (String(key).match(/\d+/g) || []).map(Number);
  function newer(a, b) {
    const x = version(a); const y = version(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    return false;
  }

  function seriesClass(dim, key) {
    const k = String(key);
    if (dim === 'kind') return KIND_CLASS[k] || 'kind4';
    if (dim === 'model') {
      const fam = FAMILIES.find((f) => k.includes(f));
      if (!fam) return 'm-other';
      const newest = (order.model || []).concat(k).filter((x) => x.includes(fam)).reduce((a, b) => (newer(b, a) ? b : a));
      return k === newest ? fam : `${fam}-2`;
    }
    const i = (order[dim] || []).indexOf(k);
    // A key the page did not list gets a stable colour from a string hash (31 * h + char, 32 bits).
    const n = i >= 0 ? i : Math.abs([...k].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7));
    return `s${(n % 8) + 1}`;
  }

  // The step is 1, 2, 2.5, 5 or 10 times a power of ten, so the ticks are round numbers.
  function niceScale(max) {
    const raw = (Number(max) > 0 ? Number(max) : 1) / 4;
    const pow = 10 ** Math.floor(Math.log10(raw));
    const n = raw / pow;
    const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
    return { max: step * 4, ticks: [1, 2, 3, 4].map((i) => step * i) };
  }

  const sum = (parts) => parts.reduce((a, p) => a + (Number(p.value) || 0), 0);

  function columns({ cols, fmt, summary }) {
    const sc = niceScale(Math.max(0, ...cols.map((c) => sum(c.parts))));
    const y = sc.ticks.map((v, i) => `<span class="y" aria-hidden="true" style="bottom:${(i + 1) * 25}%">${esc(fmt(v))}</span>`).join('');
    const body = cols.map((c) => {
      const parts = c.parts.filter((p) => p.value > 0).map((p) => `<i class="${p.cls}" style="height:${((p.value / sc.max) * 100).toFixed(2)}%"></i>`).join('');
      const tip = esc(c.tip);
      return c.pick != null
        ? `<button type="button" class="colm" data-pick="${esc(c.pick)}" title="${tip}" aria-label="${tip}">${parts}</button>`
        : `<div class="colm" title="${tip}">${parts}</div>`;
    }).join('');
    const n = cols.length;
    const at = [...new Set([0, 1, 2, 3, 4].map((i) => Math.round((i * (n - 1)) / 4)))];
    const xs = n ? at.map((i) => `<span>${esc(cols[i].label)}</span>`).join('') : '';
    const role = cols.some((c) => c.pick != null) ? 'group' : 'img';
    return `<div><div class="chart" role="${role}" aria-label="${esc(summary)}">${y}${body}</div><div class="xaxis" aria-hidden="true">${xs}</div></div>`;
  }

  function bars(items) {
    return `<div class="bars">${items.map((i) => {
      const dot = i.cls ? `<i class="dot ${i.cls}"></i>` : '';
      const name = i.pick != null
        ? `<button type="button" class="name" data-pick="${esc(i.pick)}" title="${esc(i.name)}">${dot}${esc(i.name)}</button>`
        : `<span class="name${i.sub ? ' sub' : ''}" title="${esc(i.name)}">${dot}${esc(i.name)}</span>`;
      return `<div class="bar">${name}<span class="num">${esc(i.value)}</span>${i.pct != null ? `<span class="pct num">${esc(i.pct)}</span>` : ''}`
        + `${i.width != null ? `<div class="track"><i style="width:${Math.max(0, Math.min(100, i.width)).toFixed(1)}%"></i></div>` : ''}`
        + `${i.note ? `<span class="note small muted">${esc(i.note)}</span>` : ''}</div>`;
    }).join('')}</div>`;
  }

  function stack(parts, summary) {
    return `<div class="stack" role="img" aria-label="${esc(summary)}">${parts.map((p) => `<i class="${p.cls}" style="width:${Math.max(0, p.share).toFixed(1)}%"></i>`).join('')}</div>`;
  }

  const legend = (items) => `<div class="legend">${items.map((i) => `<span><i class="dot ${i.cls}"></i>${esc(i.label)}</span>`).join('')}</div>`;

  // The plot is a 700 x 220 box: 40 px for the y labels, the plot from x 40 to 680 and y 20 (top) to 190 (bottom).
  function line({ series, xMin, xMax, yMax, fmtY, xTicks, summary }) {
    const sc = niceScale(yMax);
    const px = (x) => 40 + ((x - xMin) / ((xMax - xMin) || 1)) * 640;
    const py = (v) => 190 - (v / sc.max) * 170;
    const f = (n) => String(Math.round(n * 10) / 10);
    const grid = [0, 1, 2, 3, 4].map((i) => `M40 ${f(190 - i * 42.5)}H680`).join('');
    const ylab = [0, ...sc.ticks].map((v, i) => `<text x="32" y="${f(194 - i * 42.5)}" text-anchor="end">${esc((fmtY || String)(v))}</text>`).join('');
    const xlab = (xTicks || []).map((tk, i, all) => `<text x="${f(px(tk.x))}" y="212" text-anchor="${i === 0 ? 'start' : i === all.length - 1 ? 'end' : 'middle'}">${esc(tk.label)}</text>`).join('');
    const marks = series.map((s) => {
      const runs = []; let cur = [];
      for (const p of s.pts) { if (p) cur.push(p); else if (cur.length) { runs.push(cur); cur = []; } }
      if (cur.length) runs.push(cur);
      const path = (run) => run.map((p, i) => `${i ? 'L' : 'M'}${f(px(p.x))} ${f(py(p.y))}`).join('');
      let out = '';
      for (const run of runs) {
        if (s.area) out += `<path class="area" d="${path(run)}V190H${f(px(run[0].x))}Z"></path>`;
        out += `<path class="${s.dashed ? 'dash' : 'ln'}" d="${path(run)}"></path>`;
      }
      const last = s.dot && runs.length ? runs[runs.length - 1].slice(-1)[0] : null;
      if (last) {
        const x = px(last.x);
        out += `<circle cx="${f(x)}" cy="${f(py(last.y))}" r="6"></circle>`;
        if (s.label) out += `<text class="end" x="${f(x > 560 ? x - 12 : x + 12)}" y="${f(py(last.y) - 4)}" text-anchor="${x > 560 ? 'end' : 'start'}">${esc(s.label)}</text>`;
      }
      return out;
    }).join('');
    return `<svg class="lc" viewBox="0 0 700 220" role="img" aria-label="${esc(summary)}"><path class="rules" d="${grid}"></path>`
      + `<g class="scale">${ylab}${xlab}</g>${marks}</svg>`;
  }

  function table(head, rows) {
    return `<div class="scroll"><table><thead><tr>${head.map((h, i) => `<th scope="col"${i ? ' class="r"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>`
      + rows.map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="r"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('') + '</tbody></table></div>';
  }
  const tableDetails = (head, rows) => `<details class="fallback"><summary>${esc(t('chart.table'))}</summary>${table(head, rows)}</details>`;

  return { seriesClass, niceScale, columns, bars, stack, legend, line, table, tableDetails };
};
