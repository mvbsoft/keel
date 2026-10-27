'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { tempDir } = require('./fixtures/tmp.js');

const PLUGIN = path.join(__dirname, '..', 'plugins', 'keel');
const HOOKS = path.join(PLUGIN, 'hooks');

// The hooks keep once-per-session notes in the system temp folder; here that is a folder of the test's own.
const HOOK_TMP = tempDir('keel-hook-tmp-');

function runHook(script, stdin, env = {}, args = []) {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE_')));
  if (!('CLAUDE_PROJECT_DIR' in env) && !(stdin && typeof stdin === 'object' && stdin.cwd)) env = { CLAUDE_PROJECT_DIR: tempProject('keel-hook-'), ...env };
  const r = spawnSync(process.execPath, [...args, path.join(HOOKS, script)], {
    input: typeof stdin === 'string' ? stdin : JSON.stringify(stdin),
    env: { ...clean, TEMP: HOOK_TMP, TMP: HOOK_TMP, TMPDIR: HOOK_TMP, ...env },
    encoding: 'utf8',
  });
  return { code: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, raw: r.stdout };
}

// A project keel is set up in: keel's hooks act only there.
function tempProject(name) {
  const dir = tempDir(name);
  fs.mkdirSync(path.join(dir, '.keel'));
  fs.writeFileSync(path.join(dir, '.keel', 'config.json'), '{}');
  return dir;
}
let n = 0;
const session = () => `t-${process.pid}-${Date.now()}-fx${n++}`;

// --- skill-hints ---

test('skill-hints: project files are judged against CLAUDE_PROJECT_DIR when the session sits in a subfolder', () => {
  const dir = tempProject('keel-hint-');
  fs.mkdirSync(path.join(dir, 'db', 'migrations'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'app'));
  const call = (tool_input, tool_name = 'Write') => runHook('skill-hints.js',
    { session_id: session(), cwd: path.join(dir, 'app'), tool_name, tool_input }, { CLAUDE_PROJECT_DIR: dir }).raw;
  assert.match(call({ file_path: path.join(dir, 'db', 'migrations', '002_x.sql') }), /migration-safety/);
  assert.match(call({ command: 'cat ../db/migrations/002_x.sql' }, 'Bash'), /migration-safety/, 'relative paths start at the shell folder');
  assert.equal(call({ file_path: path.join(os.tmpdir(), 'elsewhere', 'a.py') }), '', 'outside the project: silent');
});

test('skill-hints: cd flags and the cmd /d switch are not folders', () => {
  const dir = tempProject('keel-hint-');
  fs.mkdirSync(path.join(dir, 'db', 'migrations'), { recursive: true });
  const call = (command, cwd = os.tmpdir()) => runHook('skill-hints.js', { session_id: session(), cwd, tool_name: 'Bash', tool_input: { command } }, { CLAUDE_PROJECT_DIR: dir }).raw;
  assert.match(call(`cd /d "${dir}" && cat db/migrations/001.sql`), /migration-safety/);
  assert.match(call(`cd -P "${dir}" && cat db/migrations/001.sql`), /migration-safety/);
  assert.match(call(`Set-Location -Path "${dir}"; Get-Content db/migrations/001.sql`), /migration-safety/);
  assert.match(call('cd db && cat migrations/001.sql', dir), /migration-safety/, 'a plain relative cd still works');
});

test('skill-hints: quoted text is not a redirection', () => {
  const dir = tempProject('keel-hint-');
  const call = (command) => runHook('skill-hints.js', { session_id: session(), cwd: dir, tool_name: 'Bash', tool_input: { command } }).raw;
  assert.equal(call('echo "a > b.py and more"'), '');
  assert.doesNotMatch(call('git commit -m "a > b.py and more"'), /python-conventions/);
  assert.match(call('git commit -m "a > b.py and more"'), /keel:git/, 'the commit itself is still hinted');
  assert.equal(call("echo 'x >> y.py' && ls"), '');
  assert.match(call('echo hi > "my script.py"'), /python-conventions/, 'a quoted redirection target still counts');
  assert.match(call('echo "x" > script.py'), /python-conventions/);
});

test("skill-hints: subagents get no hint and do not use up the main session's; keel's implementer does", () => {
  const dir = tempProject('keel-hint-');
  const sid = session();
  const call = (extra, sessionId = sid) => runHook('skill-hints.js', { session_id: sessionId, cwd: dir, tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'README.md') }, ...extra }).raw;
  assert.equal(call({ agent_id: 'a1', agent_type: 'keel:reviewer' }), '', 'a read-only reviewer');
  assert.equal(call({ agent_id: 'a2', agent_type: 'Explore' }), '');
  assert.equal(call({ agent_id: 'a3' }), '', 'no agent type');
  assert.match(call({}), /documentation-philosophy/, 'the main session still hears it');
  assert.equal(call({ agent_id: 'a4', agent_type: 'keel:implementer' }), '', 'once per session also holds for the implementer');
  assert.match(call({ agent_id: 'a5', agent_type: 'keel:implementer' }, session()), /documentation-philosophy/);
});

test('skill-hints: a skill is claimed by one marker file, so parallel calls cannot both name it', async () => {
  const dir = tempProject('keel-hint-');
  const sid = session();
  const input = JSON.stringify({ session_id: sid, cwd: dir, tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'README.md') } });
  const one = () => new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(HOOKS, 'skill-hints.js')], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, TEMP: HOOK_TMP, TMP: HOOK_TMP, TMPDIR: HOOK_TMP } });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('close', () => resolve(out));
    child.stdin.end(input);
  });
  const outs = await Promise.all(Array.from({ length: 6 }, one));
  assert.equal(outs.filter((o) => o.includes('documentation-philosophy')).length, 1);
  assert.deepEqual(fs.readdirSync(path.join(HOOK_TMP, `keel-skill-hints-${sid}`)), ['documentation-philosophy']);
});

// --- no-ai-attribution ---

test('no-ai-attribution: a message file named with -F, --file or --body-file is checked too', () => {
  const dir = tempProject('keel-msg-');
  const bad = path.join(dir, 'msg.txt');
  fs.writeFileSync(bad, 'Fix it\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n');
  fs.writeFileSync(path.join(dir, 'ok.txt'), 'Fix it\n\nCo-Authored-By: Ann Lee <ann@example.com>\n');
  const call = (command, cwd = dir) => runHook('no-ai-attribution.js', { tool_name: 'Bash', cwd, tool_input: { command } }).out;
  for (const cmd of ['git commit -F msg.txt', 'git commit --file=msg.txt', 'git commit --file msg.txt', `git commit -F "${bad}"`, 'gh pr create --title x --body-file msg.txt', "git commit -F 'msg.txt'"]) {
    assert.equal(call(cmd).hookSpecificOutput.permissionDecision, 'deny', cmd);
  }
  assert.equal(call('git commit -F ok.txt'), null);
  assert.equal(call('git commit -F missing.txt'), null, 'a missing file is not an error');
  assert.equal(call('git commit -F -'), null, 'stdin cannot be read');
  assert.equal(call('git commit -F msg.txt', os.tmpdir()), null, 'relative to the hook input cwd');
});

test('no-ai-attribution: more AI tools are named; a human called Cody is not', () => {
  const trailer = (name) => `git commit -m "x" -m "Co-Authored-By: ${name} <a@b.c>"`;
  const call = (command) => runHook('no-ai-attribution.js', { tool_name: 'Bash', tool_input: { command } }).out;
  for (const name of ['Windsurf', 'Cline', 'Sourcegraph Cody AI', 'DeepSeek', 'Grok']) {
    assert.equal(call(trailer(name)).hookSpecificOutput.permissionDecision, 'deny', name);
  }
  assert.equal(call('gh pr create --body "Generated with Windsurf"').hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(call(trailer('Cody Smith')), null, 'a human co-author');
  // People who share a first name with a tool, or a tool's letters inside a name, are people.
  assert.equal(call(trailer('Claude Martin')), null);
  assert.equal(call(trailer('Patsy Clinesmith')), null);
  for (const name of ['Claude', 'Claude Opus 5.5', 'devin-ai-integration[bot]']) assert.equal(call(trailer(name)).hookSpecificOutput.permissionDecision, 'deny', name);
});

// --- session start, standards and wallet ---

test('session-start: the standards come first in the one context, the same text on every event', () => {
  const standards = fs.readFileSync(path.join(HOOKS, 'standards.md'), 'utf8');
  const project = tempProject('keel-proj-');
  for (const source of ['startup', 'resume', 'clear', 'compact']) {
    const r = runHook('session-start.js', { source }, { CLAUDE_PROJECT_DIR: project, CLAUDE_PLUGIN_ROOT: PLUGIN });
    assert.ok(r.out.hookSpecificOutput.additionalContext.startsWith(standards), source);
    assert.match(r.out.hookSpecificOutput.additionalContext, /\nkeel: talk to the user[\s\S]*# Code comments in this project/);
  }
  assert.ok(runHook('session-start.js', 'not json', { CLAUDE_PROJECT_DIR: project }).out.hookSpecificOutput.additionalContext.startsWith(standards));
});

test('session-start: the old-Node warning is shown on a fresh start only, and the standards are still injected', () => {
  const dir = tempProject('keel-oldnode-');
  const preload = path.join(dir, 'old-node.js');
  fs.writeFileSync(preload, "Object.defineProperty(process.versions, 'node', { value: '20.1.0' });\n");
  const run = (input) => runHook('session-start.js', input, { CLAUDE_PROJECT_DIR: dir }, ['--require', preload]);
  assert.match(run({ source: 'startup' }).out.systemMessage, /20\.1\.0/);
  assert.match(run('not json').out.systemMessage, /20\.1\.0/, 'unknown source: warn');
  for (const source of ['resume', 'clear', 'compact']) assert.equal(run({ source }).out?.systemMessage, undefined, source);
  assert.match(run({ source: 'startup' }).out.hookSpecificOutput.additionalContext, /^# keel standards/);
});

test('standards: the implementer subset keeps the working rules and drops the talk-to-the-user sections', () => {
  const { standards } = require(path.join(HOOKS, 'standards.js'));
  const full = standards(PLUGIN);
  const sub = standards(PLUGIN, { implementer: true });
  for (const section of ['Precedence', 'Changing code', 'Done', 'Economy']) assert.ok(sub.includes(`## ${section}\n`), section);
  for (const section of ['Talking to the user', 'Rules the user states']) {
    assert.ok(full.includes(`## ${section}\n`) && !sub.includes(section), section);
  }
  assert.ok(sub.length < full.length - 500);
});

test('session-wallet: a /clear (new session id) is recorded, a compact is not', () => {
  const dir = tempProject('keel-wallet-');
  const env = { KEEL_USAGE_DIR: dir, CLAUDE_CONFIG_DIR: dir, CLAUDE_PLUGIN_ROOT: PLUGIN };
  const rows = () => (fs.existsSync(path.join(dir, 'sessions.jsonl')) ? fs.readFileSync(path.join(dir, 'sessions.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  runHook('session-wallet.js', { source: 'compact', session_id: 's1', cwd: dir }, env);
  assert.equal(rows().length, 0);
  runHook('session-wallet.js', { source: 'clear', session_id: 's2', cwd: dir }, env);
  assert.deepEqual(rows().map((r) => r.session_id), ['s2']);
});
