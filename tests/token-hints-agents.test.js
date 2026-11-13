'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tempDir } = require('./fixtures/tmp.js');
const { says } = require('./fixtures/texts.js');

const PLUGIN = path.join(__dirname, '..', 'plugins', 'keel');
const norm = (p) => p.replace(/\\/g, '/');
const HOOK_TMP = tempDir('keel-hint-tmp-');
let n = 0;

function project() {
  const dir = tempDir('keel-hint-proj-');
  fs.mkdirSync(path.join(dir, '.keel'));
  fs.writeFileSync(path.join(dir, '.keel', 'config.json'), '{}');
  return dir;
}

function runHint(plugin, dir, tool, input, { session = `t-${process.pid}-${Date.now()}-th${n++}`, env = {}, extra = {} } = {}) {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE_')));
  const r = spawnSync(process.execPath, [path.join(plugin, 'hooks', 'skill-hints.js')], {
    input: JSON.stringify({ session_id: session, cwd: dir, tool_name: tool, tool_input: input, ...extra }),
    env: { ...clean, TEMP: HOOK_TMP, TMP: HOOK_TMP, TMPDIR: HOOK_TMP, CLAUDE_PROJECT_DIR: dir, ...env },
    encoding: 'utf8',
  });
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : '';
}

const hint = (dir, tool, input, opts) => runHint(PLUGIN, dir, tool, input, opts);
const body = (skill) => fs.readFileSync(path.join(PLUGIN, 'skills', skill, 'SKILL.md'), 'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');

test('a hint for a .py edit carries the python-conventions rules, not an order to load the skill', () => {
  const dir = project();
  const text = hint(dir, 'Edit', { file_path: path.join(dir, 'app', 'x.py') });
  const line = body('python-conventions').split('\n').find((l) => l.startsWith('- **Async:**'));
  assert.ok(line, 'the skill has the async rule');
  assert.ok(text.includes(line), 'a line of the skill body is in the hint');
  assert.ok(text.startsWith('keel: this is Python code.'), 'the reason comes first');
  assert.ok(!text.includes('Skill tool'), 'no extra request to load the skill');
  assert.ok(!text.includes('description:'), 'the front matter is not part of the hint');
});

for (const [skill, file] of [
  ['architecture', 'src/new-module.js'],
  ['adr-required', 'docs/adr/0004-jobs.md'],
  ['documentation-philosophy', 'README.md'],
  ['migration-safety', 'db/migrations/002_x.sql'],
]) {
  test(`the ${skill} hint has no unresolved placeholder and names the real plugin path`, () => {
    const dir = project();
    const text = hint(dir, 'Write', { file_path: path.join(dir, ...file.split('/')) }, { env: { CLAUDE_PLUGIN_OPTION_CONVERSATION_LANGUAGE: 'uk' } });
    assert.ok(text.length > 0, 'a hint');
    assert.ok(!text.includes('${'), 'no ${...} left');
    assert.ok(!text.includes('CLAUDE_PLUGIN_ROOT'), 'plugin root resolved');
    if (skill !== 'architecture') assert.ok(text.includes(`${norm(PLUGIN)}/skills/_shared/`), 'a path into the real plugin folder');
    if (skill === 'architecture') assert.match(text, /else uk\)/, "the project's language replaces the placeholder");
  });
}

test('the hint still comes once per skill per session, and subagents get nothing but the implementer', () => {
  const dir = project();
  const session = `t-${process.pid}-${Date.now()}-once`;
  const edit = (extra) => hint(dir, 'Edit', { file_path: path.join(dir, 'a.py') }, { session, extra });
  assert.equal(edit({ agent_id: 'a1', agent_type: 'keel:bug-hunter' }), '', 'a subagent: nothing, and the skill is not used up');
  assert.ok(edit({}).length > 0, 'first time');
  assert.equal(edit({}), '', 'second time: silent');
  assert.ok(hint(dir, 'Edit', { file_path: path.join(dir, 'b.py') }, { session: `${session}-2`, extra: { agent_id: 'a2', agent_type: 'keel:implementer' } }).length > 0, 'the implementer hears it');
});

test('an unreadable skill file falls back to the one-line hint', () => {
  const copy = path.join(tempDir('keel-hint-plugin-'), 'keel');
  fs.cpSync(PLUGIN, copy, { recursive: true, filter: (s) => !/[\\/]evals([\\/]|$)/.test(s) });
  fs.rmSync(path.join(copy, 'skills', 'python-conventions', 'SKILL.md'));
  const dir = project();
  const text = runHint(copy, dir, 'Edit', { file_path: path.join(dir, 'x.py') });
  assert.equal(text, 'keel: this is Python code. Load the keel:python-conventions skill (Skill tool) and follow it, unless you already did in this session.');
});

test('the largest hinted skill body stays well under the context limit of a hook', () => {
  const sizes = ['migration-safety', 'python-conventions', 'adr-required', 'documentation-philosophy', 'architecture', 'git'].map((s) => body(s).length);
  assert.ok(Math.max(...sizes) < 6000, `largest body: ${Math.max(...sizes)}`);
});

// --- review agents ---
const agentBody = (name) => fs.readFileSync(path.join(PLUGIN, 'agents', `${name}.md`), 'utf8');

test('bug-hunter and architect read the context map in the first step, then search in batches', () => {
  for (const name of ['bug-hunter', 'architect']) {
    const text = agentBody(name);
    says(text, ['context-map.md', 'First read'], `${name}: the context map is part of the first read`);
    says(text, ['batches', 'Grep', 'Read', 'one message'], `${name}: searches and reads in batches`);
  }
});

test('_search.md holds the batch line the agents point at', () => {
  const text = fs.readFileSync(path.join(PLUGIN, 'protocols', '_search.md'), 'utf8');
  says(text, ['Independent Grep and', 'Read calls go in one message']);
});

test('test-reviewer reverts once, runs the chosen tests in one command, restores once', () => {
  const text = agentBody('test-reviewer');
  says(text, ['all in one command', 'one revert and one restore']);
  says(text, ["Read each test's result separately", 'compile', 'proves nothing']);
});

test('qa runs ordinary scenarios as one written script; server, reproduce and qa-break stay separate', () => {
  const text = agentBody('qa');
  says(text, ['Ordinary scenarios', 'one script']);
  says(text, ['starting a server', 'reproduce', 'qa-break', 'separate']);
});
