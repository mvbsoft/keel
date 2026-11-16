'use strict';
// plans.js check and stale: the structure check of a feature and of one ticket (also for feature-page.js),
// and which files the tickets name changed since the plan was made.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { git, read, clean } = require('./repo-read.js');
const { sections } = require('./tasks.js');
const { ticketStructure, planStructure, isStub, outsideFences, unclosedFence, heading } = require('./plans-format.js');
const { settings } = require('./plans-settings.js');
const { PLAN_FILE, STATES, CLOSED, needDraft, tickets, ticketIds } = require('./plans-drafts.js');
// The kinds of ticket file: a ticket, a stub (lib/plans-stubs.js), one that lives in another repository.
const TYPES = ['ticket', 'stub', 'elsewhere'];

// Files a ticket names in "Where to look" without a folder or a line count only with a known extension:
// `obj.id` or `fs.readFileSync` are code, not files.
const FILE_EXT = new Set(['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'go', 'rs', 'java', 'kt', 'rb', 'php', 'cs', 'c', 'h', 'cpp', 'hpp', 'swift', 'dart', 'ex', 'exs', 'scala', 'md', 'json', 'yml', 'yaml', 'toml', 'xml', 'sql', 'sh', 'ps1', 'html', 'css', 'scss', 'vue', 'svelte', 'txt', 'ini', 'cfg', 'gradle', 'lock', 'proto', 'graphql']);

const lf = (text) => String(text).replace(/\r\n/g, '\n');
const given = (v) => typeof v === 'string' && v.trim() !== '' && v.trim() !== '-';

const repos = () => require('./plans-repos.js');

// --- the structure check ---

// The text a placeholder search reads: no code blocks (also indented or ~~~ ones), no inline code, no
// links in angle brackets. Blanked lines stay, so line numbers still match the file.
const prose = (text) => outsideFences(lf(text)).replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length)).replace(/<https?:[^>\s]*>/g, (m) => ' '.repeat(m.length));

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

// A path of this machine: a drive (C:\ or C:/, also in file:///C:/), a UNC share, a Windows drive in WSL
// (/mnt/c/), or one of `folders` (the home folder among them). Not a path: http://x, src/home/a.js,
// ~/.claude.
const LOCAL_PATH = /(?<![A-Za-z0-9])[A-Za-z]:[\\/]|(?<![\w\\])\\\\[\w.$-]+\\|(?<![\w.~/-])\/mnt\/[a-z]\//g;
// /home/<x>, /Users/<x> or /root outside `folders`: another machine's home folder, or a web route such
// as /home/<page> or GET /Users/<id>, which looks the same. Only a note.
const HOME_LIKE = /(?<![\w.~/-])\/(?:home\/[^/\s]|Users\/[^/\s]|root(?![\w.-]))/g;
const PATH_END = /^[^\s`'"<>()[\]{}|,;]+/;
// A folder counts as a whole path part: /app is in /app/x.js, "/app", <file:///app> and /app?x=1, not in
// src/apple.js, /app-old or /app.v2.
const BEFORE_FOLDER = /[\w.~/-]$/;
const AFTER_FOLDER = /^(?![\w-]|\.\w)/;

// The folders of this machine a feature file must not name: the project, the neighbouring
// repositories of the repos map and the home folder (a project in /srv or /opt matches no pattern).
function machineFolders(root) {
  const all = [root, ...Object.values(settings(root).repos || {}), os.homedir()];
  return [...new Set(all.filter((f) => typeof f === 'string').map((f) => f.replace(/\\/g, '/').replace(/\/+$/, '')).filter((f) => f.length > 3))];
}

// Every path of this machine in `text` (`local`) and every other home-like path (`homeLike`), with its
// line: "C:\Users\ann\a.js (line 4)".
function pathsIn(text, folders = []) {
  const win = process.platform === 'win32';
  const local = [];
  const homeLike = [];
  lf(text).split('\n').forEach((line, i) => {
    const slashed = line.replace(/\\/g, '/');
    const look = win ? slashed.toLowerCase() : slashed;
    const starts = [...line.matchAll(LOCAL_PATH)].map((m) => m.index);
    for (const f of folders) {
      const want = win ? f.toLowerCase() : f;
      for (let j = look.indexOf(want); j >= 0; j = look.indexOf(want, j + 1)) {
        const before = look.slice(0, j);
        if ((!BEFORE_FOLDER.test(before) || /file:\/\/$/i.test(before)) && AFTER_FOLDER.test(look.slice(j + want.length))) starts.push(j);
      }
    }
    const pathAt = (at) => PATH_END.exec(line.slice(at))[0].replace(/[.:]+$/, '');
    const spans = [];
    for (const at of [...new Set(starts)].sort((a, b) => a - b)) {
      if (spans.length && at < spans[spans.length - 1][1]) continue;
      const p = pathAt(at);
      spans.push([at, at + p.length]);
      local.push(`${clean(p, 200)} (line ${i + 1})`);
    }
    for (const m of line.matchAll(HOME_LIKE)) {
      if (!spans.some(([a, b]) => m.index >= a && m.index < b)) homeLike.push(`${clean(pathAt(m.index), 200)} (line ${i + 1})`);
    }
  });
  return { local, homeLike };
}

const localPaths = (text, folders = []) => pathsIn(text, folders).local;

// The paths of this machine in a feature's files, one problem each.
const localProblems = (label, text, folders) => localPaths(text, folders).map((p) => `${label}: local path ${p}`);

// The other home-like paths in a feature's file, one note each: never a problem.
const homeNotes = (label, text, folders) => pathsIn(text, folders).homeLike.map((p) => `note: ${label}: ${p} looks like a home folder; a file's path goes from its repository's root, a web route stays`);

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
  if (unclosedFence(text)) out.push(`${label}: the code block from line ${unclosedFence(text)} is never closed`);
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
  // A plan.md with `home:` holds no plan, only the front matter that names its home.
  const out = given(d.fm.home) ? [] : planStructure(d.text);
  for (const p of placeholders(d.text)) out.push(`plan.md: placeholder ${p}`);
  if (unclosedFence(d.text)) out.push(`plan.md: the code block from line ${unclosedFence(d.text)} is never closed`);
  const folders = machineFolders(root);
  const notes = homeNotes(PLAN_FILE, d.text, folders);
  out.push(...localProblems(PLAN_FILE, d.text, folders));
  for (const r of researchTexts(d.folder)) {
    out.push(...localProblems(r.name, r.text, folders));
    notes.push(...homeNotes(r.name, r.text, folders));
  }
  const s = settings(root);
  // In another repository's folder of a feature planned elsewhere (`home:`): its tickets depend on the
  // home plan's, which are checked there.
  const away = given(d.fm.home);
  const files = tickets(d);
  const list = away ? files : repos().withElsewhere(root, d, files, s);
  const ids = new Set(list.map((t) => t.id));
  for (const id of ids) {
    const same = list.filter((t) => t.id === id);
    if (same.length > 1) out.push(`${id}: two files have this number: ${same.map((t) => t.name).sort().join(', ')}`);
  }
  for (const [i, t] of list.entries()) {
    const here = files[i];
    notes.push(...homeNotes(t.id, here.text, folders));
    if (here.fm.id !== t.id) out.push(`${t.id}: front matter id is "${clean(here.fm.id || '')}", the file name says ${t.id}`);
    if (given(here.fm.type) && !TYPES.includes(here.fm.type)) out.push(`${t.id}: type is "${clean(here.fm.type, 20)}"; ${TYPES.join(', ')}`);
    const target = repos().targetOf(root, here, s);
    const elsewhere = here.fm.type === 'elsewhere' && !away;
    if (elsewhere) {
      // The file here is a heading and a line; the ticket is read in its repository.
      if (heading(here.text)[0] !== t.id) out.push(`${t.id}: no "# [${t.id}] <title>" heading`);
      if (target.own || target.bad) { out.push(`${t.id}: an elsewhere ticket's repo "${clean(String(here.fm.repo || ''), 120)}" is not another repository's name`); continue; }
      if (t.unknown) { notes.push(`note: ${t.id}: in ${target.name}, not checked (${clean(t.unknown, 300)})`); continue; }
      if (t.there.t.fm.id !== t.id) out.push(`${t.id}: front matter id in ${target.name} is "${clean(t.there.t.fm.id || '')}"`);
    }
    if (!STATES.includes(t.fm.status)) out.push(`${t.id}: status is "${clean(t.fm.status || '', 20)}"; ${STATES.join(', ')}`);
    else if (t.fm.status === 'abandoned' && !given(t.fm.reason)) out.push(`${t.id}: abandoned without a reason`);
    if (isStub(t.fm)) {
      // A stub's repository is not on this machine: no Where to look to check.
      if (target.own || target.bad) out.push(`${t.id}: a stub's repo "${clean(String(here.fm.repo || ''), 120)}" is not another repository's name`);
      else if (target.folder) notes.push(require('./plans-stubs.js').offerNote(d.feature, t.id, target.name));
      out.push(...ticketProblems(root, t.id, t.text, null));
    } else {
      if (target.bad) out.push(`${t.id}: repo "${clean(target.name, 120)}" is not a repository name`);
      if (!target.own && !target.bad && !target.folder) notes.push(`note: ${t.id}: Where to look not checked (${clean(target.why, 200)})`);
      out.push(...ticketProblems(root, t.id, t.text, target.own ? root : target.folder));
    }
    if (away) continue;
    for (const dep of ticketIds(t.fm.depends_on)) {
      const k = dep.toUpperCase();
      if (k === t.id) out.push(`${t.id}: depends on itself`);
      else if (!ids.has(k)) out.push(`${t.id}: depends on ${clean(dep)}, which does not exist in this feature`);
    }
  }
  if (!away) for (const c of cycles(list)) out.push(`dependency cycle: ${c}`);
  return { out, count: list.length, notes, list };
}

// plan.md and the tickets; then git's one warning (a ticket whose branch is merged and that is not done)
// and, when every ticket is done or abandoned, that the plan can be done.
function draftCheck(root, feature) {
  const { d, why } = needDraft(root, feature, 'check');
  if (!d) return why;
  const { out, count, notes, list } = problems(root, d);
  // An elsewhere ticket's branch is in its own repository.
  const after = [...require('./plans-git.js').mergedWarnings(root, d, list.filter((t) => !t.there)), ...doneHint(d, list)];
  if (!out.length) return [`check: clean (plan.md and ${count} tickets)`, ...notes, ...after];
  return [`check: ${out.length} problems`, ...out.map((p) => `- ${p}`), ...notes, ...after];
}

// The line that says the plan can be done: every ticket is done or abandoned, the plan is still open.
// An elsewhere ticket whose status cannot be read (lib/plans-repos.js withElsewhere) is left to the user.
function doneHint(d, list) {
  if (!list.length || CLOSED.includes(d.fm.status)) return [];
  const open = list.filter((t) => !CLOSED.includes(t.fm.status));
  if (!open.length) return [`plan: every ticket is done or abandoned: plans.js state ${d.feature} done`];
  if (open.some((t) => !t.unknown)) return [];
  return [`plan: every other ticket is done or abandoned; the status of ${open.map((t) => `${t.id} is unknown (${clean(t.unknown, 300)})`).join(', ')}: confirmation needed, ask the user whether it is done, then plans.js state ${d.feature} done --confirm`];
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

// This project's tickets against after_commit; each other repository's tickets (an elsewhere ticket's
// text read there) in its folder against its commit in after_commit_repos, one `stale (<name>):` line
// each.
function draftStale(root, feature) {
  const { d, why } = needDraft(root, feature, 'stale');
  if (!d) return why;
  const s = settings(root);
  const own = [];
  const other = new Map();
  // A stub has no Where to look.
  for (const t of repos().withElsewhere(root, d, tickets(d), s).filter((x) => !isStub(x.fm))) {
    const target = repos().targetOf(root, t, s);
    if (target.own) own.push(t);
    else other.set(target.name, { target, list: [...(other.has(target.name) ? other.get(target.name).list : []), t] });
  }
  const commits = repos().commitsOf(d.fm);
  const out = [staleLine(root, d.fm.after_commit, own, '')];
  for (const [name, { target, list }] of other) {
    const tag = ` (${clean(name, 120)})`;
    if (target.bad || !target.folder) out.push(`stale${tag}: not checked (${target.bad ? 'repo is not a repository name' : clean(target.why, 200)})`);
    else if (!commits.has(name)) out.push(`stale${tag}: not checked (no commit recorded for ${name}: plans.js set ${d.feature} --after-commit)`);
    else out.push(staleLine(target.folder, commits.get(name), list, tag));
  }
  return out;
}

module.exports = {
  draftCheck, draftStale, problems, doneHint, ticketProblems, cycles,
  mentionedFiles, machineFolders, localPaths, localProblems, homeNotes, researchTexts,
};
