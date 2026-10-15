'use strict';
// Fan-in of changed files: how many other project files import or require each one. A static, cheap
// scan of import/require/use lines in JS/TS, Python and PHP; no parsing, no build tools. Tests do not
// count: a helper five tests import is not core code. Used by the level proposal (core code → Maximum).
const fs = require('node:fs');
const path = require('node:path');
const { listFiles } = require('./files.js');

const JS = new Set(['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts', 'vue', 'svelte']);
const JS_TRY = ['', '.js', '.ts', '.tsx', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '/index.js', '/index.ts', '/index.tsx', '/index.jsx'];
// TypeScript with NodeNext writes the compiled name: `./a.js` is a.ts.
const TS_FOR = { js: ['.ts', '.tsx', '.mts', '.cts'], mjs: ['.mts', '.ts'], cjs: ['.cts', '.ts'] };
const SKIP_DIRS = ['node_modules', 'vendor', '.git', 'dist', 'build', '.venv', 'venv', '__pycache__', '.next', 'coverage', '.keel'];
const MAX_SCAN = 20000;
const MAX_BYTES = 512 * 1024;

const ext = (p) => { const b = p.slice(p.lastIndexOf('/') + 1); return b.includes('.') ? b.slice(b.lastIndexOf('.') + 1).toLowerCase() : ''; };
const lang = (p) => { const e = ext(p); return JS.has(e) ? 'js' : e === 'py' ? 'py' : e === 'php' ? 'php' : null; };
const dir = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const norm = (p) => path.posix.normalize(p).replace(/^\.\//, '');

// Every module path a file mentions, as written.
function specifiers(text, language) {
  const out = [];
  const grab = (re) => { for (const m of text.matchAll(re)) out.push(m[1]); };
  if (language === 'js') {
    grab(/\bfrom\s*['"]([^'"]+)['"]/g);
    grab(/\bimport\s*['"]([^'"]+)['"]/g);
    grab(/\b(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
  } else if (language === 'py') {
    for (const m of text.matchAll(/^\s*from\s+([.\w]+)\s+import\s+([^#\n]+)/gm)) {
      out.push(m[1]);
      for (const name of m[2].replace(/[()\\]/g, ' ').split(',')) {
        const n = name.trim().split(/\s+/)[0];
        if (/^\w+$/.test(n)) out.push(m[1].endsWith('.') ? `${m[1]}${n}` : `${m[1]}.${n}`);
      }
    }
    for (const m of text.matchAll(/^\s*import\s+([^#\n]+)/gm)) for (const name of m[1].split(',')) out.push(name.trim().split(/\s+/)[0]);
  } else if (language === 'php') {
    grab(/^\s*use\s+(?:function\s+|const\s+)?\\?([\w\\]+)/gm);
    grab(/\b(?:require|include)(?:_once)?\s*\(?\s*(?:__DIR__\s*\.\s*)?['"]([^'"]+)['"]/g);
  }
  return out;
}

// Whether `spec`, written in `from`, points at `target` (all paths relative to the project root).
function pointsAt(spec, from, target, language) {
  if (language === 'js') {
    if (!spec.startsWith('.')) return false;
    const resolved = norm(path.posix.join(dir(from), spec));
    if (JS_TRY.some((s) => resolved + s === target)) return true;
    const compiled = /\.(m|c)?js$/.exec(resolved);
    return Boolean(compiled) && TS_FOR[compiled[0].slice(1)].some((s) => resolved.slice(0, compiled.index) + s === target);
  }
  if (language === 'py') {
    let mod = spec;
    if (mod.startsWith('.')) {
      const dots = /^\.+/.exec(mod)[0].length;
      const parts = dir(from).split('/').filter(Boolean);
      const pkg = parts.slice(0, Math.max(0, parts.length - (dots - 1))).join('/');
      mod = [pkg, mod.slice(dots).replace(/\./g, '/')].filter(Boolean).join('/');
      return target === `${mod}.py` || target === `${mod}/__init__.py`;
    }
    const tail = mod.replace(/\./g, '/');
    // Absolute imports are relative to a source root (often src/): match the path's end.
    return [`${tail}.py`, `${tail}/__init__.py`].some((t) => target === t || target.endsWith(`/${t}`));
  }
  if (language === 'php') {
    if (/\.php$/i.test(spec)) return norm(path.posix.join(dir(from), spec.replace(/^\//, ''))) === target || target.endsWith(`/${spec.replace(/^[./]+/, '')}`);
    // PSR-4: the first namespace segment maps to a folder (App → app/ or src/); match the rest.
    const parts = spec.split('\\').filter(Boolean);
    if (parts.length < 2) return false;
    const tail = `${parts.slice(1).join('/')}.php`;
    return target.toLowerCase().endsWith(`/${tail.toLowerCase()}`) || target.toLowerCase() === tail.toLowerCase();
  }
  return false;
}

// targets: changed project paths. isTest(path) → bool. Returns { counts: { path: n }, scanned, truncated }.
function fanIn(root, targets, isTest, { maxScan = MAX_SCAN } = {}) {
  const wanted = targets.filter((t) => lang(t));
  const counts = Object.fromEntries(wanted.map((t) => [t, 0]));
  if (!wanted.length) return { counts, scanned: 0, truncated: false };
  const langs = new Set(wanted.map(lang));
  const { files } = listFiles(root, SKIP_DIRS);
  const sources = files.filter((f) => langs.has(lang(f)) && !isTest(f) && !SKIP_DIRS.some((d) => f.startsWith(`${d}/`) || f.includes(`/${d}/`)));
  const truncated = sources.length > maxScan;
  for (const f of sources.slice(0, maxScan)) {
    let text;
    try {
      const full = path.join(root, f);
      if (fs.statSync(full).size > MAX_BYTES) continue;
      text = fs.readFileSync(full, 'utf8');
    } catch { continue; }
    const language = lang(f);
    const specs = specifiers(text, language);
    if (!specs.length) continue;
    for (const t of wanted) {
      if (t === f || lang(t) !== language) continue;
      if (specs.some((s) => pointsAt(s, f, t, language))) counts[t]++;
    }
  }
  return { counts, scanned: Math.min(sources.length, maxScan), truncated };
}

module.exports = { fanIn, specifiers, pointsAt };
