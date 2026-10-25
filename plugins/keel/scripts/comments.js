'use strict';
// Measures the comments in the lines a change added, against the project's comment level
// (.keel/config.json comments.level, "short" when unset): the share of comment lines, comment blocks
// longer than the level allows, literals a reader would have to look up that have no comment, and ids
// in new comment and doc lines that point at something a project may delete (tickets, records, commits).
// The results are notes for the author, not a gate: a long block that explains tricky code stays,
// with one line in the report saying why. Directives for tools (eslint-disable, noqa,
// @ts-expect-error...) do not count as comments. Only reads (git and the changed files; never secret files).
// Usage: node comments.js <projectDir> [--base <ref>] [--skip <path>]... [--json]
//        node comments.js <projectDir> --project   (configure: the comment share of the code as it is
//                                                   and the ticket prefixes seen in git history)
//   --base  measure a branch's whole work: lines added since the merge base with <ref> (default: HEAD)
//   --skip  an untracked file the user said is not part of the task (repeatable)
const fs = require('node:fs');
const path = require('node:path');
const { git, collectChanges, untrackedRecord } = require('./lib/diff.js');
const { parseArgs, secretCheck } = require('./lib/project.js');
const { matchesAny } = require('./lib/patterns.js');
const { listFiles } = require('./lib/files.js');
const { isVendored } = require('./lib/languages.js');
const catalog = require('../data/catalog.json');
const limits = require('../data/comments.json');
const { projectLevel } = require('../hooks/comment-rules.js');
const { readJsonFile } = require('./lib/json.js');
const { planningFiles } = require('./lib/planning.js');

const MAX_READ = 1024 * 1024;
// Comment syntax per extension. data/change-signals.json lists only line markers; measuring needs block
// comments and docstrings too.
const SLASH = { line: ['//'], block: ['/*', '*/'] };
const HASH = { line: ['#'] };
const SYNTAX = {
  js: SLASH, mjs: SLASH, cjs: SLASH, jsx: SLASH, ts: SLASH, tsx: SLASH, java: SLASH, kt: SLASH, kts: SLASH,
  scala: SLASH, groovy: SLASH, go: SLASH, rs: SLASH, swift: SLASH, c: SLASH, h: SLASH, cc: SLASH, cpp: SLASH,
  hpp: SLASH, cs: SLASH, dart: SLASH, vue: SLASH, svelte: SLASH,
  php: { line: ['//', '#'], block: ['/*', '*/'] },
  py: { ...HASH, docstring: true }, rb: HASH, sh: HASH, bash: HASH, pl: HASH, r: HASH, ex: HASH, exs: HASH,
  sql: { line: ['--'], block: ['/*', '*/'] }, lua: { line: ['--'] }, hs: { line: ['--'] },
};
const DOC_PATH = /\.(md|mdx|markdown|rst|adoc)$/i;
const TEST_PATH = /(^|\/)(tests?|spec|__tests__|fixtures?)\/|[._-](test|spec)\.[a-z]+$|(^|\/)test_[^/]+\.py$/i;

function syntaxOf(rel) {
  return SYNTAX[path.extname(rel).slice(1).toLowerCase()] || null;
}

// Added line numbers (1-based) per changed file, untracked files whole. The change is the one step 1 of
// verification looks at (lib/diff.js): the same base, the task-start record and --skip leave the same files
// out, planning's files are not the change, and secret files are never listed. Throws when git cannot give
// the change.
function addedLines(root, { base, isSecret, skip }) {
  const planning = planningFiles(root);
  const change = collectChanges(root, { base, isSecret, before: untrackedRecord(root), skip, ignore: (p) => Boolean(planning(p)) });
  const result = new Map();
  for (const f of change.files) if (!f.secret && !f.binary) result.set(f.path, f.untracked ? 'all' : new Set(f.addedAt));
  return result;
}

const stripStrings = (text) => text.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');

// Kind of every line: 'code', 'comment' (incl. doc comments and docstrings) or 'blank'; and the
// trailing comment of a code line, if any.
function classify(lines, syntax) {
  const kinds = [];
  const trailing = [];
  let open = null;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    trailing.push(false);
    if (open) {
      kinds.push('comment');
      if (t.includes(open)) open = null;
      continue;
    }
    if (!t) { kinds.push('blank'); continue; }
    if (syntax.line.some((p) => t.startsWith(p)) && !t.startsWith('#[') && !t.startsWith('#!')) { kinds.push('comment'); continue; }
    if (syntax.block && t.startsWith(syntax.block[0])) {
      kinds.push('comment');
      if (!t.slice(syntax.block[0].length).includes(syntax.block[1])) open = syntax.block[1];
      continue;
    }
    if (syntax.docstring) {
      const m = /^[rRbBuU]?("""|''')/.exec(t);
      const prev = lines.slice(0, i).reverse().find((l) => l.trim());
      // a docstring: first in the file, or right after a line that opens a block (def, class)
      if (m && (!prev || /:\s*(#.*)?$/.test(prev.trim()))) {
        kinds.push('comment');
        if (!t.slice(t.indexOf(m[1]) + 3).includes(m[1])) open = m[1];
        continue;
      }
    }
    kinds.push('code');
    const code = stripStrings(lines[i]);
    trailing[i] = syntax.line.some((p) => new RegExp(`\\s${p.replace(/[/*]/g, '\\$&')}`).test(code)) ||
      (!!syntax.block && code.includes(` ${syntax.block[0]}`));
  }
  return { kinds, trailing };
}

function commentsConfig(root) {
  try { return readJsonFile(path.join(root, '.keel', 'config.json')).comments || {}; } catch { return {}; }
}

// Commit hashes: 7-40 lowercase hex with a digit and a letter, not part of a word, a #colour or a dashed id.
const COMMIT_HASH = /(?<![\w#-])[0-9a-f]{7,40}(?![\w-])/g;
const ADR = /\bADR[- ]?\d+\b/g;
const MD_LINK = /\[[^\]]*\]\([^)]*\)/g;

// Ids that point at something a project may delete or rename: ticket and record ids with the project's
// prefixes (ABC-12, ABC-A-12), decision records when the project forbids them, and commit hashes.
function refFinder(cfg) {
  const prefixes = (cfg.ticket_prefixes || []).filter((p) => /^[A-Z][A-Z0-9]*$/.test(p));
  const ticket = prefixes.length ? new RegExp(`(?<![\\w-])(?:${prefixes.join('|')})(?:-[A-Z])?-\\d+(?!\\w)`, 'g') : null;
  const exempt = [...limits.refs_exempt, ...(cfg.refs_exempt || [])];
  return {
    exempt: (rel) => matchesAny(rel, exempt),
    find(text, doc) {
      const found = ticket ? [...(text.match(ticket) || [])] : [];
      // a doc may link a decision record: the link is a lasting pointer, a bare mention is not
      if (cfg.adr_refs === 'forbidden') found.push(...((doc ? text.replace(MD_LINK, '') : text).match(ADR) || []));
      for (const [h] of text.matchAll(COMMIT_HASH)) if (/\d/.test(h) && /[a-f]/.test(h)) found.push(h);
      return [...new Set(found)];
    },
  };
}

const isDelimiter = (t) => /^(\/\*\*?|\*\/|\*|"""|''')$/.test(t);
const DIRECTIVE = /(eslint|prettier|stylelint|tslint|jshint|istanbul|c8|v8)[- ](disable|enable|ignore)|@ts-(ignore|expect-error|nocheck|check)|\bnoqa\b|type:\s*ignore|pylint:|mypy:|pyright:|fmt:\s*(off|on|skip)|isort:|phpcs:|@phpstan-|@psalm-|@codeCoverageIgnore|NOSONAR|nolint|#(end)?region|SPDX-License-Identifier|@license|@generated|go:(build|generate|embed)|swiftlint:|rubocop:|@formatter:/i;

// Numbers a reader would have to look up: hex values and bit masks, decimals with a fraction, and
// integers of 3+ significant digits that are not round. Small and round numbers are left alone.
function lookupLiterals(code) {
  const found = [];
  const re = /(?<![\w.])(0[xX][0-9a-fA-F_]+|\d[\d_]*\.\d[\d_]*|\d[\d_]*)(?![\w.])/g;
  for (const m of code.matchAll(re)) {
    const raw = m[1];
    const v = raw.replace(/_/g, '');
    if (/^0x/i.test(v)) { if (parseInt(v, 16) > 9) found.push(raw); continue; }
    if (v.includes('.')) { if (!/^\d+\.(0+|5|25|75)$/.test(v)) found.push(raw); continue; }
    const n = Number(v);
    const digits = v.replace(/0+$/, '');
    if (digits.length >= 3 && !Number.isInteger(Math.log2(n))) found.push(raw); // powers of two (1024, 4096) read as sizes
  }
  return found;
}

function inspect(rel, text, added, level, refs = null) {
  const syntax = syntaxOf(rel);
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const { kinds, trailing } = classify(lines, syntax);
  const isAdded = (i) => added === 'all' || added.has(i + 1);
  const lim = limits.levels[level];
  // a comment line for people: not a delimiter, not a directive for a tool
  const human = (i) => (kinds[i] === 'comment' ? !isDelimiter(lines[i].trim()) : trailing[i]) && !DIRECTIVE.test(lines[i]);
  let newLines = 0;
  let newComments = 0;
  const notes = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isAdded(i) || !lines[i].trim()) continue;
    newLines++;
    if (human(i)) newComments++;
  }
  // comment blocks that the change added to or wrote
  const firstBlock = kinds.findIndex((k, n) => k === 'comment' || (k === 'code' && !/^(['"]use strict['"];?|<\?php|#!.*)$/.test(lines[n].trim())));
  for (let i = 0; i < lines.length; i++) {
    if (kinds[i] !== 'comment' || (i > 0 && kinds[i - 1] === 'comment')) continue;
    let j = i;
    while (j + 1 < lines.length && kinds[j + 1] === 'comment') j++;
    let size = 0;
    let touched = false;
    for (let k = i; k <= j; k++) {
      if (human(k)) size++;
      if (isAdded(k) && human(k)) touched = true;
    }
    // the file header: the first comment block, with nothing but a directive ('use strict', <?php) before it
    const header = i === firstBlock;
    if (touched && !header && size > lim.block_lines) {
      notes.push({ kind: 'long-block', file: rel, line: i + 1, lines: size, limit: lim.block_lines });
    }
    i = j;
  }
  if (refs) {
    const markers = [...syntax.line, ...(syntax.block ? [syntax.block[0]] : [])].map((p) => p.replace(/[/*]/g, '\\$&')).join('|');
    const trailingAt = new RegExp(`\\s(?:${markers})`);
    for (let i = 0; i < lines.length; i++) {
      if (!isAdded(i) || !human(i)) continue;
      // a trailing comment: only the text after its marker, strings blanked so code is not read as comment
      const code = stripStrings(lines[i]);
      const text = kinds[i] === 'comment' ? lines[i] : code.slice(Math.max(0, code.search(trailingAt)));
      const found = refs.find(text, false);
      if (found.length) notes.push({ kind: 'ref', file: rel, line: i + 1, refs: found });
    }
  }
  if (!TEST_PATH.test(rel)) {
    for (let i = 0; i < lines.length; i++) {
      if (!isAdded(i) || kinds[i] !== 'code' || trailing[i]) continue;
      if (i > 0 && kinds[i - 1] === 'comment') continue;
      const literals = lookupLiterals(stripStrings(lines[i]));
      if (literals.length) notes.push({ kind: 'literal', file: rel, line: i + 1, literals });
    }
  }
  return { file: rel, new_lines: newLines, new_comment_lines: newComments, notes };
}

// Ids in the added lines of a doc. Fenced code blocks are skipped: they show commands and their
// output, where hashes and ids are the example itself.
function inspectDoc(rel, text, added, refs) {
  const notes = [];
  let fence = null;
  text.replace(/\r\n/g, '\n').split('\n').forEach((line, i) => {
    const f = /^\s*(```|~~~)/.exec(line);
    if (f) { fence = fence === f[1] ? null : fence || f[1]; return; }
    if (fence || (added !== 'all' && !added.has(i + 1))) return;
    const found = refs.find(line, true);
    if (found.length) notes.push({ kind: 'ref', file: rel, line: i + 1, refs: found });
  });
  return notes;
}

function run(root, opts) {
  const level = projectLevel(root);
  const lim = limits.levels[level];
  const { isSecret } = secretCheck(root);
  const refs = refFinder(commentsConfig(root));
  const files = [];
  const docNotes = [];
  for (const [rel, added] of addedLines(root, { base: typeof opts.base === 'string' ? opts.base : null, isSecret, skip: opts.skip || [] })) {
    const doc = DOC_PATH.test(rel);
    if ((!doc && !syntaxOf(rel)) || isSecret(rel) || (doc && refs.exempt(rel))) continue;
    const full = path.join(root, rel);
    let text;
    try {
      if (fs.statSync(full).size > MAX_READ) continue;
      text = fs.readFileSync(full, 'utf8');
    } catch { continue; }
    if (text.includes('\0')) continue;
    if (doc) docNotes.push(...inspectDoc(rel, text, added, refs));
    else files.push(inspect(rel, text, added, level, refs.exempt(rel) ? null : refs));
  }
  const newLines = files.reduce((s, f) => s + f.new_lines, 0);
  const newComments = files.reduce((s, f) => s + f.new_comment_lines, 0);
  const share = newLines ? newComments / newLines : 0;
  const notes = [...files.flatMap((f) => f.notes), ...docNotes];
  if (newLines >= limits.min_lines_for_share && share > lim.share) {
    notes.unshift({ kind: 'share', share: Math.round(share * 100), limit: Math.round(lim.share * 100) });
  }
  return { level, new_lines: newLines, new_comment_lines: newComments, share: Math.round(share * 100), notes };
}

// configure's hint: the share of comment lines in the project's own source files now (vendored,
// generated and test files left out), and the level whose usual share is closest.
function measureProject(root) {
  const { isSecret } = secretCheck(root);
  let lines = 0;
  let comments = 0;
  let files = 0;
  for (const rel of listFiles(root, catalog.skip_dirs).files) {
    const syntax = syntaxOf(rel);
    if (!syntax || isSecret(rel) || isVendored(rel) || TEST_PATH.test(rel)) continue;
    let text;
    try {
      if (fs.statSync(path.join(root, rel)).size > MAX_READ) continue;
      text = fs.readFileSync(path.join(root, rel), 'utf8');
    } catch { continue; }
    if (text.includes('\0')) continue;
    const all = text.replace(/\r\n/g, '\n').split('\n');
    const { kinds, trailing } = classify(all, syntax);
    files++;
    for (let i = 0; i < all.length; i++) {
      if (!all[i].trim()) continue;
      lines++;
      if (kinds[i] === 'comment' ? !isDelimiter(all[i].trim()) : trailing[i]) comments++;
    }
  }
  const share = lines ? comments / lines : 0;
  const hint = limits.project_hint.find((h) => share <= h.up_to) || limits.project_hint[limits.project_hint.length - 1];
  return { files, lines, comment_lines: comments, share: Math.round(share * 100), suggested_level: hint.level };
}

// Ticket-like ids in commit subjects and branch names, for configure to propose comments.ticket_prefixes.
// Standards and encodings shaped like ids (UTF-8, SHA-256, RFC-9110) are not tickets; ADR has its own setting.
const NOT_TICKETS = new Set(['UTF', 'UCS', 'ISO', 'IEC', 'SHA', 'MD', 'AES', 'RSA', 'RFC', 'CVE', 'CWE', 'GHSA', 'HTTP', 'TLS', 'SSL', 'IPV', 'ES', 'ECMA', 'PEP', 'WCAG', 'UTC', 'GMT', 'BASE', 'ADR']);
function ticketPrefixesSeen(root) {
  const text = [git(root, ['log', '-n', '5000', '--format=%s']), git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes'])].join('\n');
  const ids = new Map();
  for (const m of text.matchAll(/(?<![\w-])([A-Z][A-Z0-9]{1,9})(?:-[A-Z])?-\d+(?!\w)/g)) {
    if (NOT_TICKETS.has(m[1])) continue;
    if (!ids.has(m[1])) ids.set(m[1], new Set());
    ids.get(m[1]).add(m[0]);
  }
  return [...ids].filter(([, seen]) => seen.size >= 2).sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0])).map(([prefix, seen]) => ({ prefix, ids: seen.size }));
}

function report(r) {
  const head = `comments: level ${r.level}; ${r.new_comment_lines} of ${r.new_lines} new lines are comments (${r.share} %)`;
  if (!r.notes.length) return `${head}; ok`;
  const out = [`${head}; ${r.notes.length} note(s):`];
  for (const n of r.notes) {
    if (n.kind === 'share') out.push(`- ${n.share} % of the new lines are comments; level ${r.level} allows ${n.limit} %. Shorten comments on plain code.`);
    if (n.kind === 'long-block') out.push(`- ${n.file}:${n.line}: a comment of ${n.lines} lines (level ${r.level}: ${n.limit}). Keep it only if it explains tricky code (formula, hidden behaviour, legacy, looks wrong but is right) and say so in one line of the report; otherwise shorten it.`);
    if (n.kind === 'ref') out.push(`- ${n.file}:${n.line}: ${n.refs.join(', ')} points at a ticket, record or commit that may be deleted or renamed. Write the reason in plain words, or drop the comment if the code already says it. Fix it; do not keep it.`);
    if (n.kind === 'literal') out.push(`- ${n.file}:${n.line}: ${n.literals.join(', ')} has no comment. Say what it is and where it comes from, or build it from named parts.`);
  }
  return out.join('\n');
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const { opts, pos } = parseArgs(argv);
  opts.skip = argv.flatMap((a, i) => (a === '--skip' && argv[i + 1] && !argv[i + 1].startsWith('--') ? [argv[i + 1]] : []));
  const root = path.resolve(pos[0] || '.');
  try {
    if (opts.project) {
      const m = measureProject(root);
      process.stdout.write(`comments in the project now: ${m.comment_lines} of ${m.lines} lines in ${m.files} source files (${m.share} %); closest level: ${m.suggested_level}\n`);
      const seen = ticketPrefixesSeen(root);
      process.stdout.write(`ticket prefixes in git history: ${seen.length ? seen.map((t) => `${t.prefix} (${t.ids} ids)`).join(', ') : 'none'}\n`);
    } else {
      const r = run(root, opts);
      process.stdout.write(opts.json ? `${JSON.stringify(r, null, 2)}\n` : `${report(r)}\n`);
    }
  } catch (e) {
    process.stdout.write(`comments: not measured (${e.message})\n`);
  }
}

module.exports = { run, report, inspect, inspectDoc, refFinder, classify, lookupLiterals, measureProject, ticketPrefixesSeen };
