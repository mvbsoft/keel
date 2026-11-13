'use strict';
// configure sections 7 (stack plugins), 8 (documentation shape) and 10 (Claude Code settings).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tempDir } = require('./fixtures/tmp.js');
const { says } = require('./fixtures/texts.js');

const PLUGIN = path.join(__dirname, '..', 'plugins', 'keel');
const SCRIPTS = path.join(PLUGIN, 'scripts');
const stackSkills = require(path.join(SCRIPTS, 'stack-skills.js'));
const settings = require(path.join(SCRIPTS, 'claude-settings.js'));
const { scan } = require(path.join(SCRIPTS, 'scan.js'));

function project(files) {
  const dir = tempDir('keel-cfg-');
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

const AVAILABLE = {
  installed: [{ id: 'context7@claude-plugins-official', scope: 'user' }],
  available: [
    { pluginId: 'php-lsp@claude-plugins-official', name: 'php-lsp', marketplaceName: 'claude-plugins-official', description: 'PHP language server' },
    { pluginId: 'laravel-boost@claude-plugins-official', name: 'laravel-boost', marketplaceName: 'claude-plugins-official', description: 'Laravel toolkit' },
    { pluginId: 'context7@claude-plugins-official', name: 'context7', marketplaceName: 'claude-plugins-official', description: 'docs' },
    { pluginId: 'php-modernization@team-market', name: 'php-modernization', marketplaceName: 'team-market', description: 'PHP 8 patterns', installCount: 10 },
    { pluginId: 'hosting@claude-plugins-official', name: 'hosting', marketplaceName: 'claude-plugins-official', description: 'Deploy PHP and React apps' },
    { pluginId: 'php-magic@anthropic-plugin-directory', name: 'php-magic', marketplaceName: 'anthropic-plugin-directory', description: 'PHP' },
  ],
};

function stackProject() {
  const dir = project({
    'composer.json': JSON.stringify({ require: { php: '>=8.2', 'laravel/framework': '^11', 'yiisoft/yii2': '~2.0' } }),
    'app/a.php': '<?php echo 1;\n',
    'app/b.php': '<?php echo 2;\n',
  });
  const file = path.join(dir, 'available.json');
  fs.writeFileSync(file, JSON.stringify(AVAILABLE));
  return { dir, file };
}

test('stack-skills: checked entries by language and package, marketplace search by name, nothing reliable said plainly', () => {
  const { dir, file } = stackProject();
  const r = stackSkills.run(dir, { available: file });
  assert.deepEqual(r.stack.frameworks, ['Laravel', 'Yii2']);
  assert.deepEqual(r.checked.map((c) => c.plugin), ['php-lsp@claude-plugins-official', 'laravel-boost@claude-plugins-official', 'context7@claude-plugins-official']);
  assert.equal(r.checked.find((c) => c.plugin.startsWith('context7')).installed, true);
  assert.equal(typeof r.checked[0].needs_on_path, 'boolean', 'the language server program is looked up on PATH');
  assert.deepEqual(r.found.PHP.map((f) => f.plugin), ['php-modernization@team-market'], 'name match only; the Directory is never searched');
  assert.deepEqual(r.nothing_reliable, ['Yii2'], 'Laravel is covered by a checked plugin');
  assert.deepEqual(r.marketplaces_to_add.map((m) => m.name), ['trailofbits']);
  const text = stackSkills.report(r);
  assert.match(text, /install: claude plugin install php-lsp@claude-plugins-official --scope project/);
  assert.match(text, /needs intelephense: (on PATH|not installed \(npm install -g intelephense\))/);
  assert.match(text, /add: claude plugin marketplace add trailofbits\/skills/);
  assert.match(text, /nothing reliable found for: Yii2/);
});

test('stack-skills: without a marketplace listing it still gives keel\'s checked list and says why', () => {
  const { dir } = stackProject();
  const r = stackSkills.run(dir, { available: path.join(dir, 'missing.json') });
  assert.match(r.marketplaces_error, /could not list the marketplaces/);
  assert.ok(r.checked.length >= 3);
  assert.match(stackSkills.report(r), /only keel's checked list below/);
});

test('stack-skills: package names from npm, Composer and Python manifests, never versions', () => {
  const dir = project({
    'package.json': JSON.stringify({ dependencies: { react: '18' }, devDependencies: { '@playwright/test': '1' } }),
    'requirements.txt': '# web\nDjango==5.0\nrequests>=2\n',
    'pyproject.toml': '[project]\ndependencies = ["fastapi>=0.110", "pydantic[email]>=2"]\n',
  });
  const names = stackSkills.packagesOf(dir, ['.']);
  for (const n of ['react', '@playwright/test', 'django', 'requests', 'fastapi', 'pydantic']) assert.ok(names.has(n), n);
  assert.ok(![...names].some((n) => /\d/.test(n) && n.includes('.')), 'no versions');
});

test('stack-skills --lsp: says whether a language server is on PATH', () => {
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'stack-skills.js'), os.tmpdir(), '--lsp', 'no-such-server-xyz'], { encoding: 'utf8' });
  assert.equal(r.stdout, 'no-such-server-xyz: not on PATH\n');
});

test('scan: documentation shape, files loaded every session with line counts, suggested profile and pattern', () => {
  const dir = project({
    'README.md': '# x\n',
    'CLAUDE.md': `${'line\n'.repeat(249)}last`,
    'docs/adr/0001-a.md': '# a\n',
    'docs/tutorials/start.md': 'x', 'docs/how-to/deploy.md': 'x', 'docs/reference/api.md': 'x',
  });
  const { findings } = scan(dir);
  assert.deepEqual(findings.docs.adr_dirs, ['docs/adr']);
  assert.deepEqual(findings.docs.diataxis_kinds, ['tutorials', 'how-to', 'reference']);
  assert.equal(findings.docs.suggested_pattern, 'diataxis');
  assert.equal(findings.docs.suggested_profile, 2);
  assert.deepEqual(findings.docs.always_loaded, [{ path: 'CLAUDE.md', lines: 250 }]);
  const specs = scan(project({ 'specs/login.md': 'x', 'docs/arc42/README.md': 'x' })).findings.docs;
  assert.equal(specs.suggested_profile, 3);
  assert.equal(specs.suggested_pattern, 'arc42');
  assert.equal(scan(project({ 'a.js': '1' })).findings.docs.suggested_profile, 1);
});

test('scan: how the existing ADRs are kept, counted from their text', () => {
  const dir = project({
    'docs/adr/README.md': '# Decisions\nSuperseded records stay.\n',
    'docs/adr/0001-db.md': '# Postgres\nStatus: Superseded by 0003\n',
    'docs/adr/0002-queue.md': '# Queue\nStatus: Accepted\nAmended 2026-01-02: retries 5.\n',
    'docs/adr/0003-db.md': '# SQLite\nStatus: Accepted\nSupersedes 0001.\n',
    'docs/adr/0004-cache.md': '# Cache\nStatus: Accepted\n',
  });
  // one supersede is one superseded record: the newer record's "Supersedes 0001" is not a second one
  assert.deepEqual(scan(dir).findings.docs.adr_records, { records: 4, superseded: 1, amended: 1 });
  const plain = project({
    'docs/decisions/0001-cache.md': '# Cache\nStatus: Accepted\n\nThe cache is partially warmed at start; a clock-skew correction of 5 s applies.\n',
    'docs/decisions/0002-api.md': '# API\nStatus: Accepted\n\nHandlers return void. This supersedes nothing; it refines the error model.\n',
  });
  assert.deepEqual(scan(plain).findings.docs.adr_records, { records: 2, superseded: 0, amended: 0 }, 'ordinary words in a record are not history marks');
  const marks = project({
    'docs/adr/0001-a.md': '# A\n**Status:** Partly superseded by 0002\n',
    'docs/adr/0002-b.md': '# B\nStatus: Accepted\n\n> Was: 3 retries.\n',
  });
  assert.deepEqual(scan(marks).findings.docs.adr_records, { records: 2, superseded: 1, amended: 2 }, 'a bold status line, a partial supersede and a quoted note count');
  assert.deepEqual(scan(project({ 'a.js': '1' })).findings.docs.adr_records, { records: 0, superseded: 0, amended: 0 });
});

function withUserFile(content, fn) {
  const dir = tempDir('keel-user-');
  const file = path.join(dir, 'settings.json');
  if (content !== undefined) fs.writeFileSync(file, JSON.stringify(content));
  const before = process.env.KEEL_USER_SETTINGS;
  process.env.KEEL_USER_SETTINGS = file;
  try { return fn(file, dir); } finally { if (before === undefined) delete process.env.KEEL_USER_SETTINGS; else process.env.KEEL_USER_SETTINGS = before; }
}

test('claude-settings show: what is set and what keel recommends, per-model compaction noted', () => {
  withUserFile({ showClearContextOnPlanAccept: true, modelSettings: { 'claude-opus-5-5': { autoCompactWindow: 500000 } } }, () => {
    const r = settings.show(project({}));
    const row = (k) => r.rows.find((x) => x.key === k);
    assert.equal(row('showClearContextOnPlanAccept').matches, true);
    assert.equal(row('autoCompactWindow').now, undefined);
    assert.equal(row('plansDirectory').recommended, './.keel/local/plans/claude');
    assert.deepEqual(r.per_model_compact, ['claude-opus-5-5: 500000']);
    assert.match(settings.report(r), /- user autoCompactWindow \[machine or project\]: not set \| keel recommends 300000/);
  });
});

test('claude-settings: Plan Mode files the older plansDirectory left in .keel/local/plans/ are listed and moved into claude/', () => {
  withUserFile({}, () => {
    const dir = project({});
    const plans = path.join(dir, '.keel', 'local', 'plans');
    for (const [rel, text] of [['old-plan.md', 'a'], ['same-name.md', 'old'], ['claude/same-name.md', 'new'], ['keel/s3-storage/plan.md', 'draft'], ['notes.txt', 'x']]) {
      fs.mkdirSync(path.dirname(path.join(plans, rel)), { recursive: true });
      fs.writeFileSync(path.join(plans, rel), text);
    }
    const r = settings.show(dir);
    assert.deepEqual(r.old_plans, ['old-plan.md', 'same-name.md']);
    assert.ok(settings.report(r).split('\n').includes('- old Plan Mode files in .keel/local/plans/: 2 (move-plans moves them to .keel/local/plans/claude/)'));
    const out = spawnSync(process.execPath, [path.join(SCRIPTS, 'claude-settings.js'), dir, 'move-plans'], { encoding: 'utf8' }).stdout.trim();
    assert.equal(out, 'moved to .keel/local/plans/claude/: 1; left in place (the same name is already there): same-name.md');
    assert.equal(fs.readFileSync(path.join(plans, 'claude', 'old-plan.md'), 'utf8'), 'a');
    assert.equal(fs.readFileSync(path.join(plans, 'claude', 'same-name.md'), 'utf8'), 'new', 'never overwritten');
    assert.ok(fs.existsSync(path.join(plans, 'same-name.md')));
    assert.ok(fs.existsSync(path.join(plans, 'keel', 's3-storage', 'plan.md')), 'planning drafts stay');
    assert.ok(fs.existsSync(path.join(plans, 'notes.txt')));
    assert.deepEqual(settings.show(project({})).old_plans, [], 'a project without the folder');
  });
});

const flow = () => fs.readFileSync(path.join(PLUGIN, 'skills', '_shared', 'configure-flow.md'), 'utf8');

test('catalog: gitleaks is two scanners (branch commits and uncommitted changes), each a valid config entry', () => {
  const { scanners } = require(path.join(PLUGIN, 'data', 'catalog.json')).security;
  const [branch, uncommitted] = scanners.gitleaks;
  assert.equal(scanners.gitleaks.length, 2);
  assert.match(branch.command, /^gitleaks detect --no-banner --redact --log-opts=<main>\.\.HEAD$/);
  assert.match(uncommitted.command, /^gitleaks protect --no-banner --redact$/);
  assert.notEqual(branch.name, uncommitted.name);
  for (const list of Object.values(scanners)) for (const s of list) assert.ok(s.name && s.command, 'name and command, as in gates.security_scanners');
  assert.deepEqual(scanners.semgrep.map((s) => s.command), ['semgrep scan --config auto --error']);
});

test('configure flow section 3: <main> is substituted from section 4, Docker is an option the user decides', () => {
  const text = flow();
  const three = text.slice(text.indexOf('## 3. Gates'), text.indexOf('## 4. Git'));
  says(three, ['--log-opts=<main>..HEAD']);
  says(three, ['gitleaks protect --no-banner --redact']);
  assert.match(three, /`<main>` is the main branch confirmed in\s+section 4/);
  says(three, ['docker run --rm -v ./:/repo zricethezav/gitleaks:<pinned version> detect --source /repo']);
  says(three, ['MSYS_NO_PATHCONV=1']);
  says(three, ['the user decides']);
});

test('configure flow section 12: the manual setup is proposed for the README, written only after a yes', () => {
  const text = flow();
  const twelve = text.slice(text.indexOf('## 12. Write and summary'));
  assert.ok(twelve.indexOf('Write the manual setup down') > twelve.indexOf('config-check.js'), 'after the files are written and checked');
  assert.match(twelve, /README \(or\s+its existing setup or getting-started doc/);
  says(twelve, ['"Working with Claude Code"']);
  says(twelve, ['`repo_language`']);
  says(twelve, ['only after the user\'s yes']);
  says(twelve, ['about 10 lines']);
  says(twelve, ['claude plugin install <plugin>@<marketplace> --scope project']);
  assert.match(twelve, /does not fetch or\s+offer a plugin/);
  says(twelve, ['extraKnownMarketplaces']);
  assert.doesNotMatch(text, /gets it offered|Claude Code offers them/);
  says(twelve, ['each program a picked plugin needs']);
  says(twelve, ['security scanners']);
});

test('claude-settings apply: merges only allowed keys, keeps the rest, backs the file up', () => {
  withUserFile({ model: 'opus', enabledPlugins: { 'keel@team': true }, permissions: { deny: ['Read(.env)'] } }, (file, dir) => {
    const root = project({ '.claude/settings.local.json': JSON.stringify({ permissions: { allow: ['Bash(ls)'] } }) });
    const changes = path.join(dir, 'changes.json');
    fs.writeFileSync(changes, JSON.stringify({
      user: { autoCompactWindow: 300000, attribution: { commit: '', pr: '', sessionUrl: false }, conversation_language: 'uk' },
      project: { plansDirectory: './.keel/local/plans', 'permissions.allow': ['Bash(npm test)', 'Bash(ls)'] },
    }));
    const written = settings.apply(root, changes);
    assert.equal(written.length, 2);
    const user = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(user.model, 'opus');
    assert.deepEqual(user.permissions, { deny: ['Read(.env)'] });
    assert.equal(user.autoCompactWindow, 300000);
    assert.deepEqual(user.pluginConfigs, { 'keel@team': { options: { conversation_language: 'uk' } } });
    const local = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.local.json'), 'utf8'));
    assert.deepEqual(local.permissions.allow, ['Bash(ls)', 'Bash(npm test)']);
    assert.ok(written.every((w) => w.backup && fs.existsSync(w.backup)), 'each changed file has a backup');
    assert.equal(JSON.parse(fs.readFileSync(written[0].backup, 'utf8')).autoCompactWindow, undefined);
  });
});

test('claude-settings apply: a project file backup goes to .keel/local/backups, a machine file backup stays beside it', () => {
  withUserFile({ model: 'opus' }, (file, dir) => {
    const root = project({ '.claude/settings.local.json': JSON.stringify({ permissions: { allow: ['Bash(ls)'] } }) });
    const changes = path.join(dir, 'changes.json');
    fs.writeFileSync(changes, JSON.stringify({ user: { autoCompactWindow: 300000 }, project: { plansDirectory: './.keel/local/plans' } }));
    const [userWrite, projectWrite] = settings.apply(root, changes);

    const backups = path.join(root, '.keel', 'local', 'backups');
    assert.equal(path.dirname(projectWrite.backup), backups);
    assert.match(path.basename(projectWrite.backup), /^settings\.local\.json\.keel-backup-\d{8}T\d{6}$/);
    assert.deepEqual(JSON.parse(fs.readFileSync(projectWrite.backup, 'utf8')), { permissions: { allow: ['Bash(ls)'] } });
    assert.deepEqual(fs.readdirSync(path.join(root, '.claude')), ['settings.local.json'], 'nothing new beside the project file');

    assert.equal(path.dirname(userWrite.backup), dir);
    assert.match(path.basename(userWrite.backup), /^settings\.json\.keel-backup-/);
    assert.deepEqual(JSON.parse(fs.readFileSync(userWrite.backup, 'utf8')), { model: 'opus' });
  });
});

test('claude-settings apply: the printed line names the backup path in .keel/local/backups', () => {
  withUserFile({}, (file, dir) => {
    const root = project({ '.claude/settings.local.json': '{}' });
    const changes = path.join(dir, 'changes.json');
    fs.writeFileSync(changes, JSON.stringify({ project: { plansDirectory: './.keel/local/plans' } }));
    const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'claude-settings.js'), root, 'apply', changes], { encoding: 'utf8', env: { ...process.env, KEEL_USER_SETTINGS: file } });
    assert.equal(r.status, 0, r.stderr);
    const kept = /previous file kept as (.+)\n/.exec(r.stdout)[1];
    assert.equal(path.dirname(kept), path.join(root, '.keel', 'local', 'backups'));
    assert.ok(fs.existsSync(kept));
  });
});

test('claude-settings apply: permissions written nested or with a dotted key are the same', () => {
  withUserFile({}, (file, dir) => {
    const root = project({});
    const changes = path.join(dir, 'changes.json');
    fs.writeFileSync(changes, JSON.stringify({ project: { permissions: { allow: ['Bash(npm test)'] } } }));
    settings.apply(root, changes);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.local.json'), 'utf8')), { permissions: { allow: ['Bash(npm test)'] } });
  });
});

test('claude-settings apply: an unknown key writes nothing', () => {
  withUserFile({ model: 'opus' }, (file, dir) => {
    const changes = path.join(dir, 'changes.json');
    fs.writeFileSync(changes, JSON.stringify({ user: { autoCompactWindow: 300000, apiKeyHelper: 'x' } }));
    assert.throws(() => settings.apply(project({}), changes), /does not write these settings: user.apiKeyHelper/);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { model: 'opus' });
  });
});

test('claude-settings: a new machine gets the settings file and keel@keel as the plugin id', () => {
  withUserFile(undefined, (file, dir) => {
    const changes = path.join(dir, 'changes.json');
    fs.writeFileSync(changes, JSON.stringify({ user: { conversation_language: 'de', showClearContextOnPlanAccept: true } }));
    const [w] = settings.apply(project({}), changes);
    assert.equal(w.backup, null);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { pluginConfigs: { 'keel@keel': { options: { conversation_language: 'de' } } }, showClearContextOnPlanAccept: true });
  });
});

test('configure flow section 5: turn caps are stated, not asked (they live in the agent files)', () => {
  const five = flow().slice(flow().indexOf('## 5. Verification'), flow().indexOf('## 6.'));
  says(five, ['Turn caps are not asked', 'state them in one line', '60 for review agents', '350 for implementers', "fixed in each agent's own file, not in the config"]);
  assert.ok(five.indexOf('ask whether to keep them') < five.indexOf('Turn caps'), 'the question covers only the configurable values');
});

test('configure flow section 6: the planning settings, quick setup too, alone with `planning`; the planning prefix never goes into ticket_prefixes', () => {
  const text = flow();
  const six = text.slice(text.indexOf('## 6. Code'), text.indexOf('## 7.'));
  says(six, ['**Planning tickets**', '`planning`; alone: `/keel:configure planning`']);
  for (const field of ['planning.ticket_prefix', 'planning.tickets', 'planning.tickets_dir', 'planning.language']) assert.ok(six.includes(`\`${field}\``), field);
  says(six, ['else 3-4 capital letters', "from the repository's name"]);
  says(six, ['in the repository (recommended', "together with the reports of keel's researcher", '`research/`', 'only on this machine']);
  says(six, ['**Ticket language** (`planning.language`)', 'detailed setup only', 'Quick setup takes `repo_language`']);
  assert.ok(six.indexOf('**Planning tickets**') < six.indexOf('**Ids in comments and docs**'), 'the prefix is known before the ids question shows it');
  says(six, ['The planning ticket prefix is always checked too', 'list it as "added on its own"', 'never write it into `ticket_prefixes`']);
  says(text, ['| 6 Code |', 'planning tickets asked', 'the prefix and where they live', 'two questions in one call', 'the language is `repo_language`']);
  says(text, ['`planning` runs only', 'the "Planning tickets" block of section 6']);
});

test('configure flow section 7: stack plugins are never preselected, also on "accept all"', () => {
  const seven = fs.readFileSync(path.join(PLUGIN, 'skills', '_shared', 'configure-plugins.md'), 'utf8');
  says(seven, ['Also on "accept all" or "your recommendation"', 'list the plugins by name', 'none marked recommended or preselected']);
});

test('configure-flow.md hands each rare part to its own file, naming the case; the common parts stay', () => {
  const text = flow();
  const sevenPointer = text.slice(text.indexOf('## 7. Stack plugins'), text.indexOf('## 8.'));
  says(sevenPointer, ['**Stack plugins**', 'the user picks plugins', '`<keel>/skills/_shared/configure-plugins.md`', 'read', 'follow it']);
  says(text.slice(text.indexOf('## 9.'), text.indexOf('## 10.')), ['No other system → skip this section without a question', '`<keel>/skills/_shared/configure-migration.md`', 'read', 'follow it']);
  says(text.slice(text.indexOf('6. **Price update**'), text.indexOf('7. **Write**')), ['**Price update**', '`<keel>/skills/_shared/configure-prices.md`', 'read', 'follow it']);
  says(text.slice(text.indexOf('**Instruction check, only when it is worth it**')), ['Advise', '`<keel>/skills/_shared/configure-instruction-check.md`', 'read', 'follow it']);
  assert.ok(text.includes('**ADR style** (`docs.adr_style`)'), 'the ADR style question stays');
  assert.ok(text.includes('4. **Write the manual setup down for the next developer.**'), 'the README step stays');
  for (const f of ['configure-plugins.md', 'configure-migration.md', 'configure-prices.md', 'configure-instruction-check.md']) assert.ok(fs.existsSync(path.join(PLUGIN, 'skills', '_shared', f)), f);
});

test('configure-flow.md: the scripts every setup needs run once, in one message, and the sections use their output', () => {
  const text = flow();
  const batch = text.slice(text.indexOf('**The setup\'s scripts run once, together.**'), text.indexOf('Existing AI instruction files'));
  assert.ok(batch.length > 200, 'the batch paragraph exists');
  says(batch, ['ONE message', 'separate tool calls', 'each its own plain `node` command']);
  says(batch, ['project mode, all five', 'scan.js', 'comments.js', 'migrate.js', 'claude-settings.js', 'usage-setup.js']);
  says(batch, ['machine mode, the last two only']);
  says(batch, ['`migrate.js find` is always in the batch', 'the scan does not see what it sees']);
  says(batch, ['Each section below uses the output already in the conversation']);
  says(text.slice(text.indexOf('## 3. Gates'), text.indexOf('## 4.')), ['several commands: all in one message as separate tool calls', 'it writes nothing']);
  says(text.slice(text.indexOf('## 10.'), text.indexOf('## 11.')), ['output of `node "<keel>/scripts/claude-settings.js" "<project>" show` from section 0\'s batch']);
  says(text.slice(text.indexOf('## 11.'), text.indexOf('## 12.')), ['output of `node "<keel>/scripts/usage-setup.js" "<project>" show` from section 0\'s batch']);
  says(text.slice(text.indexOf('## 9.'), text.indexOf('## 10.')), ['output of `node "<keel>/scripts/migrate.js" "<project>" find` from the batch of section 0']);
  says(text.slice(text.indexOf('## 6.'), text.indexOf('## 7.')), ['use the output of `node "<keel>/scripts/comments.js" "<project>" --project` from section 0\'s batch']);
  says(text.slice(text.indexOf('## 2.'), text.indexOf('## 3.')), ['ran in section 0\'s batch', 'use its output']);
  // Without AskUserQuestion the scripts still run first.
  says(text, ['first run the scripts of every section', 'the batch of section 0', 'then ask all questions in one message']);
});

test('configure flow section 11: keel\'s status line on macOS or Linux checks for jq', () => {
  const eleven = flow().slice(flow().indexOf('## 11. Usage and costs'), flow().indexOf('## 12.'));
  says(eleven, ['`install` on macOS or Linux', 'run `command -v jq`', "say that keel's line then shows less", 'give the install hint']);
});

test('configure flow section 10: the personal settings file is offered to .gitignore when git does not ignore it', () => {
  const ten = flow().slice(flow().indexOf('## 10. Claude Code settings'), flow().indexOf('## 11.'));
  says(ten, ['`git check-ignore .claude/settings.local.json`', 'offer to add the line `.claude/settings.local.json`', "project's `.gitignore`"]);
  says(flow().slice(flow().indexOf('## 12.')), ['README, CLAUDE.md, `.gitignore` or `.claude/settings.json`', 'when this setup changed them']);
});

test('configure flow: the quick setup states its real number of questions', () => {
  const zero = flow().slice(flow().indexOf('**Quick or detailed**'), flow().indexOf('| Section | Quick |'));
  says(zero, ['quick (recommended: 11 to 18 questions', 'depending on the project']);
  assert.doesNotMatch(zero, /about six/);
});
