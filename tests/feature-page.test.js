'use strict';
// feature-page.js: a feature's md files and states as data in the page template. Throwaway
// repositories; no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { tempDir } = require('./fixtures/tmp.js');

const SCRIPTS = path.join(__dirname, '..', 'plugins', 'keel', 'scripts');
const vm = require('node:vm');
const { termsOf, PAGE_ASSETS, PAGE_STATE } = require(path.join(SCRIPTS, 'feature-page.js'));
const { langCode, readPage } = require(path.join(SCRIPTS, 'lib', 'feature-page-text.js'));

const hasGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const gitTest = (name, fn) => test(name, { skip: !hasGit && 'git is not installed' }, fn);

const CONFIG = {
  schema_version: 1,
  repo_language: 'en',
  gates: { checks: [], security_scanners: [] },
  git: { mode: 'autonomous', main_branch: 'main', ask_before_merge: true, state_in_git: true },
  verification: {
    tier_rules: { gates_only_max_files: 1, basic_max_modules: 1, large_change_lines: 400, very_large_change_lines: 1000 },
    verifier_caps: { basic: 3, standard: 5, maximum: 8 },
  },
  architecture: { file_lines_warn: 700, file_lines_max: 1000 },
  docs: { profile: 1, pattern: 'none' },
  planning: { place: 'repo', language: 'uk' },
};

const FEATURE = 'message-notify';
// The feature's code in its plan.md.
const PAGE = '3f9a2c1b';
const T = `tickets/${FEATURE}`;

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
// The conversation in Ukrainian, as the tickets: no translation unless a test asks for it.
const runIn = (lang) => (dir, ...args) => spawnSync(process.execPath, [path.join(SCRIPTS, 'feature-page.js'), dir, ...args],
  { encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_OPTION_CONVERSATION_LANGUAGE: lang } }).stdout.trim().split('\n');
const run = runIn('uk');
const plans = (dir, ...args) => spawnSync(process.execPath, [path.join(SCRIPTS, 'plans.js'), dir, ...args], { encoding: 'utf8' }).stdout.trim().split('\n');
const line = (out, name) => (out.find((l) => l.startsWith(`${name}: `)) || '').slice(name.length + 2);

// The page's data block, as the page reads it.
function pageData(file) {
  const html = fs.readFileSync(file, 'utf8');
  const m = /<script type="application\/json" id="feature-data">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(m, 'the page has its data block');
  return { html, data: JSON.parse(m[1]) };
}

// A full ticket: every section, a code block, three criteria and two files in Where to look.
const FULL = (id, status = 'ready', depends = '', extra = '') => `---
id: ${id}
type: ticket
status: ${status}
depends_on: ${depends}
${extra}review_hash: -
---

# [${id}] Цифра непрочитаних на іконці чату

## In plain words
Коли чат закритий, на іконці з'являється червона цифра. Подія приходить через WebSocket.

## Example
- 3 нові повідомлення → «3»

## Goal
Показати цифру.

## Acceptance criteria
- [ ] Чат закритий, прийшла подія — цифра +1
- [ ] Понад 99 — «99+»
- [x] Чат відкрили — цифра зникла

## How to check
\`\`\`bash
npm test -- chat-badge
## not a section
\`\`\`

## Boundaries
- always: змінювати компоненти в \`src/features/chat/\`
- ask first: якщо треба змінити формат події
- never: опитувати сервер таймером

## Correct the priors
Лічильник з нуля скидається після оновлення сторінки. </script><b>x</b>

## Where to look
- \`src/features/chat/ChatIcon.tsx:12\` — сама іконка
- \`src/shared/ws/client.ts:40\` — підписка

## Out of scope
Звук.

## Why
D1

## Dependencies
-
`;

// The same structure without the optional sections (Example, Correct the priors).
const BARE = (id, status = 'ready', depends = '', extra = '') => `---
id: ${id}
type: ticket
status: ${status}
depends_on: ${depends}
${extra}review_hash: -
---

# [${id}] Подія message.created

## In plain words
Бекенд шле подію після нового повідомлення.

## Goal
Подія є.

## Acceptance criteria
- [ ] Подія приходить

## How to check
Вручну.

## Boundaries
- always: тести
- ask first: схема
- never: опитування

## Where to look

## Out of scope

## Why
D1

## Dependencies
`;

const PLAN = ({ heading = 'Сповіщення про нове повідомлення', status = 'in-progress', page = PAGE } = {}) => `---
type: plan
status: ${status}
feature: ${FEATURE}
${page ? `page: ${page}\n` : ''}language: uk
branch: ${FEATURE}
merge_into: main
last_ticket: 2
ready_hash: -
---
# ${heading}

## In plain words
Коли комусь пишуть, він бачить цифру навіть у закритому чаті; подія приходить через WebSocket.

## Decisions
D1. Одна подія для всіх.

## Terms
- **WebSocket** — постійне з'єднання браузера з сервером
- подія: повідомлення від сервера

## Tickets
- T1 Подія message.created
- T2 Цифра непрочитаних на іконці чату
`;

function repo(tmp, name, remote) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'core.autocrlf', 'false');
  if (remote) git(dir, 'remote', 'add', 'origin', remote);
  write(dir, '.keel/config.json', JSON.stringify(CONFIG));
  write(dir, '.keel/.gitignore', 'local/\n');
  write(dir, 'src/app.js', 'module.exports = 1;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  git(dir, 'checkout', '-q', '-b', FEATURE);
  return dir;
}

// api: T1 done (bare), T2 ready after it (full); a research report; all in the repository.
function feature(tmp, { plan = PLAN(), remote = 'https://bot:s3cret-token@GitHub.com/Team/api.git' } = {}) {
  const api = repo(tmp, 'api', remote);
  write(api, `${T}/plan.md`, plan);
  write(api, `${T}/tickets/T1-event.md`, BARE('T1', 'done'));
  write(api, `${T}/tickets/T2-badge.md`, FULL('T2', 'ready', 'T1'));
  write(api, `${T}/research/websocket.md`, '# WebSocket чи опитування\n\n## Question\nЯк доставити подію?\n\n## Recommendation\nWebSocket.\n');
  git(api, 'add', '-A');
  git(api, 'commit', '-q', '-m', 'Plan the notify feature');
  // The tickets as reviewed: T2 is next only so.
  plans(api, 'reviewed', FEATURE, 'T1', 'T2');
  return api;
}

gitTest('a feature: its texts, states from the status fields, sizes and terms go into the page as they are; the title has no prefixes', () => {
  const tmp = tempDir('keel-page-');
  const api = feature(tmp);
  const out = run(api, FEATURE);
  assert.equal(line(out, 'code'), PAGE);
  assert.equal(line(out, 'title'), `Сповіщення про нове повідомлення (${PAGE})`);
  assert.equal(line(out, 'feature'), `${FEATURE}, in-progress, 2 tickets (1 done)`);
  assert.match(line(out, 'as of'), /^api [0-9a-f]{7,}$/);
  const file = line(out, 'page');
  assert.equal(path.relative(api, file).split(path.sep).join('/'), '.keel/local/tmp/feature-page/index.html');
  const { html, data } = pageData(file);

  assert.ok(html.includes(`<title>Сповіщення про нове повідомлення (${PAGE})</title>`));
  assert.ok(html.indexOf('<title>') < 8192, 'the host reads the title in the first 8KB');
  assert.equal(data.heading, 'Сповіщення про нове повідомлення');
  assert.equal(data.stage, 'in-progress');
  assert.equal(data.language, 'uk');
  assert.equal(data.overview.file, 'plan.md');
  assert.deepEqual(data.overview.sections.map((s) => s.name), ['In plain words', 'Decisions', 'Terms', 'Tickets']);
  assert.deepEqual(data.terms, [{ term: 'WebSocket', text: "постійне з'єднання браузера з сервером" }, { term: 'подія', text: 'повідомлення від сервера' }]);

  const [one, two] = data.tickets;
  assert.deepEqual([one.key, one.state, one.next, two.key, two.state, two.next], ['T1', 'done', false, 'T2', 'to do', true]);
  assert.deepEqual(two.depends, [{ key: 'T1', met: true, state: 'done', feature: null, where: null }]);
  assert.equal(two.title, 'Цифра непрочитаних на іконці чату');
  assert.equal(two.repo, 'api');
  assert.deepEqual([two.files, two.criteria], [2, 3]);
  // The text as it is: a "## " inside a code block stays in its section.
  const sectionText = (name) => two.sections.find((s) => s.name === name).text;
  assert.equal(sectionText('How to check'), '```bash\nnpm test -- chat-badge\n## not a section\n```');
  assert.ok(FULL('T2').includes(sectionText('Correct the priors')));
  assert.equal(two.sections.length, 11);
  // The whole file too, front matter included, for the page's "MD file" window.
  assert.match(two.md, /^---\n[\s\S]*\n---\n/);
  assert.ok(two.md.includes('# [T2] Цифра непрочитаних на іконці чату') && two.md.includes(sectionText('How to check')));
  // A ticket without the optional sections: the others, in their order, and its size.
  assert.deepEqual(one.sections.map((s) => s.name), ['In plain words', 'Goal', 'Acceptance criteria', 'How to check', 'Boundaries', 'Where to look', 'Out of scope', 'Why', 'Dependencies']);
  assert.deepEqual([one.files, one.criteria], [0, 1]);
  assert.deepEqual(data.research.map((r) => [r.name, r.title, r.sections.map((s) => s.name)]), [['websocket.md', 'WebSocket чи опитування', ['Question', 'Recommendation']]]);

  // The page's state words for each status; a ticket that needs review or waits for a dependency is no next.
  plans(api, 'status', FEATURE, 'T2', 'in-progress');
  assert.deepEqual(pageData(line(run(api, FEATURE), 'page')).data.tickets.map((t) => [t.state, t.next]), [['done', false], ['in progress', false]]);
  plans(api, 'status', FEATURE, 'T1', 'abandoned', '--reason', 'не треба');
  // plans.js never moves a ticket back: the field by hand, as the page only reads it.
  write(api, `${T}/tickets/T2-badge.md`, fs.readFileSync(path.join(api, T, 'tickets', 'T2-badge.md'), 'utf8').replace('status: in-progress', 'status: ready'));
  const after = pageData(line(run(api, FEATURE), 'page')).data.tickets;
  assert.deepEqual(after.map((t) => [t.state, t.next]), [['abandoned', false], ['to do', false]]);
  assert.deepEqual(after[1].depends, [{ key: 'T1', met: false, state: 'abandoned', feature: null, where: null }]);

  // A "</script>" in a ticket cannot end the data block (the page's own: two data blocks, the theme
  // script, three libraries, its script); the token in the remote URL is not on the page.
  assert.equal((html.match(/<\/script>/g) || []).length, 7);
  assert.ok(!html.includes('s3cret'));
  assert.ok(!html.includes(tmp) && !html.includes(tmp.split(path.sep).join('/')), 'no local path on the page');
});

const TEMPLATES = path.join(__dirname, '..', 'plugins', 'keel', 'templates');
const TEMPLATE_DIR = path.join(TEMPLATES, 'feature-page');
const DESIGN_DIR = path.join(TEMPLATES, 'design');
// The folder itself, not a list: a file added to the design system must reach the page.
const DESIGN_FILES = fs.readdirSync(DESIGN_DIR);

gitTest('the page\'s other files lie beside it as they are (the design system byte for byte), and the page loads no local file that is not there', () => {
  const tmp = tempDir('keel-page-');
  const file = line(run(feature(tmp), FEATURE), 'page');
  const dir = path.dirname(file);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['index.html', 'style.css', 'page.js', ...DESIGN_FILES].sort());
  const same = (name, from) => assert.ok(fs.readFileSync(path.join(dir, name)).equals(fs.readFileSync(path.join(from, name))), `${name} is copied as it is`);
  for (const name of ['style.css', 'page.js']) same(name, TEMPLATE_DIR);
  for (const name of DESIGN_FILES) same(name, DESIGN_DIR);
  const html = fs.readFileSync(file, 'utf8');
  const local = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((u) => !/^https?:/.test(u));
  for (const name of ['keel.css', 'style.css', 'keel-theme.js']) assert.ok(local.includes(name), `${name} is loaded: ${local.join(', ')}`);
  for (const name of local) assert.ok(fs.existsSync(path.join(dir, name)), `${name} is loaded by the page but is not beside it`);
  assert.match(fs.readFileSync(path.join(dir, 'keel.css'), 'utf8'), /url\("keel-mark\.png"\)/, 'the design system draws the mark from the file beside it');
});

test('the page\'s other files: the list, the template folders and the publish step name the same files', () => {
  assert.deepEqual([...PAGE_ASSETS].sort(), [...fs.readdirSync(TEMPLATE_DIR).filter((n) => n !== 'index.html'), ...DESIGN_FILES].sort());
  for (const name of DESIGN_FILES) assert.ok(fs.existsSync(path.join(DESIGN_DIR, name)), `${name} is in templates/design`);
  const build = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'keel', 'skills', '_shared', 'feature-page-build.md'), 'utf8');
  const step = build.slice(build.indexOf('3. **Publish.**'), build.indexOf('4. **Reply**'));
  assert.ok(step.length > 0, 'the build instructions have the publish step');
  assert.match(step, /Read the whole page file and every other file beside it/, 'the publish step reads the page and its files');
  assert.match(step, /keel-mark\.png` \(the image is read as an image\)/, 'the image is read as an image');
  for (const name of PAGE_ASSETS) {
    const n = name.replace(/\./g, '\\.');
    assert.match(step, new RegExp(`\`${n}\``), `the publish step reads ${name}`);
    assert.match(step, new RegExp(`"${n}": "<the ${n} beside it>"`), `the publish step publishes ${name}`);
  }
});

test('the page template: a fragment (the publish tool adds the document) that loads the design system at the top in order, with no colour literal and no prefers-color-scheme', () => {
  const html = fs.readFileSync(path.join(TEMPLATE_DIR, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /<!doctype|<\/?(?:html|head|body)\b|<meta charset|name="viewport"/i, 'the publish tool wraps the page in its own document');
  assert.ok(html.startsWith('<title>{{TITLE}}</title>\n'), 'the title is the first line');
  const head = html.slice(0, html.indexOf('<div'));
  const at = (re) => head.search(re);
  const fonts = at(/<link[^>]*fonts\.googleapis\.com\/css2\?family=IBM\+Plex\+Sans:wght@400;500;600&family=IBM\+Plex\+Mono:wght@400;500&/);
  const keel = at(/<link rel="stylesheet" href="keel\.css">/);
  const style = at(/<link rel="stylesheet" href="style\.css">/);
  const theme = at(/<script src="keel-theme\.js"><\/script>/);
  assert.ok(fonts >= 0 && fonts < keel && keel < style && style < theme, `fonts ${fonts}, keel.css ${keel}, style.css ${style}, keel-theme.js ${theme}`);
  assert.match(head, /<script src="keel-theme\.js"><\/script>\s*$/, 'keel-theme.js is a plain script, the last thing before the page\'s first element');

  // A hex colour is # and 3, 4, 6 or 8 hex digits that no name continues (`#dec-D3` is an id).
  const hex = /(?<![\w&])#([0-9a-fA-F]+)(?![\w-])/g;
  const named = /(?<![\w-])(?:white|black|red|green|blue|gray|grey|silver|orange|yellow|purple|pink|brown|teal|navy|cyan|magenta|lime|maroon|olive|aqua|fuchsia|gold|coral|crimson|indigo|violet)(?![\w-])/;
  const lines = {};
  for (const name of ['index.html', 'style.css', 'page.js']) {
    const text = fs.readFileSync(path.join(TEMPLATE_DIR, name), 'utf8');
    lines[name] = text.split('\n').length;
    const literals = [...text.matchAll(hex)].filter((m) => [3, 4, 6, 8].includes(m[1].length)).map((m) => m[0]);
    assert.deepEqual(literals, [], `${name}: hex colours`);
    assert.doesNotMatch(text, /\b(?:rgba?|hsla?|oklch|oklab|hwb|lab|lch|color)\(/, `${name}: colour functions`);
    assert.doesNotMatch(text, /prefers-color-scheme|data-theme/, `${name}: the theme is keel-theme.js's, dark first`);
  }
  const css = fs.readFileSync(path.join(TEMPLATE_DIR, 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of css.matchAll(/([\w-]+)\s*:\s*([^;{}]+)[;}]/g)) {
    if (/^(?:color|background|background-color|border(?:-[a-z]+)*|outline|outline-color|fill|stroke|box-shadow|accent-color)$/.test(m[1])) assert.doesNotMatch(m[2], named, `${m[1]}: ${m[2]}`);
  }
  // The diagrams follow the theme switch: they read KeelTheme and the tokens, and redraw on its event.
  const script = fs.readFileSync(path.join(TEMPLATE_DIR, 'page.js'), 'utf8');
  assert.match(script, /KeelTheme\.get\(\)/);
  assert.match(script, /KeelTheme\.control\(\{ label: L\('theme'\), dark: L\('theme_dark'\), light: L\('theme_light'\) \}\)/);
  const bare = script.split('\n').filter((l) => /KeelTheme\./.test(l) && !/window\.KeelTheme (?:\?|&&)|!window\.KeelTheme \|\|/.test(l));
  assert.deepEqual(bare, [], 'a page published without keel-theme.js still draws: every use of KeelTheme is guarded');
  assert.match(script, /document\.addEventListener\('keel-theme'/);
  assert.match(script, /getComputedStyle\(document\.documentElement\)\.getPropertyValue\(name\)/);
  assert.doesNotMatch(script, /matchMedia\('\(prefers-color-scheme/);
  for (const [name, n] of Object.entries(lines)) assert.ok(n < 700, `${name} has ${n} lines`);
});

gitTest('the code: the plan\'s own, whatever the remote; a plan without one gets one written into plan.md', () => {
  const tmp = tempDir('keel-page-');
  const title = (n, opts) => {
    const dir = path.join(tmp, n);
    fs.mkdirSync(dir);
    return line(run(feature(dir, opts), FEATURE), 'title');
  };
  assert.equal(title('1'), title('2', { remote: null }), 'no remote: the same page');
  // A long heading is cut, the code stays whole.
  const long = title('3', { plan: PLAN({ heading: 'Дуже довга назва '.repeat(8) }) });
  assert.match(long, new RegExp(`^Дуже довга назва .{40,80}… \\(${PAGE}\\)$`), long);
  const dir = path.join(tmp, '4');
  fs.mkdirSync(dir);
  const api = feature(dir, { plan: PLAN({ page: null }) });
  const code = line(run(api, FEATURE), 'code');
  assert.match(code, /^[0-9a-f]{8}$/);
  assert.match(fs.readFileSync(path.join(api, T, 'plan.md'), 'utf8'), new RegExp(`^page: ${code}$`, 'm'));
  assert.equal(line(run(api, FEATURE), 'code'), code, 'the next build reads it from plan.md');
});

gitTest('the page\'s language: the conversation\'s; texts in another language wait for a translation, kept in the page for the next update', () => {
  const tmp = tempDir('keel-page-');
  const api = feature(tmp);
  const dir = path.join(api, '.keel', 'local', 'tmp', 'feature-page');
  const out = runIn('en')(api, FEATURE);
  assert.equal(line(out, 'page'), '', 'no page until the texts are translated');
  assert.match(line(out, 'language'), /^en; texts in uk$/);
  assert.match(line(out, 'translate'), /\(\d+ texts, about \d+ words, uk to en; write .*translated\.json, then run apply\)$/);
  const asked = JSON.parse(fs.readFileSync(path.join(dir, 'translate.json'), 'utf8'));
  assert.deepEqual([asked.from, asked.to], ['uk', 'en']);
  assert.ok(asked.texts.some((t) => t.text === 'Цифра непрочитаних на іконці чату'), 'a ticket title');
  assert.ok(asked.texts.some((t) => t.text === 'WebSocket'), 'a term');
  assert.equal(new Set(asked.texts.map((t) => t.id)).size, asked.texts.length, 'each text once');

  const translated = Object.fromEntries(asked.texts.map((t) => [t.id, `EN ${t.text}`]));
  delete translated[asked.texts[0].id];
  fs.writeFileSync(path.join(dir, 'translated.json'), JSON.stringify(translated));
  assert.match(run(api, 'apply')[0], /^feature-page: refused \(1 texts have no translation: /);
  translated[asked.texts[0].id] = `EN ${asked.texts[0].text}`;
  fs.writeFileSync(path.join(dir, 'translated.json'), JSON.stringify(translated));
  const applied = run(api, 'apply');
  assert.equal(line(applied, 'translated'), `${asked.texts.length} texts, uk to en`);
  const { html, data } = pageData(line(applied, 'page'));
  assert.match(html, /<meta name="keel-feature-lang" content="en">/);
  assert.deepEqual([data.language, data.source, data.translatedFrom], ['en', 'uk', 'uk']);
  assert.equal(data.tickets[1].title, 'EN Цифра непрочитаних на іконці чату');
  assert.equal(data.labels['section.acceptance_criteria'], 'Done when');
  assert.ok(!fs.existsSync(path.join(dir, 'translate.json')), 'the waiting files go');

  // The next update: only what changed is asked for.
  const saved = path.join(tmp, 'published.html');
  fs.copyFileSync(line(applied, 'page'), saved);
  const said = (file) => { const p = readPage(fs.readFileSync(file, 'utf8')); return [p.lang, p.translations.lang, Object.keys(p.translations.items).length]; };
  assert.deepEqual(said(saved), ['en', 'en', asked.texts.length]);
  // A tool that reads a page by lines needs only its first ones: the language and the translations.
  const head = path.join(tmp, 'head.html');
  fs.writeFileSync(head, fs.readFileSync(saved, 'utf8').split('\n').slice(0, 8).join('\n'));
  assert.deepEqual(said(head), said(saved));
  assert.match(line(run(api, FEATURE, '--previous', head), 'page'), /index\.html$/, 'the first lines are enough for the cache');
  assert.match(line(run(api, FEATURE, '--previous', saved), 'page'), /index\.html$/, 'all known: the page at once, in its language');
  write(api, `${T}/tickets/T2-badge.md`, FULL('T2', 'ready', 'T1').replace('Показати цифру.', 'Показати цифру одразу.'));
  const again = run(api, FEATURE, '--previous', saved);
  assert.match(line(again, 'translate'), /^\S.*\(1 texts, /);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'translate.json'), 'utf8')).texts[0].text, 'Показати цифру одразу.');

  // A language asked for wins; one without page labels gets English ones; not a code is refused.
  assert.match(line(run(api, FEATURE, '--lang', 'uk', '--previous', saved), 'page'), /index\.html$/, 'the tickets\' own language: no translation');
  assert.match(line(run(api, FEATURE, '--lang', 'de'), 'language'), /^de \(labels in English: no page labels in this language\); texts in uk$/);
  assert.match(run(api, FEATURE, '--lang', 'x1')[0], /^feature-page: refused \("x1" is no language code/);
  assert.match(run(api, FEATURE, '--lang', 'German')[0], /^feature-page: refused \("German" is no language code/, 'a name is not turned into a code');
});

gitTest('a draft on this machine: plan.md as the overview, its tickets as drafts, none next', () => {
  const tmp = tempDir('keel-page-');
  const api = repo(tmp, 'api', 'https://github.com/Team/api.git');
  assert.equal(plans(api, 'new', 'csv-export', '--place', 'pc')[0], 'created: .keel/local/plans/keel/csv-export/plan.md');
  const draft = path.join(api, '.keel', 'local', 'plans', 'keel', 'csv-export');
  const plan = fs.readFileSync(path.join(draft, 'plan.md'), 'utf8').replace(/## In plain words\n[^#]*/, '## In plain words\nЕкспорт рахунків у CSV.\n\n');
  fs.writeFileSync(path.join(draft, 'plan.md'), plan);
  write(draft, 'tickets/T1-export.md', FULL('T1', 'draft'));
  write(draft, 'tickets/T2-button.md', BARE('T2', 'draft', 'T1'));
  const out = run(api, 'csv-export');
  const code = /^page: ([0-9a-f]{8})$/m.exec(fs.readFileSync(path.join(draft, 'plan.md'), 'utf8'))[1];
  assert.equal(line(out, 'title'), `csv-export (${code})`, 'the plan\'s code, from plan.md');
  assert.equal(line(out, 'feature'), 'csv-export, draft, 2 tickets (0 done)');
  const { data } = pageData(line(out, 'page'));
  assert.equal(data.stage, 'draft');
  assert.equal(data.overview.sections.find((s) => s.name === 'In plain words').text, 'Експорт рахунків у CSV.');
  assert.deepEqual(data.tickets.map((t) => [t.key, t.state, t.next, t.repo, t.files, t.criteria]), [['T1', 'draft', false, 'api', 2, 3], ['T2', 'draft', false, 'api', 0, 1]]);
  assert.deepEqual(data.tickets[1].depends, [{ key: 'T1', met: false, state: 'draft', feature: null, where: null }]);
});

gitTest('a stub and a ticket of another repository: shown under that repository\'s name, the stub marked', () => {
  const tmp = tempDir('keel-page-');
  const api = feature(tmp);
  write(api, `${T}/tickets/T3-admin.md`, BARE('T3', 'ready', 'T9').replace('type: ticket', 'type: stub\nrepo: ADM'));
  write(api, `${T}/tickets/T4-web.md`, BARE('T4', 'ready').replace('type: ticket', 'type: ticket\nrepo: WEB'));
  const { data } = pageData(line(run(api, FEATURE), 'page'));
  const [, , stub, web] = data.tickets;
  assert.deepEqual([stub.key, stub.repo, stub.stub, web.key, web.repo, web.stub], ['T3', 'ADM', true, 'T4', 'WEB', undefined]);
  assert.deepEqual(stub.depends, [{ key: 'T9', met: false, state: 'not found', feature: null, where: null }]);
  assert.deepEqual(data.repos.map((r) => r.name), ['api', 'ADM', 'WEB']);
});

gitTest('no feature named: the current branch\'s, or a ticket\'s branch\'s, else none with the list; clean removes the page', () => {
  const tmp = tempDir('keel-page-');
  const api = feature(tmp);
  assert.equal(line(run(api), 'feature'), `${FEATURE}, in-progress, 2 tickets (1 done)`);
  write(api, `${T}/tickets/T2-badge.md`, FULL('T2', 'in-progress', 'T1', 'branch: message-notify-T2\n'));
  git(api, 'commit', '-qam', 'T2 in progress');
  git(api, 'checkout', '-q', '-b', 'message-notify-T2');
  assert.equal(line(run(api), 'feature'), `${FEATURE}, in-progress, 2 tickets (1 done)`, 'a ticket\'s own branch');
  git(api, 'checkout', '-q', 'main');
  assert.deepEqual(run(api), ['feature: none (the branch main is no feature\'s branch)', 'features: none']);
  git(api, 'checkout', '-q', FEATURE);
  plans(api, 'new', 'csv-export', '--place', 'pc');
  git(api, 'checkout', '-q', '-b', 'other-work');
  assert.deepEqual(run(api), ['feature: none (the branch other-work is no feature\'s branch)', `features: csv-export, ${FEATURE}`]);
  assert.deepEqual(run(api, 'no-such-feature'), ['feature-page: refused (no feature no-such-feature in this working tree; on another branch: switch to it first)']);
  assert.match(run(api, 'Bad Name')[0], /^feature-page: refused \(invalid feature name/);
  assert.deepEqual(run(api, 'clean'), ['clean: removed .keel/local/tmp/feature-page']);
  assert.ok(!fs.existsSync(path.join(api, '.keel', 'local', 'tmp', 'feature-page')));
  assert.deepEqual(run(api, 'clean'), ['clean: nothing to remove']);
});

gitTest('a research report with no heading is shown by its file name', () => {
  const tmp = tempDir('keel-page-');
  const api = feature(tmp);
  write(api, `${T}/research/notes.md`, 'Лише текст, без заголовка.\n');
  const { data } = pageData(line(run(api, FEATURE), 'page'));
  assert.deepEqual(data.research.map((r) => [r.name, r.title]), [['notes.md', 'notes.md'], ['websocket.md', 'WebSocket чи опитування']]);
});

gitTest('no path of this machine on the page: the script adds none, and a feature file with one is refused', () => {
  const tmp = tempDir('keel-page-');
  const api = feature(tmp);
  const file = line(run(api, FEATURE), 'page');
  const html = fs.readFileSync(file, 'utf8');
  const forms = (p) => [p, p.split(path.sep).join('/'), JSON.stringify(p).slice(1, -1)];
  for (const p of [api, tmp, require('node:os').homedir()]) {
    for (const f of forms(p)) assert.ok(!html.includes(f), `${f} on the page`);
  }
  const ticket = `${T}/tickets/T2-badge.md`;
  write(api, ticket, fs.readFileSync(path.join(api, ticket), 'utf8').replace('## Where to look', 'Як у C:\\Users\\ann\\api\\src\\chat.js.\n\n## Where to look'));
  const home = require('node:os').homedir().replace(/\\/g, '/');
  write(api, `${T}/research/websocket.md`, `# WebSocket\n\nПриклад у ${home}/api/ws.js\n`);
  const out = run(api, FEATURE);
  assert.equal(out[0], 'feature-page: refused (2 paths of this machine in the feature\'s files; write them from the repository\'s root)', out.join('\n'));
  assert.match(out[1], /^- T2: local path C:\\Users\\ann\\api\\src\\chat\.js \(line \d+\)$/);
  assert.equal(out[2], `- research/websocket.md: local path ${home}/api/ws.js (line 3)`);
  assert.ok(!fs.existsSync(file), 'no page is left to publish');
});

test('langCode takes language codes only; termsOf keeps snake_case terms and drops an empty one', () => {
  assert.deepEqual(['uk', 'uk-UA', 'pt_BR', 'DE', 'German', 'Ukrainian', '', 'x1'].map(langCode), ['uk', 'uk', 'pt', 'de', null, null, null, null]);
  const terms = termsOf([{ name: 'Terms', text: '- `ticket_prefix` — the key prefix\n-  — nothing\n- __bold__: text' }]);
  assert.deepEqual(terms, [{ term: 'ticket_prefix', text: 'the key prefix' }, { term: 'bold', text: 'text' }]);
});

test('the page template: its script parses, every label it names exists, and it knows every state the scripts write', () => {
  const html = fs.readFileSync(path.join(TEMPLATE_DIR, 'index.html'), 'utf8');
  assert.ok(html.includes('<script src="page.js"></script>'), 'the page loads its script from page.js');
  assert.doesNotMatch(html, /<script>/, 'no inline script');
  const scripts = [fs.readFileSync(path.join(TEMPLATE_DIR, 'page.js'), 'utf8')];
  assert.doesNotThrow(() => new vm.Script(scripts[0], { filename: 'page.js' }));
  const catalogs = ['en', 'uk'].map((code) => [code, JSON.parse(fs.readFileSync(path.join(SCRIPTS, '..', 'locales', `${code}.json`), 'utf8'))]);
  const labels = new Set([...scripts[0].matchAll(/\bL\('([^']+)'/g)].map((m) => m[1]));
  assert.ok(labels.size > 30);
  // How to update the page: the command with this feature's name, and a button that copies it.
  assert.match(scripts[0], /const refresh = `\/keel:feature-page \$\{data\.feature\}`;/);
  assert.match(scripts[0], /navigator\.clipboard\.writeText\(refresh\)/);
  for (const k of ['refresh', 'copy', 'copied', 'copy_failed']) assert.ok(labels.has(k), k);
  // A failed fetch: a mark on the feature card, with its explanation.
  assert.match(scripts[0], /const stale = data\.fetchFailed \?[^\n]*L\('fetch_failed'\)[^\n]*L\('fetch_failed_title'\)/);
  assert.match(scripts[0], /card\.append\(add\(el\('div', 'row chips'\)[^\n]*\bstale\)\)/, 'the mark is on the card');
  // A mark's explanation is a bubble like ⓘ, not the browser's tooltip, which a phone never shows; so a
  // dependency row is a box with its button and its marks beside it, not one button.
  assert.doesNotMatch(scripts[0], /\b[mc]\.title = /, 'a mark or chip with a browser tooltip');
  assert.match(scripts[0], /const row = el\('div', 'dep'\)/);
  for (const [code, cat] of catalogs) for (const k of labels) assert.ok(`page.${k}` in cat, `${code}: page.${k}`);
  const stateKeys = vm.runInNewContext(`(${/const STATE_KEYS = (\{[\s\S]*?\});/.exec(scripts[0])[1]})`);
  const { STATES } = require(path.join(SCRIPTS, 'lib', 'plans-state.js'));
  const { UNKNOWN } = require(path.join(SCRIPTS, 'feature-page.js'));
  // Every plan status has a page state, and each ticket state also has its group: the counts, the bar and the colour.
  assert.deepEqual(Object.keys(PAGE_STATE).sort(), [...STATES].sort());
  const groupOf = vm.runInNewContext(`(${/const GROUP_OF = (\{[\s\S]*?\});/.exec(scripts[0])[1]})`);
  for (const state of Object.values(PAGE_STATE)) assert.ok(state in groupOf, `the page groups "${state}"`);
  for (const state of [...Object.values(PAGE_STATE), UNKNOWN, 'not found']) {
    assert.ok(state in stateKeys, `the page knows "${state}"`);
    for (const [code, cat] of catalogs) assert.ok(`page.state.${stateKeys[state]}` in cat, `${code}: page.state.${stateKeys[state]}`);
  }
});

gitTest('a title that holds the text of a placeholder leaves the page\'s data intact', () => {
  const tmp = tempDir('keel-page-');
  const api = feature(tmp, { plan: PLAN({ heading: '{{DATA}} {{TRANSLATIONS}} шаблони' }) });
  const { html, data } = pageData(line(run(api, FEATURE), 'page'));
  assert.equal(data.heading, '{{DATA}} {{TRANSLATIONS}} шаблони');
  assert.ok(html.includes(`<title>{{DATA}} {{TRANSLATIONS}} шаблони (${PAGE})</title>`), 'the title keeps its text');
  assert.equal(JSON.parse(/id="feature-translations">([\s\S]*?)<\/script>/.exec(html)[1]).lang, 'uk');
});
