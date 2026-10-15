'use strict';
// Converts GitHub Linguist data (languages.yml, vendor.yml, documentation.yml; MIT) into the compact
// JSON the project scan uses. Development tool, run by hand when updating the pinned Linguist version:
//   node tools/linguist-import.js <dir with the three .yml files and LICENSE> <version tag>
// The parser covers exactly the YAML shapes these files use and fails loudly on anything else.
const fs = require('node:fs');
const path = require('node:path');

const KEEP = new Set(['type', 'group', 'extensions', 'filenames', 'interpreters']);

function unquote(s) {
  s = s.trim();
  if (s.startsWith('"') && s.endsWith('"')) return JSON.parse(s);
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  return s;
}

function parseLanguages(text) {
  const languages = [];
  let lang = null;
  let listKey = null;
  text.split(/\r?\n/).forEach((line, i) => {
    if (line === '' || line.startsWith('#') || line === '---') return;
    let m;
    if ((m = /^(\S.*):$/.exec(line))) {
      lang = { name: unquote(m[1]) };
      languages.push(lang);
      listKey = null;
    } else if ((m = /^ {2}([a-z_]+):\s*(.*)$/.exec(line)) && lang) {
      listKey = m[2] === '' ? m[1] : null;
      if (listKey && KEEP.has(listKey)) lang[listKey] = [];
      else if (KEEP.has(m[1])) lang[m[1]] = unquote(m[2]);
    } else if ((m = /^ {2}- (.*)$/.exec(line)) && lang && listKey) {
      if (KEEP.has(listKey)) lang[listKey].push(unquote(m[1]));
    } else {
      throw new Error(`languages.yml line ${i + 1}: unexpected shape: ${line}`);
    }
  });
  return languages;
}

function parsePatterns(text, file) {
  const out = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (line.trim() === '' || line.trim().startsWith('#')) return;
    const m = /^- (.*)$/.exec(line);
    if (!m) throw new Error(`${file} line ${i + 1}: unexpected shape: ${line}`);
    const pattern = unquote(m[1]);
    try { new RegExp(pattern); } catch { throw new Error(`${file} line ${i + 1}: not a JS regex: ${pattern}`); }
    out.push(pattern);
  });
  return out;
}

function main() {
  const [dir, version] = process.argv.slice(2);
  if (!dir || !version) throw new Error('usage: node tools/linguist-import.js <dir> <version>');
  const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
  const languages = parseLanguages(read('languages.yml'));
  const data = {
    source: 'https://github.com/github-linguist/linguist',
    version,
    license: 'MIT, Copyright (c) 2017 GitHub, Inc. See LICENSE-linguist.txt',
    languages,
    vendor: parsePatterns(read('vendor.yml'), 'vendor.yml'),
    documentation: parsePatterns(read('documentation.yml'), 'documentation.yml'),
  };
  const outDir = path.join(__dirname, '..', 'plugins', 'keel', 'data');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'linguist.json'), JSON.stringify(data) + '\n');
  fs.writeFileSync(path.join(outDir, 'LICENSE-linguist.txt'), read('LICENSE'));
  console.log(`languages: ${languages.length}, vendor: ${data.vendor.length}, documentation: ${data.documentation.length}`);
}

main();
