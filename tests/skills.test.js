'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { says } = require('./fixtures/texts.js');

const SKILLS = path.join(__dirname, '..', 'plugins', 'keel', 'skills');
const ADVICE = [
  'adr-required', 'architecture', 'documentation-philosophy', 'git', 'migration-safety',
  'performance-review', 'postgres-best-practices', 'production-readiness', 'python-conventions',
  'root-cause-analysis', 'when-tests-are-owed',
];

function parse(name) {
  const text = fs.readFileSync(path.join(SKILLS, name, 'SKILL.md'), 'utf8');
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  assert.ok(m, `${name}: frontmatter must start on the first line`);
  const fields = Object.fromEntries(m[1].split('\n').map((l) => {
    const i = l.indexOf(':');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }));
  return { fields, body: m[2] };
}

test('the 11 advisory skills exist', () => {
  const dirs = fs.readdirSync(SKILLS, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('_')).map((e) => e.name);
  for (const name of ADVICE) assert.ok(dirs.includes(name), `missing skill ${name}`);
});

for (const name of ADVICE) {
  test(`${name}: name matches its folder, short description, model may invoke it`, () => {
    const { fields, body } = parse(name);
    assert.equal(fields.name, name);
    assert.ok(fields.description && fields.description.length <= 240, `description is ${fields.description?.length} characters`);
    assert.match(fields.description, /^Use (when|before)/, 'description leads with its trigger');
    assert.equal(fields['disable-model-invocation'], undefined, 'advisory skills are model-invoked');
    assert.ok(body.length < 4000, `body is ${body.length} characters`);
  });
}

test('all advisory descriptions together stay within about 0.7k tokens', () => {
  const total = ADVICE.reduce((n, name) => n + parse(name).fields.description.length + name.length, 0);
  assert.ok(total <= 2800, `descriptions total ${total} characters`);
});

test('"See `skill`" cross-references point to existing skills', () => {
  for (const name of ADVICE) {
    for (const [, ref] of parse(name).body.matchAll(/See `([a-z-]+)`/g)) {
      assert.ok(ADVICE.includes(ref), `${name} references unknown skill ${ref}`);
    }
  }
});

test('configure is user-only and every file the flow names exists in the plugin', () => {
  const text = fs.readFileSync(path.join(SKILLS, 'configure', 'SKILL.md'), 'utf8');
  assert.match(text, /^disable-model-invocation: true$/m);
  assert.match(text, /^!`node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/config-check\.js" "\$\{CLAUDE_PROJECT_DIR\}"`$/m);
  const root = path.join(SKILLS, '..');
  for (const file of ['skills/configure/SKILL.md', 'skills/_shared/configure-flow.md', 'skills/_shared/preflight.md', 'skills/_shared/intake.md', 'skills/_shared/git.md', 'skills/_shared/handoff.md', 'skills/_shared/planning.md']) {
    const body = fs.readFileSync(path.join(root, file), 'utf8');
    for (const [, ref] of body.matchAll(/<keel>\/([A-Za-z0-9_./-]+)/g)) {
      assert.ok(fs.existsSync(path.join(root, ref)), `${file} names <keel>/${ref}, which does not exist`);
    }
    assert.doesNotMatch(body.replace(/^[\s\S]*?\n---\n/, ''), file.startsWith('skills/_shared') ? /\$\{CLAUDE_PLUGIN_ROOT\}|\$\{user_config/ : /^\b$/, 'shared files are read by the model, so placeholders would stay unsubstituted');
  }
});

const COMMANDS = ['start-task', 'start-session', 'end-task', 'end-session', 'start-planning', 'end-planning', 'cleanup', 'tasks', 'feature-page'];

test('the workflow commands and cleanup are user-only, check the config first and name only existing files', () => {
  const root = path.join(SKILLS, '..');
  for (const name of COMMANDS) {
    const { fields, body } = parse(name);
    assert.equal(fields.name, name);
    assert.equal(fields['disable-model-invocation'], 'true', name);
    assert.ok(fields.description.length <= 200, `${name} description`);
    assert.match(fields['allowed-tools'], /check-config\.js/);
    assert.match(body, /^!`node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/check-config\.js" "\$\{CLAUDE_PROJECT_DIR\}" --profile`$/m, name);
    says(body, ['skills/_shared/preflight.md'], `${name} reads the preflight`);
    assert.ok(body.indexOf('preflight.md') < body.search(/intake\.md|handoff\.md|verify\.md|planning\.md|cleanup\.js|notes\.js|plans\.js|feature-page\.js/), `${name}: preflight comes first`);
  }
  for (const file of [...COMMANDS.map((c) => `skills/${c}/SKILL.md`), 'skills/_shared/intake.md', 'skills/_shared/handoff.md', 'skills/_shared/planning.md', 'skills/_shared/git.md', 'skills/_shared/delegate.md', 'skills/_shared/migrate.md', 'skills/_shared/feature-page-build.md', 'templates/keel/plan.md']) {
    const body = fs.readFileSync(path.join(root, file), 'utf8');
    for (const [, ref] of body.matchAll(/<keel>\/([A-Za-z0-9_./-]+)/g)) {
      assert.ok(fs.existsSync(path.join(root, ref)), `${file} names <keel>/${ref}, which does not exist`);
    }
    if (!file.endsWith('SKILL.md')) assert.doesNotMatch(body, /\$\{CLAUDE_PLUGIN_ROOT\}|\$\{user_config/, `${file} is read by the model: placeholders would stay unsubstituted`);
  }
});

test('feature-page: may run the scripts it names, finds its page by the feature\'s code and keeps the title current', () => {
  const { fields, body } = parse('feature-page');
  const runs = [...body.matchAll(/node "<keel>\/scripts\/([\w-]+\.js)"( report)?/g)].map((m) => `${m[1]}"${m[2] || ''}`);
  assert.deepEqual([...new Set(runs)].sort(), ['feature-page.js"', 'usage.js" report']);
  for (const run of new Set(runs)) {
    for (const shell of ['Bash', 'PowerShell']) assert.ok(fields['allowed-tools'].includes(`${shell}(node "\${CLAUDE_PLUGIN_ROOT}/scripts/${run} *)`), `${shell}: ${run} is allowed`);
  }
  says(body, ["This feature's page is the one whose title", 'ends with ` (<code>)`', 'the `code:` line']);
  says(body, ['`code written: <files> (...)`', 'commit and push them', 'every machine finds this page']);
  assert.doesNotMatch(body, /--taken|marker|title if taken/);
  const build = fs.readFileSync(path.join(SKILLS, '_shared', 'feature-page-build.md'), 'utf8');
  says(build, ["its title is not the `title:` line", 'takes that title too', "the tool's title"]);
});

test('feature-page: the questions stay in the session, the page is built and published in one Sonnet agent', () => {
  const { body } = parse('feature-page');
  const build = fs.readFileSync(path.join(SKILLS, '_shared', 'feature-page-build.md'), 'utf8');
  // The session never reads the page: neither the earlier one nor the built one.
  assert.doesNotMatch(body, /action: read|Read the whole page|translated\.json/);
  says(body, ['Do not read it here', 'the page agent reads it']);
  assert.ok(body.indexOf('Several → ask which') < body.indexOf('feature-page-build.md'), 'the questions come before the agent');
  says(build, ['one `Agent` call', '`subagent_type: "general-purpose"`', '`model: "sonnet"`']);
  says(build, ['No `Agent` tool', 'do steps 1-4 yourself']);
  says(build, ['`skip: no page tool in the agent`', 'the agent cannot start', 'do steps 1-4 yourself']);
  says(build, ['an error after the agent started', 'no reply', 'running the command again', 'Do not do the steps yourself', 'made twice']);
  says(build, ['the agent cannot start', 'the `Agent` call is refused before any work']);
  // A page the user links is updated only when it is this feature's: its title carries the code.
  says(build, ['`<code>` = <the `code:` line>']);
  says(build, ['Its `<title>` must end with ` (<code>)</title>`', '`failed: not this feature\'s page (<its title>)`', 'never publish over another page']);
  says(build, ['`failed: not this feature\'s page (<its title>)` → say the link is not this feature\'s page', 'start the agent again with `<url>` = new']);
  assert.ok(build.indexOf("never publish over another page") < build.indexOf('feature-page.js" "<project>" <args>'), 'the title is checked before the build and the publish');
  says(body, ['the `code:` line and the page from step 4']);
  says(build, ['read it into a file', 'never into the conversation']);
  says(build, ['`published: <link> <new|updated>; <n> tickets; as of <the as of hashes>; language <code>`']);
  says(build, ['`; fetch failed: <its reason>`', '`; no labels for <code>`']);
  says(body, ["the reply's `published:` line", '`fetch failed: <reason>`', '`no labels for <code>`']);
  const runs = [...build.matchAll(/node "<keel>\/scripts\/([\w-]+\.js)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(runs)], ['feature-page.js'], 'the agent runs only the page script');
});

test('end commands verify, then write the note and do git in the agreed order', () => {
  const end = (name) => parse(name).body;
  for (const name of ['end-task', 'end-session']) {
    const body = end(name);
    assert.ok(body.indexOf('verify.md') < body.indexOf('git.md'), `${name}: verification before git`);
    assert.match(body, /--base/, `${name}: committed work is verified too`);
  }
  // A finished task leaves its branch in the final commit, so the folder is deleted before git and never reaches the main branch.
  assert.ok(end('end-task').indexOf('task delete <id> --session') < end('end-task').indexOf('git.md'), 'the task folder is deleted before the final commit and the merge');
  // Claude Code itself confirms the folder (keel's hook asks); the instructions only announce it.
  const et = end('end-task');
  assert.ok(et.indexOf('Claude Code will now ask you to confirm') < et.indexOf('task delete <id> --session'), 'the confirmation is announced before the call');
  assert.match(et, /declines[\s\S]*user's "no"/, 'a declined confirmation keeps the task');
  says(et, ['--finish <id> --session <sid>'], 'git steps of a finish put the task back by themselves when they stop');
  assert.doesNotMatch(et, /Is the task fully\s+done\?/, 'no question in the chat');
  assert.ok(end('end-task').indexOf('usage-sync.md') < end('end-task').indexOf('task delete <id> --session'), 'the costs read the task title first');
  assert.ok(end('end-task').indexOf('task deactivate') > end('end-task').indexOf('git.md'), 'a handed-off task is released after git');
  // A planned ticket is marked done after the folder deletion (a declined deletion marks nothing) and before git (same commit as the code).
  const done = et.indexOf('plans.js" "<project>" done <id>`');
  assert.ok(et.indexOf('task delete <id> --session') < done && done < et.indexOf('8. Git: read `<keel>/skills/_shared/git.md`'), 'task delete, then plans.js done, then git');
  const es = end('end-session');
  assert.ok(es.indexOf('verify.md') < es.indexOf('plans.js" "<project>" done <KEY>`') && es.indexOf('done <KEY>`') < es.indexOf('7. Costs'), 'end-session: verified first, tickets marked before the commit');
  assert.match(fs.readFileSync(path.join(SKILLS, '_shared', 'final-report.md'), 'utf8'), /\/clear before the next task/);
  assert.ok(end('end-session').indexOf('handoff.md') < end('end-session').indexOf('git.md'), 'the note is prepared before the action');
});

test('the plan template has the Execution section that survives "clear context"', () => {
  const plan = fs.readFileSync(path.join(SKILLS, '..', 'templates', 'keel', 'plan.md'), 'utf8');
  const exec = plan.slice(plan.indexOf('## Execution'));
  assert.ok(plan.includes('## Execution'));
  says(exec, ['notes.js" "<project>" task new']);
  assert.ok(exec.indexOf('git-flow.js') < exec.indexOf('task new'), 'the task file is written on its branch');
  says(exec, ['git-flow.js" "<project>" start --name']);
  says(exec, ['/keel:end-task']);
  for (const section of ['## Files', '## Architecture', '## Libraries and framework', '## Tests', '## Likely verification level', '## Documentation', '## Steps']) assert.ok(plan.includes(section), section);
  assert.ok(exec.includes('Execution: <here | delegate | fresh>'));
  assert.ok(exec.includes('skills/_shared/delegate.md'), 'delegation survives "clear context" through the plan');
  assert.ok(plan.indexOf('## Steps') < plan.indexOf('## Execution'));
});

test('delegation is wired: planning asks here or delegate, start-session delegates on request, the loop accepts and repairs', () => {
  const read = (f) => fs.readFileSync(path.join(SKILLS, '_shared', f), 'utf8');
  const intake = read('intake.md');
  assert.match(intake, /plan-steps.js/);
  assert.match(intake, /Here or delegate|here or delegate/i);
  says(intake, ['model: sonnet']);
  says(intake, ['confirm or change']);
  assert.match(intake, /delegate.md/);
  const handoff = read('handoff-resume.md');
  says(handoff, ['do it through subagents']);
  assert.match(handoff, /plan-steps.js" "<project>" "<file with the steps>" --remaining/);
  const loop = read('delegate.md');
  says(loop, ['keel:implementer']);
  says(loop, ['`name` = `step-<n>`'], 'named, so a repair reaches the same implementer');
  says(loop, ['SendMessage` to the same `step-<n>`']);
  says(loop, ['select:SendMessage'], 'deferred tool is loaded first');
  says(loop, ['`model` and `effort` = the step\'s']);
  assert.ok(loop.includes('Done: <c> of <t> criteria (<c/t as %>)'), 'turn limit: a factual share of confirmed criteria');
  says(loop, ['Advice: <continue']);
  says(loop, ['stopped at its <n>-turn limit before finishing'], 'the wording Claude Code uses for a partial agent');
  says(loop, ['do **not** send anything yet'], 'at the turn limit the user decides, not the session');
  says(loop, ['- implementer: <agent id'], 'the agent id survives a resumed session, the name does not');
  assert.match(loop, /ledger-report.js" "<project>" --since <time> --agent implementer/);
  says(loop, ['No commits per step']);
});

test('templates: the note and the task carry the fields notes.js reads', () => {
  const { frontmatter } = require(path.join(SKILLS, '..', 'scripts', 'notes.js'));
  const tpl = (f) => fs.readFileSync(path.join(SKILLS, '..', 'templates', 'keel', f), 'utf8');
  assert.deepEqual(Object.keys(frontmatter(tpl('next-session.md'))), ['status', 'branch', 'base', 'merge_into', 'execution', 'keys', 'after_commit', 'date']);
  // started: the commit the task began at, so a ticket on its shared feature branch is verified from there.
  assert.deepEqual(Object.keys(frontmatter(tpl('task.md'))), ['id', 'title', 'source', 'link', 'status', 'branch', 'base', 'merge_into', 'execution', 'plan', 'created', 'updated', 'after_commit', 'started']);
  const headings = [...tpl('task.md').matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(headings, ['Goal', 'Next action', 'Acceptance criteria', 'Out of scope', 'State', 'Files', 'Decisions and why', 'Tried and did not work', 'Open questions', 'How to check', "User's changes"]);
  assert.match(tpl('task.md'), /^status: <active \| handed-off>$/m);
  // The template states its rules without naming where they came from.
  assert.doesNotMatch(tpl('task.md'), /Sources:|http/, 'the template cites no outside source');
  assert.match(tpl('next-session.md'), /^## Later$/m);
  assert.ok(!fs.existsSync(path.join(SKILLS, '..', 'templates', 'keel', 'current-task.md')), 'current-task.md is gone');
  for (const f of ['next-session.md', 'project-memory.md', 'session-log.md']) assert.ok(tpl(f).split('\n').length < 60, f);
});

test('languages: plans and the chat in the conversation language, repository files in repo_language', () => {
  const read = (f) => fs.readFileSync(path.join(SKILLS, '..', f), 'utf8');
  const intake = read('skills/_shared/intake.md');
  says(intake, ['**whole plan**']);
  says(intake, ['a language the user explicitly asks for in this session wins', 'for this session only']);
  says(intake, ['`repo_language`']);
  says(read('skills/_shared/handoff.md'), ['translate the text', 'when the plan is in another language']);
  says(read('skills/_shared/configure-flow.md'), ['Existing documents keep the language', 'they are written in']);
  assert.match(read('hooks/standards.md'), /A document keeps its own language when edited/);
  assert.match(read('templates/keel/plan.md'), /Write the whole plan in the conversation language/);
  // The language that applies is the project's own, else the machine's; the session-start line names it.
  for (const c of COMMANDS) says(read(`skills/${c}/SKILL.md`), ["the language in keel's session-start line", "this project's own, else the machine's", '${user_config.conversation_language}', 'a language the user explicitly asks for in this session wins']);
  assert.doesNotMatch(JSON.stringify(require(path.join(SKILLS, '..', 'schemas', 'config.schema.json'))), /files_language/);
});

test('migration and cleanup are wired: configure section 9, the end commands remind, the guards are stated', () => {
  const read = (f) => fs.readFileSync(path.join(SKILLS, '..', f), 'utf8');
  const flow = read('skills/_shared/configure-flow.md');
  const nine = flow.slice(flow.indexOf('## 9.'), flow.indexOf('## 10.'));
  const nineFile = read('skills/_shared/configure-migration.md');
  says(nine, ['migrate.js" "<project>" find']);
  says(nine, ['`<keel>/skills/_shared/configure-migration.md`', 'read', 'follow it']);
  says(nineFile, ['skills/_shared/migrate.md']);
  says(nine + nineFile, ['/keel:configure migration']);
  says(nineFile, ['already chosen "now", so do not ask'], 'a direct /keel:configure migration skips "now or later"');
  const migrate = read('skills/_shared/migrate.md');
  for (let n = 1; n <= 13; n++) assert.match(migrate, new RegExp(`^## ${n}\\. `, 'm'), `migration step ${n}`);
  says(migrate, ['keel:context'], 'the overview uses the context agent');
  says(migrate, ['Product, variable and service names stay']);
  says(migrate, ['never opened, moved, deleted or quoted']);
  says(migrate, ['to keel\'s trash (recommended'], 'old notes go to the trash by default');
  says(migrate, ['claude plugin disable <id>']);
  says(migrate, ['refs --folder "<old folder>" --prefix "<name>:"']);
  says(migrate, ['its yes is the yes to write them', 'no second question'], 'the config is not asked twice');
  says(migrate, ['ready commit message'], 'the final report keeps the commit message');
  says(migrate, ['`/keel:cleanup` can go through', 'what the old system left']);
  says(migrate, ['never start over']);
  const cleanup = parse('cleanup').body;
  says(cleanup, ['move --items <numbers>']);
  says(cleanup, ['--red <numbers>']);
  says(cleanup, ['second question']);
  says(cleanup, ['gates: needed']);
  says(cleanup, ['restore <batch>']);
  assert.match(cleanup, /empty-trash/);
  for (const name of ['end-task', 'end-session']) {
    const body = parse(name).body;
    says(body, ['cleanup.js" "<project>" reminder'], `${name} reminds about leftovers`);
    assert.ok(body.indexOf('reminder') > body.indexOf('git.md'), `${name}: the reminder comes after git`);
  }
});

// --- the usage calculator's instructions point at things that exist ---

const PLUGIN_DIR = path.join(__dirname, '..', 'plugins', 'keel');
const read = (...p) => fs.readFileSync(path.join(PLUGIN_DIR, ...p), 'utf8');

test('usage-sync.md names only scripts and subcommands that exist', () => {
  const text = read('skills', '_shared', 'usage-sync.md');
  const scripts = new Set([...text.matchAll(/<keel>\/scripts\/([\w.-]+\.js)/g)].map((m) => m[1]));
  assert.ok(scripts.size > 0);
  for (const s of scripts) assert.ok(fs.existsSync(path.join(PLUGIN_DIR, 'scripts', s)), `${s} does not exist`);
  const cli = read('scripts', 'usage.js');
  for (const m of text.matchAll(/usage\.js" (\w[\w-]*)/g)) {
    assert.ok(cli.includes(`//   ${m[1]} `), `usage.js documents no ${m[1]}`);
  }
  for (const m of text.matchAll(/<keel>\/(skills|data|templates|statusline)\/([\w./-]+)/g)) {
    assert.ok(fs.existsSync(path.join(PLUGIN_DIR, m[1], m[2])), `${m[1]}/${m[2]} does not exist`);
  }
});

test('usage-sync.md passes the planning feature and names only flags usage.js documents', () => {
  const text = read('skills', '_shared', 'usage-sync.md');
  says(text, ['from `/keel:end-planning`, `--feature <feature>`']);
  // A retry that dropped --feature would record an earlier task's changes on the planning chat.
  says(text, ['the same `prepare` again, plus `--version']);
  const lines = read('scripts', 'usage.js').split(/\r?\n/);
  const header = lines.slice(1, lines.findIndex((l, i) => i > 0 && !l.startsWith('//'))).join('\n');
  const flags = new Set(text.match(/--[a-z][\w-]*/g));
  assert.ok(flags.size > 0);
  for (const f of flags) assert.match(header, new RegExp(`${f}(?![\\w-])`), `the usage.js header documents no ${f}`);
});

test('end-task, end-session and end-planning hand the costs step to usage-sync.md with the session id', () => {
  for (const name of ['end-task', 'end-session', 'end-planning']) {
    const text = read('skills', name, 'SKILL.md');
    says(text, ['_shared/usage-sync.md'], name);
    assert.ok(text.includes('${CLAUDE_SESSION_ID}'), `${name} passes the session id`);
  }
  assert.ok(fs.existsSync(path.join(PLUGIN_DIR, 'skills', '_shared', 'usage-sync.md')));
});

test('configure-flow.md has the usage and write sections, and names only usage-setup.js subcommands that exist', () => {
  const text = read('skills', '_shared', 'configure-flow.md') + read('skills', '_shared', 'configure-prices.md');
  assert.match(text, /^## 11\. Usage and costs/m);
  assert.match(text, /^## 12\. Write and summary/m);
  assert.ok(text.indexOf('## 11. Usage and costs') < text.indexOf('## 12. Write and summary'));
  const line = read('scripts', 'usage-setup.js').split('\n').find((l) => l.includes('usage: usage-setup.js'));
  assert.ok(line, 'usage-setup.js prints a usage line');
  const used = new Set([...text.matchAll(/usage-setup\.js" "<project>" ([\w-]+)/g)].map((m) => m[1]));
  assert.ok(used.size >= 5, `found ${[...used]}`);
  for (const sub of used) assert.ok(line.includes(sub), `usage-setup.js has no ${sub}`);
});

// usage-page.md holds finding, creating and updating the page (configure and /keel:usage on read it); a page of
// another account or a team page is not offered. Several pages titled "keel usage" are asked about; the read says
// "owned by you", not "writer".
test('usage-page.md finds, creates and updates the page with the built-in tools; the page data stays', () => {
  const text = read('skills', '_shared', 'usage-page.md');
  const flow = read('skills', '_shared', 'configure-flow.md');
  const eleven = flow.slice(flow.indexOf('## 11. Usage and costs'), flow.indexOf('## 12.'));
  says(eleven, ['`<keel>/skills/_shared/usage-page.md`']);
  assert.doesNotMatch(eleven, /page_shared|approved_artifact_urls/);
  says(text, ['made and updated with the built-in', '`Artifact` and `ArtifactData` tools', 'deferred counts']);
  const find = text.slice(text.indexOf('## Find'), text.indexOf('## Create'));
  says(find, ['`Artifact` `action: list`, mine, `limit` 200']);
  says(find, ['Several → ask which one']);
  const create = text.slice(text.indexOf('## Create'), text.indexOf('## Update'));
  says(create, ['`capabilities` `{ "db": {}, "user": {}, "downloads": true }`']);
  assert.match(create, /`set` to collection `meta`, doc `settings`,\s+`\{ "language": "<conversation language code>", "schema": 1, "template": "<page_template printed by page>" \}`/);
  const update = text.slice(text.indexOf('## Update'), text.indexOf('## Save'));
  assert.match(update, /its data\s+stays whatever is done/);
  says(update, ['`action: read`, that `url`'], 'read first: the Artifact tool publishes over a page only after a read');
  says(update, ['title is not "keel usage"', 'neither "owned by you" nor "writer"', 'stop and say why']);
  says(update, ['no `title`, `icon` or `capabilities`'], 'the page keeps its capabilities');
  says(update, ['`if_version` = the `version` the `get` returned']);
  says(text, ['usage-setup.js" "<project>" apply "<project>/.keel/local/tmp/usage-setup.json"']);
});

test('usage-sync.md: the database sync reads the page settings too, into the same folder report reads', () => {
  const text = read('skills', '_shared', 'usage-sync.md');
  const step = text.slice(text.indexOf('3. **Sync through the database**'), text.indexOf('4. **'));
  says(step, ['three `ArtifactData` calls']);
  says(step, ['`out_dir` = `<project>/.keel/local/usage/in`']);
  says(step, ['collection `meta` with `query: { limit: 10 }`']);
  says(text, ['plus `--in "<project>/.keel/local/usage/in"` after step 3'], 'report reads the same folder');
});

test('usage-sync.md: the page tool is found first and passed to prepare', () => {
  const text = read('skills', '_shared', 'usage-sync.md');
  says(text, ['`ArtifactData` among the tools', 'deferred counts', '`<tools>` is `db`', 'otherwise `none`']);
  says(text, ['prepare --tools <tools>']);
  assert.doesNotMatch(text, /restart(ing)? Claude Code/i);
});

test('usage-sync.md: the sync runs in a small Haiku agent; the calling session waits for it and reports', () => {
  const text = read('skills', '_shared', 'usage-sync.md');
  const start = text.slice(text.indexOf('**Start the sync agent**'), text.indexOf('1. **Limits snapshot'));
  says(start, ['`subagent_type: "general-purpose"`', '`model: "haiku"`', 'do its steps 1-3 exactly', 'every `<...>` replaced by its']);
  says(start, ['`synced`, `skip: <reason>` or `incomplete: <what failed>`']);
  // end-task deletes the task right after the sync, and prepare reads that task.
  says(start, ['Wait for its reply before the command\'s next step']);
  says(start, ['no `Agent` tool, or the agent cannot start → do steps 1-3 yourself']);
  // A session without the page tool (an API key) keeps prepare's own skip reason instead of an agent's.
  says(start, ['`ArtifactData` is not', 'start no agent: do steps 1-2 yourself']);
  // A half-finished agent may have written batches: the session must not sync a second time.
  says(start, ['No reply, or another reply', 'do not run steps 1-3 again']);
  says(text, ['`skip: no page tool in the agent`', 'the calling session then syncs itself']);
  says(text, ['in the same message as the last ack']);
  says(text, ['4. **Not now: last, right before you write the final report** (the calling session']);
});

test('the sync cost is given in measured dollars only: no old estimate, no share of a plan limit', () => {
  const docs = (f) => fs.readFileSync(path.join(__dirname, '..', 'docs', f), 'utf8');
  const flow = read('skills', '_shared', 'configure-flow.md');
  const step5 = flow.slice(flow.indexOf('5. **Usage page**'), flow.indexOf('6. **Price update**'));
  const texts = { 'usage-dashboard.md': docs('usage-dashboard.md'), 'under-the-hood.md': docs('under-the-hood.md'), 'configure step 5': step5, 'usage-sync.md': read('skills', '_shared', 'usage-sync.md') };
  for (const [name, text] of Object.entries(texts)) {
    assert.doesNotMatch(text, /0\.01.{0,3}0\.04|few cents/, `${name}: the old sync estimate is back`);
  }
  // Plans differ, so only the end reports, which calibrate per account, give shares of a limit.
  for (const name of ['configure step 5', 'usage-sync.md']) assert.doesNotMatch(texts[name], /\d\s?% of/, `${name}: a share of a plan limit`);
  says(step5, ['about $0.07-0.20', 'The longer the session, the more it costs', 'dollars only']);
});

// /keel:usage includes `clear`, so the skill may run usage-clear.js too.
test('/keel:usage: user-only, reads only the usage settings and gives or opens the page link; on, off and clear', () => {
  const { fields, body } = parse('usage');
  assert.equal(fields.name, 'usage');
  assert.equal(fields['disable-model-invocation'], 'true');
  assert.match(fields['allowed-tools'], /^Bash\(node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/usage-setup\.js" \*\), PowerShell\(/);
  assert.match(body, /^!`node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/usage-setup\.js" "\$\{CLAUDE_PROJECT_DIR\}" show`$/m);
  says(body, ['`artifact_url`']);
  // The page may run a newer keel's page; the line says to update keel everywhere first.
  says(body, ["`page template` says `offer: update` → one line: the page runs another keel's page, usually an older one", 'update keel on every machine first']);
  says(body, ['`sync: off since <date>` → one line']);
  says(body, ['`Artifact` tool (`action: open`']);
  says(body, ['`/keel:usage on` sets it up']);
  const off = body.slice(body.indexOf('**`off`**'), body.indexOf('**`on`**'));
  // `on` sends only what Claude Code's logs still hold, so that is explained before the question.
  assert.ok(off.indexOf('Ask "Turn the sync off?"') > off.indexOf('they keep 30 days by default'), 'explained before the question');
  says(off, ['usage-setup.js" "<project>" sync off`']);
  assert.match(body.slice(body.indexOf('**`on`**'), body.indexOf('**`clear`**')), /usage-setup\.js" "<project>" sync on`[\s\S]*usage-page\.md/);
  assert.match(fields['argument-hint'], /\[on\|off\|clear\]/);
  for (const shell of ['Bash', 'PowerShell']) assert.ok(fields['allowed-tools'].includes(`${shell}(node "\${CLAUDE_PLUGIN_ROOT}/scripts/usage-clear.js" *)`), `${shell}: usage-clear.js is allowed`);
  assert.match(body.slice(body.indexOf('**`clear`**')), /`<keel>\/skills\/_shared\/usage-clear\.md`/);
  says(body, ['the language in keel\'s session-start line']);
});

test('/keel:help: user-only, static, short, and its table names every keel command and nothing else', () => {
  const { fields, body } = parse('help');
  assert.equal(fields.name, 'help');
  assert.equal(fields['disable-model-invocation'], 'true');
  assert.equal(fields['allowed-tools'], undefined, 'it runs nothing');
  assert.doesNotMatch(body, /^!`/m, 'no script output: it is static');
  says(body, ['the language in keel\'s session-start line']);
  const rows = [...body.matchAll(/^\| `\/keel:([a-z-]+)/gm)].map((m) => m[1]);
  const userOnly = fs.readdirSync(SKILLS, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('_') && parse(e.name).fields['disable-model-invocation'] === 'true').map((e) => e.name);
  assert.deepEqual([...rows].sort(), [...userOnly].sort(), 'every user command, once');
  assert.deepEqual([...COMMANDS, 'configure', 'help', 'usage'].sort(), [...userOnly].sort());
  assert.ok(body.split('\n').length < 30, 'short');
  says(body, ['/keel:configure', 'machine'], 'the configure row names the machine section');
  says(body, ['/keel:cleanup', 'restore', 'empty-trash'], 'the cleanup row names restore and empty-trash');
});

test('every command the user runs has its section in docs/commands.md', () => {
  const commands = fs.readdirSync(SKILLS).filter((n) => fs.existsSync(path.join(SKILLS, n, 'SKILL.md')) && parse(n).fields['disable-model-invocation'] === 'true');
  assert.ok(commands.includes('feature-page') && commands.length >= 12, commands.join(', '));
  const text = fs.readFileSync(path.join(__dirname, '..', 'docs', 'commands.md'), 'utf8');
  for (const name of commands) assert.match(text, new RegExp(`^## \`/keel:${name}\`$`, 'm'), `/keel:${name}`);
});
