'use strict';
// /keel:feature-page: a feature's md files and its tickets' states as data in a fixed HTML template
// (templates/feature-page/: index.html, style.css and page.js, with the keel design system of
// templates/design/ beside them), for the Artifact tool to publish. The texts go in as they are: the page renders the markdown and highlights the code itself, with libraries from cdnjs.
// - A feature folder (plan.md, tickets/T<n>-*.md, research/); each ticket's state is its status field,
//   an elsewhere ticket's as its file in its repository says (as plans.js tickets reads it).
//   A stub (lib/plans-stubs.js) is shown with its text and marked; a ticket of another repository
//   (repo:) under that repository's name.
// - The page's title, the same from every machine and repository of the feature: <the plan's heading>
//   (<code>): the heading cut to 80 characters and the feature's code (`page:` in plan.md, lib/plans.js),
//   by which the page is found again. A plan without one gets it here.
// - Its language: --lang, else the earlier page's (--previous, that page saved to a file), else the
//   conversation's. Labels come from locales/<code>.json; texts in another language than the
//   tickets' wait in translate.json for Claude, and `apply` puts the translations in
//   (lib/feature-page-text.js). The page keeps them, so the next update translates only new texts.
// Nothing is kept: the page goes to .keel/local/tmp/feature-page/ and `clean` removes it after the
// publish. Reads git and the files only, but for the code a feature without one gets (see above).
// Usage: node feature-page.js <projectDir> [<feature>] [--lang <code>] [--previous <file>]
//                                         the page; no feature: the current branch's
//        node feature-page.js <projectDir> apply         puts translated.json into the waiting page
//        node feature-page.js <projectDir> clean         removes the page's folder
const fs = require('node:fs');
const path = require('node:path');
const plans = require('./lib/plans.js');
const { nextOf, featureTickets } = require('./lib/plans-state.js');
const { planNeedsReview } = require('./lib/plans-drafts.js');
const { settings } = require('./lib/plans-settings.js');
const { headOf } = require('./lib/plans-repos.js');
const { outsideFences, heading, repoName, isStub } = require('./lib/plans-format.js');
const { git, read, clean } = require('./lib/repo-read.js');
const { safeLocalPath } = require('./lib/safe-path.js');
const { parseArgs } = require('./lib/project.js');
const { effectiveOptions } = require('./lib/options.js');
const { langCode, labelsFor, missing, translate, readPage } = require('./lib/feature-page-text.js');

const { DESIGN_DIR, DESIGN_FILES } = require('./lib/design-files.js');

const TEMPLATE_DIR = path.join(__dirname, '..', 'templates', 'feature-page');
const TEMPLATE = path.join(TEMPLATE_DIR, 'index.html');
// The page's other files, published beside index.html as they are: its own style.css and page.js, and
// the keel design system (templates/design/). keel-mark.png is binary; copyFileSync copies bytes.
const PAGE_ASSETS = ['style.css', 'page.js', ...DESIGN_FILES];
const assetPath = (name) => path.join(DESIGN_FILES.includes(name) ? DESIGN_DIR : TEMPLATE_DIR, name);
const DONE = 'done';
const UNKNOWN = 'state unknown';
const OPEN_PLAN = ['ready', 'in-progress'];

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
    const m = /^\s*[-*]\s+(?:\*\*|__)?`?([^`*\n:—–]{1,60}?)`?(?:\*\*|__)?\s*(?::|—|–|\s-\s)\s*(\S.*)$/.exec(l);
    const term = m ? m[1].trim() : '';
    // An empty term would match everywhere on the page and stop its hints.
    if (term) out.push({ term, text: m[2].trim() });
  }
  return out;
}

function researchOf(folder) {
  const dir = path.join(folder, 'research');
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && /\.md$/i.test(e.name)).map((e) => e.name).sort(); } catch { /* none */ }
  return names.map((name) => { const text = read(path.join(dir, name)) || ''; return { name, title: titleOf(text) || name, sections: sectionsOf(text) }; });
}

// The code a file's front matter holds, or null.
const codeIn = (fm) => (plans.PAGE_CODE.test(fm.page || '') ? fm.page : null);
const TITLE_HEADING_MAX = 80;

// The feature's repositories, this project's first: [{ prefix, name, folder, commit }]. Another
// repository a ticket names (repo:) is listed by that name, its state as the ticket's file says.
function reposOf(root, all) {
  const out = [{ prefix: '', name: repoName(root), folder: root, commit: headOf(root) }];
  for (const r of [...new Set(all.map((t) => (given(t.fm.repo) ? t.fm.repo.trim() : '')).filter(Boolean))]) out.push({ prefix: r, name: clean(r, 60), folder: null, commit: null });
  return out;
}

const ticketOf = (key, text, extra) => {
  const sections = text ? sectionsOf(text) : null;
  return { key, title: text ? heading(text)[1] : '', sections, md: text ? lf(text) : null, ...(sections ? sizeOf(sections) : { files: 0, criteria: 0 }), ...extra };
};

// A status as the page names it (templates/feature-page/page.js STATE_KEYS).
const PAGE_STATE = { draft: 'draft', ready: 'to do', 'in-progress': 'in progress', done: DONE, abandoned: 'abandoned' };
const pageState = (status) => PAGE_STATE[status] || UNKNOWN;
// The "needs review" mark, as plans.js tickets shows it: an open ticket whose text changed since its review.
const needsMark = (t) => !t.unknown && !plans.CLOSED.includes(t.fm.status) && plans.needsReview(t);

function featureData(root, found) {
  // A feature made before plans carried the code gets one; it is keel's own field and no edit of the plan.
  const d = codeIn(found.fm) ? found : plans.writePlan(root, found, { page: plans.pageCode() });
  const all = featureTickets(root, d);
  const repos = reposOf(root, all);
  const byId = new Map(all.map((t) => [t.id, t]));
  const next = OPEN_PLAN.includes(d.fm.status) ? nextOf(all) : null;
  const depOf = (k) => {
    const x = byId.get(k.toUpperCase());
    return { key: k, met: x ? x.fm.status === 'done' : false, state: x ? pageState(x.fm.status) : 'not found', feature: null, where: null };
  };
  const tickets = all.map((t) => {
    const repo = given(t.fm.repo) ? t.fm.repo.trim() : '';
    return ticketOf(t.id, t.text, { prefix: repo, repo: repo ? clean(repo, 60) : repos[0].name, state: pageState(t.fm.status), ...(isStub(t.fm) ? { stub: true } : {}), ...(needsMark(t) ? { review: true } : {}), next: t === next, via: null, onBranch: null, depends: plans.ticketIds(t.fm.depends_on).map(depOf) });
  });
  return { code: d.fm.page, stage: d.fm.status, review: planNeedsReview(d), overviewText: d.text, overviewFile: 'plan.md', repos, tickets, research: researchOf(d.folder), folder: d.folder, language: given(d.fm.language) ? d.fm.language : settings(root).language };
}

// The feature of the current branch: one whose branch (or name) it is, or whose ticket's branch it is;
// `all` every feature here, for the question.
function currentFeature(root) {
  const branch = git(root, ['symbolic-ref', '-q', '--short', 'HEAD']);
  const features = plans.listDrafts(root);
  const all = features.map((d) => d.feature);
  const on = branch ? features.filter((d) => d.fm.branch === branch || d.feature === branch || plans.tickets(d).some((t) => t.fm.branch === branch)).map((d) => d.feature) : [];
  return { branch, all, on };
}

// `lang`: the page's language, else the earlier page's (`previous`, its file), else the conversation's.
function build(root, arg, { now = new Date(), lang = null, previous = null } = {}) {
  let feature = arg;
  if (feature === undefined) {
    const c = currentFeature(root);
    if (c.on.length !== 1) {
      const why = !c.branch ? 'HEAD is detached' : c.on.length ? `the branch ${c.branch} has several: ${c.on.join(', ')}` : `the branch ${c.branch} is no feature's branch`;
      return [`feature: none (${why})`, `features: ${c.all.join(', ') || 'none'}`];
    }
    feature = c.on[0];
  }
  if (!plans.validFeature(feature)) return refuse(`invalid feature name "${clean(String(feature), 60)}"`);
  const found = plans.listDrafts(root).find((d) => d.feature === feature);
  if (!found) return refuse(`no feature ${feature} in this working tree; on another branch: switch to it first`);
  let data;
  try { data = featureData(root, found); } catch (e) { return refuse(e.message); }
  // The page leaves this machine: a feature file that names one of its folders is fixed first.
  const folders = plans.machineFolders(root);
  const local = [
    ...(data.overviewText ? plans.localProblems(data.overviewFile, data.overviewText, folders) : []),
    ...data.tickets.flatMap((t) => (t.md ? plans.localProblems(t.key, t.md, folders) : [])),
    ...plans.researchTexts(data.folder).flatMap((r) => plans.localProblems(r.name, r.text, folders)),
  ];
  if (local.length) {
    try { fs.rmSync(path.join(pageDir(root), 'index.html'), { force: true }); } catch { /* none */ }
    return [...refuse(`${local.length} paths of this machine in the feature's files; write them from the repository's root`), ...local.map((p) => `- ${p}`)];
  }
  const heading = (data.overviewText && titleOf(data.overviewText)) || feature;
  const chars = [...heading.trim()];
  const shown = chars.length > TITLE_HEADING_MAX ? `${chars.slice(0, TITLE_HEADING_MAX - 1).join('').trimEnd()}…` : chars.join('');
  const title = `${shown} (${data.code})`;
  if (lang && !langCode(lang)) return refuse(`"${clean(String(lang), 40)}" is no language code: give one such as en, uk, de`);
  const earlier = previous ? read(previous) : null;
  if (previous && earlier === null) return refuse(`cannot read ${previous}`);
  const before = earlier === null ? null : readPage(earlier);
  const pageLang = langCode(lang) || (before && before.lang) || langCode(effectiveOptions(root).conversation_language) || 'en';
  const source = langCode(data.language) || 'en';
  const { labels, own } = labelsFor(pageLang);
  const secs = data.overviewText ? sectionsOf(data.overviewText) : [];
  const page = {
    feature, title, stage: data.stage, review: data.review, generated: now.toISOString(), fetchFailed: false,
    language: pageLang, source, labels,
    heading,
    repos: data.repos.map((r) => ({ prefix: r.prefix, name: r.name, commit: r.commit })),
    overview: data.overviewText ? { file: data.overviewFile, sections: secs } : null,
    terms: termsOf(secs), tickets: data.tickets, research: data.research,
  };
  const known = before && before.translations.lang === pageLang ? before.translations.items : {};
  const todo = pageLang === source ? [] : missing(page, known);
  const done = data.tickets.filter((t) => t.state === DONE).length;
  const info = [
    `title: ${title}`,
    `code: ${data.code}`,
    `feature: ${feature}, ${data.stage}, ${data.tickets.length} tickets (${done} done)`,
    `as of: ${data.repos.map((r) => `${r.name} ${r.commit || 'not on this machine'}`).join(', ')}`,
    `language: ${pageLang}${own ? '' : ' (labels in English: no page labels in this language)'}; texts in ${source}`,
  ];
  let dir;
  try {
    dir = pageDir(root);
    fs.mkdirSync(dir, { recursive: true });
    for (const name of ['index.html', PENDING, TO_TRANSLATE, TRANSLATED]) fs.rmSync(path.join(dir, name), { force: true });
    if (!todo.length) return [`page: ${render(dir, page, known)}`, ...info];
    // The texts to translate wait with the page until `apply` brings their translations.
    fs.writeFileSync(path.join(dir, PENDING), JSON.stringify({ page, known }));
    fs.writeFileSync(path.join(dir, TO_TRANSLATE), JSON.stringify({ from: source, to: pageLang, texts: todo }, null, 1));
  } catch (e) { return refuse(e.message); }
  const words = todo.reduce((n, t) => n + t.text.split(/\s+/).length, 0);
  return [`translate: ${path.join(dir, TO_TRANSLATE)} (${todo.length} texts, about ${words} words, ${source} to ${pageLang}; write ${path.join(dir, TRANSLATED)}, then run apply)`, ...info];
}

const PENDING = 'pending.json';
const TO_TRANSLATE = 'translate.json';
const TRANSLATED = 'translated.json';

// The page file: the template with the data, its language and the translations it used.
function render(dir, page, known) {
  // translate() replaces the texts inside `page` itself, before the page goes into the template.
  const used = page.language === page.source ? {} : translate(page, known);
  if (Object.keys(used).length) page.translatedFrom = page.source;
  // "<" as the escape <: a "</script>" in a ticket's text cannot close a data block. Replacement functions,
  // not strings: a text with $& or $' must not be read as a replacement pattern.
  const json = (o) => JSON.stringify(o).replace(/</g, '\\u003c');
  // One pass over the template: a placeholder that a title or a ticket's text holds is never filled.
  const values = { TITLE: escapeHtml(page.title), LANG: page.language, DATA: json(page), TRANSLATIONS: json({ lang: page.language, items: used }) };
  const html = fs.readFileSync(TEMPLATE, 'utf8').replace(/\{\{(TITLE|LANG|DATA|TRANSLATIONS)\}\}/g, (m, key) => values[key]);
  const file = path.join(dir, 'index.html');
  fs.writeFileSync(file, html);
  for (const name of PAGE_ASSETS) fs.copyFileSync(assetPath(name), path.join(dir, name));
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
    file = render(dir, waiting.page, known);
    for (const name of [PENDING, TO_TRANSLATE, TRANSLATED]) fs.rmSync(path.join(dir, name), { force: true });
  } catch (e) { return refuse(e.message); }
  return [`page: ${file}`, `translated: ${asked.texts.length} texts, ${asked.from} to ${asked.to}`];
}

function readJsonOr(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
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
    const root = require('./lib/project-dir.js').scriptProject(pos[0]);
    const str = (v) => (typeof v === 'string' ? v : null);
    // "--fetch <feature>" (keel 2.0.0's flag, no longer used): parseArgs takes the word as its value; it is the feature.
    const feature = pos[1] ?? str(opts.fetch) ?? undefined;
    lines = feature === 'clean' ? cleanPage(root) : feature === 'apply' ? applyTranslations(root)
      : build(root, feature, { lang: str(opts.lang), previous: str(opts.previous) });
  } catch (e) {
    lines = [`feature-page: unavailable (${e.message})`];
  }
  process.stdout.write(lines.join('\n') + '\n');
  process.exit(0);
}

module.exports = { termsOf, PAGE_ASSETS, PAGE_STATE, UNKNOWN };
