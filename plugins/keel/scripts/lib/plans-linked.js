'use strict';
// A feature on several repositories, after export: its overview (README.md beside its tickets, the same
// word for word in every repository) names them in `repos:`.
// - plans.js tickets (no argument) ends with the `linked:` block, after `next:`: for each feature of this
//   project whose overview names other repositories, and where a ticket is not done here or there, their
//   tickets of the feature. A repository on this machine (the repos map) is read like this project, from
//   its git and files, never fetched; its tickets the overview lists but that repository has no file
//   for are looked up in its history (lib/plans-state.js stateIn). One with no folder here: the
//   overview's Tickets lines for its prefix, state unknown. Overviews that differ: one line, no block.
// - plans.js align <feature> [--take <PREFIX>]: the versions of the overview on this machine, the
//   sections where they differ and the version to take by default; --take writes that version into
//   the other repositories' overviews in their working trees (nothing is committed).
// An overview is read in the working tree (or on this machine for tickets kept there), else on the tip
// of the feature branch, else on the newest branch with the feature's tickets.
const fs = require('node:fs');
const path = require('node:path');
const plans = require('./plans.js');
const { collect, states, ticketLine: stateLine, serverData, stateIn, prefixOf, STATES } = require('./plans-state.js');
const { settings, PREFIX } = require('./plans-settings.js');
const { planRepos, isFolder, isRepoTop, same } = require('./plans-repos.js');
const { repoName } = require('./plans-format.js');
const { git, read, frontmatter, clean } = require('./repo-read.js');
const { readBlobs } = require('./tasks.js');

const README = 'README.md';
const UNKNOWN = 'state unknown';
const DONE = STATES[0];
// Lazy: lib/plans-export-repos.js loads the export code.
const mapTracked = (root) => require('./plans-export-repos.js').mapTracked(root);

const refuse = (why) => [`plans: align refused (${why})`];
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const slashes = (p) => p.replace(/\\/g, '/');
const lf = (text) => String(text).replace(/\r\n/g, '\n');
// Line endings and trailing blank lines are no difference: git may check the file out with CRLF.
const norm = (text) => lf(text).replace(/\s+$/, '');
const day = (seconds) => new Date(seconds * 1000).toISOString().slice(0, 10);

// The feature's overview in a project read by collect(): { text, file, local } in the working tree or
// on this machine, { text, ref, path } on a branch; null when there is none.
function overviewOf(d, list) {
  const own = (text) => (text !== null && text !== undefined && frontmatter(text).type === 'feature' ? text : null);
  const found = list.flatMap((e) => e.found);
  const work = found.find((f) => f.view.work);
  const pc = list.flatMap((e) => e.pc)[0];
  const here = work || pc;
  if (here) {
    const file = path.join(d.root, ...dirOf(here.path).split('/').filter(Boolean), README);
    const text = own(read(file));
    return text && { text, file, local: Boolean(pc && !work) };
  }
  const branch = list[0].branch;
  const tips = new Set([`refs/heads/${branch}`, ...(d.remote ? [`refs/remotes/${d.remote}/${branch}`] : [])]);
  const view = [...found].sort((a, b) => Number(tips.has(b.view.ref)) - Number(tips.has(a.view.ref)) || b.view.date - a.view.date)[0];
  if (!view) return null;
  const p = `${dirOf(view.path) ? `${dirOf(view.path)}/` : ''}${README}`;
  const name = `${view.view.sha}:./${p}`;
  const text = own(readBlobs(d.root, [name]).get(name));
  return text && { text, ref: view.view.ref, path: p };
}

// The overview's Tickets lines: "- KEY title (repository)" (lib/plans-format.js ticketLine).
function listed(text) {
  const m = /^## Tickets[ \t]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(lf(text));
  const out = [];
  for (const l of (m ? m[1] : '').split('\n')) {
    const t = /^- ([A-Za-z][A-Za-z0-9]+-\d+) (.*?)(?: \(([^()]+)\))?\s*$/.exec(l);
    if (t) out.push({ key: t[1].toUpperCase(), title: t[2], repo: t[3] || null });
  }
  return out;
}

// Another repository of the overview on this machine: { folder }, or { why } it is not read. `tracked`:
// the repos map is in git, so it names no folder (lib/plans-export-repos.js mapTracked).
function placeOf(root, prefix, tracked) {
  if (tracked) return { why: 'the repos map is in git; keel takes another repository\'s folder only from this machine\'s own map' };
  const folder = settings(root).repos[prefix];
  if (!folder) return { why: `no folder for ${prefix} in the repos map: plans.js settings set --repo ${prefix}=<folder>` };
  if (!isFolder(folder)) return { why: `${clean(folder, 200)} is not on this machine` };
  if (!isRepoTop(folder)) return { why: `${clean(folder, 200)} is not a git repository` };
  if (same(folder, root)) return { why: `the repos map gives ${prefix} to this project` };
  return { folder };
}

const byFeature = (keys) => {
  const out = new Map();
  for (const e of keys.values()) out.set(e.feature, [...(out.get(e.feature) || []), e]);
  return out;
};

// This project's prefixes for a feature: the planning one and its tickets' own.
const ownPrefixes = (root, list) => new Set([settings(root).ticket_prefix, ...list.map((e) => prefixOf(e.key))].filter(Boolean));

// The other repositories of a feature's overview here: { mine (the overview here), prefixes (all of
// repos:), others }, or null. The overview may come from a clone: only ticket prefixes are taken.
function linkedOf(d, list) {
  const mine = overviewOf(d, list);
  if (!mine) return null;
  const prefixes = planRepos(frontmatter(mine.text)).filter((p) => PREFIX.test(p));
  const own = ownPrefixes(d.root, list);
  const others = prefixes.filter((p) => !own.has(p));
  return others.length ? { mine, prefixes, others } : null;
}

// Another repository read once per run: its collect() and states.
function reader(now) {
  const cache = new Map();
  return (folder) => {
    if (!cache.has(folder)) { const d = collect(folder, now); cache.set(folder, { d, keys: states(d) }); }
    return cache.get(folder);
  };
}

// --- plans.js tickets: the linked block ---

// The block's lines (none when no feature here is on several repositories).
function linkedLines(d, keys, now = new Date()) {
  const readRepo = reader(now);
  const tracked = mapTracked(d.root);
  const features = [];
  for (const [feature, list] of byFeature(keys)) {
    const l = linkedOf(d, list);
    if (!l) continue;
    const tickets = listed(l.mine.text);
    const parts = l.others.map((prefix) => ({ prefix, theirs: tickets.filter((t) => prefixOf(t.key) === prefix), place: placeOf(d.root, prefix, tracked) }));
    features.push({ feature, list, l, parts });
  }
  // The listed keys a repository has no file for, looked up in its history once per repository.
  const missing = new Map();
  for (const { parts } of features) {
    for (const { theirs, place } of parts.filter((x) => x.place.folder)) {
      const r = readRepo(place.folder);
      missing.set(place.folder, new Set([...(missing.get(place.folder) || []), ...theirs.map((t) => t.key).filter((k) => !r.keys.has(k))]));
    }
  }
  const gone = new Map([...missing].map(([folder, set]) => [folder, set.size ? stateIn(folder, [...set], now, readRepo(folder).d).keys : new Map()]));
  const out = [];
  for (const { feature, list, l, parts } of features) {
    let open = list.some((e) => STATES[e.state] !== DONE);
    const lines = [];
    const differ = [];
    for (const { prefix, theirs, place } of parts) {
      const name = place.folder ? repoName(place.folder) : clean((theirs.find((t) => t.repo) || {}).repo || prefix, 60);
      if (!place.folder) {
        if (!theirs.length) continue;
        open = true;
        lines.push(`linked: ${feature}: the repository ${name} (${prefix}) has more tickets, ${UNKNOWN} (${place.why}):`);
        for (const t of theirs) lines.push(`  ${clean(t.key, 40)} ${clean(t.title, 80)} — ${UNKNOWN}`);
        continue;
      }
      const r = readRepo(place.folder);
      // A listed key filed there under another feature name is still this feature's ticket.
      const own = [...r.keys.values()].filter((e) => e.feature === feature);
      const found = [...r.keys.values()].filter((e) => e.feature === feature || theirs.some((t) => t.key === e.key));
      const lost = theirs.filter((t) => !r.keys.has(t.key));
      const rows = [
        ...found.map((e) => ({ key: e.key, text: stateLine(e, null), done: STATES[e.state] === DONE })),
        ...lost.map((t) => {
          const s = gone.get(place.folder).get(t.key).state;
          return { key: t.key, text: `  ${clean(t.key, 40)} ${clean(t.title, 80)} — ${s}`, done: s === DONE };
        }),
      ].sort((a, b) => prefixOf(a.key).localeCompare(prefixOf(b.key)) || Number(a.key.split('-').pop()) - Number(b.key.split('-').pop()));
      open = open || rows.some((x) => !x.done);
      lines.push(`linked: ${feature} in ${name} (${prefix}; ${clean(place.folder, 200)}, ${serverData(r.d)})`, ...rows.map((x) => x.text));
      const there = own.length ? overviewOf(r.d, own) : null;
      if (there && norm(there.text) !== norm(l.mine.text)) differ.push(name);
    }
    if (!open) continue;
    out.push(...lines);
    if (differ.length) out.push(`linked: ${feature}: the overview in ${differ.join(', ')} differs from this project's (pull there; still different: plans.js align ${feature})`);
  }
  return out;
}

// --- plans.js align ---

// The overview's parts: the front matter, the title with any text before the first section, each
// "## <name>" section; name -> its lines without blank ones.
function partsOf(text) {
  const out = new Map();
  let name = 'front matter';
  let body = lf(text);
  const fm = /^---\n[\s\S]*?\n---\n?/.exec(body);
  if (fm) { out.set(name, fm[0].split('\n').filter((l) => l.trim() && l !== '---')); body = body.slice(fm[0].length); }
  name = 'title';
  for (const line of body.split('\n')) {
    const h = /^## (.+?)\s*$/.exec(line);
    if (h) { name = h[1]; out.set(name, []); continue; }
    if (!out.has(name)) out.set(name, []);
    if (line.trim()) out.get(name).push(line);
  }
  return out;
}

// What `to` has against `from`, per part: "section <name>: missing" (`to` lacks it) or "added" (only
// `to` has it), else its "-" lines (only in `from`) and "+" lines (only in `to`).
// shortcut: lines are compared as sets, so a line moved inside a section shows as "the same lines in
// another order"; a line diff would show the move.
function partDiff(from, to) {
  const a = partsOf(from);
  const b = partsOf(to);
  const out = [];
  for (const name of [...new Set([...a.keys(), ...b.keys()])]) {
    if (!a.has(name) || !b.has(name)) { out.push(`  section ${name}: ${a.has(name) ? 'missing' : 'added'}`); continue; }
    const x = a.get(name);
    const y = b.get(name);
    if (x.join('\n') === y.join('\n')) continue;
    const added = y.filter((l) => !x.includes(l));
    const removed = x.filter((l) => !y.includes(l));
    out.push(`  section ${name}:`, ...removed.map((l) => `    - ${clean(l, 200)}`), ...added.map((l) => `    + ${clean(l, 200)}`));
    if (!added.length && !removed.length) out.push('    the same lines in another order');
  }
  return out;
}

// When a version last changed: uncommitted (a working tree file git shows as changed or new), the
// time of the last commit that changed it, or the file's own time for one on this machine only.
function changedAt(root, v) {
  if (v.local) { try { return { time: fs.statSync(v.file).mtimeMs / 1000 }; } catch { return { time: 0 }; } }
  const p = v.file ? slashes(path.relative(root, v.file)) : v.path;
  if (v.file && git(root, ['status', '--porcelain', '--', p])) return { uncommitted: true, time: Infinity };
  const t = Number(git(root, ['log', '-1', '--format=%ct', ...(v.ref ? [v.ref] : []), '--', p]));
  return { time: t > 0 ? t : 0 };
}

function versionText(v) {
  const where = v.file ? slashes(v.own ? path.relative(v.root, v.file) : v.file) : `${v.ref.replace(/^refs\/(heads|remotes)\//, '')}:${v.path}`;
  const when = v.uncommitted ? 'uncommitted changes' : v.time ? `last changed ${day(v.time)}` : 'never committed';
  return `- ${v.prefix} (${v.name}${v.own ? ', this project' : ''}, ${clean(where, 200)}): ${when}`;
}

// The versions of a feature's overview on this machine, newest first (the main repository, the first
// in repos:, before others of the same time): { versions, notes, main } or { why }.
function versionsOf(root, feature, now) {
  const d = collect(root, now);
  const list = byFeature(states(d)).get(feature);
  if (!list) return { why: `no tickets of ${feature} in this project` };
  const l = linkedOf(d, list);
  if (!l) return { why: overviewOf(d, list) ? `${feature} is a feature on one repository` : `no overview of ${feature} here` };
  const own = [...ownPrefixes(root, list)].find((p) => l.prefixes.includes(p)) || prefixOf(list[0].key);
  const versions = [{ ...l.mine, prefix: own, name: repoName(root), root, own: true }];
  const notes = [];
  const readRepo = reader(now);
  const tracked = mapTracked(root);
  for (const prefix of l.others) {
    const place = placeOf(root, prefix, tracked);
    const found = place.folder ? [...readRepo(place.folder).keys.values()].filter((e) => e.feature === feature) : [];
    const v = found.length ? overviewOf(readRepo(place.folder).d, found) : null;
    if (v) versions.push({ ...v, prefix, name: repoName(place.folder), root: place.folder, own: false });
    else notes.push(`not checked: ${prefix} (${place.why || `no overview of ${feature} in ${clean(place.folder, 200)}`})`);
  }
  for (const v of versions) Object.assign(v, changedAt(v.root, v));
  const rank = (v) => l.prefixes.indexOf(v.prefix) === -1 ? l.prefixes.length : l.prefixes.indexOf(v.prefix);
  versions.sort((a, b) => b.time - a.time || rank(a) - rank(b));
  return { versions, notes, main: l.prefixes[0] };
}

// Why the first version is the default: newer than the next one, or of the same time and the main
// repository's, or of the same time and first in repos:.
function whyDefault(versions, main) {
  if (versions[0].time > versions[1].time) return 'the newest change';
  return versions[0].prefix === main ? 'the main repository' : 'the same time as the next one, first in repos:';
}

function alignCommand(root, feature, { take, now = new Date() } = {}) {
  if (!plans.validFeature(feature)) return refuse(`invalid feature name "${clean(String(feature), 60)}"`);
  if (take !== undefined && (typeof take !== 'string' || !take.trim())) return refuse('--take needs a ticket prefix: --take WEB');
  // --take writes into the folders the repos map names: one in git is refused before anything is read.
  if (take !== undefined && mapTracked(root)) return require('./plans-export-repos.js').trackedMap(root, 'align');
  const r = versionsOf(root, feature, now);
  if (r.why) return refuse(r.why);
  const { versions, notes, main } = r;
  const chosen = take === undefined ? null : versions.find((v) => v.prefix === take.trim().toUpperCase());
  if (take !== undefined && !chosen) return refuse(`--take: ${clean(take, 20)} is not one of ${versions.map((v) => v.prefix).join(', ')}`);
  if (versions.length === 1) return [`align: ${feature}: no other overview to compare`, ...notes];
  const groups = [...new Set(versions.map((v) => norm(v.text)))];
  if (groups.length === 1) return [`align: ${feature}: the overview is the same in ${versions.length} repositories`, ...notes];
  if (take === undefined) {
    const first = versions[0];
    const out = [`align: ${feature}: ${groups.length} versions of the overview in ${versions.length} repositories`, ...versions.map(versionText)];
    out.push(`default: ${first.prefix} (${whyDefault(versions, main)})`);
    for (const text of groups.slice(1)) {
      const alike = versions.filter((v) => norm(v.text) === text);
      out.push(`${alike.map((v) => v.prefix).join(', ')} against ${first.prefix}:`, ...partDiff(first.text, alike[0].text));
    }
    return [...out, ...notes, `take one: plans.js align ${feature} --take <PREFIX>`];
  }
  const out = [];
  for (const v of versions.filter((x) => norm(x.text) !== norm(chosen.text))) {
    if (!v.file) { out.push(`not aligned: ${v.prefix} (its overview is on ${v.ref.replace(/^refs\/(heads|remotes)\//, '')}, not in its working tree: switch to that branch there)`); continue; }
    try { plans.writeFile(v.root, { local: v.local }, v.file, chosen.text); } catch (e) { out.push(`not aligned: ${v.prefix} (${e.message})`); continue; }
    out.push(`aligned: ${v.prefix} ${slashes(v.own ? path.relative(root, v.file) : v.file)}${v.uncommitted ? ' (its uncommitted changes replaced)' : ''}`);
    if (!v.local) out.push(`commit: plans.js commit ${feature}${v.own ? '' : ` --repo ${v.prefix}`}, then plans.js push ${feature}${v.own ? '' : ` --repo ${v.prefix}`}`);
  }
  return [`align: ${feature}: ${chosen.prefix}'s overview taken`, ...out, ...notes];
}

module.exports = { linkedLines, alignCommand, listed };
