'use strict';
// Language detection from GitHub Linguist data (MIT, see data/LICENSE-linguist.txt):
// file name first, then the longest matching extension, then the shebang of extension-less files.
// Only 'programming' and 'markup' languages count, as in Linguist's statistics; grouped languages
// (e.g. TSX) count towards their parent (TypeScript).
const data = require('../../data/linguist.json');

const byFilename = new Map();
const byExtension = new Map();
const byInterpreter = new Map();
// A leading unanchored capture such as `([^\s]*)` or `(.*?)` never changes whether a pattern
// matches, but in JavaScript it makes some Linguist patterns backtrack badly on long paths.
const compile = (p) => new RegExp(p.replace(/^\((?:\.\*\??|\[\^\\s\]\*)\)/, ''));
const vendor = data.vendor.map(compile);
const documentation = data.documentation.map(compile);

// Defaults for common ambiguous extensions (Linguist settles these with content heuristics,
// which are not used here).
const PREFERRED = {
  ".md": "Markdown", ".h": "C", ".m": "Objective-C", ".pl": "Perl", ".pm": "Perl", ".t": "Perl",
  ".rs": "Rust", ".ts": "TypeScript", ".sql": "SQL", ".fs": "F#", ".inc": "PHP", ".r": "R",
  ".pp": "Puppet", ".cs": "C#", ".ml": "OCaml", ".ex": "Elixir", ".sh": "Shell", ".php": "PHP",
  ".json": "JSON", ".yml": "YAML", ".yaml": "YAML", ".xml": "XML", ".html": "HTML", ".toml": "TOML",
  ".js": "JavaScript", ".vue": "Vue", ".tsx": "TSX", ".cls": "Apex", ".v": "Verilog", ".d": "D",
};

for (const lang of data.languages) {
  for (const f of lang.filenames || []) if (!byFilename.has(f)) byFilename.set(f, lang);
  (lang.extensions || []).forEach((ext, i) => {
    const key = ext.toLowerCase();
    const current = byExtension.get(key);
    // Ambiguous extension (e.g. .h, .m, .pl): prefer the language where it is the primary
    // extension, then a programming language. Linguist's content heuristics are not used.
    const rank = (l, idx) => (idx === 0 ? 2 : 0) + (l.type === 'programming' ? 1 : 0);
    if (!current || rank(lang, i) > current.rank) byExtension.set(key, { lang, rank: rank(lang, i) });
  });
  for (const it of lang.interpreters || []) if (!byInterpreter.has(it)) byInterpreter.set(it, lang);
}

for (const [ext, name] of Object.entries(PREFERRED)) {
  const lang = data.languages.find((l) => l.name === name);
  if (!lang || !(lang.extensions || []).includes(ext)) throw new Error(`linguist data: ${name} has no ${ext}`);
  byExtension.set(ext, { lang, rank: 99 });
}

const counted = (lang) => lang && (lang.type === 'programming' || lang.type === 'markup');
const display = (lang) => lang.group || lang.name;

function detect(relPath, readFirstLine) {
  const name = relPath.slice(relPath.lastIndexOf('/') + 1);
  if (byFilename.has(name)) return byFilename.get(name);
  const lower = name.toLowerCase();
  for (let i = lower.indexOf('.'); i !== -1; i = lower.indexOf('.', i + 1)) {
    const hit = byExtension.get(lower.slice(i));
    if (hit) return hit.lang;
  }
  if (!name.includes('.') && readFirstLine) {
    const line = readFirstLine(relPath) || '';
    const m = /^#!\s*(?:\/usr\/bin\/env\s+(?:-S\s+)?)?(?:\S*\/)?([A-Za-z0-9_.+-]+)/.exec(line);
    if (m) return byInterpreter.get(m[1]) || byInterpreter.get(m[1].replace(/[\d.]+$/, '')) || null;
  }
  return null;
}

// One combined pattern per list and a per-path cache: the scan asks about the same paths many times.
const anyOf = (list) => new RegExp(list.map((re) => `(?:${re.source})`).join('|'));
const vendorRe = anyOf(vendor);
const documentationRe = anyOf(documentation);
const memo = (re) => {
  const cache = new Map();
  return (relPath) => {
    let hit = cache.get(relPath);
    if (hit === undefined) { hit = re.test(relPath); cache.set(relPath, hit); }
    return hit;
  };
};
const isVendored = memo(vendorRe);
const isDocumentation = memo(documentationRe);

module.exports = { detect, counted, display, isVendored, isDocumentation, version: data.version };
