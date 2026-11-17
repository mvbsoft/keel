'use strict';
// `skills.js evidence` and `install`: checks skill candidates at a pinned commit, decides the action by
// fixed rules (never by stars), and copies a chosen folder. A fact that could not be read is
// 'not checked' and never a reason to install. Nothing from a candidate is ever run.
const fs = require('node:fs');
const path = require('node:path');
const { frontMatter, riskFlags, printable } = require('./skills-front.js');
const { parseCandidate, licenseOfText, json, urls, LICENSE_NAME } = require('./skills-github.js');
const { linkOnWay } = require('./safe-path.js');

const NOT_CHECKED = 'not checked';
const SAFE_LICENSES = ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC'];
// Size cap of one skill folder: 200 files and 1 MB in all. A skill is instructions plus a few small
// helpers; anything bigger is a project, not a skill, and is not copied.
const MAX_FILES = 200;
const MAX_BYTES = 1024 * 1024;
// "Changed in the last 12 months", for skills with code or an MCP server.
const FRESH_MS = 365 * 24 * 60 * 60 * 1000;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
// The scout returns at most 3 candidates a need; more, or more than 30 in all, are not read.
const PER_NEED = 3;
const MAX_CANDIDATES = 30;

const short = (sha) => (typeof sha === 'string' ? sha.slice(0, 7) : NOT_CHECKED);
const day = (iso) => (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : NOT_CHECKED);

// Why a path from a candidate's tree must not be written, or null.
function unsafePath(rel) {
  if (typeof rel !== 'string' || !rel) return 'empty path';
  if (/[\0-\x1f\\:]/.test(rel) || rel.startsWith('/')) return `bad path ${JSON.stringify(rel)}`;
  if (rel.split('/').some((s) => !s || s === '.' || s === '..' || s.toLowerCase() === '.git')) return `bad path ${JSON.stringify(rel)}`;
  return null;
}

// The skill folder's entries in a git tree: { files: [{ rel, size }], links, submodules, unsafe }.
function folderOf(tree, folder) {
  const prefix = folder ? `${folder}/` : '';
  const out = { files: [], links: [], submodules: [], unsafe: [] };
  for (const t of tree.tree || []) {
    if (typeof t.path !== 'string' || !t.path.startsWith(prefix)) continue;
    const rel = t.path.slice(prefix.length);
    if (t.type === 'tree') continue;
    if (t.type === 'commit') out.submodules.push(rel);
    else if (t.mode === '120000') out.links.push(rel);
    else if (t.type === 'blob') out.files.push({ rel, size: Number(t.size) || 0 });
    const bad = unsafePath(rel);
    if (bad) out.unsafe.push(bad);
  }
  return out;
}

// Anthropic marketplace of a skill id (owner/repo/path): 'Anthropic official', 'community marketplace',
// 'none', or NOT_CHECKED without the marketplace listing.
function marketplaceOf(id, owner, markets) {
  const inList = (list) => list.some((m) => id.toLowerCase() === m || id.toLowerCase().startsWith(m.endsWith('/') ? m : `${m}/`));
  if (owner.toLowerCase() === 'anthropics') return 'Anthropic official';
  if (!markets) return NOT_CHECKED;
  if (inList(markets.official || [])) return 'Anthropic official';
  if (inList(markets.community || [])) return 'community marketplace';
  return 'none';
}

// Reads one candidate: facts, risks, description, licence. Returns { dropped } for one that does not
// exist, else the evidence entry (its action decided later).
async function readCandidate(f, cand, ctx) {
  const p = parseCandidate(cand);
  if (p.error) return { dropped: `${printable(cand && cand.repo, 200)}: ${p.error}` };
  const id = `${p.owner}/${p.repo}${p.path ? `/${p.path}` : ''}`;
  const e = { need: p.need, owner: p.owner, repo: p.repo, path: p.path, id, url: `https://github.com/${p.owner}/${p.repo}${p.path ? `/tree/HEAD/${p.path}` : ''}` };
  const repoRes = await f.get(urls.repo(p.owner, p.repo));
  if (repoRes.status === 404) return { dropped: `${id}: not found (no such repository)` };
  const repo = json(repoRes);
  const commitRes = await f.get(urls.lastCommit(p.owner, p.repo, p.path));
  const commits = json(commitRes);
  if (commitRes.status === 404 || (Array.isArray(commits) && !commits.length)) return { dropped: `${id}: not found (no such folder)` };
  const commit = Array.isArray(commits) && commits[0] && typeof commits[0].sha === 'string' && /^[0-9a-f]{40}$/.test(commits[0].sha) ? commits[0] : null;
  e.commit = commit ? commit.sha : null;
  if (e.commit) e.url = `https://github.com/${p.owner}/${p.repo}/tree/${e.commit}${p.path ? `/${p.path}` : ''}`;
  e.facts = {
    marketplace: marketplaceOf(id, p.owner, ctx.markets),
    owner_listed: ctx.owners.has(p.owner.toLowerCase()) ? 'yes' : 'no',
    pushed_at: repo && repo.pushed_at ? repo.pushed_at : NOT_CHECKED,
    changed_at: commit && commit.commit && commit.commit.committer && commit.commit.committer.date ? commit.commit.committer.date : NOT_CHECKED,
    archived: repo && typeof repo.archived === 'boolean' ? (repo.archived ? 'yes' : 'no') : NOT_CHECKED,
    license: NOT_CHECKED,
    stars: repo && Number.isFinite(repo.stargazers_count) ? repo.stargazers_count : NOT_CHECKED,
  };
  e.risks = { flags: [NOT_CHECKED], code: [] };
  e.description = null;
  if (!e.commit) { e.problem = `the folder's commit could not be read (${commitRes.error || `HTTP ${commitRes.status}`})`; return e; }
  const tree = json(await f.get(urls.tree(p.owner, p.repo, e.commit)));
  if (!tree || !Array.isArray(tree.tree)) { e.problem = 'the file list could not be read'; return e; }
  if (tree.truncated) { e.problem = 'the repository is too big to list its files'; return e; }
  const folder = folderOf(tree, p.path);
  if (!folder.files.some((x) => x.rel === 'SKILL.md')) return { dropped: `${id}: not found (no SKILL.md at ${short(e.commit)})` };
  e.files = folder.files;
  // A skill inside a plugin loses the plugin's scripts and hooks when copied alone.
  const ups = p.path ? p.path.split('/').map((_, i, a) => a.slice(0, i + 1).join('/')) : [];
  const plugin = ['', ...ups].find((a) => (tree.tree || []).some((t) => t.path === `${a ? `${a}/` : ''}.claude-plugin/plugin.json`));
  e.part_of_plugin = plugin === undefined ? null : plugin;
  const skill = await f.get(urls.raw(p.owner, p.repo, e.commit, p.path ? `${p.path}/SKILL.md` : 'SKILL.md'), MAX_BYTES);
  const text = skill.status === 200 ? skill.text : null;
  const fm = frontMatter(text || '');
  e.description = text !== null && typeof fm.fields.description === 'string' ? fm.fields.description : null;
  e.front_matter = text === null ? NOT_CHECKED : fm.ok ? 'ok' : `broken (${fm.problem})`;
  e.name = typeof fm.fields.name === 'string' && NAME.test(fm.fields.name) ? fm.fields.name : (p.path ? p.path.split('/').pop() : p.repo);
  const r = riskFlags(folder.files.map((x) => x.rel), text || '');
  if (folder.links.length) r.flags.push(`links (${folder.links.length})`);
  if (folder.submodules.length) r.flags.push(`submodules (${folder.submodules.length})`);
  if (folder.unsafe.length) r.flags.push(`unsafe paths (${folder.unsafe.length})`);
  if (text === null) r.flags.push(`SKILL.md ${NOT_CHECKED}`);
  e.risks = r;
  e.size = { files: folder.files.length, bytes: folder.files.reduce((s, x) => s + x.size, 0) };
  // The folder's own licence file wins over the repository's licence.
  const own = folder.files.find((x) => !x.rel.includes('/') && LICENSE_NAME.test(x.rel));
  const rootFile = (tree.tree || []).find((t) => t.type === 'blob' && t.mode !== '120000' && LICENSE_NAME.test(t.path));
  if (own) {
    const lt = await f.get(urls.raw(p.owner, p.repo, e.commit, p.path ? `${p.path}/${own.rel}` : own.rel), MAX_BYTES);
    e.facts.license = lt.status === 200 ? licenseOfText(lt.text) : NOT_CHECKED;
    e.license_file = null;
  } else {
    const spdx = repo && repo.license && typeof repo.license.spdx_id === 'string' ? repo.license.spdx_id : null;
    // An SPDX id is short and plain; anything else is a licence keel does not recognise.
    e.facts.license = !repo ? NOT_CHECKED : !spdx || spdx === 'NOASSERTION' ? 'none' : /^[A-Za-z0-9.+-]{1,60}$/.test(spdx) ? spdx : 'other';
    e.license_file = rootFile ? rootFile.path : null;
  }
  return e;
}

const hasCodeOrMcp = (e) => e.risks.code.length > 0 || e.risks.flags.some((x) => x.startsWith('MCP'));

// Whether a remembered ref names this commit: the full sha or a prefix of at least 7 characters.
const sameCommit = (ref, sha) => typeof ref === 'string' && typeof sha === 'string' && ref.length >= 7 && sha.toLowerCase().startsWith(ref.toLowerCase());

// The action for one evidence entry by the fixed rules; stars are never read here. Every reason that
// applies is given, so the user sees all of them at once.
function decide(e, ctx) {
  const no = (reasons) => ({ action: 'not recommended', reason: [].concat(reasons).join('; ') });
  const choice = ctx.choices[e.id];
  if (choice && choice.decision === 'declined' && sameCommit(choice.ref, e.commit)) return no('declined before at this commit');
  if (choice && choice.decision === 'installed' && sameCommit(choice.ref, e.commit)) return no('installed already at this commit');
  const covered = ctx.covered && ctx.covered[e.need];
  if (covered) return no(`the need is covered by ${covered}`);
  if (e.problem) return no(e.problem);
  if (e.description === null) return no(`its description could not be read (${e.front_matter})`);
  const why = [];
  if (e.front_matter !== 'ok') why.push(`front matter ${e.front_matter}`);
  if (e.part_of_plugin !== null && e.part_of_plugin !== undefined) why.push(`part of the plugin at ${e.part_of_plugin || 'the repository root'}: a plugin is installed whole, not one skill of it`);
  const bad = e.risks.flags.find((x) => /^(links|submodules|unsafe paths)/.test(x));
  if (bad) why.push(`${bad}: keel does not copy such a folder`);
  if (e.size.files > MAX_FILES || e.size.bytes > MAX_BYTES) why.push(`larger than keel copies (${e.size.files} files, ${e.size.bytes} bytes; at most ${MAX_FILES} files and ${MAX_BYTES} bytes)`);
  if (e.facts.marketplace !== 'Anthropic official' && e.facts.owner_listed !== 'yes') why.push(`neither in Anthropic's official marketplace (${e.facts.marketplace}) nor from an owner on keel's list`);
  if (e.facts.archived !== 'no') why.push(e.facts.archived === 'yes' ? 'the repository is archived' : `archived ${NOT_CHECKED}`);
  if (e.facts.license === NOT_CHECKED) why.push(`licence ${NOT_CHECKED}`);
  else if (e.facts.license === 'none') why.push('licence unknown');
  else if (e.facts.license === 'other') why.push('licence not recognised');
  else if (e.license_file === null && !e.files.some((x) => !x.rel.includes('/') && LICENSE_NAME.test(x.rel))) why.push('no licence file to copy beside it');
  if (hasCodeOrMcp(e)) {
    const at = Date.parse(e.facts.changed_at);
    if (!Number.isFinite(at)) why.push(`has code and its last change is ${NOT_CHECKED}`);
    else if (ctx.today - at > FRESH_MS) why.push(`has code and no change since ${day(e.facts.changed_at)} (12 months)`);
  }
  return why.length ? no(why) : { action: 'install', reason: null };
}

// Checks installed standalone skills with a known source (source.json): archived, or with code or MCP
// and unchanged for 12 months, gives `why`; a skill that is fine, or whose facts could not be read,
// gets why null and keeps covering its need.
async function checkInstalled(f, installed, ctx) {
  const out = [];
  for (const s of installed) {
    if (!s.source) continue;
    const p = parseCandidate({ repo: s.source.repo, path: s.source.path || '' });
    // A source keel cannot read keeps covering its need.
    if (p.error) { out.push({ skill: s.name, place: s.place, need: s.source.need, why: null }); continue; }
    const repo = json(await f.get(urls.repo(p.owner, p.repo)));
    const commits = json(await f.get(urls.lastCommit(p.owner, p.repo, p.path)));
    const changed = Array.isArray(commits) && commits[0] && commits[0].commit && commits[0].commit.committer ? Date.parse(commits[0].commit.committer.date) : NaN;
    // The inventory stores an installed skill's risks as a list of flags.
    const flags = Array.isArray(s.risks) ? s.risks : s.risks && Array.isArray(s.risks.flags) ? s.risks.flags : [];
    const code = flags.some((x) => /^(code|MCP)/.test(x));
    const why = repo && repo.archived === true ? 'its repository is archived'
      : code && Number.isFinite(changed) && ctx.today - changed > FRESH_MS ? `has code and no change since ${new Date(changed).toISOString().slice(0, 10)}` : null;
    out.push({ skill: s.name, place: s.place, need: s.source.need, why });
  }
  return out;
}

// Checks every candidate; returns { read_on, via, candidates, dropped, replace }. A need whose cover is
// an installed skill that is fine stays covered by it; one that is archived or stale gets a replace line
// when a candidate for the same need passes.
async function evidence(f, list, installed, ctx) {
  const checked = await checkInstalled(f, installed, ctx);
  const covered = { ...(ctx.covered || {}) };
  for (const c of checked) if (!c.why && c.need && !covered[c.need]) covered[c.need] = c.skill;
  ctx = { ...ctx, covered };
  const entries = [];
  const dropped = [];
  const perNeed = {};
  const seen = new Map();
  let taken = 0;
  for (const cand of list) {
    const p = parseCandidate(cand);
    const id = p.error ? printable(cand && cand.repo, 200) : `${p.owner}/${p.repo}${p.path ? `/${p.path}` : ''}`;
    const need = cand && typeof cand.need === 'string' ? cand.need : '';
    const key = id.toLowerCase();
    if (!p.error && seen.has(key)) {
      const n = seen.get(key);
      dropped.push(`${id}: ${n ? `same skill as candidate ${n}` : 'same skill as a dropped candidate'}`);
      continue;
    }
    if ((perNeed[need] || 0) >= PER_NEED) { dropped.push(`${id}: over the limit (at most ${PER_NEED} per need)`); continue; }
    if (taken >= MAX_CANDIDATES) { dropped.push(`${id}: over the limit (at most ${MAX_CANDIDATES} in all)`); continue; }
    perNeed[need] = (perNeed[need] || 0) + 1;
    taken += 1;
    const e = await readCandidate(f, cand, ctx);
    if (e.dropped) { seen.set(key, null); dropped.push(e.dropped); continue; }
    Object.assign(e, decide(e, ctx), { n: entries.length + 1 });
    seen.set(key, e.n);
    entries.push(e);
  }
  const replace = checked.filter((c) => c.why).map((c) => ({ ...c, with: (entries.find((e) => e.action === 'install' && e.need && e.need === c.need) || {}).n })).filter((c) => c.with)
    .map(({ skill, place, why, with: n }) => ({ skill, place, why, with: n }));
  return { read_on: new Date(ctx.today).toISOString().slice(0, 10), via: f.via, candidates: entries, dropped, replace };
}


function evidenceReport(r) {
  const out = [`checked through: ${r.via}; read on ${r.read_on}`];
  for (const e of r.candidates) {
    const f = e.facts;
    const lic = f.license !== NOT_CHECKED && f.license !== 'none' && !SAFE_LICENSES.includes(f.license) ? `${f.license} (not on keel's list: ask first)` : f.license;
    out.push(`candidate ${e.n}: ${e.id} @ ${short(e.commit)}`);
    out.push(`need: ${printable(e.need, 80) || 'none given'}`);
    out.push(`what: ${e.description === null ? NOT_CHECKED : printable(e.description, 1024)}`);
    out.push(`facts: marketplace ${f.marketplace}; owner on keel's list ${f.owner_listed}; pushed ${day(f.pushed_at)}; changed ${day(f.changed_at)}; archived ${f.archived}; licence ${lic}; stars ${f.stars} (shown only)`);
    out.push(`link: ${e.url}`);
    out.push(`risks: ${e.risks.flags.join(', ') || 'none'}`);
    out.push(`action: ${e.action === 'install' ? 'install' : `not recommended: ${printable(e.reason, 1000)}`}`);
  }
  if (!r.candidates.length) out.push('candidates: none');
  for (const d of r.dropped) out.push(`dropped: ${printable(d, 400)}`);
  for (const x of r.replace) out.push(`replace: ${printable(x.skill, 80)} (${x.place}; ${x.why}) with candidate ${x.with}`);
  return out.join('\n');
}

// Copies candidate `e` (from skills-evidence.json) to `base/<name>/` at its pinned commit after every
// check; returns { target, written, code } or throws with the reason. Writes nothing on refusal.
async function install(f, e, base, { licenseOk = false, need = '', today = Date.now(), linkRoot = null } = {}) {
  if (!e || e.action !== 'install') throw new Error(`candidate ${e ? e.n : '?'} is not one to install (${e && e.reason ? e.reason : 'no such candidate'})`);
  if (!SAFE_LICENSES.includes(e.facts.license) && !licenseOk) throw new Error(`licence ${e.facts.license} is not on keel's list (${SAFE_LICENSES.join(', ')}); ask the user, then add --license-ok`);
  if (!NAME.test(e.name || '')) throw new Error(`the skill name ${JSON.stringify(e.name)} is not a safe folder name`);
  if (!/^[0-9a-f]{40}$/.test(e.commit || '')) throw new Error('no pinned commit');
  const target = path.join(base, e.name);
  try { fs.lstatSync(target); throw new Error(`${target} exists: keel never overwrites a skill folder`); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  if (linkRoot) { const why = linkOnWay(linkRoot, target); if (why) throw new Error(`${why}: keel does not write through it`); }
  const tree = json(await f.get(urls.tree(e.owner, e.repo, e.commit)));
  if (!tree || !Array.isArray(tree.tree) || tree.truncated) throw new Error(`the file list at ${short(e.commit)} could not be read`);
  const folder = folderOf(tree, e.path);
  if (folder.links.length) throw new Error(`the folder holds links (${folder.links.join(', ')}): keel does not copy them`);
  if (folder.submodules.length) throw new Error('the folder holds submodules: keel does not copy them');
  if (folder.unsafe.length) throw new Error(`unsafe paths: ${folder.unsafe.join(', ')}`);
  if (!folder.files.some((x) => x.rel === 'SKILL.md')) throw new Error(`no SKILL.md at ${short(e.commit)}`);
  const total = folder.files.reduce((s, x) => s + x.size, 0);
  if (folder.files.length > MAX_FILES || total > MAX_BYTES) throw new Error(`larger than keel copies (${folder.files.length} files, ${total} bytes; at most ${MAX_FILES} files and ${MAX_BYTES} bytes)`);
  const ownLicense = folder.files.some((x) => !x.rel.includes('/') && LICENSE_NAME.test(x.rel));
  if (folder.files.some((x) => x.rel === 'source.json' || (!ownLicense && x.rel === 'LICENSE'))) throw new Error('the folder already holds source.json or LICENSE, which keel writes: not copied');
  // Download everything first, so a failure leaves nothing behind.
  const contents = [];
  let bytes = 0;
  for (const x of folder.files) {
    const r = await f.get(urls.raw(e.owner, e.repo, e.commit, e.path ? `${e.path}/${x.rel}` : x.rel), MAX_BYTES);
    if (r.status !== 200) throw new Error(`${x.rel} could not be downloaded (${r.error || `HTTP ${r.status}`})`);
    const buf = r.buf || Buffer.from(r.text, 'utf8');
    bytes += buf.length;
    if (bytes > MAX_BYTES) throw new Error(`larger than keel copies (more than ${MAX_BYTES} bytes)`);
    contents.push([x.rel, buf]);
  }
  if (!ownLicense) {
    if (!e.license_file) throw new Error('no licence file to copy beside it');
    const r = await f.get(urls.raw(e.owner, e.repo, e.commit, e.license_file), MAX_BYTES);
    if (r.status !== 200) throw new Error(`the licence file could not be downloaded (${r.error || `HTTP ${r.status}`})`);
    contents.push(['LICENSE', r.buf || Buffer.from(r.text, 'utf8')]);
  }
  const source = { repo: `https://github.com/${e.owner}/${e.repo}`, path: e.path, commit: e.commit, license: e.facts.license, installed_at: new Date(today).toISOString(), need: need || e.need || null };
  contents.push(['source.json', Buffer.from(`${JSON.stringify(source, null, 2)}\n`)]);
  fs.mkdirSync(base, { recursive: true });
  // mkdirSync without recursive fails when the folder appeared meanwhile: nothing is overwritten.
  fs.mkdirSync(target);
  try {
    for (const [rel, buf] of contents) {
      const file = path.join(target, ...rel.split('/'));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, buf, { flag: 'wx' });
    }
  } catch (err) {
    fs.rmSync(target, { recursive: true, force: true });
    throw err;
  }
  return { target, written: contents.map(([rel]) => rel), code: e.risks.code || [] };
}

module.exports = { evidence, evidenceReport, install, decide, readCandidate, checkInstalled, folderOf, unsafePath, marketplaceOf, SAFE_LICENSES, MAX_FILES, MAX_BYTES, NOT_CHECKED };
