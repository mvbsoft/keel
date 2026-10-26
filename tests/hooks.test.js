'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const PLUGIN = path.join(__dirname, '..', 'plugins', 'keel');
const HOOKS = path.join(PLUGIN, 'hooks');

// Runs a hook script like Claude Code does: JSON on stdin, options in the environment.
// keel's hooks act only in a project keel is set up in: a call that names no project runs in one.
const KEEL_PROJECT = tempProjectSetUp();
function tempProjectSetUp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-hook-set-up-'));
  fs.mkdirSync(path.join(dir, '.keel'));
  fs.writeFileSync(path.join(dir, '.keel', 'config.json'), '{}');
  return dir;
}

function runHook(script, stdin, env = {}) {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE_')));
  if (!('CLAUDE_PROJECT_DIR' in env) && !(stdin && typeof stdin === 'object' && stdin.cwd)) env = { CLAUDE_PROJECT_DIR: KEEL_PROJECT, ...env };
  const r = spawnSync(process.execPath, [path.join(HOOKS, script)], {
    input: typeof stdin === 'string' ? stdin : JSON.stringify(stdin),
    env: { ...clean, ...env },
    encoding: 'utf8',
  });
  return { code: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, raw: r.stdout, err: r.stderr };
}

function tempProject(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-hook-'));
  if (config !== undefined) {
    fs.mkdirSync(path.join(dir, '.keel'));
    fs.writeFileSync(path.join(dir, '.keel', 'config.json'), typeof config === 'string' ? config : JSON.stringify(config));
  }
  return dir;
}

const VALID_CONFIG = {
  schema_version: 1,
  repo_language: 'en',
  gates: { checks: [{ part: '.', kind: 'test', command: 'npm test' }], security_scanners: [] },
  git: { mode: 'manual', main_branch: 'main', ask_before_merge: true, state_in_git: true },
  verification: {
    tier_rules: { gates_only_max_files: 1, basic_max_modules: 1, large_change_lines: 400, very_large_change_lines: 1000 },
    verifier_caps: { basic: 3, standard: 5, maximum: 8 },
  },
  architecture: { file_lines_warn: 700, file_lines_max: 1000 },
  docs: { profile: 1, pattern: 'none' },
};

test('hooks.json: session start runs on every start incl. compact; Node hooks in exec form, no shell', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(HOOKS, 'hooks.json'), 'utf8')).hooks;
  const start = cfg.SessionStart[0];
  assert.deepEqual(start.matcher.split('|').sort(), ['clear', 'compact', 'resume', 'startup']);
  assert.deepEqual(start.hooks.map((h) => h.command), ['node', 'node'], 'standards come from session-start.js, not from cat');
  const [session] = start.hooks;
  assert.equal(session.command, 'node');
  assert.deepEqual(session.args, ['${CLAUDE_PLUGIN_ROOT}/hooks/session-start.js']);
  const opus = cfg.PreToolUse.find((h) => h.matcher === 'Agent').hooks[0];
  assert.deepEqual([opus.command, ...opus.args], ['node', '${CLAUDE_PLUGIN_ROOT}/hooks/agent-model.js']);
});

test('hooks.json: the implementer gets the standards through SubagentStart, in exec form', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(HOOKS, 'hooks.json'), 'utf8')).hooks;
  assert.equal(cfg.SubagentStart.length, 1);
  const [entry] = cfg.SubagentStart;
  assert.equal(entry.matcher, '^keel:implementer$', 'plugin agent names need an anchored matcher (hooks.md:2386)');
  assert.deepEqual([entry.hooks[0].command, ...entry.hooks[0].args], ['node', '${CLAUDE_PLUGIN_ROOT}/hooks/subagent-start.js']);
});

test('subagent-start: the implementer gets standards.md and the comment rules; other agents nothing', () => {
  const env = { CLAUDE_PLUGIN_ROOT: PLUGIN, CLAUDE_PROJECT_DIR: tempProject({ comments: { level: 'detailed' } }) };
  const r = runHook('subagent-start.js', { hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'keel:implementer' }, env);
  assert.equal(r.code, 0);
  assert.equal(r.out.hookSpecificOutput.hookEventName, 'SubagentStart');
  const context = r.out.hookSpecificOutput.additionalContext;
  // The implementer reports to the main session: it gets the standards without the rules for talking to the user.
  assert.match(context, /^# keel standards: how we work/);
  assert.match(context, /## Changing code[\s\S]*## Done[\s\S]*## Economy/);
  assert.doesNotMatch(context, /Talking to the user|Rules the user states|Explain in this order/);
  assert.match(context, /# Code comments in this project \(level: detailed\)/);
  assert.ok(context.length < 10000, 'hook text limit (hooks.md:917)');
  for (const type of ['keel:qa', 'implementer', 'other:implementer', 'Explore', '']) {
    assert.equal(runHook('subagent-start.js', { agent_type: type }, env).raw, '', type);
  }
  const bad = runHook('subagent-start.js', 'not json', env);
  assert.equal(bad.code, 0);
  assert.equal(bad.raw, '');
});

test('standards stay well under the 10,000-character hook limit and the token budget', () => {
  const text = fs.readFileSync(path.join(HOOKS, 'standards.md'), 'utf8');
  assert.ok(text.length < 6000, `standards are ${text.length} characters`);
  for (const rule of ['Ask, don\'t guess', 'Solution ladder', 'Docs before code', 'shortcut:', '.keel/local/tmp/', 'Done = tests + docs', 'merge only when the user']) {
    assert.ok(text.includes(rule), `standards miss "${rule}"`);
  }
});

test('session-start: the language line and the comment rules, silent about the project config', () => {
  for (const config of [VALID_CONFIG, '{bad', { ...VALID_CONFIG, schema_version: 9 }]) {
    for (const source of ['startup', 'resume', 'clear', 'compact']) {
      const r = runHook('session-start.js', { source }, { CLAUDE_PROJECT_DIR: tempProject(config), CLAUDE_PLUGIN_OPTION_CONVERSATION_LANGUAGE: 'uk' });
      assert.equal(r.code, 0);
      assert.equal(r.out.systemMessage, undefined, 'nothing is shown to the user at session start');
      assert.match(r.out.hookSpecificOutput.additionalContext, /\nkeel: talk to the user and write plans in this language: Ukrainian \(uk\). If the user explicitly asks for another language in this session, use that one for this session only./);
      assert.match(r.out.hookSpecificOutput.additionalContext, /# Code comments in this project \(level: short\)/, 'no level in the config: short');
    }
  }
});

test('session-start: language defaults to en; garbage stdin never breaks the session', () => {
  const r = runHook('session-start.js', 'not json', { CLAUDE_PROJECT_DIR: tempProject({}) });
  assert.equal(r.code, 0);
  assert.match(r.out.hookSpecificOutput.additionalContext, /in this language: English \(en\)\./);
});

test('agent-model: Opus allowed (default) → keel agents on Opus and Sonnet untouched', () => {
  for (const model of ['opus', 'sonnet', 'haiku']) {
    const input = { tool_input: { subagent_type: 'keel:security', prompt: 'p', model } };
    assert.equal(runHook('agent-model.js', input).raw, '');
    assert.equal(runHook('agent-model.js', input, { CLAUDE_PLUGIN_OPTION_ALLOW_OPUS: 'true' }).raw, '');
  }
});

test('agent-model: Opus off → an explicit Opus model becomes Sonnet, other fields kept', () => {
  const input = { tool_input: { subagent_type: 'keel:security', prompt: 'p', description: 'd', model: 'opus', effort: 'high' } };
  const r = runHook('agent-model.js', input, { CLAUDE_PLUGIN_OPTION_ALLOW_OPUS: 'false' });
  assert.equal(r.code, 0);
  assert.deepEqual(r.out.hookSpecificOutput.updatedInput, { ...input.tool_input, model: 'sonnet' });
  assert.equal(r.out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(r.out.hookSpecificOutput.permissionDecision, undefined, 'never auto-approves');
});

test('agent-model: keel never runs Fable, whatever the session runs on', () => {
  const input = { tool_input: { subagent_type: 'keel:judge', prompt: 'p', model: 'fable' } };
  const on = runHook('agent-model.js', input);
  assert.equal(on.out.hookSpecificOutput.updatedInput.model, 'opus');
  assert.match(on.out.hookSpecificOutput.additionalContext, /never runs Fable/);
  const off = runHook('agent-model.js', { tool_input: { ...input.tool_input, model: 'claude-fable-5-1' } }, { CLAUDE_PLUGIN_OPTION_ALLOW_OPUS: 'false' });
  assert.equal(off.out.hookSpecificOutput.updatedInput.model, 'sonnet');
});

test('agent-model: a keel agent without its own model never inherits the session model', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-root-'));
  fs.mkdirSync(path.join(root, 'agents'));
  const agent = (name, text) => fs.writeFileSync(path.join(root, 'agents', `${name}.md`), text);
  agent('judge', '---\nname: judge\nmodel: opus\n---\nbody\n');
  agent('qa', '---\r\nname: qa\r\nmodel: sonnet\r\n---\r\nbody\r\n');
  agent('loose', '---\nname: loose\nmodel: inherit\n---\nbody\n');
  agent('bare', '---\nname: bare\n---\nbody\n');
  const env = { CLAUDE_PLUGIN_ROOT: root };
  const run = (name, extra = {}) => runHook('agent-model.js', { tool_input: { subagent_type: `keel:${name}`, prompt: 'p' } }, { ...env, ...extra });
  assert.equal(run('qa').raw, '');
  assert.equal(run('judge').raw, '');
  assert.equal(run('judge', { CLAUDE_PLUGIN_OPTION_ALLOW_OPUS: 'false' }).out.hookSpecificOutput.updatedInput.model, 'sonnet');
  for (const name of ['loose', 'bare', 'missing-file', '../../x']) {
    assert.equal(run(name).out.hookSpecificOutput.updatedInput.model, 'sonnet', name);
  }
});

test("agent-model: other plugins' and the user's agents are left alone; garbage is harmless", () => {
  const env = { CLAUDE_PLUGIN_OPTION_ALLOW_OPUS: 'false' };
  assert.equal(runHook('agent-model.js', { tool_input: { subagent_type: 'other:x', model: 'fable' } }, env).raw, '');
  assert.equal(runHook('agent-model.js', { tool_input: { subagent_type: 'general-purpose' } }, env).raw, '');
  const garbage = runHook('agent-model.js', 'zzz', env);
  assert.equal(garbage.code, 0);
  assert.equal(garbage.raw, '');
});

test('every keel agent and skill names its model explicitly and never Fable', () => {
  const agentsDir = path.join(PLUGIN, 'agents');
  const agents = fs.existsSync(agentsDir) ? fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md')) : [];
  const frontmatter = (file) => (/^---\r?\n([\s\S]*?)\r?\n---/.exec(fs.readFileSync(file, 'utf8')) || [])[1] || '';
  for (const f of agents) {
    assert.match(frontmatter(path.join(agentsDir, f)), /^model:\s*(haiku|sonnet|opus)\s*$/m, `${f} must set model: haiku, sonnet or opus`);
  }
  for (const dir of fs.readdirSync(path.join(PLUGIN, 'skills'))) {
    const file = path.join(PLUGIN, 'skills', dir, 'SKILL.md');
    if (fs.existsSync(file)) assert.doesNotMatch(frontmatter(file), /fable/i, `${dir} must not use Fable`);
  }
});

test('no plugin script depends on jq', () => {
  const offenders = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\bjq\b/.test(fs.readFileSync(p, 'utf8'))) offenders.push(path.relative(PLUGIN, p));
    }
  };
  walk(path.join(PLUGIN, 'hooks'));
  walk(path.join(PLUGIN, 'scripts'));
  assert.deepEqual(offenders, []);
});

test('own-files: keel may read and search its own folder without a prompt', () => {
  const env = { CLAUDE_PLUGIN_ROOT: PLUGIN };
  const read = runHook('own-files.js', { tool_name: 'Read', tool_input: { file_path: path.join(PLUGIN, 'skills', '_shared', 'preflight.md') } }, env);
  assert.equal(read.out.hookSpecificOutput.permissionDecision, 'allow');
  const glob = runHook('own-files.js', { tool_name: 'Glob', tool_input: { pattern: '**/*.md', path: PLUGIN } }, env);
  assert.equal(glob.out.hookSpecificOutput.permissionDecision, 'allow');
  for (const file of [path.join(PLUGIN, '..', 'other', 'x.md'), path.join(PLUGIN, '..', '..', 'package.json'), `${PLUGIN}-evil/x.md`, path.join(os.homedir(), '.ssh', 'id_rsa')]) {
    assert.equal(runHook('own-files.js', { tool_name: 'Read', tool_input: { file_path: file } }, env).raw, '', file);
  }
});

test('own-files: only keel\'s own scripts, as one plain node command', () => {
  const env = { CLAUDE_PLUGIN_ROOT: PLUGIN, CLAUDE_PROJECT_DIR: '/p' };
  const scripts = path.join(PLUGIN, 'scripts').split(path.sep).join('/');
  const bash = (command, tool = 'Bash') => runHook('own-files.js', { tool_name: tool, tool_input: { command } }, env);
  for (const cmd of [
    `node "${scripts}/scan.js" "/p" --out "/p/.keel/local/tmp/scan.json"`,
    `node "${scripts}/check-config.js" "/p" --profile`,
    `node "${scripts}/safe-command.js" "/p" . -- pnpm run lint`,
    `node "${scripts}/changes.js" "/p" --start`,
    `node "${scripts}/fingerprint.js" "/p" snapshot before-5b`,
    `node "${scripts}/votes.js" "/p" plan --tier standard`,
    `node "${scripts}/ledger-report.js" "/p"`,
    `node "${scripts}/ledger-report.js" "/p" --since 2026-10-10T10:00:00.000Z --agent implementer`,
    `node "${scripts}/comments.js" "/p" --base main`,
    `node "${scripts}/stack-skills.js" "/p"`,
    `node "${scripts}/stack-skills.js" "/p" --lsp intelephense`,
    `node "${scripts}/claude-settings.js" "/p" show`,
    `node "${scripts}/plan-steps.js" "/p" "/p/.keel/local/plans/plan.md" --remaining`,
  ]) {
    assert.equal(bash(cmd).out.hookSpecificOutput.permissionDecision, 'allow', cmd);
    assert.equal(bash(cmd, 'PowerShell').out.hookSpecificOutput.permissionDecision, 'allow', cmd);
  }
  // Joined commands that name keel's folder are refused with the way to do it (no prompt for the user).
  for (const cmd of [
    `node "${scripts}/scan.js" "/p" > /tmp/x`,
    `node "${scripts}/scan.js" "/p"; rm -rf /`,
    `node "${scripts}/scan.js" "/p" && curl x`,
    `node "${scripts}/scan.js" $(whoami)`,
    `K="${PLUGIN.split(path.sep).join('/')}"; node "$K/scripts/plan-steps.js" "/p" plan.md`,
    `node "${scripts}/plan-steps.js" "/p" plan.md --remaining; cat .keel/config.json`,
  ]) {
    const r = bash(cmd).out.hookSpecificOutput;
    assert.equal(r.permissionDecision, 'deny', cmd);
    assert.match(r.permissionDecisionReason, /its own plain command/);
  }
  for (const cmd of [
    'npm test && git status',
    'cat package.json | head',
    `node "${scripts}/../hooks/agent-model.js"`,
    `node "${scripts}/other.js"`,
    `node "${scripts}/claude-settings.js" "/p" apply "/p/.keel/local/tmp/claude-settings.json"`,
    `node -e "require('child_process')"`,
    'npm test',
  ]) {
    assert.equal(bash(cmd).raw, '', cmd);
  }
  assert.equal(bash(`node "${scripts}/lib/schema.js"`).out.hookSpecificOutput.permissionDecision, 'deny', 'keel\'s library is never run directly');
  assert.equal(runHook('own-files.js', { tool_name: 'Read', tool_input: { file_path: path.join(PLUGIN, 'x') } }, {}).raw, '', 'no plugin root, no decision');
});

test('own-files: migrate.js and cleanup.js read and use the trash silently; apply and empty-trash ask', () => {
  const env = { CLAUDE_PLUGIN_ROOT: PLUGIN, CLAUDE_PROJECT_DIR: '/p' };
  const scripts = path.join(PLUGIN, 'scripts').split(path.sep).join('/');
  const bash = (command) => runHook('own-files.js', { tool_name: 'Bash', tool_input: { command } }, env);
  for (const cmd of [
    `node "${scripts}/migrate.js" "/p" find`,
    `node "${scripts}/migrate.js" "/p" find --from ".orbit"`,
    `node "${scripts}/migrate.js" "/p" refs --folder ".orbit" --prefix "orbit:"`,
    `node "${scripts}/migrate.js" "/p" state`,
    `node "${scripts}/cleanup.js" "/p" find`,
    `node "${scripts}/cleanup.js" "/p" move --items 1,2 --red 5`,
    `node "${scripts}/cleanup.js" "/p" restore 20261011-101500`,
    `node "${scripts}/cleanup.js" "/p" trash`,
    `node "${scripts}/cleanup.js" "/p" reminder`,
  ]) assert.equal(bash(cmd).out.hookSpecificOutput.permissionDecision, 'allow', cmd);
  assert.equal(bash(`node "${scripts}/migrate.js" "/p" apply "/p/.keel/local/tmp/migrate-plan.json"`).raw, '', 'apply is left to the normal permission prompt');
  // Deleting the trash for good: Claude Code itself confirms, with what goes, also over allow rules.
  for (const [cmd, what] of [['empty-trash', /the batches 30 or more days old/], ['empty-trash --older-than 0', /the batches 0 or more days old/], ['empty-trash --all', /all batches/], ['empty-trash --batch 20261011-101500', /batch 20261011-101500/]]) {
    const out = bash(`node "${scripts}/cleanup.js" "/p" ${cmd}`).out.hookSpecificOutput;
    assert.equal(out.permissionDecision, 'ask', cmd);
    assert.match(out.permissionDecisionReason, what, cmd);
  }
});

const hasGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('own-files: notes.js is keel\'s own; git-flow.js runs silently only in confirmed autonomous mode, merge asks', { skip: !hasGit && 'git is not installed' }, () => {
  const git = (mode, extra = {}) => ({ mode, main_branch: 'main', ask_before_merge: true, state_in_git: true, ...extra });
  const auto = tempProject({ git: git('autonomous') }).split(path.sep).join('/');
  // A push is silent only on a task branch (below: on the main branch it is not).
  execFileSync('git', ['init', '-q', '-b', 'CAN-1-x', auto]);
  const manual = tempProject({ git: git('manual') }).split(path.sep).join('/');
  const noAsk = tempProject({ git: git('autonomous', { ask_before_merge: false }) }).split(path.sep).join('/');
  const untrusted = tempProject({ git: git('autonomous', { ask_before_merge: false }) }).split(path.sep).join('/');
  // Autonomous mode now needs the user's confirmation on this machine (git-flow.js trust), because the
  // mode itself comes from the committed config.
  const usageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-trust-'));
  const env = { CLAUDE_PLUGIN_ROOT: PLUGIN, KEEL_USAGE_DIR: usageDir };
  const { trust } = require(path.join(PLUGIN, 'scripts', 'lib', 'trust.js'));
  for (const p of [auto, noAsk]) trust(p, env);
  const scripts = path.join(PLUGIN, 'scripts').split(path.sep).join('/');
  // The project is the one the command names: the hook allows keel's scripts only on the current project.
  const projectOf = (command) => (/\.js" "([^"]+)"/.exec(command) || [])[1];
  const decision = (command) => runHook('own-files.js', { tool_name: 'Bash', tool_input: { command } }, { ...env, CLAUDE_PROJECT_DIR: projectOf(command) }).out?.hookSpecificOutput.permissionDecision ?? null;
  for (const step of ['push', 'commit --message-file x']) assert.equal(decision(`node "${scripts}/git-flow.js" "${untrusted}" ${step}`), null, `not confirmed here: ${step}`);
  assert.equal(decision(`node "${scripts}/git-flow.js" "${untrusted}" merge`), 'ask', 'a merge asks in every mode');
  for (const p of [untrusted, auto]) assert.equal(decision(`node "${scripts}/git-flow.js" "${p}" trust`), 'ask', 'trust itself always prompts, even past an allow rule');

  assert.equal(decision(`node "${scripts}/notes.js" "${manual}" check --begin`), 'allow');
  for (const step of ['tasks --session s1', 'lane CAN-1', 'task new PROJ-1 --title Plain --source text --session s1', 'task activate PROJ-1 --session s1', 'task deactivate --session s1', 'task restore PROJ-1 --session s1', 'task inventory PROJ-1']) {
    assert.equal(decision(`node "${scripts}/notes.js" "${manual}" ${step}`), 'allow', step);
  }
  for (const p of [auto, manual]) assert.equal(decision(`node "${scripts}/git-flow.js" "${p}" status`), 'allow', p);
  for (const step of ['start --name CAN-1-x', 'switch --name CAN-1-x', `commit --message-file "${auto}/.keel/local/tmp/commit-message.txt"`, 'sync --from main', 'push']) {
    assert.equal(decision(`node "${scripts}/git-flow.js" "${auto}" ${step}`), 'allow', step);
    assert.equal(decision(`node "${scripts}/git-flow.js" "${manual}" ${step}`), null, `manual: ${step}`);
  }
  assert.equal(decision(`node "${scripts}/git-flow.js" "${auto}" merge --into develop`), 'ask');
  assert.match(runHook('own-files.js', { tool_name: 'Bash', tool_input: { command: `node "${scripts}/git-flow.js" "${auto}" merge --into develop` } }, { ...env, CLAUDE_PROJECT_DIR: auto }).out.hookSpecificOutput.permissionDecisionReason, /into develop/);
  assert.equal(decision(`node "${scripts}/git-flow.js" "${manual}" merge`), 'ask', 'manual mode: the merge still asks');
  assert.equal(decision(`node "${scripts}/git-flow.js" "${noAsk}" merge`), 'allow');
  assert.equal(decision(`node "${scripts}/git-flow.js" "${auto}" push; git push --force`), 'deny', 'no shell operators: refused, never allowed');
  assert.equal(decision(`node "${scripts}/git-flow.js" "${tempProject()}" push`), null, 'no config, no decision');
});

test('skill-hints: a matching file or command names its skill once per session; nothing else is said', () => {
  const dir = tempProject({});
  const sid = `t-${process.pid}-${Date.now()}`;
  const call = (tool, input, session = sid) => runHook('skill-hints.js', { session_id: session, cwd: dir, tool_name: tool, tool_input: input });
  const mig = call('Write', { file_path: path.join(dir, 'db', 'migrations', '002_x.sql') });
  assert.equal(mig.out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(mig.out.hookSpecificOutput.permissionDecision, undefined, 'never decides permissions');
  assert.match(mig.out.hookSpecificOutput.additionalContext, /database migration\. Load the keel:migration-safety skill/);
  assert.equal(call('Edit', { file_path: path.join(dir, 'db', 'migrations', '003_y.sql') }).raw, '', 'once per session');
  assert.match(call('Read', { file_path: 'db/migrations/002_x.sql' }, `${sid}-2`).raw, /migration-safety/, 'a new session hears it again');

  assert.match(call('Write', { file_path: path.join(dir, 'src', 'report.js') }).raw, /keel:architecture/, 'a new source file');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'old.js'), 'x');
  assert.equal(call('Write', { file_path: path.join(dir, 'src', 'old.js') }, `${sid}-3`).raw, '', 'an existing file is not new');
  assert.equal(call('Write', { file_path: path.join(dir, 'test', 'a.test.js') }, `${sid}-4`).raw, '', 'tests are not architecture');
  assert.match(call('Edit', { file_path: path.join(dir, 'README.md') }).raw, /documentation-philosophy/);
  assert.equal(call('Edit', { file_path: path.join(dir, '.keel', 'next-session.md') }, `${sid}-5`).raw, '', "keel's own notes are not project docs");
  assert.match(call('Edit', { file_path: path.join(dir, 'package.json') }).raw, /adr-required/);
  assert.match(call('Bash', { command: 'git commit -m "x"' }).raw, /keel:git/);
  assert.match(call('Bash', { command: 'GIT_AUTHOR_DATE="2026-01-01 10:00" git commit -m "x"' }, `${sid}-9`).raw, /keel:git/, 'after an env prefix');

  assert.equal(call('Bash', { command: 'npm test' }, `${sid}-8`).raw, '', 'a plain toolchain command: nothing');
  assert.equal(call('Bash', { command: `node "${path.join(PLUGIN, 'scripts', 'notes.js')}" x check > db/migrations/out.txt` }, `${sid}-6`).raw, '', "keel's own commands are not the project's work");
  assert.equal(call('Write', { file_path: path.join(os.tmpdir(), 'elsewhere.py') }, `${sid}-7`).raw, '', 'outside the project: silent');
  assert.equal(runHook('skill-hints.js', 'not json').raw, '', 'garbage stdin: silent');
});

test('skill-hints: shell commands count as the file tool they stand for, after a leading cd', () => {
  const dir = tempProject({});
  fs.mkdirSync(path.join(dir, 'db', 'migrations'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'db', 'migrations', '001_init.sql'), 'x');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'old.js'), 'x');
  let n = 0;
  const call = (command, cwd = dir) => runHook('skill-hints.js', { session_id: `t-${process.pid}-${Date.now()}-sh${n++}`, cwd, tool_name: 'Bash', tool_input: { command } }, { CLAUDE_PROJECT_DIR: dir }).raw;

  assert.match(call('cat db/migrations/001_init.sql'), /migration-safety/, 'cat reads a migration');
  assert.match(call(`cd "${dir}" && sed -n '1,40p' db/migrations/001_init.sql`, os.tmpdir()), /migration-safety/, 'a leading cd is followed');
  assert.match(call('cd db && cat migrations/001_init.sql'), /migration-safety/, 'a relative cd too');
  assert.match(call("cat > db/migrations/002_x.sql <<'EOF'\nALTER TABLE t ADD c INT;\nEOF"), /migration-safety/, 'a heredoc writes a migration');
  assert.match(call("cat > src/report.js <<'EOF'\nmodule.exports = {};\nEOF"), /keel:architecture/, '> to a new source file is Write');
  assert.equal(call("cat > src/old.js <<'EOF'\nx\nEOF"), '', '> to an existing file is not a new file');
  assert.match(call('echo "- note" >> README.md'), /documentation-philosophy/, '>> edits docs');
  assert.equal(call('cat README.md'), '', 'reading docs is not changing them');
  assert.match(call("sed -i 's/a/b/' scripts/report.py"), /python-conventions/, 'sed -i edits');
  assert.match(call('Set-Content -Path requirements.txt -Value x'), /adr-required/, 'PowerShell writers');
  assert.match(call('git add README.md && git commit -m "Update README"'), /keel:git/, 'a git step after another command');
  assert.equal(call("cat > notes.txt <<'EOF'\ncat db/migrations/001_init.sql\nEOF"), '', 'a heredoc body is data, not a command');
  assert.equal(call('npm test 2>&1 > /dev/null'), '', 'stream redirections are not files');
});

test('no-ai-attribution: refuses a commit or PR that names an AI as author, with the reason; nothing else', () => {
  const call = (command, tool = 'Bash') => runHook('no-ai-attribution.js', { tool_name: tool, tool_input: { command } });
  const heredoc = "git add README.md && git commit -m \"$(cat <<'EOF'\nDocument tests\n\nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>\nEOF\n)\"";
  const denied = call(heredoc).out.hookSpecificOutput;
  assert.equal(denied.permissionDecision, 'deny');
  assert.match(denied.permissionDecisionReason, /no AI or tool attribution.*send the same command again without it/s);
  assert.equal(call('git commit -m "x" -m "Co-Authored-By: GitHub Copilot <x@y>"', 'PowerShell').out.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(call('gh pr create --title x --body "Done.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)"').out.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(call('git commit -m "Document tests" -m "Co-Authored-By: Ann Lee <ann@example.com>"').raw, '', 'a human co-author is fine');
  assert.equal(call('git log --format=%B -1').raw, '', 'other git commands: nothing');
  assert.equal(call('echo "Co-Authored-By: Claude" > notes.txt').raw, '', 'not a commit: nothing');
  assert.equal(runHook('no-ai-attribution.js', 'not json').raw, '', 'garbage stdin: silent');
  const cfg = JSON.parse(fs.readFileSync(path.join(HOOKS, 'hooks.json'), 'utf8')).hooks;
  const h = cfg.PreToolUse.find((x) => x.hooks[0].args && x.hooks[0].args[0].endsWith('no-ai-attribution.js'));
  assert.deepEqual(h.matcher.split('|').sort(), ['Bash', 'PowerShell']);
});

test('hooks.json registers skill-hints on file and shell tools, in exec form', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(HOOKS, 'hooks.json'), 'utf8')).hooks;
  const h = cfg.PreToolUse.find((x) => x.hooks[0].args && x.hooks[0].args[0].endsWith('skill-hints.js'));
  assert.deepEqual(h.matcher.split('|').sort(), ['Bash', 'Edit', 'PowerShell', 'Read', 'Write']);
});

test('own-files: usage.js and usage-setup.js read-only steps run silently; apply, prices-apply and install-statusline ask', () => {
  const env = { CLAUDE_PLUGIN_ROOT: PLUGIN, CLAUDE_PROJECT_DIR: '/p' };
  const scripts = path.join(PLUGIN, 'scripts').split(path.sep).join('/');
  const bash = (command, tool = 'Bash') => runHook('own-files.js', { tool_name: tool, tool_input: { command } }, env);
  for (const cmd of [
    `node "${scripts}/usage.js" prepare --project "/p"`,
    `node "${scripts}/usage-setup.js" "/p" show`,
    `node "${scripts}/usage-setup.js" "/p" prices-diff "/p/.keel/local/tmp/prices-new.json"`,
    `node "${scripts}/usage-setup.js" "/p" page`,
  ]) {
    assert.equal(bash(cmd).out.hookSpecificOutput.permissionDecision, 'allow', cmd);
    assert.equal(bash(cmd, 'PowerShell').out.hookSpecificOutput.permissionDecision, 'allow', cmd);
  }
  for (const cmd of [
    `node "${scripts}/usage-setup.js" "/p" apply x.json`,
    `node "${scripts}/usage-setup.js" "/p" apply "/p/.keel/local/tmp/usage-setup.json"`,
    `node "${scripts}/usage-setup.js" "/p" prices-apply "/p/.keel/local/tmp/prices-new.json"`,
    `node "${scripts}/usage-setup.js" "/p" install-statusline`,
  ]) {
    const r = bash(cmd);
    assert.equal(r.raw, '', `${cmd} is left to Claude Code's prompt`);
    assert.equal(bash(cmd, 'PowerShell').raw, '', cmd);
  }
  // Joined with a shell operator it is refused, never allowed.
  assert.equal(bash(`node "${scripts}/usage-setup.js" "/p" show; rm -rf /`).out.hookSpecificOutput.permissionDecision, 'deny');
});

test('session-wallet: notes the wallet per start; plugin-root.txt is written only when the status-line shim exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-wallet-'));
  const env = { KEEL_USAGE_DIR: dir, CLAUDE_CONFIG_DIR: dir, CLAUDE_PLUGIN_ROOT: PLUGIN };
  const root = path.join(dir, 'plugin-root.txt');
  const start = (extra = {}, e = env) => runHook('session-wallet.js', { hook_event_name: 'SessionStart', source: 'startup', session_id: 's1', cwd: dir, ...extra }, e);

  const a = start();
  assert.equal(a.code, 0);
  assert.equal(a.raw, '', 'prints nothing');
  const lines = fs.readFileSync(path.join(dir, 'sessions.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].session_id, 's1');
  assert.equal(lines[0].wallet, 'subscription');
  assert.ok(!fs.existsSync(root), 'no shim installed, no plugin-root.txt');

  fs.writeFileSync(path.join(dir, 'statusline.js'), '// shim');
  start({ source: 'resume' });
  assert.equal(fs.readFileSync(root, 'utf8'), PLUGIN);
  assert.equal(fs.readFileSync(path.join(dir, 'sessions.jsonl'), 'utf8').trim().split('\n').length, 2);

  // The plugin folder moves with an update: the next start points the shim at the new one.
  start({}, { ...env, CLAUDE_PLUGIN_ROOT: path.join(dir, 'plugin-v2') });
  assert.equal(fs.readFileSync(root, 'utf8'), path.join(dir, 'plugin-v2'));
  // An API key in the environment is noted as the api wallet.
  start({ session_id: 's2' }, { ...env, ANTHROPIC_API_KEY: 'test-not-a-key' });
  assert.equal(fs.readFileSync(path.join(dir, 'sessions.jsonl'), 'utf8').trim().split('\n').pop().includes('"wallet":"api"'), true);
});

test('session-wallet: compact starts, and starts without a session id, write nothing; bad input never fails', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-wallet-'));
  const env = { KEEL_USAGE_DIR: dir, CLAUDE_CONFIG_DIR: dir, CLAUDE_PLUGIN_ROOT: PLUGIN };
  fs.writeFileSync(path.join(dir, 'statusline.js'), '// shim');
  for (const input of [{ source: 'compact', session_id: 's' }, { source: 'startup' }, 'not json', '']) {
    const r = runHook('session-wallet.js', input, env);
    assert.equal(r.code, 0);
    assert.equal(r.raw, '');
  }
  assert.deepEqual(fs.readdirSync(dir), ['statusline.js']);
});

test('handback: in auto mode a keel agent\'s report arrives through SubagentHandback and is the one kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-handback-'));
  fs.mkdirSync(path.join(dir, '.keel'));
  const agents = path.join(dir, '.keel', 'local', 'tmp', 'agents');
  const env = { CLAUDE_PROJECT_DIR: dir };
  const report = '```json\n{"findings": []}\n```';
  const r = runHook('handback.js', { tool_name: 'SubagentHandback', tool_input: { message: report }, agent_id: 'a1', agent_type: 'keel:reviewer', cwd: dir }, env);
  assert.equal(r.code, 0);
  assert.equal(r.raw, '', 'never blocks or prints');
  assert.equal(fs.readFileSync(path.join(agents, 'reviewer-a1.md'), 'utf8'), report);
  // The agent then stops with a closing line: the report stays.
  runHook('ledger.js', { agent_id: 'a1', agent_type: 'keel:reviewer', last_assistant_message: 'Report delivered.', session_id: 's1', cwd: dir }, env);
  assert.equal(fs.readFileSync(path.join(agents, 'reviewer-a1.md'), 'utf8'), report);
  // Without a hand-back (other modes) the last text is the reply, as before.
  runHook('ledger.js', { agent_id: 'a2', agent_type: 'keel:reviewer', last_assistant_message: report, session_id: 's1', cwd: dir }, env);
  assert.equal(fs.readFileSync(path.join(agents, 'reviewer-a2.md'), 'utf8'), report);
  // Other agents and projects without .keel are left alone.
  runHook('handback.js', { tool_name: 'SubagentHandback', tool_input: { message: 'x' }, agent_id: 'b1', agent_type: 'Explore', cwd: dir }, env);
  assert.ok(!fs.readdirSync(agents).some((f) => f.includes('b1')));
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-handback-bare-'));
  runHook('handback.js', { tool_name: 'SubagentHandback', tool_input: { message: 'x' }, agent_id: 'c1', agent_type: 'keel:qa', cwd: bare }, { CLAUDE_PROJECT_DIR: bare });
  assert.ok(!fs.existsSync(path.join(bare, '.keel')));
  const pre = JSON.parse(fs.readFileSync(path.join(HOOKS, 'hooks.json'), 'utf8')).hooks.PreToolUse;
  assert.ok(pre.some((h) => h.matcher === 'SubagentHandback' && h.hooks[0].args[0].endsWith('/hooks/handback.js')));
});

test('ledger: in a planning conversation keel agents\' replies go to its own folder, a ticket review is also kept as a sample', () => {
  const dir = tempProject('{}');
  const plans = (...args) => execFileSync(process.execPath, [path.join(PLUGIN, 'scripts', 'plans.js'), dir, ...args], { encoding: 'utf8' });
  plans('new', 'csv-export');
  plans('mark', 'set', 'csv-export', '--session', 'chat-plan');
  const env = { CLAUDE_PROJECT_DIR: dir };
  const local = (...p) => path.join(dir, '.keel', 'local', ...p);
  const transcript = local('agent.jsonl');
  fs.writeFileSync(transcript, [
    JSON.stringify({ type: 'user', isSidechain: true, message: { role: 'user', content: 'Review T1 and T2 in .keel/local/plans/keel/csv-export/' } }),
    JSON.stringify({ type: 'user', isSidechain: true, message: { role: 'user', content: '<system-reminder>x</system-reminder>' } }),
    JSON.stringify({ type: 'assistant', message: { id: 'm1', role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'done' }], usage: { input_tokens: 10, output_tokens: 5 } } }),
  ].join('\n') + '\n');
  const report = '{"agent": "ticket-reviewer", "status": "complete", "checks": [], "findings": []}';
  const stop = (session, type, id, message) => runHook('ledger.js', { session_id: session, agent_id: id, agent_type: type, last_assistant_message: message, agent_transcript_path: transcript, cwd: dir }, env);

  stop('chat-plan', 'keel:ticket-reviewer', 'a1', report);
  assert.equal(fs.readFileSync(local('tmp', 'planning', 'chat-plan', 'ticket-reviewer-a1.md'), 'utf8'), report);
  assert.ok(!fs.existsSync(local('tmp', 'agents')), 'the task verification folder is not touched');
  const samples = fs.readdirSync(local('plans', 'keel', 'samples'));
  assert.equal(samples.length, 1);
  assert.match(samples[0], /^\d{4}-\d{2}-\d{2}-ticket-reviewer-a1\.md$/);
  assert.equal(fs.readFileSync(local('plans', 'keel', 'samples', samples[0]), 'utf8'), `# Task\n\nReview T1 and T2 in .keel/local/plans/keel/csv-export/\n\n# Reply\n\n${report}\n`);
  assert.equal(fs.readFileSync(local('ledger.jsonl'), 'utf8').trim().split('\n').length, 1, 'the token ledger line is still written');

  // The context agent of a planning conversation is planning's too: no context map for the verification.
  stop('chat-plan', 'keel:context', 'a2', '# Context map\n- x');
  assert.ok(fs.existsSync(local('tmp', 'planning', 'chat-plan', 'context-a2.md')));
  assert.ok(!fs.existsSync(local('tmp', 'context-map.md')));
  // Only keel's agents are saved; the plan reviewer gives no sample.
  stop('chat-plan', 'Explore', 'a3', 'x');
  stop('chat-plan', 'keel:plan-reviewer', 'a4', report);
  assert.deepEqual(fs.readdirSync(local('tmp', 'planning', 'chat-plan')).sort(), ['context-a2.md', 'plan-reviewer-a4.md', 'ticket-reviewer-a1.md']);
  assert.equal(fs.readdirSync(local('plans', 'keel', 'samples')).length, 1);

  // In auto mode the report arrives through SubagentHandback first and is the one kept and sampled.
  runHook('handback.js', { session_id: 'chat-plan', tool_name: 'SubagentHandback', tool_input: { message: report }, agent_id: 'a5', agent_type: 'keel:ticket-reviewer', cwd: dir }, env);
  stop('chat-plan', 'keel:ticket-reviewer', 'a5', 'Report delivered.');
  assert.equal(fs.readFileSync(local('tmp', 'planning', 'chat-plan', 'ticket-reviewer-a5.md'), 'utf8'), report);
  assert.match(fs.readFileSync(local('plans', 'keel', 'samples', fs.readdirSync(local('plans', 'keel', 'samples')).find((f) => f.includes('a5'))), 'utf8'), /# Reply\n\n\{"agent": "ticket-reviewer"/);

  // Another conversation, or this one once planning ends: replies go where the verification reads them.
  stop('chat-task', 'keel:ticket-reviewer', 'b1', report);
  // A report handed back before end-planning cleared the mark stays the reply; the closing words do not
  // reach the verification folder.
  runHook('handback.js', { session_id: 'chat-plan', tool_name: 'SubagentHandback', tool_input: { message: report }, agent_id: 'a6', agent_type: 'keel:ticket-reviewer', cwd: dir }, env);
  plans('mark', 'clear', '--session', 'chat-plan');
  stop('chat-plan', 'keel:ticket-reviewer', 'a6', 'Report delivered.');
  assert.equal(fs.readFileSync(local('tmp', 'planning', 'chat-plan', 'ticket-reviewer-a6.md'), 'utf8'), report);
  stop('chat-plan', 'keel:context', 'b2', '# Context map\n- y');
  assert.deepEqual(fs.readdirSync(local('tmp', 'agents')).sort(), ['context-b2.md', 'ticket-reviewer-b1.md']);
  assert.ok(fs.existsSync(local('tmp', 'context-map.md')));
  assert.equal(fs.readdirSync(local('plans', 'keel', 'samples')).length, 3, 'no sample outside planning');

  // A session id that is not one never points the saved-reply check outside the planning folder.
  fs.writeFileSync(local('tmp', 'ticket-reviewer-c1.md'), report);
  stop('..', 'keel:ticket-reviewer', 'c1', 'Report delivered.');
  assert.equal(fs.readFileSync(local('tmp', 'agents', 'ticket-reviewer-c1.md'), 'utf8'), 'Report delivered.');
  assert.equal(fs.readdirSync(local('plans', 'keel', 'samples')).length, 3);
});

test('a project keel is not set up in: the hooks add nothing, keel\'s agents and skills are refused', () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-bare-'));
  const env = { CLAUDE_PLUGIN_ROOT: PLUGIN, CLAUDE_PROJECT_DIR: bare };
  assert.equal(runHook('session-start.js', { source: 'startup', session_id: 's1' }, env).raw, '', 'no standards, no language line');
  assert.equal(runHook('no-ai-attribution.js', { tool_name: 'Bash', tool_input: { command: 'git commit -m "x" -m "Co-Authored-By: Claude <noreply@anthropic.com>"' } }, env).raw, '', 'the user\'s own commit rules apply');
  assert.equal(runHook('skill-hints.js', { session_id: 's1', tool_name: 'Edit', tool_input: { file_path: path.join(bare, 'README.md') } }, env).raw, '');
  const agent = runHook('agent-model.js', { tool_name: 'Agent', tool_input: { subagent_type: 'keel:reviewer', prompt: 'review' } }, env).out.hookSpecificOutput;
  assert.equal(agent.permissionDecision, 'deny');
  assert.match(agent.permissionDecisionReason, /keel is not set up in this project.*another agent/s);
  assert.equal(runHook('agent-model.js', { tool_name: 'Agent', tool_input: { subagent_type: 'general-purpose', prompt: 'review' } }, env).raw, '', 'other agents are left alone');
  const skill = runHook('skill-gate.js', { tool_name: 'Skill', tool_input: { skill: 'keel:git' } }, env).out.hookSpecificOutput;
  assert.equal(skill.permissionDecision, 'deny');
  for (const s of ['keel:configure', 'keel:help', 'keel:usage', 'other:git', 'git']) assert.equal(runHook('skill-gate.js', { tool_name: 'Skill', tool_input: { skill: s } }, env).raw, '', s);

  // /keel:configure has started (its scan writes .keel/local/): its context agent may run.
  fs.mkdirSync(path.join(bare, '.keel', 'local'), { recursive: true });
  assert.notEqual(runHook('agent-model.js', { tool_name: 'Agent', tool_input: { subagent_type: 'keel:context', prompt: 'map' } }, env).out?.hookSpecificOutput.permissionDecision, 'deny');
  // Set up: everything acts again.
  fs.writeFileSync(path.join(bare, '.keel', 'config.json'), '{}');
  assert.match(runHook('session-start.js', { source: 'startup' }, env).out.hookSpecificOutput.additionalContext, /keel: talk to the user/);
  assert.equal(runHook('skill-gate.js', { tool_name: 'Skill', tool_input: { skill: 'keel:git' } }, env).raw, '');
  const pre = JSON.parse(fs.readFileSync(path.join(HOOKS, 'hooks.json'), 'utf8')).hooks.PreToolUse;
  assert.ok(pre.some((h) => h.matcher === 'Skill' && h.hooks[0].args[0].endsWith('/hooks/skill-gate.js')));
});
