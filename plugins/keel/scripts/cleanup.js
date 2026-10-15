'use strict';
// /keel:cleanup: finds leftovers and moves the ones the user picks into keel's trash; nothing is
// deleted except by `empty-trash`. Secret files are never moved or opened. Thresholds and patterns:
// data/cleanup.json.
// Usage: node cleanup.js <projectDir> <command> [options]
//   find                          numbered list in three groups (safe / check / do not touch), written
//                                 to .keel/local/tmp/cleanup.json; only reads the project
//   move --items <n,n> [--red <n,n>]
//                                 move the picked items of the last `find` to the trash; an item of
//                                 the "do not touch" group moves only when --red names it as well
//   restore [<batch>]             put a batch back (the newest when none is named)
//   trash                         list the trash batches with their age
//   empty-trash [--older-than <days> | --batch <b> | --all]
//                                 delete batches for good (default: older than trash_max_age_days)
//   reminder                      one line when leftovers pass the reminder threshold (end-task,
//                                 end-session); otherwise says there is nothing to say
// Exit code 0; the first output line starts with `cleanup:`.
const fs = require('node:fs');
const path = require('node:path');
const rules = require('../data/cleanup.json');
const catalog = require('../data/catalog.json');
const { gitLists, sizeOf } = require('./lib/files.js');
const { matchesAny } = require('./lib/patterns.js');
const { secretCheck, parseArgs, readJson } = require('./lib/project.js');
const trash = require('./lib/trash.js');
const { unsafeRel, localLink, safeLocalWrite } = require('./lib/safe-path.js');

const MB = 1024 * 1024;
const LIST = path.join('.keel', 'local', 'tmp', 'cleanup.json');
const MIGRATE_STATE = path.join('.keel', 'local', 'migrate-state.json');
const REF_BUDGET = 30 * MB;
const SAFE_MAX_MB = 5;
const BUILDS = ['dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', 'obj', 'bin'];
const TEXT_MAX = 512 * 1024;

const base = (rel) => rel.replace(/\/$/, '').split('/').pop();
const strip = (rel) => rel.replace(/\/$/, '');
const human = (b) => (b >= MB * 1024 ? `${(b / MB / 1024).toFixed(1)} GB` : b >= MB ? `${(b / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const day = (ms) => (ms ? new Date(ms).toLocaleDateString('sv') : '?');
const isBackup = (rel) => matchesAny(base(rel), rules.backups);
const isJunk = (rel) => rules.os_junk.includes(base(rel));
const isCache = (rel) => matchesAny(base(rel), rules.caches);
const isDependency = (rel) => rules.dependencies.includes(base(rel)) || BUILDS.includes(base(rel));
const isKeelTmp = (rel) => rel.startsWith('.keel/local/tmp/');
// Folders of editors and AI tools (.claude, .idea, .vscode...): settings, not leftovers; only backups
// and system files inside them are listed.
const isToolDir = (rel) => catalog.other_systems.known_tool_dirs.includes(rel.split('/')[0]);
const isKeelBackup = (rel) => /\.keel-backup-[^/]*$/.test(rel);
const trashAge = trash.maxAgeDays;

function stats(root, rel) {
  const full = path.join(root, strip(rel));
  try {
    const st = fs.lstatSync(full);
    if (st.isDirectory()) { const s = sizeOf(full); return { kind: 'folder', bytes: s.bytes, files: s.files, changed: s.newest || st.mtimeMs, partial: s.partial }; }
    return { kind: 'file', bytes: st.size, files: 1, changed: st.mtimeMs, partial: false };
  } catch { return null; }
}

// Old systems that a migration moved from (.keel/local/migrate-state.json): what is left there.
function oldSystems(root) {
  const state = readJson(path.join(root, MIGRATE_STATE));
  return state && Array.isArray(state.sources) ? state.sources.map((s) => s.path).filter((p) => p && fs.existsSync(path.join(root, p))) : [];
}

function candidates(root) {
  const { isSecret } = secretCheck(root);
  const lists = gitLists(root);
  const items = [];
  const secrets = new Set();
  const seen = new Set();
  const add = (rel, fields) => {
    const key = strip(rel);
    if (seen.has(key)) return;
    if (isSecret(key)) { secrets.add(key); seen.add(key); return; }
    const s = stats(root, rel);
    if (!s) return;
    seen.add(key);
    // A big backup is more likely real data than editor litter: the user looks before it goes.
    const big = fields.group === 'safe' && s.bytes >= SAFE_MAX_MB * MB;
    items.push({ path: key + (s.kind === 'folder' ? '/' : ''), ...s, ...fields, ...(big ? { group: 'check', what: `${fields.what}, large (${human(s.bytes)})` } : {}) });
  };
  const now = Date.now();
  const old = oldSystems(root);
  const inOld = (key) => old.some((d) => key === d || key.startsWith(`${d}/`));
  const tracked = new Set(lists ? lists.tracked : []);
  const untracked = new Set(lists ? lists.untracked.map(strip) : []);
  const gitState = (rel) => (!lists ? 'no git' : [...tracked].some((t) => t === rel || t.startsWith(`${rel}/`)) ? 'tracked' : untracked.has(rel) ? 'untracked' : 'ignored');

  // keel's own temporary files, one item per entry of local/tmp/.
  const tmp = path.join(root, '.keel', 'local', 'tmp');
  let tmpNames = [];
  try { tmpNames = fs.readdirSync(tmp); } catch { /* none */ }
  for (const name of tmpNames.sort()) {
    const rel = `.keel/local/tmp/${name}`;
    if (rel === LIST.split(path.sep).join('/')) continue;
    const s = stats(root, rel);
    if (!s) continue;
    const fresh = now - s.changed < rules.tmp_safe_after_hours * 3600 * 1000;
    add(rel, { what: 'keel temporary file', source: fresh ? 'made in the last 24 hours: may belong to the work in progress' : 'keel or its agents during a task', group: fresh ? 'check' : 'safe', git: 'ignored' });
  }

  // What an old system left after a migration.
  for (const dir of old) {
    let names = [];
    try { names = fs.readdirSync(path.join(root, dir)); } catch { continue; }
    for (const name of names.sort()) {
      const rel = `${dir}/${name}`;
      if (isSecret(rel)) { secrets.add(rel); seen.add(rel); continue; }
      const s = stats(root, rel);
      if (!s) continue;
      const large = s.kind === 'folder' && s.bytes >= rules.large_dir_mb * MB;
      add(rel, { what: large ? `large data folder (${human(s.bytes)}), project data` : 'left in an old notes system after the move', source: `old system ${dir}`, group: large ? 'keep' : 'check', git: gitState(rel) });
    }
    seen.add(dir);
  }

  const toolDir = (rel, git) => {
    const stack = [strip(rel)];
    let n = 0;
    while (stack.length && n < 2000) {
      const dir = stack.pop();
      let entries = [];
      try { entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        const r = `${dir}/${e.name}`;
        n += 1;
        if (e.isDirectory()) { if (!isDependency(r) && !isCache(r)) stack.push(r); } else if (isJunk(r)) add(r, { what: 'operating system file', source: 'Finder or Explorer', group: 'safe', git });
        else if (isBackup(r)) add(r, { what: 'backup or copy', source: isKeelBackup(r) ? 'keel settings backup' : 'an editor, a merge or a manual copy', group: 'safe', git });
      }
    }
  };

  if (lists) {
    for (const rel of lists.tracked) {
      if (rel.startsWith('.keel/')) continue;
      if (isJunk(rel)) add(rel, { what: 'operating system file', source: 'Finder or Explorer', group: 'check', git: 'tracked' });
      else if (isBackup(rel)) add(rel, { what: 'backup or copy', source: 'committed to git', group: 'check', git: 'tracked' });
    }
    for (const rel of lists.untracked) {
      if (rel.startsWith('.keel/')) continue;
      const key = strip(rel);
      if (inOld(key)) continue;
      if (rel.endsWith('/') && isToolDir(key) && !isCache(key)) { toolDir(rel, 'untracked'); continue; }
      if (isJunk(key)) add(rel, { what: 'operating system file', source: 'Finder or Explorer', group: 'safe', git: 'untracked' });
      else if (isBackup(key)) add(rel, { what: 'backup or copy', source: isKeelBackup(key) ? 'keel settings backup' : 'an editor, a merge or a manual copy', group: 'safe', git: 'untracked' });
      else if (isCache(key)) add(rel, { what: 'cache of a tool; it rebuilds itself', source: 'a test, lint or build tool', group: 'check', git: 'untracked' });
      else if (isToolDir(key)) continue;
      else {
        const s = stats(root, rel);
        const large = s && s.kind === 'folder' && s.bytes >= rules.large_dir_mb * MB;
        add(rel, { what: large ? `large data folder (${human(s.bytes)}), project data` : 'not in git and not in .gitignore', source: 'new work, or a leftover nobody added', group: large ? 'keep' : 'check', git: 'untracked' });
      }
    }
    for (const rel of lists.ignored) {
      const key = strip(rel);
      if (key === '.keel' || key.startsWith('.keel/') || key === '.git' || tracked.has(key)) continue;
      if (inOld(key) || old.some((d) => d.startsWith(`${key}/`))) continue;
      if (isSecret(key)) { secrets.add(key); continue; }
      if (isDependency(key)) continue;
      if (rel.endsWith('/') && isToolDir(key) && !isCache(key)) { toolDir(rel, 'ignored'); continue; }
      if (isJunk(key)) add(rel, { what: 'operating system file', source: 'Finder or Explorer', group: 'safe', git: 'ignored' });
      else if (isBackup(key)) add(rel, { what: 'backup or copy', source: isKeelBackup(key) ? 'keel settings backup' : 'an editor, a merge or a manual copy', group: 'safe', git: 'ignored' });
      else if (isCache(key)) add(rel, { what: 'cache of a tool; it rebuilds itself', source: 'a test, lint or build tool', group: 'check', git: 'ignored' });
      else if (rel.endsWith('/')) {
        const s = stats(root, rel);
        if (s && s.bytes >= rules.large_dir_mb * MB) add(rel, { what: `large data folder (${human(s.bytes)}), project data`, source: 'ignored by .gitignore on purpose', group: 'keep', git: 'ignored' });
      }
    }
  } else {
    // Not a git repository: backups, system files and caches by name only.
    const stack = [''];
    let count = 0;
    while (stack.length && count < 100000) {
      const dir = stack.pop();
      let entries = [];
      try { entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        const rel = dir ? `${dir}/${e.name}` : e.name;
        count += 1;
        if (rel === '.keel' || rel === '.git' || isDependency(rel)) continue;
        if (e.isDirectory()) {
          if (isCache(rel)) add(`${rel}/`, { what: 'cache of a tool; it rebuilds itself', source: 'a test, lint or build tool', group: 'check', git: 'no git' });
          else stack.push(rel);
        } else if (isJunk(rel)) add(rel, { what: 'operating system file', source: 'Finder or Explorer', group: 'safe', git: 'no git' });
        else if (isBackup(rel)) add(rel, { what: 'backup or copy', source: 'an editor, a merge or a manual copy', group: 'check', git: 'no git' });
      }
    }
  }
  return { items, secrets: [...secrets].sort(), tracked: lists ? lists.tracked : [], isSecret };
}

// Which tracked text files mention each item (its path, or a distinctive file name). A mention moves
// the item one group up: safe → check, check → do not touch.
function references(root, items, tracked, isSecret) {
  const trackedNames = new Set(tracked.map(base));
  // The file name counts too when it is distinctive: long enough, and no tracked file has the same
  // name (a mention of "config.json" is about the tracked one).
  const needles = items.map((it) => {
    const p = strip(it.path);
    const name = base(p);
    const distinctive = it.kind === 'file' && name.length >= 6 && name.includes('.') && !isBackup(p) && !isKeelTmp(p) && !trackedNames.has(name);
    return [p, ...(distinctive ? [name] : [])];
  });
  let budget = REF_BUDGET;
  let partial = false;
  for (const file of tracked) {
    if (isSecret(file) || base(file) === '.gitignore' || file.startsWith('.keel/')) continue;
    let text;
    try {
      const full = path.join(root, file);
      const size = fs.statSync(full).size;
      if (size > TEXT_MAX) continue;
      if (budget - size < 0) { partial = true; break; }
      budget -= size;
      text = fs.readFileSync(full, 'utf8');
    } catch { continue; }
    if (text.includes('\0')) continue;
    items.forEach((it, i) => {
      const self = strip(it.path);
      if (file === self || file.startsWith(`${self}/`)) return;
      for (const needle of needles[i]) {
        const at = text.indexOf(needle);
        if (at === -1) continue;
        it.refs = it.refs || [];
        if (it.refs.length < 3) it.refs.push(`${file}:${text.slice(0, at).split('\n').length}`);
        it.ref_count = (it.ref_count || 0) + 1;
        break;
      }
    });
  }
  for (const it of items) if (it.refs) it.group = it.group === 'safe' ? 'check' : 'keep';
  return partial;
}

const GROUPS = [['safe', '🟢 safe (preselected)'], ['check', '🟡 check (add by number)'], ['keep', '🔴 do not touch unless you are sure (by number, then a second question about the consequences)']];

function find(root) {
  const linked = localLink(root);
  if (linked) return ['cleanup: stopped', `reason: ${linked}: keel does not write through it`];
  const { items, secrets, tracked, isSecret } = candidates(root);
  const partial = references(root, items, tracked, isSecret);
  const order = { safe: 0, check: 1, keep: 2 };
  items.sort((a, b) => order[a.group] - order[b.group] || a.path.localeCompare(b.path));
  items.forEach((it, i) => { it.n = i + 1; });
  const batches = trash.listBatches(root);
  const maxAge = trashAge(root);
  const old = batches.filter((b) => b.age_days >= maxAge);
  const list = { project: root, at: new Date().toISOString(), items, secrets, trash: { batches: batches.length, old: old.map((b) => b.batch), max_age_days: maxAge } };
  safeLocalWrite(root, ['tmp', 'cleanup.json'], JSON.stringify(list, null, 2) + '\n');

  const out = [`cleanup: ${items.length} items; the list is in ${LIST.split(path.sep).join('/')}`];
  for (const [group, title] of GROUPS) {
    const g = items.filter((it) => it.group === group);
    if (!g.length) continue;
    out.push(title + ':');
    for (const it of g) {
      const refs = it.refs ? `referenced by ${it.refs.join(', ')}${it.ref_count > it.refs.length ? ` and ${it.ref_count - it.refs.length} more` : ''}` : 'no references';
      out.push(` ${it.n}. ${it.path} - ${it.what}; from: ${it.source}; changed ${day(it.changed)}; ${it.partial ? 'at least ' : ''}${human(it.bytes)}${it.kind === 'folder' ? ` in ${it.files} files` : ''}; git: ${it.git}; ${refs}`);
    }
  }
  if (!items.length) out.push('nothing to clean up');
  if (secrets.length) out.push(`secret files (never moved or opened): ${secrets.join(', ')}`);
  if (partial) out.push('references: checked only part of the repository (size budget); an unreferenced item may still be used');
  // Old batches are not offered: the trash is emptied only when the user asks (empty-trash).
  if (batches.length) out.push(`trash: ${batches.length} batches, ${human(batches.reduce((n, b) => n + b.bytes, 0))}`);
  return out;
}

// The first secret file inside a folder item (the list's own secrets, then a walk of the folder as it
// is now, links not followed), or null. A folder is moved whole, so one secret inside keeps it in place.
function secretInside(root, rel, isSecret, listed) {
  const prefix = rel.replace(/\/+$/, '') + '/';
  const known = listed.find((s) => s.startsWith(prefix));
  if (known) return known;
  const walk = (dirRel, depth) => {
    if (depth > 20) return null;
    let entries = [];
    try { entries = fs.readdirSync(path.join(root, dirRel), { withFileTypes: true }); } catch { return null; }
    for (const e of entries) {
      const r = `${dirRel}/${e.name}`;
      if (e.isDirectory()) { const hit = walk(r, depth + 1); if (hit) return hit; } else if (isSecret(r)) return r;
    }
    return null;
  };
  let st;
  try { st = fs.lstatSync(path.join(root, rel)); } catch { return null; }
  return st.isDirectory() ? walk(rel.replace(/\/+$/, ''), 0) : null;
}

function move(root, itemsArg, redArg) {
  const list = readJson(path.join(root, LIST));
  if (!list || !Array.isArray(list.items)) return ['cleanup: stopped', 'reason: no list yet; run find first'];
  const nums = (s) => String(s || '').split(',').map((x) => Number(x.trim())).filter((x) => Number.isInteger(x) && x > 0);
  const picked = nums(itemsArg);
  const red = new Set(nums(redArg));
  if (!picked.length) return ['cleanup: stopped', 'reason: no items given (--items 1,2,3)'];
  const { isSecret } = secretCheck(root);
  const refused = [];
  const go = [];
  for (const n of picked) {
    const it = list.items.find((x) => x.n === n);
    const rel = it && strip(it.path);
    if (!it) refused.push(`${n}: not in the list`);
    else if (it.group === 'keep' && !red.has(n)) refused.push(`${n} ${it.path}: in the "do not touch" group; ask the second question, then pass --red ${n}`);
    else if (isSecret(rel) || list.secrets.includes(rel)) refused.push(`${n} ${it.path}: a secret file is never moved`);
    else if (secretInside(root, rel, isSecret, list.secrets)) refused.push(`${n} ${it.path}: it holds a secret file (${secretInside(root, rel, isSecret, list.secrets)}), which is never moved; move the other files by hand or leave the folder`);
    else if (unsafeRel(root, rel) || (rel.startsWith('.keel/') && !isKeelTmp(rel))) refused.push(`${n} ${it.path}: outside what cleanup may move`);
    else if (!fs.existsSync(path.join(root, rel))) refused.push(`${n} ${it.path}: no longer there`);
    else go.push(it);
  }
  const meta = Object.fromEntries(go.map((it) => [strip(it.path), { git: it.git, what: it.what }]));
  const r = trash.moveToTrash(root, go.map((it) => strip(it.path)), 'cleanup', meta);
  const out = [r.moved.length ? `cleanup: moved ${r.moved.length} items (${human(r.moved.reduce((n, i) => n + i.bytes, 0))})${r.batch ? ` to .keel/local/trash/${r.batch}/` : ''}` : 'cleanup: moved nothing'];
  for (const x of refused) out.push(`refused: ${x}`);
  for (const x of r.failed) out.push(`failed: ${x.path} (${x.reason})`);
  if (r.moved.some((i) => i.git === 'tracked')) out.push(`in git: ${r.moved.filter((i) => i.git === 'tracked').map((i) => i.path).join(', ')} now show as deleted; they go into the next commit as a normal change`);
  if (r.batch) {
    const quiet = r.moved.every((i) => isKeelTmp(i.path) || isKeelBackup(i.path));
    out.push(quiet ? 'gates: not needed (only keel temporary files and backups moved)' : 'gates: needed (run the gates; red → restore this batch)');
    out.push(`restore: node cleanup.js <project> restore ${r.batch}`);
  }
  return out;
}

function restoreCmd(root, batch) {
  const r = trash.restore(root, batch);
  if (r.missing) return ['cleanup: stopped', `reason: no trash batch${batch ? ` ${batch}` : ''}`];
  if (r.refused) return ['cleanup: stopped', `reason: ${r.refused}`];
  const out = [`cleanup: restored ${r.restored.length} items from ${r.batch}`];
  for (const k of r.kept) out.push(`kept in the trash: ${k.path} (${k.reason})`);
  return out;
}

function trashCmd(root) {
  const batches = trash.listBatches(root);
  if (!batches.length) return ['cleanup: the trash is empty'];
  const maxAge = trashAge(root);
  return [`cleanup: ${batches.length} trash batches`, ...batches.map((b) => ` ${b.batch} (${b.by}): ${b.items.length} items, ${human(b.bytes)}, ${b.age_days} days old${b.age_days >= maxAge ? ` - older than ${maxAge} days` : ''}`)];
}

function emptyCmd(root, opts) {
  const how = trash.emptyChoice(opts, trashAge(root));
  if (how.error) return ['cleanup: stopped', `reason: ${how.error}`];
  const removed = trash.emptyTrash(root, how);
  if (!removed.length) return ['cleanup: nothing deleted (no matching trash batch)'];
  return [`cleanup: deleted ${removed.length} trash batches for good (${human(removed.reduce((n, b) => n + b.bytes, 0))})`, ...removed.map((b) => ` ${b.batch}: ${b.items.length} items`)];
}

// Counts only what find would preselect, without the reference check (cheap; end of every task).
function reminder(root) {
  const { items } = candidates(root);
  const safe = items.filter((it) => it.group === 'safe');
  const files = safe.reduce((n, it) => n + it.files, 0);
  const bytes = safe.reduce((n, it) => n + it.bytes, 0);
  if (files >= rules.reminder.files || bytes >= rules.reminder.mb * MB) return [`cleanup: ${files} leftover files (${human(bytes)}) can go: /keel:cleanup`];
  return ['cleanup: below the reminder threshold (say nothing)'];
}

if (require.main === module) {
  let lines;
  try {
    const { opts, pos } = parseArgs(process.argv.slice(2));
    const root = path.resolve(pos[0] || process.env.CLAUDE_PROJECT_DIR || process.cwd());
    const command = pos[1] || 'find';
    if (command === 'find') lines = find(root);
    else if (command === 'move') lines = move(root, opts.items, opts.red);
    else if (command === 'restore') lines = restoreCmd(root, pos[2]);
    else if (command === 'trash') lines = trashCmd(root);
    else if (command === 'empty-trash') lines = emptyCmd(root, opts);
    else if (command === 'reminder') lines = reminder(root);
    else lines = [`cleanup: unknown command "${command}" (find, move, restore, trash, empty-trash, reminder)`];
  } catch (e) {
    lines = [`cleanup: unavailable (${e.message})`];
  }
  process.stdout.write(lines.join('\n') + '\n');
  process.exit(0);
}

module.exports = { find, move, reminder, candidates };
