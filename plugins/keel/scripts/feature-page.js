'use strict';
// /keel:feature-page: a feature's md files and its tickets' states as data in a fixed HTML template
// (templates/feature-page/index.html), for the Artifact tool to publish. The texts go in as they are:
// the page renders the markdown and highlights the code itself, with libraries from cdnjs.
// - A draft (plan.md, tickets/T<n>-*.md, research/) or an exported feature (README.md, its tickets and
//   research/ in its folder). An exported feature's states come from lib/plans-state.js; the tickets of
//   its other repositories are read in their folders from this machine's repos map, else only their
//   overview lines are shown, state unknown.
// - The page's title, the same from every repository of the feature: keel:feature:<PREFIX>:<feature>,
//   PREFIX the first of the overview's (plan.md's) repos, else this project's ticket prefix. Its marker
//   tells pages of two projects with that title apart: a hash of the main repository's remote URL
//   without scheme and credentials. The second project's page takes the title if taken,
//   keel:feature:<PREFIX>:<feature>:<repository name>.
// - Its language: --lang, else the earlier page's (--previous, that page saved to a file), else the
//   conversation's. Labels come from locales/<code>.json; texts in another language than the
//   tickets' wait in translate.json for Claude, and `apply` puts the translations in
//   (lib/feature-page-text.js). The page keeps them, so the next update translates only new texts.
// Nothing is kept: the page goes to .keel/local/tmp/feature-page/ and `clean` removes it after the
// publish. Reads git and the files only.
// Usage: node feature-page.js <projectDir> [<feature>] [--taken] [--lang <code>] [--previous <file>]
//                                         the page; no feature: the current branch's; --taken: titled
//                                         with the title if taken
//        node feature-page.js <projectDir> apply         puts translated.json into the waiting page
//        node feature-page.js <projectDir> peek <file>   an earlier page's marker and language
//        node feature-page.js <projectDir> clean         removes the page's folder
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const plans = require('./lib/plans.js');
const { featureFolder } = require('./lib/plans-export.js');
const { mapTracked } = require('./lib/plans-export-repos.js');
const { readStates, collect, states, nextOf, byKey, prefixOf, metBy, STATES } = require('./lib/plans-state.js');
const { neighbourStates, met } = require('./lib/plans-neighbours.js');
const { listed } = require('./lib/plans-linked.js');
const { settings, PREFIX } = require('./lib/plans-settings.js');
const { planRepos, isFolder, isRepoTop, headOf } = require('./lib/plans-repos.js');
const { outsideFences, heading, repoName } = require('./lib/plans-format.js');
const { git, read, frontmatter, clean } = require('./lib/repo-read.js');
const { safeLocalPath } = require('./lib/safe-path.js');
const { pickRemote } = require('./git-flow.js');
const { parseArgs } = require('./lib/project.js');
const { effectiveOptions } = require('./lib/options.js');
const { langCode, labelsFor, missing, translate, readPage } = require('./lib/feature-page-text.js');

const TEMPLATE = path.join(__dirname, '..', 'templates', 'feature-page', 'index.html');
const DONE = STATES[0];
const UNKNOWN = 'state unknown';

const refuse = (why) => [`feature-page: refused (${why})`];
const lf = (text) => String(text).replace(/\r\n/g, '\n');
const given = (v) => typeof v === 'string' && v.trim() !== '' && v.trim() !== '-';
const pageDir = (root) => safeLocalPath(root, 'tmp', 'feature-page');
const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// A file's "## " sections in their order, [{ name, text }]; a "## " inside a code block is text. Text
// between the "# " heading and the first section comes first, with no name.
function sectionsOf(text) {
  const lines = lf(text).replace(/^---\n[\s\S]*?\n---\n?/, '').split('\n');
  const plain = outsideFences(lines.join('\n')).split('\n');
  const out = [{ name: '', lines: [] }];
  lines.forEach((line, i) => {
    const m = /^##\s+(.*\S)\s*$/.exec(plain[i]);
    if (m) out.push({ name: m[1], lines: [] });
    else if (!(out.length === 1 && /^# /.test(plain[i]))) out[out.length - 1].lines.push(line);
  });
  return out.map((s) => ({ name: s.name, text: s.lines.join('\n').trim() })).filter((s) => s.name || s.text);
}

const named = (secs, name) => (secs.find((s) => s.name === name) || {}).text || '';
const titleOf = (text) => (/^# (.+)$/m.exec(outsideFences(lf(text).replace(/^---\n[\s\S]*?\n---\n?/, ''))) || [])[1] || '';

// "2 files · 3 criteria": the files Where to look names and the acceptance criteria.
function sizeOf(secs) {
  const criteria = named(secs, 'Acceptance criteria').split('\n').filter((l) => /^[-*] \[[ xX]\] \S/.test(l)).length;
  return { files: plans.mentionedFiles(named(secs, 'Where to look')).length, criteria };
}

// The overview's Terms as the page's hints: "- term — text", "- **term**: text", "- `term` - text".
function termsOf(secs) {
  const out = [];
  for (const l of named(secs, 'Terms').split('\n')) {
    const m = /^\s*[-*]\s+(?:\*\*|__)?`?([^`*_\n:—–]{1,60}?)`?(?:\*\*|__)?\s*(?::|—|–|\s-\s)\s*(\S.*)$/.exec(l);
    if (m) out.push({ term: m[1].trim(), text: m[2].trim() });
  }
  return out;
}

function researchOf(folder) {
  const dir = path.join(folder, 'research');
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && /\.md$/i.test(e.name)).map((e) => e.name).sort(); } catch { /* none */ }
  return names.map((name) => { const text = read(path.join(dir, name)) || ''; return { name, title: titleOf(text) || name, sections: sectionsOf(text) }; });
}

// The remote URL without scheme, credentials (a URL may hold a token) and .git, the host in lower case:
// git@Host:team/web.git, https://user:token@host/team/web and ssh://git@host/team/web/ give host/team/web.
function remoteKey(url) {
  let s = url.trim();
  const scp = /^(?:[^@/]+@)?([^/:]+):(?!\/)(.+)$/.exec(s);
  if (scp && !s.includes('://')) s = `${scp[1]}/${scp[2]}`;
  else s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^[^@/]*@/, '');
  s = s.replace(/\/+$/, '').replace(/\.git$/i, '');
  const i = s.indexOf('/');
  return i < 0 ? s.toLowerCase() : s.slice(0, i).toLowerCase() + s.slice(i);
}

function markerOf(folder, prefix) {
  if (!folder) return { why: `the main repository ${prefix} is not on this machine` };
  const remote = pickRemote((git(folder, ['remote']) || '').split('\n').filter(Boolean));
  const url = remote ? git(folder, ['remote', 'get-url', remote]) : null;
  if (!url) return { why: `the main repository ${prefix} has no remote` };
  return { marker: crypto.createHash('sha256').update(remoteKey(url)).digest('hex').slice(0, 16) };
}

// Another repository's folder from this machine's repos map, or null. A map in git names none: a
// cloned repository does not choose which folders keel reads (as lib/plans-linked.js).
function folderOf(root, prefix, tracked) {
  const f = settings(root).repos[prefix];
  return !tracked && f && isFolder(f) && isRepoTop(f) ? f : null;
}

// The feature's repositories, this project's first: [{ prefix, name, folder, commit }].
function reposOf(root, own, prefixes, overview) {
  const tracked = mapTracked(root);
  const lines = overview ? listed(overview) : [];
  const out = [{ prefix: own, name: repoName(root), folder: root, commit: headOf(root) }];
  for (const prefix of prefixes.filter((p) => PREFIX.test(p) && p !== own)) {
    const folder = folderOf(root, prefix, tracked);
    const fromOverview = (lines.find((t) => prefixOf(t.key) === prefix && t.repo) || {}).repo;
    out.push({ prefix, name: folder ? repoName(folder) : clean(fromOverview || prefix, 60), folder, commit: folder ? headOf(folder) : null });
  }
  return out;
}

const ticketOf = (key, text, extra) => {
  const sections = text ? sectionsOf(text) : null;
  return { key, title: text ? heading(text)[1] : '', sections, md: text ? lf(text) : null, ...(sections ? sizeOf(sections) : { files: 0, criteria: 0 }), ...extra };
};

function draftData(root, d) {
  const own = settings(root).ticket_prefix;
  const prefixes = planRepos(d.fm);
  const repos = reposOf(root, own || prefixes[0], prefixes, null);
  const nameOf = (p) => (repos.find((r) => r.prefix === p) || { name: p }).name;
  const tickets = plans.tickets(d).map((t) => {
    const prefix = given(t.fm.repo) ? t.fm.repo.trim() : own;
    return ticketOf(t.id, t.text, { prefix, repo: nameOf(prefix), state: 'draft', next: false, depends: plans.ticketIds(t.fm.depends_on).map((k) => ({ key: k, met: false })) });
  });
  return { stage: `draft${plans.stateOf(d) === 'ready' ? ' (ready)' : ''}`, overviewText: d.text, overviewFile: 'plan.md', prefixes, own, repos, tickets, research: researchOf(d.folder), language: given(d.fm.language) ? d.fm.language : settings(root).language };
}

function exportedData(root, feature, f, now) {
  const { keys, others, gone } = readStates(root, now);
  const mine = [...keys.values()].filter((e) => e.feature === feature).sort((a, b) => byKey(a.key, b.key));
  const next = nextOf(keys, mine, gone, others);
  const readme = read(path.join(f.folder, 'README.md'));
  const overview = readme !== null && frontmatter(readme).type === 'feature' ? readme : null;
  const own = settings(root).ticket_prefix || prefixOf(mine.length ? mine[0].key : f.list[0].fm.key.toUpperCase());
  const ownPrefixes = new Set([own, ...mine.map((e) => prefixOf(e.key))]);
  const prefixes = overview ? planRepos(frontmatter(overview)) : [];
  const repos = reposOf(root, own, prefixes.filter((p) => !ownPrefixes.has(p) || p === own), overview);
  // A dependency is met as nextOf reads it: done, or waiting for the merge of this same feature.
  const depMet = (k, e) => (keys.has(k) ? metBy(STATES[keys.get(k).state], keys.get(k).feature, e.feature)
    : others.has(k) ? met(others.get(k), e.feature) : gone.get(`${e.target} ${k}`) === 'done');
  const textOf = (list, key) => (list.find((t) => t.fm.key.toUpperCase() === key) || {}).text || null;
  const tickets = mine.map((e) => ticketOf(e.shown, textOf(f.list, e.key), {
    title: e.title, prefix: prefixOf(e.key), repo: repos[0].name, state: STATES[e.state], next: e === next, via: e.via || null,
    depends: e.depends.map((k) => ({ key: k, met: depMet(k, e) })),
  }));
  for (const r of repos.slice(1)) {
    const theirs = overview ? listed(overview).filter((t) => prefixOf(t.key) === r.prefix) : [];
    const there = r.folder ? featureFolder(r.folder, feature) : null;
    const list = there ? there.list : [];
    const all = [...new Set([...theirs.map((t) => t.key), ...list.map((t) => t.fm.key.toUpperCase())])].sort(byKey);
    const fileOf = (k) => list.find((t) => t.fm.key.toUpperCase() === k);
    const depsOf = (k) => (fileOf(k) ? plans.ticketIds(fileOf(k).fm.depends_on).map((x) => x.toUpperCase()) : []);
    const deps = [...new Set(all.flatMap(depsOf))].filter((k) => !keys.has(k));
    const stated = r.folder && all.length ? neighbourStates(root, [...new Set([...all, ...deps])], now) : new Map();
    const theirMet = (k) => (keys.has(k) ? metBy(STATES[keys.get(k).state], keys.get(k).feature, feature) : stated.has(k) ? met(stated.get(k), feature) : false);
    for (const k of all) {
      const s = stated.get(k);
      const t = ticketOf((s && s.shown) || k, textOf(list, k), { prefix: r.prefix, repo: r.name, state: s ? s.state : UNKNOWN, next: false, depends: depsOf(k).map((d) => ({ key: d, met: theirMet(d) })) });
      if (!t.title) t.title = (theirs.find((x) => x.key === k) || {}).title || '';
      tickets.push(t);
    }
  }
  return { stage: 'exported', overviewText: overview, overviewFile: 'README.md', prefixes, own, repos, tickets, research: researchOf(f.folder), language: settings(root).language };
}

// The feature of the current branch: a draft whose branch (or name) it is, or exported tickets whose
// branch it is; `all` every draft and exported feature here, for the question.
function currentFeature(root, now) {
  const branch = git(root, ['symbolic-ref', '-q', '--short', 'HEAD']);
  const drafts = plans.listDrafts(root).filter((d) => ['draft', 'ready'].includes(plans.stateOf(d)));
  const keys = [...states(collect(root, now)).values()].filter((e) => plans.validFeature(e.feature));
  const all = [...new Set([...drafts.map((d) => d.feature), ...keys.map((e) => e.feature)])].sort();
  const on = branch ? [...new Set([...drafts.filter((d) => d.fm.branch === branch || d.feature === branch).map((d) => d.feature), ...keys.filter((e) => e.branch === branch).map((e) => e.feature)])] : [];
  return { branch, all, on };
}

// `taken`: the page carries the title if taken (another project's page has the title). `lang`: the
// page's language, else the earlier page's (`previous`, its file), else the conversation's.
function build(root, arg, { taken = false, now = new Date(), lang = null, previous = null } = {}) {
  let feature = arg;
  if (feature === undefined) {
    const c = currentFeature(root, now);
    if (c.on.length !== 1) {
      const why = !c.branch ? 'HEAD is detached' : c.on.length ? `the branch ${c.branch} has several: ${c.on.join(', ')}` : `the branch ${c.branch} is no feature's branch`;
      return [`feature: none (${why})`, `features: ${c.all.join(', ') || 'none'}`];
    }
    feature = c.on[0];
  }
  if (!plans.validFeature(feature)) return refuse(`invalid feature name "${clean(String(feature), 60)}"`);
  const draft = plans.listDrafts(root).find((d) => d.feature === feature && ['draft', 'ready'].includes(plans.stateOf(d)));
  const f = draft ? null : featureFolder(root, feature);
  if (!draft && !f) return refuse(`no draft and no exported tickets of ${feature} in this working tree; on another branch: switch to it first`);
  const data = draft ? draftData(root, draft) : exportedData(root, feature, f, now);
  const prefix = [...data.prefixes, data.own].find((p) => PREFIX.test(p || ''));
  if (!prefix) return refuse('no ticket prefix: /keel:configure planning');
  const main = data.repos.find((r) => r.prefix === prefix) || { name: prefix, folder: null };
  const m = markerOf(main.folder, prefix);
  const title = `keel:feature:${prefix}:${feature}`;
  const ifTaken = `${title}:${main.name}`;
  if (lang && !langCode(lang)) return refuse(`"${clean(String(lang), 40)}" is no language code: give one such as en, uk, de`);
  const earlier = previous ? read(previous) : null;
  if (previous && earlier === null) return refuse(`cannot read ${previous}`);
  const before = earlier === null ? null : readPage(earlier);
  const pageLang = langCode(lang) || (before && before.lang) || langCode(effectiveOptions(root).conversation_language) || 'en';
  const source = langCode(data.language) || 'en';
  const { labels, own } = labelsFor(pageLang);
  const secs = data.overviewText ? sectionsOf(data.overviewText) : [];
  const page = {
    feature, title: taken ? ifTaken : title, stage: data.stage, generated: now.toISOString(),
    language: pageLang, source, labels,
    heading: (data.overviewText && titleOf(data.overviewText)) || feature,
    repos: data.repos.map((r) => ({ prefix: r.prefix, name: r.name, commit: r.commit })),
    overview: data.overviewText ? { file: data.overviewFile, sections: secs } : null,
    terms: termsOf(secs), tickets: data.tickets, research: data.research,
  };
  const known = before && before.translations.lang === pageLang ? before.translations.items : {};
  const todo = pageLang === source ? [] : missing(page, known);
  const done = data.tickets.filter((t) => t.state === DONE).length;
  const info = [
    `title: ${title}`,
    `title if taken: ${ifTaken}`,
    `page title: ${page.title}`,
    m.marker ? `marker: ${m.marker}` : `marker: none (${m.why})`,
    `feature: ${feature}, ${data.stage}, ${data.tickets.length} tickets${data.stage === 'exported' ? ` (${done} done)` : ''}`,
    `as of: ${data.repos.map((r) => `${r.name} ${r.commit || 'not on this machine'}`).join(', ')}`,
    `language: ${pageLang}${own ? '' : ' (labels in English: no page labels in this language)'}; texts in ${source}`,
  ];
  let dir;
  try {
    dir = pageDir(root);
    fs.mkdirSync(dir, { recursive: true });
    for (const name of ['index.html', PENDING, TO_TRANSLATE, TRANSLATED]) fs.rmSync(path.join(dir, name), { force: true });
    if (!todo.length) return [`page: ${render(dir, page, m.marker, known)}`, ...info];
    // The texts to translate wait with the page until `apply` brings their translations.
    fs.writeFileSync(path.join(dir, PENDING), JSON.stringify({ page, marker: m.marker || '', known }));
    fs.writeFileSync(path.join(dir, TO_TRANSLATE), JSON.stringify({ from: source, to: pageLang, texts: todo }, null, 1));
  } catch (e) { return refuse(e.message); }
  const words = todo.reduce((n, t) => n + t.text.split(/\s+/).length, 0);
  return [`translate: ${path.join(dir, TO_TRANSLATE)} (${todo.length} texts, about ${words} words, ${source} to ${pageLang}; write ${path.join(dir, TRANSLATED)}, then run apply)`, ...info];
}

const PENDING = 'pending.json';
const TO_TRANSLATE = 'translate.json';
const TRANSLATED = 'translated.json';

// The page file: the template with the data, its marker, language and the translations it used.
function render(dir, page, marker, known) {
  const used = page.language === page.source ? {} : translate(page, known);
  if (Object.keys(used).length) page.translatedFrom = page.source;
  // "<" as <: a "</script>" in a ticket's text cannot close a data block.
  const json = (o) => JSON.stringify(o).replace(/</g, '\\u003c');
  const html = fs.readFileSync(TEMPLATE, 'utf8')
    .replace('{{TITLE}}', () => escapeHtml(page.title)).replace('{{MARKER}}', () => marker || '').replace('{{LANG}}', () => page.language)
    .replace('{{DATA}}', () => json(page)).replace('{{TRANSLATIONS}}', () => json({ lang: page.language, items: used }));
  const file = path.join(dir, 'index.html');
  fs.writeFileSync(file, html);
  return file;
}

// Puts Claude's translations (translated.json: { "<id>": "<text>" } for every text of translate.json)
// into the waiting page.
function applyTranslations(root) {
  const dir = pageDir(root);
  const waiting = readJsonOr(path.join(dir, PENDING));
  const asked = readJsonOr(path.join(dir, TO_TRANSLATE));
  if (!waiting || !asked) return refuse('nothing waits for a translation: build the page first');
  const given = readJsonOr(path.join(dir, TRANSLATED));
  if (!given || typeof given !== 'object' || Array.isArray(given)) return refuse(`no translations: write ${path.join(dir, TRANSLATED)} as { "<id>": "<translated text>" }`);
  const lacking = asked.texts.filter((t) => typeof given[t.id] !== 'string' || !given[t.id].trim()).map((t) => t.id);
  if (lacking.length) return refuse(`${lacking.length} texts have no translation: ${lacking.slice(0, 5).join(', ')}${lacking.length > 5 ? '...' : ''}`);
  const known = { ...waiting.known };
  for (const t of asked.texts) known[t.id] = given[t.id];
  let file;
  try {
    file = render(dir, waiting.page, waiting.marker, known);
    for (const name of [PENDING, TO_TRANSLATE, TRANSLATED]) fs.rmSync(path.join(dir, name), { force: true });
  } catch (e) { return refuse(e.message); }
  return [`page: ${file}`, `translated: ${asked.texts.length} texts, ${asked.from} to ${asked.to}`];
}

function readJsonOr(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// An earlier page saved to a file: whose repository it is and its language.
function peek(file) {
  const html = read(file);
  if (html === null) return refuse(`cannot read ${file}`);
  const p = readPage(html);
  return [`marker: ${p.marker || 'none'}`, `language: ${p.lang || 'none'}`, `translations: ${Object.keys(p.translations.items).length}${p.translations.lang ? ` (${p.translations.lang})` : ''}`];
}

function cleanPage(root) {
  const dir = pageDir(root);
  if (!fs.existsSync(dir)) return ['clean: nothing to remove'];
  fs.rmSync(dir, { recursive: true, force: true });
  return [`clean: removed ${path.relative(root, dir).split(path.sep).join('/')}`];
}

if (require.main === module) {
  let lines;
  try {
    const { opts, pos } = parseArgs(process.argv.slice(2));
    const root = path.resolve(pos[0] || process.env.CLAUDE_PROJECT_DIR || process.cwd());
    // A flag followed by a word takes it as its value: `--taken message-notify` names the feature.
    const feature = pos[1] ?? (typeof opts.taken === 'string' ? opts.taken : undefined);
    const str = (v) => (typeof v === 'string' ? v : null);
    lines = feature === 'clean' ? cleanPage(root) : feature === 'apply' ? applyTranslations(root) : feature === 'peek' ? peek(pos[2] || '')
      : build(root, feature, { taken: opts.taken !== undefined, lang: str(opts.lang), previous: str(opts.previous) });
  } catch (e) {
    lines = [`feature-page: unavailable (${e.message})`];
  }
  process.stdout.write(lines.join('\n') + '\n');
  process.exit(0);
}

module.exports = { build, applyTranslations, cleanPage, sectionsOf, termsOf, remoteKey };
