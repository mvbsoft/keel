'use strict';
// The keel design system (plugins/keel/templates/design/): every colour of a keel page lives in keel.css,
// both themes define the same tokens and keep their text and marks readable, and the pages load the
// system the way docs/design-system.md describes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const TEMPLATES = path.join(ROOT, 'plugins', 'keel', 'templates');
const DESIGN = path.join(TEMPLATES, 'design');
const KEEL_CSS = path.join(DESIGN, 'keel.css');
const DOC = path.join(ROOT, 'docs', 'design-system.md');
const PAGES = ['usage', 'feature-page'];

const read = (file) => fs.readFileSync(file, 'utf8');
const rel = (file) => path.relative(ROOT, file).split(path.sep).join('/');

const templateFiles = PAGES.concat('design').flatMap((dir) => fs.readdirSync(path.join(TEMPLATES, dir))
  .filter((name) => /\.(css|js|html)$/.test(name))
  .map((name) => path.join(TEMPLATES, dir, name)));

const css = read(KEEL_CSS);

// `--name: value;` pairs of a block, as { name: value }.
function tokensOf(block) {
  const out = {};
  for (const m of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const darkBlock = /:root\s*\{\s*color-scheme:\s*dark;([\s\S]*?)\n\}/.exec(css);
const lightBlock = /:root\[data-keel-theme="light"\]\s*\{\s*color-scheme:\s*light;([\s\S]*?)\n\}/.exec(css);
const THEMES = { dark: darkBlock && tokensOf(darkBlock[1]), light: lightBlock && tokensOf(lightBlock[1]) };

test('keel.css: has a dark block and a light block', () => {
  assert.ok(darkBlock, 'the dark block `:root { color-scheme: dark; ... }`');
  assert.ok(lightBlock, 'the light block `:root[data-keel-theme="light"] { color-scheme: light; ... }`');
});

test('a group of buttons (.seg) is separate pills: the group draws no frame, each button has its own', () => {
  const rules = (text, selector) => [...text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => m[1].split(',').some((s) => s.trim().endsWith(selector))).map((m) => m[2]);
  for (const file of templateFiles.filter((f) => f.endsWith('.css'))) {
    for (const body of rules(read(file), '.seg')) {
      assert.doesNotMatch(body, /(?:^|[;\s])(?:border|background|box-shadow|outline|padding)(?:-[a-z-]+)?\s*:/, `${rel(file)}: the group itself has no frame, fill or inner space: ${body.trim()}`);
    }
  }
  const button = rules(css, '.seg button').join(' ');
  assert.match(button, /border:\s*1px solid var\(--line\)/);
  assert.match(button, /border-radius:\s*var\(--r-pill\)/);
  assert.match(rules(css, '.seg').join(' '), /gap:\s*\d+px/, 'the pills stand apart');
});

test('no colour literal in a template file outside design/keel.css', () => {
  // A hex colour is # and exactly 3, 4, 6 or 8 hex digits and then a character that cannot continue a
  // name; `&#169;` (an entity) and `#view` or `#dec-${id}` (an id or a fragment) are not colours.
  const hex = /(?<![\w&])#([0-9a-fA-F]+)(?![\w-])/g;
  const fn = /\b(?:rgba?|hsla?|oklch|oklab|color)\(/g;
  const found = [];
  for (const file of templateFiles) {
    if (file === KEEL_CSS) continue;
    const text = read(file);
    const hits = [];
    for (const m of text.matchAll(hex)) if ([3, 4, 6, 8].includes(m[1].length)) hits.push(m[0]);
    for (const m of text.matchAll(fn)) hits.push(m[0]);
    if (hits.length) found.push(`${rel(file)}: ${hits.length} literals, first ${hits.slice(0, 3).join(' ')}`);
  }
  assert.deepEqual(found, [], 'a page takes every colour from keel.css as var(--token)');
});

test('every var(--token) in a template file is defined in keel.css or in that file', () => {
  // `var(--c${i})` builds its name at run time: the lookahead skips names that do not end at `)` or `,`.
  const use = /var\(\s*--([\w-]+)(?![\w$-])/g;
  const inCss = new Set([...css.matchAll(/--([\w-]+)\s*:/g)].map((m) => m[1]));
  const missing = [];
  for (const file of templateFiles) {
    const text = read(file);
    const own = new Set([...text.matchAll(/--([\w-]+)\s*:|['"]--([\w-]+)['"]/g)].map((m) => m[1] || m[2]));
    for (const m of text.matchAll(use)) {
      if (!inCss.has(m[1]) && !own.has(m[1])) missing.push(`${rel(file)}: --${m[1]}`);
    }
  }
  assert.deepEqual(missing, [], 'a token that is defined nowhere');
});

test('both themes define the same tokens', () => {
  const dark = Object.keys(THEMES.dark).sort();
  const light = Object.keys(THEMES.light).sort();
  assert.deepEqual(dark.filter((n) => !light.includes(n)), [], 'defined in dark only');
  assert.deepEqual(light.filter((n) => !dark.includes(n)), [], 'defined in light only');
});

test('dark is the default: no prefers-color-scheme, and the only theme selector is [data-keel-theme="light"]', () => {
  const found = [];
  for (const file of templateFiles) {
    const text = read(file);
    if (/prefers-color-scheme/.test(text)) found.push(`${rel(file)}: prefers-color-scheme`);
    if (!file.endsWith('.css')) continue;
    for (const m of text.matchAll(/\[data-[\w-]*theme[^\]]*\]/g)) {
      if (m[0] !== '[data-keel-theme="light"]') found.push(`${rel(file)}: ${m[0]}`);
    }
  }
  assert.deepEqual(found, []);
});

// WCAG 2.x relative luminance: L = 0.2126 R + 0.7152 G + 0.0722 B, each channel c (0..1) linearised as
// c / 12.92 when c <= 0.04045, else ((c + 0.055) / 1.055) ^ 2.4. Contrast ratio = (L1 + 0.05) / (L2 + 0.05),
// L1 the lighter colour.
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const HL = ['hl-key', 'hl-str', 'hl-fn', 'hl-num', 'hl-com'];
const SERIES = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'];
const KINDS = ['k1', 'k2', 'k3', 'k4'];
const SOFT = ['good', 'wait', 'risk', 'info'];
// [foreground, background, minimum ratio] for a theme. Text needs 4.5:1 (WCAG 2.2, 1.4.3), marks 3:1 (1.4.11).
// In the light theme some chart series are below 3:1 on the card (an amber or a pink is light by nature),
// so they must reach 2:1 there, and every chart also shows its numbers as text or a table. Token kinds
// are four steps of one hue and need 2:1 only; the text and the numbers carry the meaning.
function pairs(theme) {
  const out = [];
  const add = (fgs, bgs, min) => { for (const f of fgs) for (const b of bgs) out.push([f, b, min]); };
  add(['ink'], ['bg', 'card', 'band', 'pop', 'pop-hover', 'accent-soft', 'good-soft', 'wait-soft', 'risk-soft', 'info-soft'], 4.5);
  add(['muted'], ['bg', 'card', 'band', 'pop'], 4.5);
  add(['faint'], ['bg', 'card'], 4.5);
  add(['accent'], ['bg', 'card', 'band', 'accent-soft'], 4.5);
  add(['on-accent'], ['accent'], 4.5);
  for (const s of SOFT) add([s], [`${s}-soft`], 4.5);
  add(['violet'], ['violet-soft'], 4.5);
  add(SOFT, ['card'], 4.5);
  add(HL, ['band', 'card'], 4.5);
  add(['fill'], ['band', 'card'], 3);
  add(['brand-a'], ['band'], 3);
  add(['good', 'wait', 'info'], ['band'], 3);
  add(['faint'], ['card'], 3);
  add(SERIES, ['card'], theme === 'dark' ? 3 : 2);
  add(KINDS, ['card'], 2);
  return out;
}

for (const theme of ['dark', 'light']) {
  test(`${theme} theme: text, marks and chart colours reach their contrast`, () => {
    const t = THEMES[theme];
    const failed = [];
    for (const [fg, bg, min] of pairs(theme)) {
      assert.ok(/^#[0-9a-f]{6}$/i.test(t[fg] || ''), `${theme}: --${fg} is a 6-digit hex`);
      assert.ok(/^#[0-9a-f]{6}$/i.test(t[bg] || ''), `${theme}: --${bg} is a 6-digit hex`);
      const ratio = contrast(t[fg], t[bg]);
      if (ratio < min) failed.push(`${theme}: --${fg} ${t[fg]} on --${bg} ${t[bg]} is ${ratio.toFixed(2)}:1, needs ${min}:1`);
    }
    assert.deepEqual(failed, []);
  });
}

for (const page of PAGES) {
  test(`${page}: index.html is a fragment: no doctype, html, head or body tag`, () => {
    // The publish tool wraps the fragment in its own document skeleton.
    const html = read(path.join(TEMPLATES, page, 'index.html'));
    assert.doesNotMatch(html, /<(?:!doctype|html|head|body)\b/i);
  });

  test(`${page}: index.html loads the design system at the top, in order`, () => {
    const html = read(path.join(TEMPLATES, page, 'index.html'));
    const at = (re) => { const m = re.exec(html); return m ? m.index : -1; };
    const fonts = at(/<link[^>]*fonts\.googleapis\.com\/css2[^>]*>/);
    const keel = at(/<link[^>]*rel="stylesheet"[^>]*href="keel\.css"[^>]*>/);
    const style = at(/<link[^>]*rel="stylesheet"[^>]*href="style\.css"[^>]*>/);
    const theme = /<script\b[^>]*src="keel-theme\.js"[^>]*>/.exec(html);
    assert.ok(keel >= 0, 'keel.css is linked');
    assert.ok(style >= 0, 'style.css is linked');
    assert.ok(fonts >= 0 && fonts < keel, 'the fonts link comes before keel.css');
    assert.ok(keel < style, 'keel.css is linked before style.css');
    assert.ok(theme, 'keel-theme.js is loaded');
    assert.ok(theme.index > style, 'keel-theme.js comes after style.css');
    assert.doesNotMatch(theme[0], /\b(?:defer|async)\b|type\s*=\s*["']?module/, 'keel-theme.js is a plain script');
    const firstElement = at(/<(?:div|main|header|nav|section|article|footer)\b/);
    assert.ok(firstElement < 0 || theme.index < firstElement, 'keel-theme.js comes before the first element of the page');
  });
}

test('docs/design-system.md lists every token defined in keel.css', () => {
  const doc = read(DOC);
  const names = new Set([...css.matchAll(/--([\w-]+)\s*:/g)].map((m) => m[1]));
  const missing = [...names].filter((n) => !new RegExp(`--${n}(?![\\w-])`).test(doc));
  assert.deepEqual(missing.map((n) => `--${n}`), [], 'tokens the document does not name');
});
