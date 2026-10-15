'use strict';
// Moving from another notes / memory / session-log system into .keel/.
// `find` and `refs` only read (`find` writes its full result to .keel/local/tmp/migrate.json);
// `apply` carries out a plan the user confirmed and records each done action in
// .keel/local/migrate-state.json, so an interrupted move continues instead of repeating.
// Secret files are never opened or moved: they are reported by path only.
// Usage: node migrate.js <projectDir> <command> [options]
//   find [--from <folder | plugin name>]
//                       other systems: hidden tool folders, handoffs/, NEXT-SESSION*.md, HANDOFF*.md,
//                       docs/plans/, notes rules in AI instruction files, session skills and enabled
//                       plugins; or only the folder or plugin the user named. Each system sorted into
//                       notes / memory / logs / config (moved) · project data (stays) · secrets
//   refs --folder <old folder> [--prefix <name:>]
//                       lines that use the old folder path or the old command prefix, in CLAUDE.md,
//                       AGENTS.md, CLAUDE.local.md, docs/, .gitignore files and .claude/; any other
//                       mention of the name (product, variable, service) is counted and left alone
//   apply <plan.json>   run the confirmed actions:
//                       {"source": ".old", "actions": [{"op": "move" | "append" | "trash", "from", "to"}]}
//                       targets: .keel/next-session.md, .keel/memory/, .keel/sessions/, or
//                       .keel/local/archive/ (an archive kept out of git).
//                       move: a file or a folder (a taken name gets -2); append: add the text to a
//                       file under a heading, then the original goes to the trash; trash: into
//                       .keel/local/trash/<batch>/. A source an earlier action already took counts as
//                       done. Then the moved text is checked for secrets (place and kind only)
//   state               what an earlier move did
// Exit code 0; the first output line starts with `migrate:`.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const catalog = require('../data/catalog.json');
const rules = require('../data/cleanup.json');
const { gitLists, sizeOf } = require('./lib/files.js');
const { matchesAny } = require('./lib/patterns.js');
const { secretCheck, parseArgs, readJson } = require('./lib/project.js');
const trash = require('./lib/trash.js');
const { linkOnWay, safeLocalWrite } = require('./lib/safe-path.js');

const LIMIT = 150;
const MB = 1024 * 1024;
const OUT = '.keel/local/tmp/migrate.json';
const STATE = '.keel/local/migrate-state.json';
const MAX_WALK = 50000;
const TEXT_MAX = 2 * MB;

const strip = (rel) => rel.replace(/\/$/, '');
const base = (rel) => strip(rel).split('/').pop();
const human = (b) => (b >= MB * 1024 ? `${(b / MB / 1024).toFixed(1)} GB` : b >= MB ? `${(b / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const read = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };
const lineCount = (text) => text.replace(/\r?\n$/, '').split(/\r?\n/).length;

function git(root, args) {
  try { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
}

// The old folder used as a path: at the start of a line or after a space, quote, bracket, = or :,
// optionally as ./name or /name, and followed by /, the end, a space, punctuation or a full stop.
// "app.orbit", "orbit-core", "ORBIT_KEY" and a plain word "orbit" never match ".orbit".
function folderPattern(folder) {
  return new RegExp(`(?:^|(?<=[\\s"'\`(\\[=:,]))(?:\\.\\/|\\/)?${esc(strip(folder))}(?=\\/|$|[\\s"'\`)\\],;:]|\\.(?=\\s|$))`, 'gm');
}
function prefixPattern(prefix) {
  return new RegExp(`(?:^|(?<=[\\s"'\`(\\[]))${esc(prefix)}[\\w-]*`, 'gm');
}

// Plugins switched on in the project and user settings (keel itself left out).
function enabledPlugins(root) {
  const user = process.env.KEEL_USER_SETTINGS || path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json');
  const files = [['project', path.join(root, '.claude', 'settings.json')], ['local', path.join(root, '.claude', 'settings.local.json')], ['user', user]];
  const out = [];
  for (const [scope, file] of files) {
    const s = readJson(file);
    for (const [id, on] of Object.entries((s && s.enabledPlugins) || {})) {
      if (on === true && !id.startsWith('keel@')) out.push({ id, name: id.split('@')[0], scope });
    }
  }
  return out;
}

function walk(root, dir) {
  const files = [];
  const stack = [dir];
  while (stack.length && files.length < MAX_WALK) {
    const rel = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = `${rel}/${e.name}`;
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) files.push(p);
    }
  }
  return { files: files.sort(), truncated: files.length >= MAX_WALK };
}

const NOTE = /^(next[-_ ]?session|handoff|hand-off|resume|continue)[^/]*\.md$/i;
const MEMORY = /(^|\/)memory(\/|[^/]*\.md$)|(^|\/)[^/]*memory[^/]*\.md$/i;
const LOGS = /(^|\/)(sessions?|session[-_]logs?|logs?|journal|history|handoffs)\/[^/]+\.(md|txt)$|(^|\/)[^/]*(session[-_]?log|journal)[^/]*\.(md|txt)$/i;
const CONFIG = /^[^/]*(config|settings)[^/]*\.(ya?ml|json|toml|ini)$/i;
const DOCS = /^(adr|adrs|decisions|specs?|plans?|reviews?|design|docs?|rfcs?)$/i;
const SCRIPT = /\.(py|js|mjs|cjs|ts|sh|ps1|rb|php|pl|bat|cmd)$/i;
const DATA = /\.(jsonl|csv|tsv|db|sqlite3?|parquet|log|ndjson|bin|zip|gz|tar)$/i;

// Commit ids a note mentions, with how far each is behind HEAD (the closest first).
function noteCommits(root, text) {
  const seen = new Set();
  const out = [];
  for (const [sha] of text.matchAll(/\b[0-9a-f]{7,40}\b/g)) {
    // git decides what is a commit: an id may be all digits (about 1 in 25 short ids is) or all letters.
    if (seen.has(sha)) continue;
    seen.add(sha);
    const full = git(root, ['rev-parse', '-q', '--verify', `${sha}^{commit}`]);
    if (!full) continue;
    const behind = Number(git(root, ['rev-list', '--count', `${full}..HEAD`]));
    out.push({ sha: sha.slice(0, 7), behind });
  }
  return out.sort((a, b) => a.behind - b.behind).slice(0, 3);
}

// One system folder (or a set of loose files) sorted into groups. `rels` are project-relative.
function classify(root, sysPath, rels, isSecret) {
  const g = { notes: [], memory: [], logs: [], config: [], data: [], secrets: [] };
  const inner = (rel) => (sysPath === '.' ? rel : rel.slice(sysPath.length + 1));
  const handoffFolder = /^handoffs?$/i.test(base(sysPath));
  const handoffNotes = handoffFolder ? rels.filter((r) => /\.md$/i.test(r) && !isSecret(r)) : [];
  const newestHandoff = handoffNotes.sort((a, b) => fs.statSync(path.join(root, b)).mtimeMs - fs.statSync(path.join(root, a)).mtimeMs)[0];
  const rest = new Map();
  for (const rel of rels) {
    const r = inner(rel);
    if (isSecret(rel)) { g.secrets.push(rel); continue; }
    const text = () => read(path.join(root, rel)) || '';
    if (rel === newestHandoff || (!handoffFolder && NOTE.test(base(rel)))) {
      const t = text();
      g.notes.push({ path: rel, lines: lineCount(t), commits: noteCommits(root, t) });
    } else if (handoffFolder && /\.md$/i.test(rel)) g.logs.push(rel);
    else if (MEMORY.test(r) && /\.(md|txt)$/i.test(r)) g.memory.push({ path: rel, lines: lineCount(text()) });
    else if (LOGS.test(r)) g.logs.push(rel);
    else if (!r.includes('/') && CONFIG.test(r)) g.config.push(rel);
    else {
      // Loose files group by their folder (docs/plans), files of a system folder by its top entry.
      const top = sysPath === '.' ? (r.includes('/') ? r.slice(0, r.lastIndexOf('/')) : r) : r.includes('/') ? r.slice(0, r.indexOf('/')) : r;
      rest.set(top, [...(rest.get(top) || []), rel]);
    }
  }
  for (const [top, files] of rest) {
    const p = sysPath === '.' ? top : `${sysPath}/${top}`;
    const s = sizeOf(path.join(root, p));
    const folder = files.length > 1 || files[0] !== p;
    let kind;
    let advice;
    if (s.bytes >= rules.large_dir_mb * MB || (!folder && DATA.test(top)) || (folder && files.every((f) => DATA.test(f)))) { kind = 'data'; advice = 'project data: stays where it is'; }
    else if (/^plans?$/i.test(base(top))) { kind = 'docs'; advice = 'plans: stay where they are; the current one can be pasted into the Plan of the note'; }
    else if (DOCS.test(base(top))) { kind = 'docs'; advice = 'documentation: worth keeping in docs/ (a separate task); not moved'; }
    else if (folder ? files.every((f) => SCRIPT.test(f)) : SCRIPT.test(top)) { kind = 'scripts'; advice = 'scripts: stay; /keel:cleanup can review them later'; }
    else { kind = 'unclear'; advice = 'unclear: a question for the overview (notes of the old system, or project files?)'; }
    g.data.push({ path: p + (folder ? '/' : ''), kind, files: s.files, bytes: s.bytes, advice });
  }
  return g;
}

function gitState(lists, rel) {
  if (!lists) return 'no git';
  const r = strip(rel);
  if (lists.tracked.some((t) => t === r || t.startsWith(`${r}/`))) return lists.ignored.some((i) => strip(i) === r) ? 'partly tracked' : 'tracked';
  if (lists.ignored.some((i) => strip(i) === r || r.startsWith(i))) return 'ignored';
  return 'untracked';
}

function find(root, from) {
  const { isSecret } = secretCheck(root);
  const lists = gitLists(root);
  const all = lists ? [...lists.tracked, ...lists.untracked, ...lists.ignored] : fs.readdirSync(root).map((n) => (fs.statSync(path.join(root, n)).isDirectory() ? `${n}/` : n));
  const plugins = enabledPlugins(root);
  const folders = new Set();
  let wanted = null;
  if (from) {
    const rel = strip(path.relative(root, path.resolve(root, from)).split(path.sep).join('/'));
    if (rel && !rel.startsWith('..') && fs.existsSync(path.join(root, rel)) && fs.statSync(path.join(root, rel)).isDirectory()) folders.add(rel);
    else {
      const name = String(from).replace(/^\//, '').replace(/:$/, '').split('@')[0];
      wanted = name;
      for (const d of [`.${name}`, name]) if (fs.existsSync(path.join(root, d))) folders.add(d);
    }
  } else {
    for (const rel of all) {
      const top = rel.split('/')[0];
      if (top.startsWith('.') && (rel.includes('/') || rel.endsWith('/')) && !catalog.other_systems.known_tool_dirs.includes(top)) folders.add(top);
      if (/^handoffs?$/i.test(top) && rel.includes('/')) folders.add(top);
    }
  }

  const systems = [];
  for (const dir of [...folders].sort()) {
    const { files, truncated } = walk(root, dir);
    const g = classify(root, dir, files, isSecret);
    const named = catalog.other_systems.names.some((n) => dir.toLowerCase().includes(n)) || plugins.some((p) => dir.replace(/^\./, '') === p.name);
    if (!from && !g.notes.length && !g.memory.length && !g.logs.length && !named) continue;
    const s = sizeOf(path.join(root, dir));
    systems.push({ path: dir, git: gitState(lists, dir), files: s.files, bytes: s.bytes, truncated, ...g });
  }
  if (!from) {
    // Loose notes outside a system folder: NEXT-SESSION*.md, HANDOFF*.md, docs/plans/.
    const loose = (lists ? [...lists.tracked, ...lists.untracked] : []).filter((r) => !r.endsWith('/') && !systems.some((s) => r.startsWith(`${s.path}/`)) && matchesAny(r, catalog.other_systems.files) && !/(^|\/)(node_modules|vendor)\//.test(r));
    if (loose.length) systems.push({ path: '.', git: 'mixed', files: loose.length, bytes: loose.reduce((n, r) => n + sizeOf(path.join(root, r)).bytes, 0), truncated: false, ...classify(root, '.', loose, isSecret) });
  }

  // Notes rules in AI instruction files, session skills and commands.
  const words = /handoff|hand-off|next[- ]session|session[- ]log|end[- ]session|start[- ]session|project memory|memory file|resume the/i;
  const folderRes = systems.filter((s) => s.path !== '.').map((s) => folderPattern(s.path));
  const ruleFiles = (lists ? lists.tracked.concat(lists.untracked, lists.ignored) : []).filter((r) => !r.endsWith('/') && matchesAny(r, catalog.ai_rules) && !/settings(\.local)?\.json$|\.mcp\.json$/.test(r) && !isSecret(r));
  for (const f of ['CLAUDE.local.md']) if (fs.existsSync(path.join(root, f)) && !ruleFiles.includes(f)) ruleFiles.push(f);
  const ruleLines = [];
  for (const f of ruleFiles) {
    const text = read(path.join(root, f));
    if (!text) continue;
    text.split(/\r?\n/).forEach((line, i) => {
      if (words.test(line) || folderRes.some((re) => { re.lastIndex = 0; return re.test(line); })) ruleLines.push(`${f}:${i + 1}: ${line.trim().slice(0, 140)}`);
    });
  }
  const skillish = /handoff|session|memory|resume|wrap[-_]?up|journal|notes/i;
  const skills = [];
  for (const d of ['.claude/skills', '.claude/commands']) {
    let names = [];
    try { names = fs.readdirSync(path.join(root, d)); } catch { continue; }
    for (const n of names) if (skillish.test(n)) skills.push(`${d}/${n}`);
  }

  // The old command prefix: an enabled plugin named like a system folder, or the one the user named.
  const related = plugins.filter((p) => p.name === wanted || systems.some((s) => s.path.replace(/^\./, '') === p.name));
  const state = readJson(path.join(root, STATE));
  const result = { project: root, from: from || null, systems, rules: ruleLines.slice(0, 40), skills, plugins, prefixes: [...new Set(related.map((p) => `/${p.name}:`))], state };
  safeLocalWrite(root, ['tmp', 'migrate.json'], JSON.stringify(result, null, 2) + '\n');
  return summary(result);
}

function summary(r) {
  const out = [`migrate: ${r.systems.length ? `${r.systems.length} other system${r.systems.length > 1 ? 's' : ''} found` : 'no other notes or memory system found'}; full result in ${OUT}`];
  if (r.from && !r.systems.length) out.push(`"${r.from}": no such folder in the project, and no folder named after that plugin`);
  for (const s of r.systems) {
    out.push(`system ${s.path === '.' ? '(loose files)' : `${s.path}/`}: ${s.files} files, ${human(s.bytes)}; git: ${s.git}${s.truncated ? '; only the first files listed' : ''}`);
    for (const n of s.notes) out.push(`  note: ${n.path} (${n.lines} lines${n.lines > LIMIT ? `, over ${LIMIT}: the rest goes to the archive` : ''})${n.commits.length ? `; mentions ${n.commits.map((c) => `${c.sha} (${c.behind} commits behind HEAD)`).join(', ')}` : ''}`);
    for (const m of s.memory) out.push(`  memory: ${m.path} (${m.lines} lines${m.lines > LIMIT ? `, over ${LIMIT}: the rest goes to the archive` : ''})`);
    if (s.logs.length) out.push(`  logs: ${s.logs.length} files (${s.logs.slice(0, 3).join(', ')}${s.logs.length > 3 ? ', ...' : ''}) → .keel/sessions/`);
    if (s.config.length) out.push(`  config (read for its meaning; values become proposals): ${s.config.join(', ')}`);
    for (const d of s.data) out.push(`  stays: ${d.path} - ${d.kind}, ${d.files} files, ${human(d.bytes)}; ${d.advice}`);
    if (s.secrets.length) out.push(`  secret files (never opened or moved): ${s.secrets.join(', ')}`);
  }
  if (r.rules.length) out.push(`notes rules in AI instruction files:`, ...r.rules.map((l) => `  ${l}`));
  if (r.skills.length) out.push(`session skills or commands: ${r.skills.join(', ')}`);
  if (r.plugins.length) out.push(`enabled plugins: ${r.plugins.map((p) => `${p.id} (${p.scope})`).join(', ')}`);
  if (r.prefixes.length) out.push(`old command prefix (to confirm): ${r.prefixes.join(', ')}`);
  if (r.state) {
    const done = (r.state.done || []).length;
    out.push(`earlier move: from ${(r.state.sources || []).map((s) => `${s.path} (${s.finished ? 'finished' : 'not finished'})`).join(', ')}; ${done} actions done${r.state.plan ? ` of ${r.state.total} in ${r.state.plan}` : ''}: continue it, do not start over`);
  }
  return out;
}

// Reference lines in the files the plan names: the old folder path and the old command prefix only.
function refs(root, folder, prefix) {
  if (!folder && !prefix) return ['migrate: stopped', 'reason: give --folder <old folder> and/or --prefix <name:>'];
  const { isSecret } = secretCheck(root);
  const lists = gitLists(root);
  const candidates = lists ? [...new Set([...lists.tracked, ...lists.untracked])] : [];
  const files = candidates.filter((r) => !isSecret(r) && (['CLAUDE.md', 'AGENTS.md', 'CLAUDE.local.md'].includes(r) || r.startsWith('docs/') && /\.(md|mdx|txt|rst)$/i.test(r) || base(r) === '.gitignore' || r.startsWith('.claude/')));
  for (const f of ['CLAUDE.local.md', '.claude/CLAUDE.md']) if (!files.includes(f) && fs.existsSync(path.join(root, f))) files.push(f);
  const res = [folder && folderPattern(folder), prefix && prefixPattern(prefix)].filter(Boolean);
  const name = (folder ? base(folder) : prefix).replace(/^[./]+/, '').replace(/:$/, '');
  const nameRe = new RegExp(esc(name), 'i');
  const hits = [];
  let skipped = 0;
  for (const f of files.sort()) {
    if (folder && (f === strip(folder) || f.startsWith(`${strip(folder)}/`))) continue;
    const text = read(path.join(root, f));
    if (!text || text.length > TEXT_MAX) continue;
    text.split(/\r?\n/).forEach((line, i) => {
      const found = [];
      for (const re of res) { re.lastIndex = 0; for (const m of line.matchAll(re)) found.push(m[0]); }
      if (found.length) hits.push(`${f}:${i + 1}: [${[...new Set(found)].join(', ')}] ${line.trim().slice(0, 160)}`);
      else if (nameRe.test(line)) skipped += 1;
    });
  }
  const out = [`migrate: ${hits.length} reference lines${folder ? ` to ${folder}` : ''}${prefix ? `${folder ? ' and' : ''} to ${prefix}` : ''}`];
  out.push(...hits);
  out.push(`left alone: ${skipped} lines that mention "${name}" otherwise (product, variable or service names are never changed)`);
  return out;
}

// Secrets in text keel moved: the place and the kind, never the value.
const SECRET_TEXT = [
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['API key', /\bsk-[A-Za-z0-9_-]{20,}/],
  ['connection string with a password', /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]+@/i],
  ['password or key assignment', /\b(password|passwd|secret|api[_-]?key|token)\b\s*[:=]\s*["']?[^\s"'<>]{8,}/i],
];
function secretLines(root, rels) {
  const out = [];
  for (const rel of rels) {
    const text = read(path.join(root, rel));
    if (!text || text.includes('\0')) continue;
    text.split(/\r?\n/).forEach((line, i) => {
      for (const [kind, re] of SECRET_TEXT) if (re.test(line)) { out.push(`${rel}:${i + 1} (${kind})`); break; }
    });
  }
  return out;
}

function removeEmptyDirs(dir) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) if (e.isDirectory()) removeEmptyDirs(path.join(dir, e.name));
  try { fs.rmdirSync(dir); } catch {}
}

function freeName(full) {
  if (!fs.existsSync(full)) return full;
  const ext = path.extname(full);
  for (let n = 2; ; n++) {
    const c = `${full.slice(0, full.length - ext.length)}-${n}${ext}`;
    if (!fs.existsSync(c)) return c;
  }
}

// Whether `target` already holds `body` under the heading an append of `from` writes.
function appendedBefore(target, from, body) {
  if (target === null) return false;
  const heading = new RegExp(`^## From ${esc(from)} \\(moved \\d{4}-\\d\\d-\\d\\d\\)\\n\\n`, 'gm');
  return [...target.matchAll(heading)].some((m) => target.startsWith(body, m.index + m[0].length));
}

function apply(root, planFile) {
  const plan = readJson(path.resolve(root, planFile || ''));
  if (!plan || !Array.isArray(plan.actions) || typeof plan.source !== 'string') return ['migrate: stopped', 'reason: the plan must be JSON {"source": "<old folder>", "actions": [...]}'];
  const { isSecret } = secretCheck(root);
  const statePath = path.join(root, STATE);
  const state = readJson(statePath) || { sources: [], done: [] };
  if (!state.sources.some((s) => s.path === plan.source)) state.sources.push({ path: plan.source, started: new Date().toISOString(), finished: false });
  state.plan = path.relative(root, path.resolve(root, planFile)).split(path.sep).join('/');
  state.total = plan.actions.length;
  const save = () => safeLocalWrite(root, 'migrate-state.json', JSON.stringify(state, null, 2) + '\n');
  const key = (a) => `${a.op} ${a.from} ${a.to || ''}`;
  const doneKeys = new Set(state.done.map(key));
  const inside = (rel) => typeof rel === 'string' && rel && !path.isAbsolute(rel) && !rel.split(/[\\/]/).includes('..');
  // keel's places for moved state: the note, memory, session logs, and the archive kept out of git.
  const keelTarget = (rel) => inside(rel) && (strip(rel) === '.keel/next-session.md' || ['.keel/memory/', '.keel/sessions/', '.keel/local/archive/'].some((p) => rel.startsWith(p) || `${strip(rel)}/` === p));
  // A source an earlier action already took (appended, trashed or moved, here or in a run before).
  const taken = (rel) => state.done.some((d) => strip(rel) === strip(d.from) || strip(rel).startsWith(`${strip(d.from)}/`));
  const out = [];
  const written = [];
  let errors = 0;
  let batch = null;
  const toTrash = (rel) => {
    const r = trash.moveToTrash(root, [rel], 'migration', {}, new Date(), batch);
    if (r.batch) batch = r.batch;
    return r;
  };
  // Folders an action emptied go too, up to the project root.
  const prune = (rel) => {
    for (let dir = path.dirname(path.join(root, rel)); path.relative(root, dir) && !path.relative(root, dir).startsWith('..'); dir = path.dirname(dir)) {
      try { if (fs.readdirSync(dir).length) break; fs.rmdirSync(dir); } catch { break; }
    }
  };
  save();
  for (const a of plan.actions) {
    const label = `${a.op} ${a.from}${a.to ? ` → ${a.to}` : ''}`;
    // Done before, unless the source is back (restored from the trash): then it is moved again.
    if (doneKeys.has(key(a)) && !(typeof a.from === 'string' && inside(a.from) && fs.existsSync(path.join(root, a.from)))) { out.push(`already done: ${label}`); continue; }
    const fail = (why) => { errors += 1; out.push(`refused: ${label} (${why})`); };
    if (!['move', 'append', 'trash'].includes(a.op)) { fail('unknown op'); continue; }
    const norm = inside(a.from) ? path.posix.normalize(a.from.replace(/\\/g, '/')).replace(/\/$/, '') : '';
    if (!norm || norm === '.' || norm.startsWith('../') || ['.keel', '.git'].some((d) => norm === d || norm.startsWith(`${d}/`))) { fail('the source must be a project path outside .keel/ and .git/, not the project itself'); continue; }
    if (isSecret(strip(a.from))) { fail('a secret file is never opened or moved'); continue; }
    const from = path.join(root, a.from);
    if (!fs.existsSync(from)) {
      if (taken(a.from)) {
        out.push(`already done: ${label} (an earlier action took it)`);
        state.done.push({ op: a.op, from: a.from, to: a.to, at: new Date().toISOString(), taken: true });
        save();
        continue;
      }
      fail('not there');
      continue;
    }
    if (a.op !== 'trash' && !keelTarget(a.to)) { fail('the target must be .keel/next-session.md, .keel/memory/, .keel/sessions/ or .keel/local/archive/'); continue; }
    try {
      if (a.op === 'move') {
        const st = fs.statSync(from);
        const listed = st.isDirectory() ? walk(root, strip(a.from)) : null;
        if (listed && listed.truncated) { fail(`more than ${MAX_WALK} files; move it by hand`); continue; }
        // A file moved to a folder (`to` ends with /) keeps its name.
        // keel's folders count as folders also without the slash (`.keel/memory`), never as a file name.
        const toFolder = a.to.endsWith('/') || ['.keel/memory', '.keel/sessions', '.keel/local/archive'].includes(strip(a.to));
        const fileTo = toFolder ? `${strip(a.to)}/${path.posix.basename(strip(a.from))}` : strip(a.to);
        const pairs = listed ? listed.files.map((f) => [f, `${strip(a.to)}/${f.slice(strip(a.from).length + 1)}`]) : [[strip(a.from), fileTo]];
        const secret = pairs.filter(([f]) => isSecret(f));
        const linked = pairs.map(([, t]) => linkOnWay(root, path.join(root, t))).find(Boolean);
        if (linked) { fail(linked); continue; }
        for (const [f, t] of pairs) {
          if (isSecret(f)) continue;
          const target = freeName(path.join(root, t));
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.renameSync(path.join(root, f), target);
          written.push(path.relative(root, target).split(path.sep).join('/'));
        }
        if (secret.length) out.push(`left in place (secret): ${secret.map(([f]) => f).join(', ')}`);
        // Only folders left empty go: anything walk does not move (links, special files) keeps its folder.
        if (st.isDirectory() && !secret.length) removeEmptyDirs(from);
        out.push(`done: ${label} (${pairs.length - secret.length} files)`);
      } else if (a.op === 'append') {
        const target = path.join(root, a.to);
        const linked = linkOnWay(root, target);
        if (linked) { fail(linked); continue; }
        const body = fs.readFileSync(from, 'utf8').replace(/\s*$/, '\n');
        // A run that stopped after the append (the trash step failed) already added the text: once is enough.
        if (!appendedBefore(read(target), a.from, body)) {
          fs.mkdirSync(path.dirname(target), { recursive: true });
          const head = fs.existsSync(target) ? '\n' : '';
          fs.appendFileSync(target, `${head}## From ${a.from} (moved ${new Date().toISOString().slice(0, 10)})\n\n${body}`);
        }
        written.push(strip(a.to));
        const r = toTrash(strip(a.from));
        if (!r.batch) { fail(r.failed[0] ? r.failed[0].reason : 'could not move the original to the trash'); continue; }
        out.push(`done: ${label} (original in .keel/local/trash/${r.batch}/)`);
      } else {
        const inner = fs.statSync(from).isDirectory() ? walk(root, strip(a.from)) : null;
        const innerSecret = inner ? inner.files.filter((f) => isSecret(f)) : [];
        if (inner && inner.truncated) { fail(`more than ${MAX_WALK} files; trash it by hand`); continue; }
        if (innerSecret.length) { fail(`the folder holds secret files, which are never moved: ${innerSecret.join(', ')}; trash the other files one by one`); continue; }
        const r = toTrash(strip(a.from));
        if (!r.batch) { fail(r.failed[0] ? r.failed[0].reason : 'could not move'); continue; }
        out.push(`done: ${label} (.keel/local/trash/${r.batch}/)`);
      }
      prune(strip(a.from));
      state.done.push({ op: a.op, from: a.from, to: a.to, at: new Date().toISOString() });
      save();
    } catch (e) {
      fail(e.code || e.message);
      save();
    }
  }
  const src = state.sources.find((s) => s.path === plan.source);
  src.finished = errors === 0;
  // Every run's moved files, so `state` can repeat the secrets warning later.
  state.written = [...new Set([...(Array.isArray(state.written) ? state.written : []), ...written])];
  save();
  const secrets = secretLines(root, written);
  return [
    `migrate: ${errors ? 'stopped' : 'ok'}; ${out.filter((l) => l.startsWith('done:')).length} done, ${out.filter((l) => l.startsWith('already done:')).length} already done, ${errors} refused or failed`,
    ...out,
    secrets.length ? secretsWarning(secrets) : 'secrets in moved text: none found',
    `state: ${STATE}`,
  ];
}

const secretsWarning = (secrets) => `possible secrets in moved text (values not shown): ${secrets.join(', ')}`;

function stateCmd(root) {
  const s = readJson(path.join(root, STATE));
  if (!s) return ['migrate: no earlier move'];
  const written = (Array.isArray(s.written) ? s.written : []).filter((r) => typeof r === 'string' && r.startsWith('.keel/') && !r.split('/').includes('..'));
  const secrets = secretLines(root, written);
  return [`migrate: earlier move from ${s.sources.map((x) => `${x.path} (${x.finished ? 'finished' : 'not finished'}, started ${x.started.slice(0, 10)})`).join(', ')}`, `actions done: ${s.done.length}${s.total ? ` of ${s.total} in ${s.plan}` : ''}`,
    ...(secrets.length ? [secretsWarning(secrets)] : [])];
}

if (require.main === module) {
  let lines;
  try {
    const { opts, pos } = parseArgs(process.argv.slice(2));
    const root = path.resolve(pos[0] || process.env.CLAUDE_PROJECT_DIR || process.cwd());
    const command = pos[1] || 'find';
    if (command === 'find') lines = find(root, typeof opts.from === 'string' ? opts.from : null);
    else if (command === 'refs') lines = refs(root, typeof opts.folder === 'string' ? opts.folder : null, typeof opts.prefix === 'string' ? `/${opts.prefix.replace(/^\/+/, '')}` : null);
    else if (command === 'apply') lines = apply(root, pos[2]);
    else if (command === 'state') lines = stateCmd(root);
    else lines = [`migrate: unknown command "${command}" (find, refs, apply, state)`];
  } catch (e) {
    lines = [`migrate: unavailable (${e.message})`];
  }
  process.stdout.write(lines.join('\n') + '\n');
  process.exit(0);
}

module.exports = { find, refs, apply, folderPattern, prefixPattern };
