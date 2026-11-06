'use strict';
// keel usage dashboard: the chart colors and Chart.js defaults, read from the page's CSS tokens.
// window.KeelColors() gives them. The page fills `order` (index.html derive()) with each dimension's
// keys, so a key keeps its color across charts.
window.KeelColors = function () {
  // ---- colors (from tokens) ------------------------------------------------------------------------
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const PAL = ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6', '--c7', '--c8'];
  const order = {}; // dim -> sorted keys (stable colors across charts)
  function colorFor(dim, key) {
    if (dim === 'model') {
      const base = /opus/.test(key) ? 'opus' : /sonnet/.test(key) ? 'sonnet' : /haiku/.test(key) ? 'haiku' : null;
      if (base) {
        const same = (order.model || []).filter((k) => k.includes(base));
        const i = Math.max(0, same.indexOf(key));
        if (i === 0) return css('--m-' + base);
        if (i === 1) return css('--m-' + base + '-2');
      }
    }
    const list = order[dim] || [];
    let i = list.indexOf(key);
    if (i < 0) i = Math.abs([...String(key)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7));
    return css(PAL[i % PAL.length]);
  }
  function chartDefaults() {
    if (!window.Chart) return;
    Chart.defaults.color = css('--muted');
    Chart.defaults.borderColor = css('--line');
    Chart.defaults.font.family = css('--font-ui') || 'system-ui';
    Chart.defaults.font.size = 12;
    Chart.defaults.animation = matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 250 };
    Chart.defaults.plugins.legend.labels.boxWidth = 10;
    Chart.defaults.plugins.legend.labels.boxHeight = 10;
    Chart.defaults.maintainAspectRatio = false;
  }

  return { css, PAL, order, colorFor, chartDefaults };
};
