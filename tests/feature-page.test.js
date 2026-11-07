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
const { termsOf, PAGE_ASSETS } = require(path.join(SCRIPTS, 'feature-page.js'));
const { langCode, readPage } = require(path.join(SCRIPTS, 'lib', 'feature-page-text.js'));

const hasGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const gitTest = (name, fn) => test(name, { skip: !hasGit && 'git is not installed' }, fn);

const CONFIG = (prefix) => ({
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
  planning: { ticket_prefix: prefix, tickets: 'repo', language: 'uk' },
});

const FEATURE = 'message-notify';
// The feature's code in its tickets, as export writes it.
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
const FULL = (key, status = 'todo', depends = '[]') => `---
type: ticket
key: ${key}
status: ${status}
feature: ${FEATURE}
page: ${PAGE}
branch: ${FEATURE}
merge_into: main
depends_on: ${depends}
---

# [${key}] Цифра непрочитаних на іконці чату

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
const BARE = (key, status = 'todo') => `---
type: ticket
key: ${key}
status: ${status}
feature: ${FEATURE}
page: ${PAGE}
branch: ${FEATURE}
merge_into: main
depends_on: []
---

# [${key}] Подія message.created

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

const OVERVIEW = (repos = '') => `---
type: feature
${repos}---
# Сповіщення про нове повідомлення

## In plain words
Коли комусь пишуть, він бачить цифру навіть у закритому чаті; подія приходить через WebSocket.

## Decisions
D1. Одна подія для всіх.

## Terms
- **WebSocket** — постійне з'єднання браузера з сервером
- подія: повідомлення від сервера

## Tickets
- API-1 Подія message.created (api)
- API-2 Цифра непрочитаних на іконці чату (api)
`;

function repo(tmp, name, prefix, remote) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'core.autocrlf', 'false');
  if (remote) git(dir, 'remote', 'add', 'origin', remote);
  write(dir, '.keel/config.json', JSON.stringify(CONFIG(prefix)));
  write(dir, '.keel/.gitignore', 'local/\n');
  write(dir, 'src/app.js', 'module.exports = 1;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  git(dir, 'checkout', '-q', '-b', FEATURE);
  return dir;
}

// api: API-1 done on the feature branch (bare), API-2 to do after it (full); a research report.
function exported(tmp, { overview = OVERVIEW(), remote = 'https://bot:s3cret-token@GitHub.com/Team/api.git' } = {}) {
  const api = repo(tmp, 'api', 'API', remote);
  write(api, `${T}/API-1-event.md`, BARE('API-1', 'done'));
  write(api, `${T}/API-2-badge.md`, FULL('API-2', 'todo', '[API-1]'));
  write(api, `${T}/README.md`, overview);
  write(api, `${T}/research/websocket.md`, '# WebSocket чи опитування\n\n## Question\nЯк доставити подію?\n\n## Recommendation\nWebSocket.\n');
  git(api, 'add', '-A');
  git(api, 'commit', '-q', '-m', 'Add the notify tickets');
  return api;
}

gitTest('an exported feature: its texts, states, sizes and terms go into the page as they are', () => {
  const tmp = tempDir('keel-page-');
  const api = exported(tmp);
  const out = run(api, FEATURE);
  assert.equal(line(out, 'code'), PAGE);
  assert.equal(line(out, 'title'), `[API] - Сповіщення про нове повідомлення (${PAGE})`);
  assert.ok(!out.some((l) => /^(title if taken|page title|marker): /.test(l)), out.join('\n'));
  assert.equal(line(out, 'feature'), `${FEATURE}, exported, 2 tickets (0 done)`);
  assert.match(line(out, 'as of'), /^api [0-9a-f]{7,}$/);
  const file = line(out, 'page');
  assert.equal(path.relative(api, file).split(path.sep).join('/'), '.keel/local/tmp/feature-page/index.html');
  const { html, data } = pageData(file);

  assert.ok(html.includes(`<title>[API] - Сповіщення про нове повідомлення (${PAGE})</title>`));
  assert.ok(html.indexOf('<title>') < 8192, 'the host reads the title in the first 8KB');
  assert.equal(data.heading, 'Сповіщення про нове повідомлення');
  assert.equal(data.stage, 'exported');
  assert.equal(data.language, 'uk');
  assert.deepEqual(data.overview.sections.map((s) => s.name), ['In plain words', 'Decisions', 'Terms', 'Tickets']);
  assert.deepEqual(data.terms, [{ term: 'WebSocket', text: "постійне з'єднання браузера з сервером" }, { term: 'подія', text: 'повідомлення від сервера' }]);

  const [one, two] = data.tickets;
  assert.deepEqual([one.key, one.state, one.next, two.key, two.state, two.next], ['API-1', 'waiting for the feature merge', false, 'API-2', 'to do', true]);
  assert.deepEqual(two.depends, [{ key: 'API-1', met: true, state: 'waiting for the feature merge', feature: FEATURE, where: null }], 'done on the feature branch holds no ticket of the feature back; the page shows its own state');
  assert.equal(two.title, 'Цифра непрочитаних на іконці чату');
  assert.deepEqual([two.files, two.criteria], [2, 3]);
  // The text as it is: a "## " inside a code block stays in its section.
  const full = FULL('API-2', 'todo', '[API-1]');
  const sectionText = (name) => two.sections.find((s) => s.name === name).text;
  assert.equal(sectionText('How to check'), '```bash\nnpm test -- chat-badge\n## not a section\n```');
  assert.ok(full.includes(sectionText('Correct the priors')));
  assert.equal(two.sections.length, 11);
  // The whole file too, front matter included, for the page's "MD file" window.
  assert.match(two.md, /^---\n[\s\S]*\n---\n/);
  assert.ok(two.md.includes('# [API-2] Цифра непрочитаних на іконці чату') && two.md.includes(sectionText('How to check')));

  // A ticket without the optional sections: the others, in their order, and its size.
  assert.deepEqual(one.sections.map((s) => s.name), ['In plain words', 'Goal', 'Acceptance criteria', 'How to check', 'Boundaries', 'Where to look', 'Out of scope', 'Why', 'Dependencies']);
  assert.deepEqual([one.files, one.criteria], [0, 1]);
  assert.deepEqual(data.research.map((r) => [r.name, r.title, r.sections.map((s) => s.name)]), [['websocket.md', 'WebSocket чи опитування', ['Question', 'Recommendation']]]);
  assert.equal(two.via, null);

  // A branch named with the key: in progress, with the branch for the page's "in progress now".
  git(api, 'branch', 'api-2-badge');
  const doing = pageData(line(run(api, FEATURE), 'page')).data.tickets[1];
  assert.equal(doing.state, 'in progress');
  assert.equal(doing.via.kind, 'branch');
  assert.equal(doing.via.branch, 'api-2-badge');
  assert.ok(doing.via.author && Number.isInteger(doing.via.date), 'the author and the date of its last commit, apart');

  // A "</script>" in a ticket cannot end the data block (the page's own: two data blocks, three
  // libraries, its script); the token in the remote URL is not on the page.
  assert.equal((html.match(/<\/script>/g) || []).length, 6);
  assert.ok(!html.includes('s3cret'));
  assert.ok(!html.includes(tmp) && !html.includes(tmp.split(path.sep).join('/')), 'no local path on the page');
});

gitTest('the page\'s other files lie beside it as they are, and the page loads no local file that is not there', () => {
  const tmp = tempDir('keel-page-');
  const file = line(run(exported(tmp), FEATURE), 'page');
  const dir = path.dirname(file);
  const template = path.join(__dirname, '..', 'plugins', 'keel', 'templates', 'feature-page');
  assert.deepEqual(fs.readdirSync(dir).sort(), fs.readdirSync(template).sort());
  for (const name of fs.readdirSync(template).filter((n) => n !== 'index.html')) {
    assert.equal(fs.readFileSync(path.join(dir, name), 'utf8'), fs.readFileSync(path.join(template, name), 'utf8'), name);
  }
  const html = fs.readFileSync(file, 'utf8');
  const local = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((u) => !/^https?:/.test(u));
  assert.ok(local.includes('style.css'), local.join(', '));
  for (const name of local) assert.ok(fs.existsSync(path.join(dir, name)), `${name} is loaded by the page but is not beside it`);
});

test('the page\'s other files: the list, the template and the publish step name the same files', () => {
  const template = path.join(__dirname, '..', 'plugins', 'keel', 'templates', 'feature-page');
  assert.deepEqual([...PAGE_ASSETS].sort(), fs.readdirSync(template).filter((n) => n !== 'index.html').sort());
  const skill = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'keel', 'skills', 'feature-page', 'SKILL.md'), 'utf8');
  const step = skill.slice(skill.indexOf('6. Read the whole page file'), skill.indexOf('7. Tell the result'));
  for (const name of PAGE_ASSETS) {
    const n = name.replace(/\./g, '\\.');
    assert.match(step, new RegExp(`Read the whole page file and the \`${n}\``), `step 6 reads ${name}`);
    assert.match(step, new RegExp(`"${n}":`), `step 6 publishes ${name}`);
  }
});

gitTest('the code: the tickets\' own, whatever the remote; a feature exported without one gets one written into its tickets here', () => {
  const tmp = tempDir('keel-page-');
  const title = (n, opts) => {
    const dir = path.join(tmp, n);
    fs.mkdirSync(dir);
    return line(run(exported(dir, opts), FEATURE), 'title');
  };
  assert.equal(title('1'), title('2', { remote: null }), 'no remote: the same page');
  // A long heading is cut, the code stays whole.
  const long = title('3', { overview: OVERVIEW().replace('# Сповіщення про нове повідомлення', `# ${'Дуже довга назва '.repeat(8)}`) });
  assert.match(long, new RegExp(`^\\[API\\] - Дуже довга назва .{40,80}… \\(${PAGE}\\)$`), long);

  // Exported before the code: a new one, written into every ticket of the feature here.
  const dir = path.join(tmp, '4');
  fs.mkdirSync(dir);
  const api = exported(dir);
  for (const f of ['API-1-event.md', 'API-2-badge.md']) write(api, `${T}/${f}`, fs.readFileSync(path.join(api, T, f), 'utf8').replace(`page: ${PAGE}\n`, ''));
  const out = run(api, FEATURE);
  const code = line(out, 'code');
  assert.match(code, /^[0-9a-f]{8}$/);
  assert.notEqual(code, PAGE);
  assert.equal(line(out, 'code written'), `${T}/API-1-event.md, ${T}/API-2-badge.md (commit and push them, so every machine finds this page)`);
  for (const f of ['API-1-event.md', 'API-2-badge.md']) assert.match(fs.readFileSync(path.join(api, T, f), 'utf8'), new RegExp(`^feature: ${FEATURE}\npage: ${code}\n`, 'm'));
  assert.equal(line(run(api, FEATURE), 'code'), code, 'the next build reads it from the files');
  assert.equal(line(run(api, FEATURE), 'code written'), '');
});

gitTest('the page\'s language: the conversation\'s; texts in another language wait for a translation, kept in the page for the next update', () => {
  const tmp = tempDir('keel-page-');
  const api = exported(tmp);
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
  write(api, `${T}/API-2-badge.md`, FULL('API-2', 'todo', '[API-1]').replace('Показати цифру.', 'Показати цифру одразу.'));
  const again = run(api, FEATURE, '--previous', saved);
  assert.match(line(again, 'translate'), /^\S.*\(1 texts, /);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'translate.json'), 'utf8')).texts[0].text, 'Показати цифру одразу.');

  // A language asked for wins; one without page labels gets English ones; not a code is refused.
  assert.match(line(run(api, FEATURE, '--lang', 'uk', '--previous', saved), 'page'), /index\.html$/, 'the tickets\' own language: no translation');
  assert.match(line(run(api, FEATURE, '--lang', 'de'), 'language'), /^de \(labels in English: no page labels in this language\); texts in uk$/);
  assert.match(run(api, FEATURE, '--lang', 'x1')[0], /^feature-page: refused \("x1" is no language code/);
  assert.match(run(api, FEATURE, '--lang', 'German')[0], /^feature-page: refused \("German" is no language code/, 'a name is not turned into a code');
});

gitTest('a feature on several repositories: one title from each, naming every repository with tickets; another repository read from the map, a missing one from the overview', () => {
  const tmp = tempDir('keel-page-');
  const overview = OVERVIEW('repos: [API, WEB, WGT]\n').replace('## Tickets\n', '## Tickets\n- WEB-14 Цифра на сайті (web)\n- WGT-3 Цифра у віджеті (widget)\n');
  const api = exported(tmp, { overview });
  const web = repo(tmp, 'web', 'WEB', 'git@github.com:Team/web.git');
  // API-2 and WEB-14 also wait for WGT-3, whose repository is not on this machine.
  write(api, `${T}/API-2-badge.md`, FULL('API-2', 'todo', '[API-1, WGT-3]'));
  git(api, 'commit', '-q', '-am', 'API-2 waits for the widget');
  write(web, `${T}/WEB-14-badge.md`, BARE('WEB-14').replace(/API-1|message.created/g, 'x').replace('# [WEB-14] Подія x', '# [WEB-14] Цифра на сайті').replace('depends_on: []', 'depends_on: [API-1, API-2, WGT-3]'));
  write(web, `${T}/README.md`, overview);
  git(web, 'add', '-A');
  git(web, 'commit', '-q', '-m', 'Add the notify tickets');
  assert.match(plans(api, 'settings', 'set', '--repo', `WEB=${web}`)[0], /^settings: /);
  assert.match(plans(web, 'settings', 'set', '--repo', `API=${api}`)[0], /^settings: /);

  const fromApi = run(api, FEATURE);
  const fromWeb = run(web, FEATURE);
  assert.equal(line(fromApi, 'title'), `[API, WEB, WGT] - Сповіщення про нове повідомлення (${PAGE})`);
  assert.equal(line(fromWeb, 'title'), line(fromApi, 'title'), 'the same title from every repository');
  assert.match(line(fromApi, 'as of'), /^api [0-9a-f]+, web [0-9a-f]+, widget not on this machine$/);

  const { data } = pageData(line(fromApi, 'page'));
  assert.deepEqual(data.repos.map((r) => r.name), ['api', 'web', 'widget']);
  const webTicket = data.tickets.find((t) => t.key === 'WEB-14');
  assert.deepEqual([webTicket.repo, webTicket.state, webTicket.title], ['web', 'to do', 'Цифра на сайті']);
  assert.ok(webTicket.sections.length > 0, 'its text from its folder');
  assert.deepEqual(webTicket.depends, [{ key: 'API-1', met: true, state: 'waiting for the feature merge', feature: FEATURE, where: null }, { key: 'API-2', met: false, state: 'to do', feature: FEATURE, where: { kind: 'todo' } }, { key: 'WGT-3', met: null, state: 'not checked', feature: null, where: null }], 'its depends_on, met as this repository reads them; one not read here: null');
  assert.deepEqual(data.tickets.find((t) => t.key === 'API-2').depends, [{ key: 'API-1', met: true, state: 'waiting for the feature merge', feature: FEATURE, where: null }, { key: 'WGT-3', met: null, state: 'not checked', feature: null, where: null }], 'a dependency in a repository not on this machine is not shown met');
  const wgt = data.tickets.find((t) => t.key === 'WGT-3');
  assert.deepEqual([wgt.repo, wgt.state, wgt.title, wgt.sections], ['widget', 'state unknown', 'Цифра у віджеті', null]);
});

gitTest('a draft: plan.md as the overview, its tickets with no state', () => {
  const tmp = tempDir('keel-page-');
  const api = repo(tmp, 'api', 'API', 'https://github.com/Team/api.git');
  assert.equal(plans(api, 'new', 'csv-export')[0], 'created: .keel/local/plans/keel/csv-export/plan.md');
  const draft = path.join(api, '.keel', 'local', 'plans', 'keel', 'csv-export');
  const plan = fs.readFileSync(path.join(draft, 'plan.md'), 'utf8').replace(/## In plain words\n[^#]*/, '## In plain words\nЕкспорт рахунків у CSV.\n\n');
  fs.writeFileSync(path.join(draft, 'plan.md'), plan);
  write(draft, 'tickets/T1-export.md', FULL('T1').replace(/^---[\s\S]*?---/, '---\nid: T1\ndepends_on: []\n---'));
  write(draft, 'tickets/T2-button.md', BARE('T2').replace(/^---[\s\S]*?---/, '---\nid: T2\ndepends_on: [T1]\n---'));
  const out = run(api, 'csv-export');
  const code = /^page: ([0-9a-f]{8})$/m.exec(fs.readFileSync(path.join(draft, 'plan.md'), 'utf8'))[1];
  assert.equal(line(out, 'title'), `[API] - csv-export (${code})`, 'the draft\'s code, from plan.md');
  assert.equal(line(out, 'code written'), '');
  assert.equal(line(out, 'feature'), 'csv-export, draft, 2 tickets');
  const { data } = pageData(line(out, 'page'));
  assert.equal(data.overview.file, 'plan.md');
  assert.equal(data.overview.sections.find((s) => s.name === 'In plain words').text, 'Експорт рахунків у CSV.');
  assert.deepEqual(data.tickets.map((t) => [t.key, t.state, t.repo, t.files, t.criteria]), [['T1', 'draft', 'api', 2, 3], ['T2', 'draft', 'api', 0, 1]]);
  assert.deepEqual(data.tickets[1].depends, [{ key: 'T1', met: false }]);
});

gitTest('no feature named: the current branch\'s, else none with the list; clean removes the page', () => {
  const tmp = tempDir('keel-page-');
  const api = exported(tmp);
  assert.equal(line(run(api), 'feature'), `${FEATURE}, exported, 2 tickets (0 done)`);
  git(api, 'checkout', '-q', 'main');
  assert.deepEqual(run(api), ['feature: none (the branch main is no feature\'s branch)', `features: ${FEATURE}`]);
  assert.deepEqual(run(api, 'no-such-feature'), ['feature-page: refused (no draft and no exported tickets of no-such-feature in this working tree; on another branch: switch to it first)']);
  assert.match(run(api, 'Bad Name')[0], /^feature-page: refused \(invalid feature name/);
  assert.deepEqual(run(api, 'clean'), ['clean: removed .keel/local/tmp/feature-page']);
  assert.ok(!fs.existsSync(path.join(api, '.keel', 'local', 'tmp', 'feature-page')));
  assert.deepEqual(run(api, 'clean'), ['clean: nothing to remove']);
});

gitTest('every ticket gets its repository: a second prefix here is this one\'s; a repository only the Tickets lines name; a map that gives another prefix to this project is not read', () => {
  const tmp = tempDir('keel-page-');
  const overview = OVERVIEW('repos: [API, WEB]\n').replace('## Tickets\n', '## Tickets\n- WEB-14 Цифра на сайті (web)\n- MOB-5 Прийом push (mobile)\n');
  const api = exported(tmp, { overview });
  write(api, `${T}/OLD-7-legacy.md`, BARE('OLD-7'));
  git(api, 'add', '-A');
  git(api, 'commit', '-q', '-m', 'An older ticket');
  assert.match(plans(api, 'settings', 'set', '--repo', `WEB=${api}`)[0], /^settings: /);
  const out = run(api, FEATURE);
  assert.match(line(out, 'as of'), /^api [0-9a-f]+, web not on this machine, mobile not on this machine$/);
  const { data } = pageData(line(out, 'page'));
  assert.deepEqual(data.tickets.map((t) => [t.key, t.repo, t.state]), [['API-1', 'api', 'waiting for the feature merge'], ['API-2', 'api', 'to do'], ['OLD-7', 'api', 'to do'], ['WEB-14', 'web', 'state unknown'], ['MOB-5', 'mobile', 'state unknown']]);
});

gitTest('in progress by a keel task or by the session note: the page says which', () => {
  const tmp = tempDir('keel-page-');
  const api = exported(tmp);
  const via = () => pageData(line(run(api, FEATURE), 'page')).data.tickets[1];
  write(api, '.keel/tasks/API-2/task.md', '---\nid: API-2\ntitle: t\nstatus: active\nupdated: 2026-10-26\n---\n');
  assert.deepEqual([via().state, via().via], ['in progress', { kind: 'task' }]);
  fs.rmSync(path.join(api, '.keel', 'tasks'), { recursive: true });
  write(api, '.keel/next-session.md', '---\nstatus: in-progress\nkeys: API-2\n---\n');
  assert.deepEqual([via().state, via().via], ['in progress', { kind: 'session' }]);
});

gitTest('a dependency of another feature: where its code is, and met once it is in this feature branch', () => {
  const tmp = tempDir('keel-page-');
  const api = exported(tmp);
  git(api, 'checkout', '-q', '-b', 'chat', 'main');
  write(api, 'tickets/chat/API-7-send.md', BARE('API-7', 'done').replace(new RegExp(FEATURE, 'g'), 'chat'));
  write(api, 'src/send.js', '1\n');
  git(api, 'add', '-A');
  git(api, 'commit', '-q', '-m', 'API-7: send');
  git(api, 'checkout', '-q', FEATURE);
  write(api, `${T}/API-3-list.md`, BARE('API-3').replace('depends_on: []', 'depends_on: [API-7]'));
  git(api, 'add', '-A');
  git(api, 'commit', '-q', '-m', 'Add API-3');
  const deps = () => pageData(line(run(api, FEATURE), 'page')).data.tickets.find((t) => t.key === 'API-3').depends;
  assert.deepEqual(deps(), [{ key: 'API-7', met: false, state: 'waiting for the feature merge', feature: 'chat',
    where: { kind: 'feature', branch: 'chat', word: 'feature branch', into: 'main', pull: FEATURE } }], 'ready in another feature branch: wait for main or pull it into this one');
  git(api, 'merge', '-q', '--no-edit', 'chat');
  assert.deepEqual(deps(), [{ key: 'API-7', met: true, state: 'waiting for the feature merge', feature: 'chat', where: { kind: 'yours', branch: FEATURE } }], 'pulled into this feature branch: it may start');
});

gitTest('a ticket of this repository only on another branch: its text from that branch, and which branch', () => {
  const tmp = tempDir('keel-page-');
  const api = exported(tmp);
  git(api, 'checkout', '-q', '-b', 'api-3-badge');
  write(api, `${T}/API-3-list.md`, FULL('API-3').replace('# [API-3] Цифра непрочитаних на іконці чату', '# [API-3] Список непрочитаних'));
  git(api, 'add', '-A');
  git(api, 'commit', '-q', '-m', 'Add API-3');
  git(api, 'checkout', '-q', FEATURE);
  const { data } = pageData(line(run(api, FEATURE), 'page'));
  const three = data.tickets.find((t) => t.key === 'API-3');
  assert.deepEqual([three.title, three.repo, three.onBranch, three.criteria], ['Список непрочитаних', 'api', 'api-3-badge', 3]);
  assert.ok(three.sections.length > 0 && three.md.includes('# [API-3] Список непрочитаних'), 'the whole ticket, read from git');
  assert.equal(data.tickets.find((t) => t.key === 'API-2').onBranch, null, 'one in the working tree');
});

gitTest('a research report with no heading is shown by its file name', () => {
  const tmp = tempDir('keel-page-');
  const api = exported(tmp);
  write(api, `${T}/research/notes.md`, 'Лише текст, без заголовка.\n');
  const { data } = pageData(line(run(api, FEATURE), 'page'));
  assert.deepEqual(data.research.map((r) => [r.name, r.title]), [['notes.md', 'notes.md'], ['websocket.md', 'WebSocket чи опитування']]);
});

gitTest('a draft and an exported feature of the same name: the page is the draft\'s', () => {
  const tmp = tempDir('keel-page-');
  const api = exported(tmp);
  const draft = path.join(api, '.keel', 'local', 'plans', 'keel', FEATURE);
  write(draft, 'plan.md', `---\ntype: plan\nfeature: ${FEATURE}\nstatus: draft\npage: 0a1b2c3d\n---\n\n# Нова чернетка\n\n## In plain words\nЧернетка.\n`);
  write(draft, 'tickets/T1-export.md', FULL('T1').replace(/^---[\s\S]*?---/, '---\nid: T1\ndepends_on: []\n---'));
  const out = run(api, FEATURE);
  assert.equal(line(out, 'feature'), `${FEATURE}, draft, 1 tickets`);
  assert.equal(line(out, 'title'), '[API] - Нова чернетка (0a1b2c3d)');
});

gitTest('no path of this machine on the page: the script adds none, and a feature file with one is refused', () => {
  const tmp = tempDir('keel-page-');
  const api = exported(tmp);
  const file = line(run(api, FEATURE), 'page');
  const html = fs.readFileSync(file, 'utf8');
  const forms = (p) => [p, p.split(path.sep).join('/'), JSON.stringify(p).slice(1, -1)];
  for (const p of [api, tmp, require('node:os').homedir()]) {
    for (const f of forms(p)) assert.ok(!html.includes(f), `${f} on the page`);
  }
  const ticket = `${T}/API-2-badge.md`;
  write(api, ticket, fs.readFileSync(path.join(api, ticket), 'utf8').replace('## Where to look', 'Як у C:\\Users\\ann\\api\\src\\chat.js.\n\n## Where to look'));
  write(api, `${T}/research/websocket.md`, '# WebSocket\n\nПриклад у /home/dev/api/ws.js\n');
  const out = run(api, FEATURE);
  assert.equal(out[0], 'feature-page: refused (2 paths of this machine in the feature\'s files; write them from the repository\'s root)', out.join('\n'));
  assert.match(out[1], /^- API-2: local path C:\\Users\\ann\\api\\src\\chat\.js \(line \d+\)$/);
  assert.equal(out[2], '- research/websocket.md: local path /home/dev/api/ws.js (line 3)');
  assert.ok(!fs.existsSync(file), 'no page is left to publish');
});

test('langCode takes language codes only; termsOf keeps snake_case terms and drops an empty one', () => {
  assert.deepEqual(['uk', 'uk-UA', 'pt_BR', 'DE', 'German', 'Ukrainian', '', 'x1'].map(langCode), ['uk', 'uk', 'pt', 'de', null, null, null, null]);
  const terms = termsOf([{ name: 'Terms', text: '- `ticket_prefix` — the key prefix\n-  — nothing\n- __bold__: text' }]);
  assert.deepEqual(terms, [{ term: 'ticket_prefix', text: 'the key prefix' }, { term: 'bold', text: 'text' }]);
});

test('the page template: its script parses, every label it names exists, and it knows every state the scripts write', () => {
  const html = fs.readFileSync(path.join(SCRIPTS, '..', 'templates', 'feature-page', 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 1, 'one script of its own');
  assert.doesNotThrow(() => new vm.Script(scripts[0], { filename: 'index.html' }));
  const catalogs = ['en', 'uk'].map((code) => [code, JSON.parse(fs.readFileSync(path.join(SCRIPTS, '..', 'locales', `${code}.json`), 'utf8'))]);
  const labels = new Set([...scripts[0].matchAll(/\bL\('([^']+)'/g)].map((m) => m[1]));
  assert.ok(labels.size > 30);
  // How to update the page: the command with this feature's name, and a button that copies it.
  assert.match(scripts[0], /const refresh = `\/keel:feature-page \$\{data\.feature\}`;/);
  assert.match(scripts[0], /navigator\.clipboard\.writeText\(refresh\)/);
  for (const k of ['refresh', 'copy', 'copied', 'copy_failed']) assert.ok(labels.has(k), k);
  // A mark's explanation is a bubble like ⓘ, not the browser's tooltip, which a phone never shows; so a
  // dependency row is a box with its button and its marks beside it, not one button.
  assert.doesNotMatch(scripts[0], /\b[mc]\.title = /, 'a mark or chip with a browser tooltip');
  assert.match(scripts[0], /const row = el\('div', 'dep'\)/);
  for (const [code, cat] of catalogs) for (const k of labels) assert.ok(`page.${k}` in cat, `${code}: page.${k}`);
  const stateKeys = vm.runInNewContext(`(${/const STATE_KEYS = (\{[\s\S]*?\});/.exec(scripts[0])[1]})`);
  const { STATES } = require(path.join(SCRIPTS, 'lib', 'plans-state.js'));
  const { NOT_CHECKED } = require(path.join(SCRIPTS, 'lib', 'plans-neighbours.js'));
  const { UNKNOWN } = require(path.join(SCRIPTS, 'lib', 'plans-linked.js'));
  // Each ticket state also has its group: the counts, the bar and the colour.
  const groupOf = vm.runInNewContext(`(${/const GROUP_OF = (\{[\s\S]*?\});/.exec(scripts[0])[1]})`);
  for (const state of [...STATES, 'draft']) assert.ok(state in groupOf, `the page groups "${state}"`);
  for (const state of [...STATES, UNKNOWN, NOT_CHECKED, 'not found', 'draft', 'draft (ready)', 'exported']) {
    assert.ok(state in stateKeys, `the page knows "${state}"`);
    for (const [code, cat] of catalogs) assert.ok(`page.state.${stateKeys[state]}` in cat, `${code}: page.state.${stateKeys[state]}`);
  }
});
