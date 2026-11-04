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
const { remoteKey } = require(path.join(SCRIPTS, 'feature-page.js'));

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
  assert.equal(line(out, 'title'), `keel:feature:API:${FEATURE}`);
  assert.equal(line(out, 'title if taken'), `keel:feature:API:${FEATURE}:api`);
  assert.equal(line(out, 'page title'), `keel:feature:API:${FEATURE}`);
  assert.equal(line(out, 'feature'), `${FEATURE}, exported, 2 tickets (0 done)`);
  assert.match(line(out, 'as of'), /^api [0-9a-f]{7,}$/);
  const file = line(out, 'page');
  assert.equal(path.relative(api, file).split(path.sep).join('/'), '.keel/local/tmp/feature-page/index.html');
  const { html, data } = pageData(file);

  assert.match(html, new RegExp(`<title>keel:feature:API:${FEATURE}</title>`));
  assert.ok(html.indexOf('<title>') < 8192, 'the host reads the title in the first 8KB');
  assert.equal(data.heading, 'Сповіщення про нове повідомлення');
  assert.equal(data.stage, 'exported');
  assert.equal(data.language, 'uk');
  assert.deepEqual(data.overview.sections.map((s) => s.name), ['In plain words', 'Decisions', 'Terms', 'Tickets']);
  assert.deepEqual(data.terms, [{ term: 'WebSocket', text: "постійне з'єднання браузера з сервером" }, { term: 'подія', text: 'повідомлення від сервера' }]);

  const [one, two] = data.tickets;
  assert.deepEqual([one.key, one.state, one.next, two.key, two.state, two.next], ['API-1', 'waiting for the feature merge', false, 'API-2', 'to do', true]);
  assert.deepEqual(two.depends, [{ key: 'API-1', met: true }], 'done on the feature branch holds no ticket of the feature back');
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

gitTest('the marker: the main repository\'s remote without credentials, the same for every spelling', () => {
  const tmp = tempDir('keel-page-');
  const marker = (n, opts) => {
    const dir = path.join(tmp, n);
    fs.mkdirSync(dir);
    return line(run(exported(dir, opts), FEATURE), 'marker');
  };
  const a = marker('1');
  const b = marker('2', { remote: 'git@github.com:Team/api.git' });
  const c = marker('3', { remote: 'git@github.com:Team/web.git' });
  const none = marker('4', { remote: null });
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(none, 'none (the main repository API has no remote)');
  const html = fs.readFileSync(path.join(tmp, '1', 'api', '.keel', 'local', 'tmp', 'feature-page', 'index.html'), 'utf8');
  assert.match(html, new RegExp(`<meta name="keel-feature-repo" content="${a}">`));
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
  assert.deepEqual(run(api, 'peek', saved), [`marker: ${line(out, 'marker')}`, 'language: en', `translations: ${asked.texts.length} (en)`]);
  // A tool that reads a page by lines needs only its first ones: the marker, the language, the translations.
  const head = path.join(tmp, 'head.html');
  fs.writeFileSync(head, fs.readFileSync(saved, 'utf8').split('\n').slice(0, 8).join('\n'));
  assert.deepEqual(run(api, 'peek', head), run(api, 'peek', saved));
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
});

test('remoteKey: scheme, credentials, .git and the host\'s case go', () => {
  for (const url of ['https://github.com/Team/api.git', 'https://user:tok@GITHUB.com/Team/api', 'git@github.com:Team/api.git', 'ssh://git@github.com/Team/api/', 'github.com:Team/api']) {
    assert.equal(remoteKey(url), 'github.com/Team/api', url);
  }
  assert.notEqual(remoteKey('https://github.com/team/api'), remoteKey('https://github.com/Team/api'));
});

gitTest('a feature on several repositories: the first of repos names the page; another repository read from the map, a missing one from the overview', () => {
  const tmp = tempDir('keel-page-');
  const overview = OVERVIEW('repos: [API, WEB, WGT]\n').replace('## Tickets\n', '## Tickets\n- WEB-14 Цифра на сайті (web)\n- WGT-3 Цифра у віджеті (widget)\n');
  const api = exported(tmp, { overview });
  const web = repo(tmp, 'web', 'WEB', 'git@github.com:Team/web.git');
  write(web, `${T}/WEB-14-badge.md`, BARE('WEB-14').replace(/API-1|message.created/g, 'x').replace('# [WEB-14] Подія x', '# [WEB-14] Цифра на сайті').replace('depends_on: []', 'depends_on: [API-1, API-2]'));
  write(web, `${T}/README.md`, overview);
  git(web, 'add', '-A');
  git(web, 'commit', '-q', '-m', 'Add the notify tickets');
  assert.match(plans(api, 'settings', 'set', '--repo', `WEB=${web}`)[0], /^settings: /);
  assert.match(plans(web, 'settings', 'set', '--repo', `API=${api}`)[0], /^settings: /);

  const fromApi = run(api, FEATURE);
  const fromWeb = run(web, FEATURE);
  assert.equal(line(fromApi, 'title'), `keel:feature:API:${FEATURE}`);
  assert.equal(line(fromWeb, 'title'), `keel:feature:API:${FEATURE}`, 'the same title from every repository');
  assert.equal(line(fromWeb, 'marker'), line(fromApi, 'marker'), 'the marker of the main repository from both');
  assert.match(line(fromApi, 'as of'), /^api [0-9a-f]+, web [0-9a-f]+, widget not on this machine$/);

  const { data } = pageData(line(fromApi, 'page'));
  assert.deepEqual(data.repos.map((r) => r.name), ['api', 'web', 'widget']);
  const webTicket = data.tickets.find((t) => t.key === 'WEB-14');
  assert.deepEqual([webTicket.repo, webTicket.state, webTicket.title], ['web', 'to do', 'Цифра на сайті']);
  assert.ok(webTicket.sections.length > 0, 'its text from its folder');
  assert.deepEqual(webTicket.depends, [{ key: 'API-1', met: true }, { key: 'API-2', met: false }], 'its depends_on, met as this repository reads them');
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
  assert.equal(line(out, 'title'), 'keel:feature:API:csv-export');
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
  // --taken: the page carries the title if taken, with or without the feature named.
  for (const args of [['--taken'], [FEATURE, '--taken'], ['--taken', FEATURE]]) {
    const out = run(api, ...args);
    assert.equal(line(out, 'page title'), `keel:feature:API:${FEATURE}:api`, args.join(' '));
    assert.match(fs.readFileSync(line(out, 'page'), 'utf8'), new RegExp(`<title>keel:feature:API:${FEATURE}:api</title>`));
  }
  git(api, 'checkout', '-q', 'main');
  assert.deepEqual(run(api), ['feature: none (the branch main is no feature\'s branch)', `features: ${FEATURE}`]);
  assert.deepEqual(run(api, 'no-such-feature'), ['feature-page: refused (no draft and no exported tickets of no-such-feature in this working tree; on another branch: switch to it first)']);
  assert.match(run(api, 'Bad Name')[0], /^feature-page: refused \(invalid feature name/);
  assert.deepEqual(run(api, 'clean'), ['clean: removed .keel/local/tmp/feature-page']);
  assert.ok(!fs.existsSync(path.join(api, '.keel', 'local', 'tmp', 'feature-page')));
  assert.deepEqual(run(api, 'clean'), ['clean: nothing to remove']);
});
