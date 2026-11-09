'use strict';
// plans.js check and stale: the structure check of a draft and of one ticket (also for exported tickets,
// lib/plans-export.js, and feature-page.js), and which files the tickets name changed since the plan
// was made.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { git, read, clean } = require('./repo-read.js');
const { sections } = require('./tasks.js');
const { ticketStructure, planStructure, isStub } = require('./plans-format.js');
const { settings, PREFIX } = require('./plans-settings.js');
const { PLAN_FILE, needDraft, exportedHere, settle, tickets, ticketIds } = require('./plans-drafts.js');

// Files a ticket names in "Where to look" without a folder or a line count only with a known extension:
// `obj.id` or `fs.readFileSync` are code, not files.
const FILE_EXT = new Set(['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'go', 'rs', 'java', 'kt', 'rb', 'php', 'cs', 'c', 'h', 'cpp', 'hpp', 'swift', 'dart', 'ex', 'exs', 'scala', 'md', 'json', 'yml', 'yaml', 'toml', 'xml', 'sql', 'sh', 'ps1', 'html', 'css', 'scss', 'vue', 'svelte', 'txt', 'ini', 'cfg', 'gradle', 'lock', 'proto', 'graphql']);

const refuse = (what, why) => [`plans: ${what} refused (${why})`];
const rel = (root, file) => path.relative(root, file).split(path.sep).join('/');
const lf = (text) => String(text).replace(/\r\n/g, '\n');
const given = (v) => typeof v === 'string' && v.trim() !== '' && v.trim() !== '-';

const neighbours = () => require('./plans-neighbours.js');
const repos = () => require('./plans-repos.js');
// Another repository's keys among a draft's dependencies (lib/plans-neighbours.js).
const otherRepos = (root, deps) => neighbours().lookUp(root, deps);

// --- the structure check ---

// The text a placeholder search reads: no code blocks (also indented ones, as in a list item), no
// inline code, no links in angle brackets.
const prose = (text) => lf(text).replace(/^[ \t]*```[\s\S]*?^[ \t]*```/gm, (m) => m.replace(/[^\n]/g, ' ')).replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length)).replace(/<https?:[^>\s]*>/g, (m) => ' '.repeat(m.length));

// "TBD" or "<...>" left in the text after the front matter, with its line. Comparisons are not
// placeholders: a "<" followed by a space or "=" ("< 30 s", "x <= 3"), a "<...>" across table cells
// ("| <30 s | >1 min |") and one closed by a ">" right before a digit or "=" ("<30 s, then >1 min").
function placeholders(text) {
  const all = lf(text);
  const fmEnd = /^---\n[\s\S]*?\n---\n?/.exec(all);
  const skip = fmEnd ? fmEnd[0].split('\n').length - 1 : 0;
  const out = [];
  prose(all).split('\n').forEach((line, i) => {
    if (i < skip) return;
    const m = /\bTBD\b/.exec(line) || /<(?![\s=])[^<>|\n]*>(?![\d=])/.exec(line);
    if (m) out.push(`${clean(m[0], 40)} (line ${i + 1})`);
  });
  return out;
}

// A path of this machine: a drive (C:\ or C:/, also in file:///C:/), a UNC share, a home folder of
// Linux or macOS (/home/<user>, /root, /Users/<user>), a Windows drive in WSL (/mnt/c/), or one of
// `folders`. Not a path: http://x, src/home/a.js, ~/.claude (no letter, word or dot before it).
const LOCAL_PATH = /(?<![A-Za-z0-9])[A-Za-z]:[\\/]|(?<![\w\\])\\\\[\w.$-]+\\|(?<![\w.~/-])\/(?:home\/[^/\s]|Users\/[^/\s]|root(?![\w.-])|mnt\/[a-z]\/)/g;
const PATH_END = /^[^\s`'"<>()[\]{}|,;]+/;

// The folders of this machine a feature file must not name: the project, the neighbouring
// repositories of the repos map and the home folder (a project in /srv or /opt matches no pattern).
function machineFolders(root) {
  const all = [root, ...Object.values(settings(root).repos || {}), os.homedir()];
  return [...new Set(all.filter((f) => typeof f === 'string').map((f) => f.replace(/\\/g, '/').replace(/\/+$/, '')).filter((f) => f.length > 3))];
}

// Every path of this machine in `text`, with its line: "C:\Users\ann\a.js (line 4)".
function localPaths(text, folders = []) {
  const win = process.platform === 'win32';
  const out = [];
  lf(text).split('\n').forEach((line, i) => {
    const slashed = line.replace(/\\/g, '/');
    const look = win ? slashed.toLowerCase() : slashed;
    const starts = [...line.matchAll(LOCAL_PATH)].map((m) => m.index);
    for (const f of folders) {
      const want = win ? f.toLowerCase() : f;
      for (let j = look.indexOf(want); j >= 0; j = look.indexOf(want, j + 1)) starts.push(j);
    }
    let end = -1;
    for (const at of [...new Set(starts)].sort((a, b) => a - b)) {
      if (at < end) continue;
      const p = PATH_END.exec(line.slice(at))[0].replace(/[.:]+$/, '');
      end = at + p.length;
      out.push(`${clean(p, 200)} (line ${i + 1})`);
    }
  });
  return out;
}

// The paths of this machine in a feature's files, one problem each.
const localProblems = (label, text, folders) => localPaths(text, folders).map((p) => `${label}: local path ${p}`);

// The research reports of a feature folder (research/*.md), each as { name, text }.
function researchTexts(folder) {
  const dir = path.join(folder, 'research');
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && /\.md$/i.test(e.name)).map((e) => e.name).sort(); } catch { /* none */ }
  return names.map((name) => ({ name: `research/${name}`, text: read(path.join(dir, name)) || '' }));
}

// The files "Where to look" names: inline code or a bare path:line, without the line part.
function mentionedFiles(text) {
  const found = new Set();
  const add = (raw) => {
    const p = raw.trim().replace(/#L\d+.*$/, '').replace(/:\d+(?:[-:]\d+)?$/, '');
    if (!p || /[\s*?(){}<>]/.test(p) || /^[a-z]+:\/\//i.test(p)) return;
    const ext = /\.([A-Za-z0-9]+)$/.exec(p);
    if (p.includes('/') || /:\d+/.test(raw) || (ext && FILE_EXT.has(ext[1].toLowerCase()))) found.add(p.replace(/^\.\//, ''));
  };
  for (const m of text.matchAll(/`([^`\n]+)`/g)) add(m[1]);
  for (const m of text.replace(/`[^`\n]*`/g, ' ').matchAll(/(?:^|[\s(])([\w./-]+\.[A-Za-z0-9]+:\d+)/gm)) add(m[1]);
  return [...found];
}

// Dependency cycles, each as T1 -> T2 -> T1.
function cycles(list) {
  const deps = new Map(list.map((t) => [t.id, ticketIds(t.fm.depends_on).filter((x) => x !== t.id)]));
  const out = [];
  const seen = new Set();
  const visit = (id, stack) => {
    if (stack.includes(id)) { out.push([...stack.slice(stack.indexOf(id)), id].join(' -> ')); return; }
    if (seen.has(id) || !deps.has(id)) return;
    seen.add(id);
    for (const next of deps.get(id)) visit(next, [...stack, id]);
  };
  for (const t of list) visit(t.id, []);
  return out;
}

// One ticket's text, a draft's or an exported one: its structure (lib/plans-format.js), no placeholders,
// the files Where to look names exist in `filesRoot` (another repository's folder for its ticket; null:
// not looked for).
function ticketProblems(root, label, text, filesRoot = root) {
  const out = ticketStructure(label, text);
  const secs = sections(text);
  for (const p of placeholders(text)) out.push(`${label}: placeholder ${p}`);
  out.push(...localProblems(label, text, machineFolders(root)));
  if (filesRoot === null) return out;
  const own = filesRoot === root;
  for (const f of mentionedFiles(secs['Where to look'] || '')) {
    const outside = path.isAbsolute(f) || path.win32.isAbsolute(f) || f.split('/').includes('..');
    if (outside) out.push(`${label}: ${clean(f)} in Where to look is outside ${own ? 'the project' : clean(filesRoot, 200)}`);
    else if (!fs.existsSync(path.join(filesRoot, f))) out.push(`${label}: ${clean(f)} in Where to look does not exist${own ? '' : ` in ${clean(filesRoot, 200)}`}`);
  }
  return out;
}

function problems(root, d) {
  const out = planStructure(d.text);
  for (const p of placeholders(d.text)) out.push(`plan.md: placeholder ${p}`);
  const folders = machineFolders(root);
  out.push(...localProblems(PLAN_FILE, d.text, folders));
  for (const r of researchTexts(d.folder)) out.push(...localProblems(r.name, r.text, folders));
  const s = settings(root);
  out.push(...repos().planReposProblems(d.fm, s.ticket_prefix));
  const planned = repos().planRepos(d.fm);
  const list = tickets(d);
  const ids = new Set(list.map((t) => t.id));
  const other = otherRepos(root, list.flatMap((t) => ticketIds(t.fm.depends_on)).filter((x) => !ids.has(x)));
  const notes = [];
  for (const t of list) {
    if (t.fm.id !== t.id) out.push(`${t.id}: front matter id is "${clean(t.fm.id || '')}", the file name says ${t.id}`);
    if (isStub(t.fm)) {
      // A stub's repository is not on this machine: never in the plan's repos, no Where to look to check.
      const r = given(t.fm.repo) ? t.fm.repo.trim().toUpperCase() : '';
      if (!PREFIX.test(r) || r === s.ticket_prefix) out.push(`${t.id}: a stub's repo "${clean(r, 20)}" is not another repository's ticket prefix`);
      else if (s.repos[r] && repos().isFolder(s.repos[r])) notes.push(require('./plans-stubs.js').offerNote(d.feature, t.id, r));
      out.push(...ticketProblems(root, t.id, t.text, null));
    } else {
      const target = repos().targetOf(root, t, s);
      if (target.bad) out.push(`${t.id}: repo "${clean(target.prefix, 20)}" is not a ticket prefix`);
      else if (!target.own && !planned.includes(target.prefix)) out.push(`${t.id}: repo ${target.prefix} is not in the plan's repos`);
      if (!target.own && !target.bad && !target.folder) notes.push(`note: ${t.id}: Where to look not checked (${clean(target.why, 200)})`);
      out.push(...ticketProblems(root, t.id, t.text, target.own ? root : target.folder));
    }
    for (const dep of ticketIds(t.fm.depends_on)) {
      const k = dep.toUpperCase();
      if (dep === t.id) out.push(`${t.id}: depends on itself`);
      else if (ids.has(dep)) continue;
      else if (!other.foreign(dep)) out.push(`${t.id}: depends on ${clean(dep)}, which does not exist`);
      else if (other.missing.has(k)) out.push(`${t.id}: depends on ${clean(dep)}, which does not exist ${other.missing.get(k)}`);
      else if (other.notes.has(k)) notes.push(neighbours().noteLine(t.id, dep, other.notes.get(k)));
    }
  }
  for (const c of cycles(list)) out.push(`dependency cycle: ${c}`);
  return { out, count: list.length, notes };
}

// A draft: plan.md and its tickets. An exported feature: its tickets, whose depends_on are keys.
function draftCheck(root, feature) {
  const { d: found, why } = needDraft(root, feature, 'check');
  const ex = exportedHere(root, feature, found);
  if (ex) {
    const { out, count, notes } = require('./plans-export.js').exportedProblems(root, ex);
    if (!out.length) return [`check: clean (${count} tickets in ${rel(root, ex.folder)}/)`, ...notes];
    return [`check: ${out.length} problems`, ...out.map((p) => `- ${p}`), ...notes];
  }
  if (!found) return why;
  let d;
  try { d = settle(root, found); } catch (e) { return refuse('check', e.message); }
  const { out, count, notes } = problems(root, d);
  const back = d !== found ? ['status: draft (the plan changed after ready)'] : [];
  if (!out.length) return [`check: clean (plan.md and ${count} tickets)`, ...notes, ...back];
  return [`check: ${out.length} problems`, ...out.map((p) => `- ${p}`), ...notes, ...back];
}

// --- staleness ---

const STALE_SHOWN = 10;

// One `stale<tag>:` line: which of the files the tickets `list` name in "Where to look" changed in
// `folder` since `after`: in commits since then or uncommitted. Read-only; only those files are compared.
function staleLine(folder, after, list, tag) {
  if (!given(after) || after.startsWith('-')) return `stale${tag}: unknown (no after_commit)`;
  if (git(folder, ['rev-parse', '--git-dir']) === null) return `stale${tag}: unknown (not a git repository)`;
  if (git(folder, ['rev-parse', '-q', '--verify', `${after}^{commit}`]) === null) return `stale${tag}: unknown (after_commit ${clean(after, 40)} not found)`;
  // A named folder (src/lib/) counts by everything in it.
  const files = [...new Set(list.flatMap((t) => mentionedFiles(sections(t.text)['Where to look'] || '')).map((f) => f.replace(/\\/g, '/').replace(/\/+$/, '')))]
    .filter((f) => f && !(path.isAbsolute(f) || path.win32.isAbsolute(f) || f.split('/').includes('..') || f.startsWith('-')));
  if (!files.length) return `stale${tag}: none of 0 named files changed since ${after}`;
  // Paths from the project folder (--relative), which may sit below the repository's top.
  const lines = (args) => (git(folder, args) || '').split('\n').filter(Boolean);
  const changed = new Set([...lines(['diff', '--relative', '--name-only', after, 'HEAD', '--', ...files]), ...lines(['diff', '--relative', '--name-only', 'HEAD', '--', ...files])]);
  const hit = files.filter((f) => [...changed].some((c) => c === f || c.startsWith(`${f}/`)));
  if (!hit.length) return `stale${tag}: none of ${files.length} named files changed since ${after}`;
  const shown = hit.slice(0, STALE_SHOWN).map((f) => clean(f)).join(', ') + (hit.length > STALE_SHOWN ? ', …' : '');
  return `stale${tag}: ${hit.length} of ${files.length} named files changed since ${after}: ${shown}`;
}

// This project's tickets against after_commit; each other repository's tickets in its folder against
// its commit in after_commit_repos, one `stale (<PREFIX>):` line each.
function draftStale(root, feature) {
  const { d, why } = needDraft(root, feature, 'stale');
  if (!d) return why;
  const s = settings(root);
  const own = [];
  const other = new Map();
  // A stub has no Where to look.
  for (const t of tickets(d).filter((x) => !isStub(x.fm))) {
    const target = repos().targetOf(root, t, s);
    if (target.own) own.push(t);
    else other.set(target.prefix, { target, list: [...(other.has(target.prefix) ? other.get(target.prefix).list : []), t] });
  }
  const commits = repos().commitsOf(d.fm);
  const out = [staleLine(root, d.fm.after_commit, own, '')];
  for (const [prefix, { target, list }] of other) {
    const tag = ` (${clean(prefix, 20)})`;
    if (target.bad || !target.folder) out.push(`stale${tag}: not checked (${target.bad ? 'repo is not a ticket prefix' : clean(target.why, 200)})`);
    else if (!commits.has(prefix)) out.push(`stale${tag}: not checked (no commit recorded for ${prefix}: plans.js set ${d.feature} --after-commit)`);
    else out.push(staleLine(target.folder, commits.get(prefix), list, tag));
  }
  return out;
}

module.exports = {
  draftCheck, draftStale, problems, ticketProblems, cycles,
  mentionedFiles, machineFolders, localPaths, localProblems, researchTexts,
};
