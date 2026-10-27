'use strict';
// One conversation, one lane: skill-gate.js (the Skill tool), lane-gate.js (a typed command) and
// planning-guard.js (no project file changes while a conversation plans), on throwaway projects.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { tempDir, tempPath } = require('./fixtures/tmp.js');

const PLUGIN = path.join(__dirname, '..', 'plugins', 'keel');
const HOOKS = path.join(PLUGIN, 'hooks');
const SCRIPTS = path.join(PLUGIN, 'scripts');

function runHook(script, stdin, env = {}) {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE_')));
  const r = spawnSync(process.execPath, [path.join(HOOKS, script)], {
    input: typeof stdin === 'string' ? stdin : JSON.stringify(stdin),
    env: { ...clean, ...env },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout ? JSON.parse(r.stdout) : null;
}

const script = (dir, name, ...args) => execFileSync(process.execPath, [path.join(SCRIPTS, name), dir, ...args], { encoding: 'utf8' }).trim();

function project() {
  const dir = tempDir('keel-lanes-');
  fs.mkdirSync(path.join(dir, '.keel'));
  fs.writeFileSync(path.join(dir, '.keel', 'config.json'), '{}');
  return dir;
}

// A project where chat-plan plans csv-export and chat-task works on task PROJ-1.
function lanes() {
  const dir = project();
  script(dir, 'plans.js', 'new', 'csv-export');
  assert.equal(script(dir, 'plans.js', 'mark', 'set', 'csv-export', '--session', 'chat-plan'), 'planning: csv-export');
  script(dir, 'notes.js', 'task', 'new', 'PROJ-1', '--title', 'Fix the export', '--source', 'text', '--session', 'chat-task');
  return dir;
}

const skill = (dir, session, name, env = {}) => runHook('skill-gate.js', { session_id: session, tool_name: 'Skill', tool_input: { skill: name } }, { CLAUDE_PROJECT_DIR: dir, ...env })?.hookSpecificOutput;
const typed = (dir, session, prompt, env = {}) => runHook('lane-gate.js', { session_id: session, hook_event_name: 'UserPromptSubmit', prompt }, { CLAUDE_PROJECT_DIR: dir, ...env });

const PLANNING_REFUSES = ['start-task', 'end-task', 'start-session', 'end-session', 'configure', 'cleanup'];

test('skill-gate: a planning conversation refuses the task, session, configure and cleanup skills; a task conversation refuses planning', () => {
  const dir = lanes();
  for (const name of PLANNING_REFUSES) {
    const out = skill(dir, 'chat-plan', `keel:${name}`);
    assert.equal(out?.permissionDecision, 'deny', name);
    assert.match(out.permissionDecisionReason, new RegExp(`plans csv-export, so /keel:${name} does not run here\\. Finish planning with /keel:end-planning, or start a new conversation`));
  }
  for (const name of ['start-planning', 'end-planning', 'tasks', 'help', 'git']) assert.equal(skill(dir, 'chat-plan', `keel:${name}`), undefined, name);

  for (const name of ['start-planning', 'end-planning']) {
    const out = skill(dir, 'chat-task', `keel:${name}`);
    assert.equal(out?.permissionDecision, 'deny', name);
    assert.match(out.permissionDecisionReason, /works on task PROJ-1, so .* finish the task with \/keel:end-task, or start a new conversation/);
  }
  for (const name of PLANNING_REFUSES) assert.equal(skill(dir, 'chat-task', `keel:${name}`), undefined, name);
  // Another conversation, or this one after its planning ends, is in no lane.
  for (const name of [...PLANNING_REFUSES, 'start-planning', 'end-planning']) assert.equal(skill(dir, 'chat-other', `keel:${name}`), undefined, name);
  // A bare name may run keel's skill too; another bare skill is left alone.
  assert.equal(skill(dir, 'chat-plan', 'start-task')?.permissionDecision, 'deny');
  assert.equal(skill(dir, 'chat-task', 'start-planning')?.permissionDecision, 'deny');
  assert.equal(skill(dir, 'chat-plan', 'git'), undefined);
  script(dir, 'plans.js', 'mark', 'clear', '--session', 'chat-plan');
  assert.equal(skill(dir, 'chat-plan', 'keel:start-task'), undefined);
  const bare = tempDir('keel-lanes-bare-');
  assert.equal(skill(bare, 's1', 'start-task'), undefined, 'a bare name is not refused as keel\'s in a project keel is not set up in');
});

test('no person, no planning: start-planning is refused when Claude Code says the session is unattended, and nothing is created', () => {
  const dir = project();
  const out = skill(dir, 's1', 'keel:start-planning', { CLAUDE_CODE_SESSION_ATTENDED: '0' });
  assert.equal(out?.permissionDecision, 'deny');
  assert.match(out.permissionDecisionReason, /planning is a conversation with a person\. Run \/keel:start-planning in a regular chat/);
  const blocked = typed(dir, 's1', '/keel:start-planning csv export', { CLAUDE_CODE_SESSION_ATTENDED: '0' });
  assert.equal(blocked?.decision, 'block');
  assert.ok(!fs.existsSync(path.join(dir, '.keel', 'local')), 'nothing written');
  // Attended, or a Claude Code that does not say: no refusal.
  for (const env of [{ CLAUDE_CODE_SESSION_ATTENDED: '1' }, {}]) {
    assert.equal(skill(dir, 's1', 'keel:start-planning', env), undefined);
    assert.equal(typed(dir, 's1', '/keel:start-planning', env), null);
  }
  assert.equal(skill(dir, 's1', 'keel:end-planning', { CLAUDE_CODE_SESSION_ATTENDED: '0' }), undefined, 'only starting is refused');
});

test('lane-gate: a typed command of the other lane is blocked, full or bare name, in the conversation language', () => {
  const dir = lanes();
  for (const prompt of ['/keel:start-task fix login', '/start-task', '/keel:cleanup', '/cleanup restore', '/configure']) {
    const out = typed(dir, 'chat-plan', prompt);
    assert.equal(out?.decision, 'block', prompt);
    assert.match(out.reason, /this conversation plans csv-export.*\/keel:end-planning/, prompt);
  }
  assert.equal(typed(dir, 'chat-task', '/start-planning')?.decision, 'block');
  assert.match(typed(dir, 'chat-plan', '/keel:end-task', { CLAUDE_PLUGIN_OPTION_CONVERSATION_LANGUAGE: 'uk' }).reason, /^keel: ця розмова планує csv-export, тож \/keel:end-task тут не запускається/);
  // Claude Code runs a command only at the very start of the prompt, case as written; other text is left alone.
  for (const prompt of ['  /keel:start-task x', '/KEEL:start-task x', 'please /keel:start-task x', '/keel:start-tasks', '/keel:tasks', '/keel:end-planning', 'start-task']) {
    assert.equal(typed(dir, 'chat-plan', prompt), null, prompt);
  }
  assert.equal(typed(dir, 'chat-other', '/start-task'), null, 'no lane, nothing blocked');
});

test('lane-gate and skill-gate: an unset project, garbage input or an unreadable mark never block', () => {
  const bare = tempDir('keel-lanes-bare-');
  assert.equal(typed(bare, 's1', '/keel:start-task'), null, 'keel is not set up');
  assert.equal(runHook('lane-gate.js', 'not json', { CLAUDE_PROJECT_DIR: bare }), null);
  const dir = project();
  fs.mkdirSync(path.join(dir, '.keel', 'local', 'plans', 'keel', 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.keel', 'local', 'plans', 'keel', 'sessions', 's1.json'), '{oops');
  assert.equal(typed(dir, 's1', '/keel:start-task'), null);
  assert.equal(skill(dir, 's1', 'keel:start-task'), undefined);
});

const guard = (dir, session, tool, toolInput, cwd = dir) => runHook('planning-guard.js', { session_id: session, tool_name: tool, tool_input: toolInput, cwd }, { CLAUDE_PROJECT_DIR: dir })?.hookSpecificOutput;

test('planning-guard: while a conversation plans, project files stay unchanged; its draft, settings, tmp, Plan Mode files and outside files are free', () => {
  const dir = lanes();
  const outside = tempPath(path.join(os.tmpdir(), 'keel-lanes-memory.md'));
  const at = (...p) => path.join(dir, ...p);
  for (const [tool, toolInput] of [
    ['Edit', { file_path: at('src', 'app.js') }],
    ['Write', { file_path: 'README.md' }],
    ['NotebookEdit', { notebook_path: at('nb.ipynb') }],
    ['Write', { file_path: at('.keel', 'config.json') }],
    ['Bash', { command: `cd "${dir}" && echo x > src/app.js` }],
    ['Bash', { command: 'sed -i s/a/b/ src/app.js' }],
    ['PowerShell', { command: 'Set-Content -Path src\\app.js -Value x' }],
  ]) {
    const out = guard(dir, 'chat-plan', tool, toolInput);
    assert.equal(out?.permissionDecision, 'deny', `${tool} ${JSON.stringify(toolInput)}`);
    assert.match(out.permissionDecisionReason, /this conversation plans csv-export, so .+ stays unchanged\. This is planning; to change code, start a task in a new conversation\./);
  }
  assert.match(guard(dir, 'chat-plan', 'Edit', { file_path: at('src', 'app.js') }).permissionDecisionReason, /so src\/app\.js stays/);
  for (const [tool, toolInput] of [
    ['Write', { file_path: at('.keel', 'local', 'plans', 'keel', 'csv-export', 'tickets', 'T1-x.md') }],
    ['Edit', { file_path: at('.keel', 'local', 'plans', 'keel', 'settings.json') }],
    ['Write', { file_path: at('.keel', 'local', 'tmp', 'notes.txt') }],
    ['Write', { file_path: at('.keel', 'local', 'plans', 'claude', 'plan.md') }],
    ['Write', { file_path: outside }],
    ['Bash', { command: 'cat src/app.js && grep x README.md' }],
    ['Bash', { command: 'echo x > .keel/local/tmp/out.txt' }],
    ['Bash', { command: `node "${SCRIPTS}/plans.js" "${dir}" ticket csv-export --title "Add export"` }],
  ]) {
    assert.equal(guard(dir, 'chat-plan', tool, toolInput), undefined, `${tool} ${JSON.stringify(toolInput)}`);
  }
  // Said honestly: rm and the like are not seen.
  assert.equal(guard(dir, 'chat-plan', 'Bash', { command: 'rm src/app.js' }), undefined);
  // Another feature's draft folder and the other chat marks are project files here.
  assert.equal(guard(dir, 'chat-plan', 'Write', { file_path: at('.keel', 'local', 'plans', 'keel', 'other-thing', 'plan.md') })?.permissionDecision, 'deny');
  assert.equal(guard(dir, 'chat-plan', 'Write', { file_path: at('.keel', 'local', 'plans', 'keel', 'sessions', 'chat-plan.json') })?.permissionDecision, 'deny');
  // A target the shell expands is not known: left alone. Git Bash's /c/... is the Windows path.
  assert.equal(guard(dir, 'chat-plan', 'Bash', { command: 'echo x > ~/note.txt' }), undefined);
  assert.equal(guard(dir, 'chat-plan', 'PowerShell', { command: 'Set-Content -Path $env:TEMP\\n.txt -Value x' }), undefined);
  if (process.platform === 'win32') {
    const gitBash = `/${dir[0].toLowerCase()}${dir.slice(2).replace(/\\/g, '/')}`;
    assert.equal(guard(dir, 'chat-plan', 'Bash', { command: `echo x > ${gitBash}/src.js` })?.permissionDecision, 'deny', gitBash);
    assert.equal(guard(dir, 'chat-plan', 'Bash', { command: `cd ${gitBash} && echo x > src.js` })?.permissionDecision, 'deny');
  }
  // The conversation's own draft stays writable after it broke plan.md.
  fs.writeFileSync(at('.keel', 'local', 'plans', 'keel', 'csv-export', 'plan.md'), 'broken');
  assert.equal(guard(dir, 'chat-plan', 'Write', { file_path: at('.keel', 'local', 'plans', 'keel', 'csv-export', 'plan.md') }), undefined);
  // A conversation that does not plan writes freely; so does this one once planning ends.
  assert.equal(guard(dir, 'chat-task', 'Edit', { file_path: at('src', 'app.js') }), undefined);
  script(dir, 'plans.js', 'mark', 'clear', '--session', 'chat-plan');
  assert.equal(guard(dir, 'chat-plan', 'Edit', { file_path: at('src', 'app.js') }), undefined);
});

test('planning-guard: a draft in the repository is writable while it is planned; garbage input never blocks', () => {
  const dir = project();
  script(dir, 'plans.js', 'settings', 'set', '--draft', 'repo', '--draft-dir', 'tickets');
  script(dir, 'plans.js', 'new', 'csv-export');
  script(dir, 'plans.js', 'mark', 'set', 'csv-export', '--session', 'chat-plan');
  assert.equal(guard(dir, 'chat-plan', 'Write', { file_path: path.join(dir, 'tickets', 'csv-export', 'tickets', 'T1-x.md') }), undefined);
  assert.equal(guard(dir, 'chat-plan', 'Write', { file_path: path.join(dir, 'tickets', 'README.md') })?.permissionDecision, 'deny');
  assert.equal(runHook('planning-guard.js', 'not json', { CLAUDE_PROJECT_DIR: dir }), null);
  assert.equal(guard(dir, '../chat-plan', 'Write', { file_path: path.join(dir, 'x.js') }), undefined, 'an invalid session id names no mark');
});

test('hooks.json: lane-gate on UserPromptSubmit after context-warning, planning-guard on file and shell tools, in exec form', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(HOOKS, 'hooks.json'), 'utf8')).hooks;
  const prompt = cfg.UserPromptSubmit[0].hooks.map((h) => h.args[0]);
  assert.deepEqual(prompt, ['${CLAUDE_PLUGIN_ROOT}/hooks/context-warning.js', '${CLAUDE_PLUGIN_ROOT}/hooks/lane-gate.js']);
  const entry = cfg.PreToolUse.find((h) => h.hooks.some((x) => x.args[0].endsWith('/hooks/planning-guard.js')));
  assert.deepEqual(entry.matcher.split('|').sort(), ['Bash', 'Edit', 'NotebookEdit', 'PowerShell', 'Write']);
  for (const h of [...cfg.UserPromptSubmit[0].hooks, ...entry.hooks]) {
    assert.equal(h.command, 'node');
    assert.ok(h.timeout > 0 && h.timeout <= 10);
  }
});
