'use strict';
// A session that works in a linked git worktree of the project (a desktop app worktree session, or after
// Claude entered a worktree) still gets the main checkout as CLAUDE_PROJECT_DIR and as <project>; keel
// works on the worktree the shell (or the hook's cwd) is in.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { tempDir } = require('./fixtures/tmp.js');

const PLUGIN = path.join(__dirname, '..', 'plugins', 'keel');
const SCRIPTS = path.join(PLUGIN, 'scripts');
const HOOKS = path.join(PLUGIN, 'hooks');

const hasGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const gitTest = (name, fn) => test(name, { skip: !hasGit && 'git is not installed' }, fn);

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const slash = (p) => p.replace(/\\/g, '/');

const CONFIG = {
  schema_version: 1,
  repo_language: 'en',
  gates: { checks: [], security_scanners: [] },
  git: { mode: 'manual', main_branch: 'main', ask_before_merge: true, state_in_git: true },
  verification: {
    tier_rules: { gates_only_max_files: 1, basic_max_modules: 1, large_change_lines: 400, very_large_change_lines: 1000 },
    verifier_caps: { basic: 3, standard: 5, maximum: 8 },
  },
  architecture: { file_lines_warn: 700, file_lines_max: 1000 },
  docs: { profile: 1, pattern: 'none' },
};

// A main checkout with keel's config committed and a linked worktree of it under .claude/worktrees/wt.
function setup(extra = {}) {
  const tmp = tempDir('keel-wt-');
  const main = path.join(tmp, 'app');
  fs.mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'config', 'user.email', 't@example.com');
  git(main, 'config', 'user.name', 'T');
  write(main, '.keel/config.json', `${JSON.stringify({ ...CONFIG, ...extra })}\n`);
  write(main, '.gitignore', '.claude/\n.keel/local/\n');
  write(main, 'src/a.js', 'module.exports = 1;\n');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'init');
  const wt = path.join(main, '.claude', 'worktrees', 'wt');
  git(main, 'worktree', 'add', '-q', '-b', 'wt', wt);
  return { tmp, main, wt };
}

const node = (script, args, cwd, env = {}) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: '', ...env } });

gitTest('worktreeOf: only a linked worktree of the given repository counts', () => {
  const { worktreeOf } = require(path.join(SCRIPTS, 'lib', 'project-dir.js'));
  const { tmp, main, wt } = setup();
  const other = path.join(tmp, 'other');
  fs.mkdirSync(other);
  git(other, 'init', '-q', '-b', 'main');
  git(other, 'config', 'user.email', 't@example.com');
  git(other, 'config', 'user.name', 'T');
  write(other, 'x.txt', 'x\n');
  git(other, 'add', '-A');
  git(other, 'commit', '-q', '-m', 'x');
  const otherWt = path.join(tmp, 'other-wt');
  git(other, 'worktree', 'add', '-q', '-b', 'o', otherWt);
  const same = (a, b) => assert.equal(fs.realpathSync.native(a).toLowerCase(), fs.realpathSync.native(b).toLowerCase());

  same(worktreeOf(main, wt), wt);
  same(worktreeOf(main, path.join(wt, 'src')), wt);
  assert.equal(worktreeOf(main, main), null);
  assert.equal(worktreeOf(main, path.join(main, 'src')), null);
  assert.equal(worktreeOf(main, other), null);
  assert.equal(worktreeOf(main, otherWt), null);
  assert.equal(worktreeOf(wt, wt), null);
  assert.equal(worktreeOf(main, tmp), null);
  assert.equal(worktreeOf(undefined, wt), null);
  assert.equal(worktreeOf(main, undefined), null);
});

gitTest('worktreeOf: a nested repository or a submodule inside the worktree still belongs to it', () => {
  const { worktreeOf } = require(path.join(SCRIPTS, 'lib', 'project-dir.js'));
  const { tmp, main, wt } = setup();
  const nested = path.join(wt, 'vendor', 'lib');
  fs.mkdirSync(nested, { recursive: true });
  git(nested, 'init', '-q', '-b', 'main');
  const sub = path.join(wt, 'mod');
  fs.mkdirSync(sub);
  write(sub, '.git', `gitdir: ${slash(path.join(tmp, 'modgit'))}\n`);
  fs.mkdirSync(path.join(tmp, 'modgit'));
  const same = (a, b) => assert.equal(fs.realpathSync.native(a).toLowerCase(), fs.realpathSync.native(b).toLowerCase());
  same(worktreeOf(main, nested), wt);
  same(worktreeOf(main, sub), wt);
  const inMain = path.join(main, 'vendor');
  fs.mkdirSync(inMain);
  git(inMain, 'init', '-q', '-b', 'main');
  assert.equal(worktreeOf(main, inMain), null);
});

gitTest('worktreeOf: a copied .git file of a worktree does not make its folder a worktree', () => {
  const { worktreeOf } = require(path.join(SCRIPTS, 'lib', 'project-dir.js'));
  const { tmp, main, wt } = setup();
  const copy = path.join(tmp, 'copy');
  fs.mkdirSync(copy);
  fs.copyFileSync(path.join(wt, '.git'), path.join(copy, '.git'));
  assert.equal(worktreeOf(main, copy), null);
});

gitTest('worktreeOf / mainOf: a project in a sub-folder of the repository maps to the same sub-folder', () => {
  const { worktreeOf, mainOf } = require(path.join(SCRIPTS, 'lib', 'project-dir.js'));
  const { main, wt } = setup();
  const same = (a, b) => assert.equal(fs.realpathSync.native(a).toLowerCase(), fs.realpathSync.native(b).toLowerCase());
  same(worktreeOf(path.join(main, 'src'), path.join(wt, 'src')), path.join(wt, 'src'));
  same(worktreeOf(path.join(main, 'src'), wt), path.join(wt, 'src'));
  same(mainOf(path.join(wt, 'src')), path.join(main, 'src'));
  same(mainOf(wt), main);
  assert.equal(mainOf(main), main);
});

gitTest('notes.js given the main checkout from a worktree records the session start in the worktree and names it', () => {
  const { main, wt } = setup();
  const r = node(path.join(SCRIPTS, 'notes.js'), [main, 'check', '--begin', '--session', 's1'], wt);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(wt, '.keel', 'local', 'session-start.json')), 'session start in the worktree');
  assert.ok(!fs.existsSync(path.join(main, '.keel', 'local', 'session-start.json')), 'nothing in the main checkout');
  assert.match(r.stderr, /^project: \S+\/\.claude\/worktrees\/wt \(a worktree of \S+\/app; keel works here/m);
});

gitTest('notes.js run from the main checkout itself stays there and prints no project line', () => {
  const { main } = setup();
  const r = node(path.join(SCRIPTS, 'notes.js'), [main, 'check', '--begin', '--session', 's1'], main);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(main, '.keel', 'local', 'session-start.json')));
  assert.doesNotMatch(r.stderr, /^project:/m);
});

gitTest('git-flow.js given the main checkout from a worktree reports the worktree branch', () => {
  const { main, wt } = setup();
  const r = node(path.join(SCRIPTS, 'git-flow.js'), [main, 'status'], wt);
  assert.match(r.stdout, /^branch: wt\b/m);
});

gitTest('hooks: a worktree session (CLAUDE_PROJECT_DIR = main checkout, cwd = worktree) uses the worktree', () => {
  const { main, wt } = setup();
  // The main checkout loses its config (not committed yet), the worktree keeps it: only the worktree is configured.
  fs.rmSync(path.join(main, '.keel'), { recursive: true, force: true });
  const hook = (name, input) => spawnSync(process.execPath, [path.join(HOOKS, name)], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN, CLAUDE_PROJECT_DIR: main } });
  const start = hook('session-start.js', { source: 'startup', session_id: 's1', cwd: wt });
  assert.match(start.stdout, /keel standards/);
  const agent = hook('agent-model.js', { tool_name: 'Agent', tool_input: { subagent_type: 'keel:reviewer' }, cwd: wt });
  assert.doesNotMatch(agent.stdout, /not set up in this project/);
});

gitTest('hooks in a worktree session take keel\'s project options (the language) from the main checkout', () => {
  const { main, wt } = setup();
  write(main, '.keel/local/options.json', '{ "conversation_language": "uk" }\n');
  const r = spawnSync(process.execPath, [path.join(HOOKS, 'session-start.js')], { input: JSON.stringify({ source: 'startup', session_id: 's1', cwd: wt }), encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN, CLAUDE_PROJECT_DIR: main, CLAUDE_PLUGIN_OPTION_CONVERSATION_LANGUAGE: 'en' } });
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /in this language: Ukrainian/);
});

gitTest('own-files: a keel script named with the worktree, or with the main checkout it belongs to, runs without a prompt', () => {
  const { main, wt } = setup();
  const decision = (project) => {
    const command = `node "${slash(path.join(SCRIPTS, 'notes.js'))}" "${slash(project)}" check`;
    const r = spawnSync(process.execPath, [path.join(HOOKS, 'own-files.js')], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: wt }), encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN, CLAUDE_PROJECT_DIR: main } });
    return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : null;
  };
  assert.equal(decision(wt), 'allow');
  assert.equal(decision(main), 'allow');
});

// What this machine shares between conversations stays in the main checkout: a worktree is deleted with
// its conversation, and another worktree session must see the same drafts, briefs and local tasks.
const run = (script, args, cwd, main) => node(path.join(SCRIPTS, script), args, cwd, { CLAUDE_PROJECT_DIR: main });

gitTest('planning drafts, briefs and keel\'s trash from a worktree are the main checkout\'s', () => {
  const { tmp, main, wt } = setup({ planning: { ticket_prefix: 'PAY', tickets: 'repo' } });
  const made = run('plans.js', [main, 'new', 'pay-later'], wt, main);
  assert.match(made.stdout, /^created: /m, made.stdout + made.stderr);
  assert.ok(fs.existsSync(path.join(main, '.keel', 'local', 'plans', 'keel', 'pay-later', 'plan.md')), 'the draft is in the main checkout');
  assert.ok(!fs.existsSync(path.join(wt, '.keel', 'local', 'plans', 'keel', 'pay-later')), 'nothing in the worktree');
  assert.match(run('plans.js', [main, 'list'], main, main).stdout, /pay-later: draft/, 'the main checkout sees it');
  const wt2 = path.join(tmp, 'wt2');
  git(main, 'worktree', 'add', '-q', '-b', 'wt2', wt2);
  assert.match(run('plans.js', [main, 'list'], wt2, main).stdout, /pay-later: draft/, 'another worktree sees it');

  write(main, '.keel/local/plans/briefs/pay-later-brief.md', '# Brief\n\n## Goal\nPay later.\n');
  const brief = run('plans.js', [wt, 'brief', 'pay-later', '.keel/local/plans/briefs/pay-later-brief.md'], wt, main);
  assert.match(brief.stdout, /^brief: /m, brief.stdout);
  assert.match(fs.readFileSync(path.join(main, '.keel', 'local', 'plans', 'keel', 'pay-later', 'plan.md'), 'utf8'), /Pay later\./);

  const gone = run('plans.js', [main, 'state', 'pay-later', 'abandoned'], wt, main);
  assert.match(gone.stdout, /moved to keel's trash: batch /, gone.stdout);
  assert.ok(!fs.existsSync(path.join(main, '.keel', 'local', 'plans', 'keel', 'pay-later')));
  assert.match(run('cleanup.js', [main, 'trash'], main, main).stdout, /trash batches/, 'the main checkout\'s trash holds it');
  const back = run('cleanup.js', [main, 'restore'], wt, main);
  assert.match(back.stdout, /restored 1 items/, back.stdout);
  assert.ok(fs.existsSync(path.join(main, '.keel', 'local', 'plans', 'keel', 'pay-later', 'plan.md')), 'put back where it was');
});

gitTest('local tasks (tasks.in_git false) from a worktree are the main checkout\'s, and keel\'s trash puts a worktree file back there', () => {
  const { main, wt } = setup({ tasks: { in_git: false } });
  const made = run('notes.js', [main, 'task', 'new', 'ABC-1', '--title', 'One', '--source', 'text', '--session', 's1'], wt, main);
  assert.match(made.stdout, /^created: /m, made.stdout + made.stderr);
  assert.ok(fs.existsSync(path.join(main, '.keel', 'local', 'tasks', 'ABC-1', 'task.md')), 'the task is in the main checkout');
  assert.match(run('notes.js', [main, 'tasks'], main, main).stdout, /ABC-1/, 'the main checkout lists it');
  const drop = run('notes.js', [main, 'task', 'drop', 'ABC-1'], wt, main);
  assert.match(drop.stdout, /trash/, drop.stdout + drop.stderr);
  assert.ok(!fs.existsSync(path.join(main, '.keel', 'local', 'tasks', 'ABC-1')));

  write(wt, 'old.log', 'x\n');
  const trash = require(path.join(SCRIPTS, 'lib', 'trash.js'));
  const r = trash.moveToTrash(wt, ['old.log'], 'cleanup');
  assert.ok(r.batch && fs.existsSync(path.join(main, '.keel', 'local', 'trash', r.batch)), 'the batch is in the main checkout');
  assert.equal(trash.restore(main, r.batch).restored.length, 1);
  assert.ok(fs.existsSync(path.join(wt, 'old.log')), 'back in the worktree it came from');
});

// own-files in a worktree session: the decision for one Bash command, or null (Claude Code asks).
function ownFiles(command, cwd, projectDir, extra = {}) {
  const r = spawnSync(process.execPath, [path.join(HOOKS, 'own-files.js')], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd, ...extra }), encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN, CLAUDE_PROJECT_DIR: projectDir } });
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : null;
}
const script = (name) => slash(path.join(SCRIPTS, name));

gitTest('git trust confirmed for the main checkout holds in its worktrees, and a worktree that edits the git section asks again', () => {
  const { tmp, main, wt } = setup({ git: { ...CONFIG.git, mode: 'autonomous' } });
  const { trust, trustState } = require(path.join(SCRIPTS, 'lib', 'trust.js'));
  const env = { KEEL_USAGE_DIR: path.join(tmp, 'home') };
  assert.equal(trust(main, env), true);
  assert.equal(trustState(wt, env), 'confirmed');
  assert.equal(trust(wt, env), false, 'no second entry');
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'home', 'trusted-git.json'), 'utf8')).projects.length, 1);
  write(wt, '.keel/config.json', `${JSON.stringify({ ...CONFIG, git: { ...CONFIG.git, mode: 'autonomous', ask_before_merge: false } })}\n`);
  assert.equal(trustState(wt, env), 'changed');
  assert.equal(trustState(main, env), 'confirmed');
});

gitTest('scan.js with no project argument scans the shell\'s folder, not CLAUDE_PROJECT_DIR', () => {
  const tmp = tempDir('keel-scan-');
  const [a, b] = [path.join(tmp, 'a'), path.join(tmp, 'b')];
  fs.mkdirSync(a);
  write(b, 'index.js', 'module.exports = 1;\n');
  const r = node(path.join(SCRIPTS, 'scan.js'), [], b, { CLAUDE_PROJECT_DIR: a });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(JSON.parse(r.stdout).profile.languages.some((l) => l.name === 'JavaScript'), 'b, with its index.js, was scanned');
});

gitTest('paths named from the main checkout work from a worktree: scan --out and plan-steps\' plan file', () => {
  const { main, wt } = setup();
  write(main, 'docs/plan.md', '# Plan\n');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'plan');
  git(wt, 'merge', '-q', 'main');
  const out = run('scan.js', [main, '--out', path.join(main, '.keel', 'local', 'tmp', 'scan.json')], wt, main);
  assert.doesNotMatch(out.stdout, /--out must be/, out.stdout);
  assert.ok(fs.existsSync(path.join(wt, '.keel', 'local', 'tmp', 'scan.json')), 'written in the worktree keel works on');
  const steps = run('plan-steps.js', [main, path.join(main, 'docs', 'plan.md')], wt, main);
  assert.doesNotMatch(steps.stdout, /unavailable/, steps.stdout);
});

gitTest('agent replies, a handback and the finish check of a worktree session stay in the worktree', () => {
  const { main, wt } = setup();
  const hook = (name, input) => spawnSync(process.execPath, [path.join(HOOKS, name)], { input: JSON.stringify({ cwd: wt, session_id: 's1', ...input }), encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN, CLAUDE_PROJECT_DIR: main } });
  hook('ledger.js', { agent_type: 'keel:reviewer', agent_id: 'a1', last_assistant_message: 'findings: none' });
  assert.equal(fs.readFileSync(path.join(wt, '.keel', 'local', 'tmp', 'agents', 'reviewer-a1.md'), 'utf8').trim(), 'findings: none');
  hook('handback.js', { tool_name: 'SubagentHandback', tool_input: { message: 'report' }, agent_type: 'keel:qa', agent_id: 'a2' });
  assert.equal(fs.readFileSync(path.join(wt, '.keel', 'local', 'tmp', 'agents', 'qa-a2.md'), 'utf8').trim(), 'report');
  assert.ok(!fs.existsSync(path.join(main, '.keel', 'local', 'tmp', 'agents')), 'nothing in the main checkout');

  const { writeFinish } = require(path.join(SCRIPTS, 'lib', 'finish.js'));
  write(wt, '.keel/tasks/ABC-1/task.md', '---\nid: ABC-1\n---\n');
  writeFinish(wt, 's1', 'ABC-1', 'deleted');
  assert.ok(require(path.join(SCRIPTS, 'lib', 'trash.js')).moveToTrash(wt, ['.keel/tasks/ABC-1'], 'task').batch);
  const stop = hook('finish-check.js', { hook_event_name: 'Stop', last_assistant_message: 'Done.' });
  assert.match(stop.stdout, /"decision":"block"/, stop.stdout);
  assert.match(stop.stdout, /\.claude\/worktrees\/wt|\.claude\\\\worktrees\\\\wt/, 'the restore command names the worktree');
});

// Each keel script takes its project through scriptProject and each hook through hookProject, so
// none works on the main checkout while the session is in a worktree of it.
test('every script and hook that reads a project resolves it through lib/project-dir.js', () => {
  const scripts = ['changes.js', 'check-config.js', 'claude-settings.js', 'cleanup.js', 'comments.js', 'config-check.js', 'feature-page.js', 'fingerprint.js', 'git-flow.js', 'ledger-report.js', 'migrate.js', 'notes.js', 'plan-steps.js', 'plans.js', 'safe-command.js', 'scan.js', 'stack-skills.js', 'usage.js', 'usage-clear.js', 'usage-setup.js', 'votes.js'];
  for (const s of scripts) assert.match(fs.readFileSync(path.join(SCRIPTS, s), 'utf8'), /require\('\.\/lib\/project-dir\.js'\)(\.scriptProject\(|;|\))/, s);
  for (const s of scripts) assert.match(fs.readFileSync(path.join(SCRIPTS, s), 'utf8'), /scriptProject\(/, s);
  const hooks = ['agent-model.js', 'context-warning.js', 'finish-check.js', 'handback.js', 'lane-gate.js', 'ledger.js', 'no-ai-attribution.js', 'own-files.js', 'planning-guard.js', 'session-start.js', 'skill-gate.js', 'skill-hints.js', 'subagent-start.js'];
  for (const h of hooks) assert.match(fs.readFileSync(path.join(HOOKS, h), 'utf8'), /hookProject\(/, h);
  for (const h of hooks) assert.doesNotMatch(fs.readFileSync(path.join(HOOKS, h), 'utf8'), /CLAUDE_PROJECT_DIR \|\|/, `${h} has its own project rule`);
});

gitTest('scriptProject: the first argument, else CLAUDE_PROJECT_DIR, else the shell\'s folder; a worktree of it is named on stderr', () => {
  const { main, wt } = setup();
  const show = path.join(tempDir('keel-sp-'), 'show.js');
  fs.writeFileSync(show, `process.stdout.write(require(${JSON.stringify(path.join(SCRIPTS, 'lib', 'project-dir.js'))}).scriptProject(process.argv[2]));\n`);
  const same = (a, b) => assert.equal(fs.realpathSync.native(a).toLowerCase(), fs.realpathSync.native(b).toLowerCase());
  same(node(show, [main], main).stdout, main);
  same(node(show, [], main, { CLAUDE_PROJECT_DIR: main }).stdout, main);
  same(node(show, [], main).stdout, main);
  const fromWt = node(show, [], wt, { CLAUDE_PROJECT_DIR: main });
  same(fromWt.stdout, wt);
  assert.match(fromWt.stderr, /^project: .*\/wt \(a worktree of /);
  same(node(show, [main], wt).stdout, wt);
  same(node(show, [], wt).stdout, wt);
  assert.equal(node(show, [], wt).stderr, '', 'the shell\'s own worktree is no other project: no line');
});

// A planning conversation that entered a worktree keeps its lock and lane: its chat mark may be in the
// main checkout (set before) or in the worktree (set after).
gitTest('planning guard and lanes hold in a worktree, whichever folder holds the chat mark', () => {
  const { main, wt } = setup({ planning: { ticket_prefix: 'PAY', tickets: 'repo' } });
  assert.match(run('plans.js', [main, 'new', 'pay-later'], main, main).stdout, /^created: /m);
  const hook = (name, input) => spawnSync(process.execPath, [path.join(HOOKS, name)], { input: JSON.stringify({ cwd: wt, ...input }), encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN, CLAUDE_PROJECT_DIR: main } }).stdout;
  for (const [sid, from] of [['chat-main', main], ['chat-wt', wt]]) {
    const set = run('plans.js', [main, 'mark', 'set', 'pay-later', '--session', sid], from, main);
    assert.match(set.stdout, /^planning: pay-later$/m, set.stdout + set.stderr);
    assert.match(run('plans.js', [main, 'mark', 'get', '--session', sid], wt, main).stdout, /^planning: pay-later$/m, `mark get from the worktree (${sid})`);
    for (const file of [path.join(wt, 'src', 'a.js'), path.join(main, 'src', 'a.js')]) {
      const out = hook('planning-guard.js', { session_id: sid, tool_name: 'Write', tool_input: { file_path: file, content: 'x' } });
      assert.match(out, /"permissionDecision":"deny"/, `${sid}: a write to ${file} is refused`);
    }
    assert.equal(hook('planning-guard.js', { session_id: sid, tool_name: 'Write', tool_input: { file_path: path.join(main, '.keel', 'local', 'plans', 'keel', 'pay-later', 'plan.md'), content: 'x' } }), '', `${sid}: the draft stays writable`);
    assert.match(hook('skill-gate.js', { session_id: sid, tool_name: 'Skill', tool_input: { skill: 'keel:start-task' } }), /"permissionDecision":"deny"/, `${sid}: no task while planning`);
    assert.match(run('plans.js', [main, 'mark', 'clear', '--session', sid], wt, main).stdout, /^planning: none$/m);
    assert.equal(hook('planning-guard.js', { session_id: sid, tool_name: 'Write', tool_input: { file_path: path.join(wt, 'src', 'a.js'), content: 'x' } }), '', `${sid}: cleared from the worktree`);
  }
});

gitTest('own-files in a worktree: the usage steps run on the worktree (or the main checkout) without a prompt', () => {
  const { main, wt } = setup();
  for (const p of [wt, main]) {
    assert.equal(ownFiles(`node "${script('usage.js')}" report --project "${slash(p)}" --session s1`, wt, main), 'allow', `usage.js report on ${p}`);
    assert.equal(ownFiles(`node "${script('usage.js')}" prepare --tools none --project "${slash(p)}" --session s1`, wt, main), 'allow', `usage.js prepare on ${p}`);
    assert.equal(ownFiles(`node "${script('usage-setup.js')}" "${slash(p)}" show`, wt, main), 'allow', `usage-setup.js show on ${p}`);
  }
  assert.equal(ownFiles(`node "${script('usage.js')}" report --project "${slash(wt)}" --out "${slash(path.join(wt, '.keel', 'local', 'usage', 'x'))}"`, wt, main), 'allow');
});

gitTest('own-files in a worktree: another project, a worktree of another repository and a step outside the project still ask', () => {
  const { tmp, main, wt } = setup();
  const other = path.join(tmp, 'other');
  fs.mkdirSync(other);
  git(other, 'init', '-q', '-b', 'main');
  git(other, 'config', 'user.email', 't@example.com');
  git(other, 'config', 'user.name', 'T');
  write(other, 'x.txt', 'x\n');
  git(other, 'add', '-A');
  git(other, 'commit', '-q', '-m', 'x');
  const otherWt = path.join(tmp, 'other-wt');
  git(other, 'worktree', 'add', '-q', '-b', 'o', otherWt);
  const notes = (p) => `node "${script('notes.js')}" "${slash(p)}" check`;
  assert.equal(ownFiles(notes(other), wt, main), null, 'another project');
  assert.equal(ownFiles(notes(otherWt), wt, main), null, 'a worktree of another repository');
  assert.equal(ownFiles(notes(wt), otherWt, main), null, 'the shell is in a worktree of another repository');
  assert.equal(ownFiles(`node "${script('usage.js')}" report --project "${slash(other)}"`, wt, main), null, 'usage on another project');
  assert.equal(ownFiles(`node "${script('usage.js')}" report --project "${slash(wt)}" --out "${slash(path.join(main, '.keel', 'local', 'usage', 'x'))}"`, wt, main), null, 'usage output outside the worktree');
});

gitTest('own-files in a worktree: a QA agent writes only under the worktree\'s .keel/local/tmp/qa/', () => {
  const { main, wt } = setup();
  const qa = (file) => {
    const r = spawnSync(process.execPath, [path.join(HOOKS, 'own-files.js')], { input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: file, content: 'x' }, cwd: wt, agent_type: 'keel:qa' }), encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN, CLAUDE_PROJECT_DIR: main } });
    return JSON.parse(r.stdout).hookSpecificOutput.permissionDecision;
  };
  assert.equal(qa(path.join(wt, '.keel', 'local', 'tmp', 'qa', 'a.js')), 'allow');
  assert.equal(qa(path.join(main, '.keel', 'local', 'tmp', 'qa', 'a.js')), 'deny');
  assert.equal(qa(path.join(wt, 'src', 'a.js')), 'deny');
});

// A hook run in a worktree session (CLAUDE_PROJECT_DIR = main checkout) with the shell in `cwd`.
const hookIn = (name, cwd, main, input) => spawnSync(process.execPath, [path.join(HOOKS, name)], { input: JSON.stringify({ cwd, ...input }), encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN, CLAUDE_PROJECT_DIR: main } }).stdout;
const commitTasks = (main, ids) => {
  for (const id of ids) write(main, `.keel/tasks/${id}/task.md`, `---\nid: ${id}\ntitle: T ${id}\nstatus: active\ncreated: 2026-11-01\nupdated: 2026-11-01\n---\n\n# ${id}\n`);
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'tasks');
};

gitTest('a planning mark set in a worktree still holds when the chat goes back to the main checkout', () => {
  const { main, wt } = setup({ planning: { ticket_prefix: 'PAY', tickets: 'repo' } });
  assert.match(run('plans.js', [main, 'new', 'pay-later'], main, main).stdout, /^created: /m);
  assert.match(run('plans.js', [main, 'mark', 'set', 'pay-later', '--session', 'chat-wt'], wt, main).stdout, /^planning: pay-later$/m);
  assert.match(run('plans.js', [main, 'mark', 'get', '--session', 'chat-wt'], main, main).stdout, /^planning: pay-later$/m);
  assert.match(hookIn('planning-guard.js', main, main, { session_id: 'chat-wt', tool_name: 'Write', tool_input: { file_path: path.join(main, 'src', 'a.js'), content: 'x' } }), /"permissionDecision":"deny"/);
  assert.match(hookIn('skill-gate.js', main, main, { session_id: 'chat-wt', tool_name: 'Skill', tool_input: { skill: 'keel:start-task' } }), /"permissionDecision":"deny"/);
});

gitTest('a task marker is one per session: set in the main checkout or a worktree, seen and cleared from the other', () => {
  const { main, wt } = setup();
  commitTasks(main, ['ABC-1']);
  git(wt, 'merge', '-q', 'main');
  assert.match(run('notes.js', [main, 'task', 'activate', 'ABC-1', '--session', 's1'], main, main).stdout, /^active task: ABC-1$/m);
  assert.match(run('notes.js', [main, 'check', '--session', 's1'], wt, main).stdout, /^active task: ABC-1$/m, 'seen from the worktree');
  assert.match(run('notes.js', [main, 'task', 'deactivate', '--session', 's1'], wt, main).stdout, /^active task: none$/m);
  assert.match(run('notes.js', [main, 'check', '--session', 's1'], main, main).stdout, /^active task: none$/m, 'cleared for the main checkout too');
  assert.match(run('notes.js', [main, 'task', 'activate', 'ABC-1', '--session', 's2'], wt, main).stdout, /^active task: ABC-1$/m);
  assert.match(hookIn('skill-gate.js', main, main, { session_id: 's2', tool_name: 'Skill', tool_input: { skill: 'keel:start-planning' } }), /"permissionDecision":"deny"/, 'no planning back in the main checkout');
});

gitTest('a local task active in another worktree session shows as active in another session', () => {
  const { tmp, main, wt } = setup({ tasks: { in_git: false } });
  const wt2 = path.join(tmp, 'wt2');
  git(main, 'worktree', 'add', '-q', '-b', 'wt2', wt2);
  assert.match(run('notes.js', [main, 'task', 'new', 'LOC-1', '--title', 'Local', '--source', 'text', '--session', 's2'], wt2, main).stdout, /^created: /m);
  assert.match(run('notes.js', [main, 'tasks', '--session', 's1'], wt, main).stdout, /active in another session/);
});

gitTest('a worktree without its own .keel/config.json uses the main checkout\'s: keel stays set up there', () => {
  const { main, wt } = setup();
  // Configured but not committed yet: the worktree has no .keel at all.
  fs.rmSync(path.join(wt, '.keel'), { recursive: true, force: true });
  assert.doesNotMatch(hookIn('skill-gate.js', wt, main, { session_id: 's1', tool_name: 'Skill', tool_input: { skill: 'keel:start-task' } }), /deny/);
  assert.match(hookIn('session-start.js', wt, main, { source: 'startup', session_id: 's1' }), /keel standards/);
  assert.match(run('check-config.js', [main], wt, main).stdout, /^keel-config: ok$/m);
  hookIn('ledger.js', wt, main, { session_id: 's1', agent_type: 'keel:reviewer', agent_id: 'a1', last_assistant_message: 'findings: none' });
  assert.ok(fs.existsSync(path.join(wt, '.keel', 'local', 'tmp', 'agents', 'reviewer-a1.md')), 'the agent reply is saved');
  write(main, '.keel/profile.json', '{}\n');
  assert.doesNotMatch(run('check-config.js', [main, '--profile'], wt, main).stdout, /^profile: missing$/m, 'the main checkout\'s profile is read');
});

gitTest('a worktree without its own .keel takes the comment level and the secret paths from the main checkout', () => {
  const { main, wt } = setup({ comments: { level: 'detailed' } });
  write(main, '.keel/profile.json', `${JSON.stringify({ secret_paths: ['data/keys.txt'] })}\n`);
  fs.rmSync(path.join(wt, '.keel'), { recursive: true, force: true });
  assert.equal(require(path.join(HOOKS, 'comment-rules.js')).projectLevel(wt), 'detailed');
  assert.equal(require(path.join(SCRIPTS, 'lib', 'project.js')).secretCheck(wt).isSecret('data/keys.txt'), true);
});

gitTest('a worktree without its own .keel/config.json takes autonomous git and its trust from the main checkout', () => {
  const { tmp, main, wt } = setup({ git: { ...CONFIG.git, mode: 'autonomous' } });
  const env = { KEEL_USAGE_DIR: path.join(tmp, 'home') };
  assert.equal(require(path.join(SCRIPTS, 'lib', 'trust.js')).trust(main, env), true);
  fs.rmSync(path.join(wt, '.keel'), { recursive: true, force: true });
  const command = `node "${script('git-flow.js')}" "${slash(wt)}" commit --message "x"`;
  const r = spawnSync(process.execPath, [path.join(HOOKS, 'own-files.js')], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: wt }), encoding: 'utf8', env: { ...process.env, ...env, CLAUDE_PLUGIN_ROOT: PLUGIN, CLAUDE_PROJECT_DIR: main } });
  assert.match(r.stdout, /"permissionDecision":"allow"/, r.stdout);
});

gitTest('task restore in a worktree takes back its own copy, not the one another worktree dropped later', () => {
  const { tmp, main, wt } = setup();
  commitTasks(main, ['ABC-2']);
  git(wt, 'merge', '-q', 'main');
  const wt2 = path.join(tmp, 'wt2');
  git(main, 'worktree', 'add', '-q', '-b', 'wt2', wt2);
  assert.match(run('notes.js', [main, 'task', 'drop', 'ABC-2'], wt, main).stdout, /^dropped: ABC-2$/m);
  assert.match(run('notes.js', [main, 'task', 'drop', 'ABC-2'], wt2, main).stdout, /^dropped: ABC-2$/m);
  const back = run('notes.js', [main, 'task', 'restore', 'ABC-2', '--session', 's1'], wt, main);
  assert.match(back.stdout, /^restored: /m, back.stdout + back.stderr);
  assert.ok(fs.existsSync(path.join(wt, '.keel', 'tasks', 'ABC-2', 'task.md')), 'back in this worktree');
  assert.ok(!fs.existsSync(path.join(wt2, '.keel', 'tasks', 'ABC-2')), 'the other worktree\'s copy stays in the trash');
});

gitTest('cleanup restore with no batch named takes the newest batch of this folder', () => {
  const { tmp, main, wt } = setup();
  const wt2 = path.join(tmp, 'wt2');
  git(main, 'worktree', 'add', '-q', '-b', 'wt2', wt2);
  const trash = require(path.join(SCRIPTS, 'lib', 'trash.js'));
  write(wt, 'a.log', 'a\n');
  write(wt2, 'b.log', 'b\n');
  assert.ok(trash.moveToTrash(wt, ['a.log'], 'cleanup').batch);
  assert.ok(trash.moveToTrash(wt2, ['b.log'], 'cleanup').batch);
  const back = run('cleanup.js', [main, 'restore'], wt, main);
  assert.match(back.stdout, /restored 1 items/, back.stdout);
  assert.ok(fs.existsSync(path.join(wt, 'a.log')), 'this worktree\'s file is back');
  assert.ok(!fs.existsSync(path.join(wt2, 'b.log')), 'the other worktree\'s file stays in the trash');
});

gitTest('closed-tasks.json keeps every entry when two worktrees close tasks at the same time', async () => {
  const { tmp, main, wt } = setup();
  const ids = Array.from({ length: 15 }, (_, i) => [`PA-${i + 1}`, `QB-${i + 1}`]).flat();
  commitTasks(main, ids);
  git(wt, 'merge', '-q', 'main');
  const wt2 = path.join(tmp, 'wt2');
  git(main, 'worktree', 'add', '-q', '-b', 'wt2', wt2);
  const drop = path.join(tmp, 'drop.js');
  fs.writeFileSync(drop, `const t = require(${JSON.stringify(path.join(SCRIPTS, 'lib', 'tasks.js'))});\nfor (const id of process.argv.slice(3)) t.taskDrop(process.argv[2], id);\n`);
  const go = (cwd, prefix) => new Promise((resolve) => {
    require('node:child_process').spawn(process.execPath, [drop, cwd, ...ids.filter((id) => id.startsWith(prefix))], { cwd, stdio: 'ignore' }).on('close', resolve);
  });
  await Promise.all([go(wt, 'PA-'), go(wt2, 'QB-')]);
  const closed = Object.keys(require(path.join(SCRIPTS, 'lib', 'tasks.js')).readClosed(main));
  assert.equal(closed.length, ids.length, `closed: ${closed.length} of ${ids.length}`);
});

gitTest('the usage scripts given the main checkout from a worktree work on the worktree', () => {
  const { tmp, main, wt } = setup();
  const env = { CLAUDE_PROJECT_DIR: main, KEEL_USAGE_DIR: path.join(tmp, 'home') };
  const under = (out, dir) => assert.ok(slash(out).toLowerCase().includes(`${slash(dir).toLowerCase()}/.keel/local/`), out);
  under(node(path.join(SCRIPTS, 'usage-setup.js'), [main, 'page'], wt, env).stdout, wt);
  under(node(path.join(SCRIPTS, 'usage-clear.js'), ['start', '--project', main], wt, env).stdout, wt);
  fs.mkdirSync(path.join(wt, '.keel', 'local', 'tmp'), { recursive: true });
  fs.writeFileSync(path.join(wt, '.keel', 'local', 'tmp', 'changes.json'), JSON.stringify({ totals: { added: 7, removed: 3, files: 2 } }));
  const { keelFields } = require(path.join(SCRIPTS, 'usage.js'));
  const expected = JSON.stringify(keelFields(wt, {}, 's1'));
  const show = path.join(tmp, 'show-usage.js');
  fs.writeFileSync(show, `const u = require(${JSON.stringify(path.join(SCRIPTS, 'usage.js'))});\nprocess.stdout.write(JSON.stringify(u.keelFields(u.projectDir({ project: process.argv[2] }), {}, 's1')));\n`);
  assert.equal(node(show, [main], wt, env).stdout, expected);
});

// Git writes real paths into a worktree's .git file, while the session may name the project through a
// link (macOS names its temp folder /var for /private/var, Windows may give an 8.3 short name).
gitTest('mainOf names the main checkout the way the worktree inside it is named, so git trust holds through a link', () => {
  const { tmp, main, wt } = setup({ git: { ...CONFIG.git, mode: 'autonomous' } });
  const link = path.join(tmp, 'link');
  fs.symlinkSync(main, link, 'junction');
  const { mainOf, worktreeOf } = require(path.join(SCRIPTS, 'lib', 'project-dir.js'));
  const wtByLink = path.join(link, '.claude', 'worktrees', 'wt');
  assert.equal(mainOf(wtByLink).toLowerCase(), link.toLowerCase());
  assert.equal(mainOf(wt).toLowerCase(), main.toLowerCase());
  assert.ok(worktreeOf(link, wtByLink), 'the worktree maps from the linked path');
  const { trust, trustState } = require(path.join(SCRIPTS, 'lib', 'trust.js'));
  const env = { KEEL_USAGE_DIR: path.join(tmp, 'home') };
  trust(link, env);
  assert.equal(trustState(wtByLink, env), 'confirmed', 'one confirmation for the project named through the link');
  fs.rmSync(path.join(wt, '.git'), { force: true });
  write(wt, '.git', `gitdir: ${slash(path.join(link, '.git', 'worktrees', 'wt'))}\n`);
  assert.equal(mainOf(wt).toLowerCase(), main.toLowerCase(), 'a .git file through the link: still the worktree\'s spelling');
});

// The session may name the project one way while a file path (git prints real paths) or the shell's
// folder uses the other.
gitTest('the planning guard and git trust take a folder named through a link and by its real path as one', () => {
  const { tmp, main, wt } = setup({ planning: { ticket_prefix: 'PAY', tickets: 'repo' }, git: { ...CONFIG.git, mode: 'autonomous' } });
  const link = path.join(tmp, 'link');
  fs.symlinkSync(main, link, 'junction');
  const wtByLink = path.join(link, '.claude', 'worktrees', 'wt');
  assert.match(run('plans.js', [main, 'new', 'pay-later'], main, main).stdout, /^created: /m);
  assert.match(run('plans.js', [main, 'mark', 'set', 'pay-later', '--session', 's1'], main, main).stdout, /^planning: pay-later$/m);
  const write = (project, cwd, file) => spawnSync(process.execPath, [path.join(HOOKS, 'planning-guard.js')], { input: JSON.stringify({ cwd, session_id: 's1', tool_name: 'Write', tool_input: { file_path: file, content: 'x' } }), encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN, CLAUDE_PROJECT_DIR: project } }).stdout;
  for (const [project, cwd] of [[link, wtByLink], [main, wtByLink], [link, wt], [main, wt]]) {
    for (const file of [path.join(main, 'src', 'a.js'), path.join(link, 'src', 'a.js'), path.join(wt, 'src', 'a.js'), path.join(wtByLink, 'src', 'a.js')]) {
      assert.match(write(project, cwd, file), /"permissionDecision":"deny"/, `project ${project}, shell in ${cwd}: a write to ${file} is refused`);
    }
  }
  const { trust, trustState } = require(path.join(SCRIPTS, 'lib', 'trust.js'));
  for (const [given, asked] of [[main, wtByLink], [link, wt]]) {
    const env = { KEEL_USAGE_DIR: path.join(tempDir('keel-trust-'), 'home') };
    trust(given, env);
    assert.equal(trustState(asked, env), 'confirmed', `confirmed for ${given}, asked from ${asked}`);
  }
  // An entry keyed by the folder as named, as keel wrote them before, still counts.
  const env = { KEEL_USAGE_DIR: path.join(tempDir('keel-trust-'), 'home') };
  trust(main, env);
  const file = path.join(env.KEEL_USAGE_DIR, 'trusted-git.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  saved.projects[0].path = slash(link).replace(/[A-Z]/g, (c) => (process.platform === 'win32' ? c.toLowerCase() : c));
  fs.writeFileSync(file, JSON.stringify(saved));
  assert.equal(trustState(link, env), 'confirmed');
  assert.equal(trust(link, env), false, 'no second entry');
});

gitTest('mainOf of a worktree outside its main checkout is the main checkout as git names it', () => {
  const { tmp, main } = setup();
  const outside = path.join(tmp, 'outside-wt');
  git(main, 'worktree', 'add', '-q', '-b', 'outside', outside);
  const { mainOf } = require(path.join(SCRIPTS, 'lib', 'project-dir.js'));
  assert.equal(mainOf(outside).toLowerCase(), fs.realpathSync.native(main).toLowerCase());
});

gitTest('restore refuses an item whose recorded root is not a folder of this project', () => {
  const { tmp, main, wt } = setup();
  const other = path.join(tmp, 'other');
  fs.mkdirSync(other);
  git(other, 'init', '-q', '-b', 'main');
  const trash = require(path.join(SCRIPTS, 'lib', 'trash.js'));
  write(wt, 'x.log', 'x\n');
  const { batch } = trash.moveToTrash(wt, ['x.log'], 'cleanup');
  const file = path.join(main, '.keel', 'local', 'trash', batch, 'manifest.json');
  for (const planted of ['.claude/worktrees/wt', other, tmp]) {
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    m.items[0].root = planted;
    fs.writeFileSync(file, JSON.stringify(m));
    const r = trash.restore(main, batch);
    assert.equal(r.restored.length, 0, planted);
    assert.match(r.kept[0].reason, /not a folder of this project/, planted);
    assert.ok(!fs.existsSync(path.join(path.resolve(main, planted), 'x.log')), `nothing written in ${planted}`);
  }
});

gitTest('an item whose worktree is gone stays in the trash, batch and copy kept', () => {
  const { main, wt } = setup();
  const trash = require(path.join(SCRIPTS, 'lib', 'trash.js'));
  write(wt, 'x.log', 'x\n');
  const { batch } = trash.moveToTrash(wt, ['x.log'], 'cleanup');
  git(main, 'worktree', 'remove', '--force', wt);
  const r = trash.restore(main, batch);
  assert.equal(r.restored.length, 0);
  assert.match(r.kept[0].reason, /gone/);
  const dir = path.join(main, '.keel', 'local', 'trash', batch);
  assert.ok(fs.existsSync(path.join(dir, 'files', 'x.log')), 'the copy is kept');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).items.length, 1);
  assert.ok(!fs.existsSync(path.join(main, 'x.log')), 'not put into the main checkout');
});

gitTest('closed-tasks.json and keel\'s project options written from a worktree land in the main checkout', () => {
  const { main, wt } = setup();
  commitTasks(main, ['ABC-3']);
  git(wt, 'merge', '-q', 'main');
  assert.match(run('notes.js', [main, 'task', 'drop', 'ABC-3'], wt, main).stdout, /^dropped: ABC-3$/m);
  assert.ok('ABC-3' in JSON.parse(fs.readFileSync(path.join(main, '.keel', 'local', 'closed-tasks.json'), 'utf8')));
  assert.ok(!fs.existsSync(path.join(wt, '.keel', 'local', 'closed-tasks.json')));
  require(path.join(SCRIPTS, 'lib', 'options.js')).writeProjectOptions(wt, { conversation_language: 'uk' });
  assert.equal(JSON.parse(fs.readFileSync(path.join(main, '.keel', 'local', 'options.json'), 'utf8')).conversation_language, 'uk');
  assert.ok(!fs.existsSync(path.join(wt, '.keel', 'local', 'options.json')));
});

gitTest('cleanup move in a worktree names the batch where it is, in the main checkout', () => {
  const { main, wt } = setup();
  write(wt, 'old.log', 'x\n');
  write(wt, '.keel/local/tmp/cleanup.json', JSON.stringify({ items: [{ n: 1, path: 'old.log', group: 'safe', git: 'untracked', what: 'a log' }], secrets: [] }));
  const out = run('cleanup.js', [main, 'move', '--items', '1'], wt, main).stdout;
  const m = /moved 1 items \([^)]*\) to (.+?)\/?$/m.exec(out);
  assert.ok(m, out);
  assert.ok(fs.existsSync(path.resolve(wt, m[1], 'manifest.json')), `${m[1]} holds the batch`);
});

// In a desktop worktree session Claude Code applies the main checkout's .claude/settings.local.json; the
// copy the app puts into the worktree is ignored (seen in a live session).
gitTest('claude-settings and the context warning use the main checkout\'s .claude/settings.local.json', () => {
  const { tmp, main, wt } = setup();
  const env = { CLAUDE_PROJECT_DIR: main, KEEL_USER_SETTINGS: path.join(tmp, 'user-settings.json'), KEEL_USAGE_DIR: path.join(tmp, 'home') };
  const changes = path.join(tmp, 'changes.json');
  fs.writeFileSync(changes, JSON.stringify({ project: { plansDirectory: './.keel/local/plans/claude' } }));
  const applied = node(path.join(SCRIPTS, 'claude-settings.js'), [main, 'apply', changes], wt, env);
  assert.match(applied.stdout, /^written /m, applied.stdout + applied.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(main, '.claude', 'settings.local.json'), 'utf8')).plansDirectory, './.keel/local/plans/claude');
  assert.ok(!fs.existsSync(path.join(wt, '.claude', 'settings.local.json')), 'nothing in the worktree');

  write(main, '.claude/settings.local.json', JSON.stringify({ autoCompactWindow: 160000 }));
  const transcript = path.join(tmp, 'transcript.jsonl');
  fs.writeFileSync(transcript, `${JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-4-5', usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 149990, output_tokens: 50 } } })}\n`);
  const warned = hookIn('context-warning.js', wt, main, { transcript_path: transcript, session_id: 's1' });
  assert.match(warned, /160k/, 'the 160k window from the main checkout applies');

  // A backup of the main checkout's file stays with it: the worktree is deleted with its conversation.
  const again = node(path.join(SCRIPTS, 'claude-settings.js'), [main, 'apply', changes], wt, env);
  assert.match(again.stdout, /previous file kept as /, again.stdout);
  assert.ok(fs.readdirSync(path.join(main, '.keel', 'local', 'backups')).some((n) => n.startsWith('settings.local.json.keel-backup-')), 'the backup is in the main checkout');
  assert.ok(!fs.existsSync(path.join(wt, '.keel', 'local', 'backups')), 'no backup in the worktree');

  // The API wallet is read from the settings Claude Code applies.
  write(main, '.claude/settings.local.json', JSON.stringify({ apiKeyHelper: '/bin/key' }));
  const { detectWallet } = require(path.join(SCRIPTS, 'lib', 'usage-config.js'));
  assert.equal(detectWallet({ projectDir: wt, env: { CLAUDE_PROJECT_DIR: main, CLAUDE_CONFIG_DIR: path.join(tmp, 'cfg') }, machine: { cloud_wallet: 'subscription' } }), 'api');
});

// Claude Code started inside the worktree itself names the worktree as the project and applies its own
// settings.
gitTest('claude-settings and the context warning use the worktree\'s settings when Claude Code was started in it', () => {
  const { tmp, wt } = setup();
  const env = { CLAUDE_PROJECT_DIR: wt, KEEL_USER_SETTINGS: path.join(tmp, 'user-settings.json'), KEEL_USAGE_DIR: path.join(tmp, 'home') };
  const changes = path.join(tmp, 'changes.json');
  fs.writeFileSync(changes, JSON.stringify({ project: { plansDirectory: './.keel/local/plans/claude' } }));
  const applied = node(path.join(SCRIPTS, 'claude-settings.js'), [wt, 'apply', changes], wt, env);
  assert.match(applied.stdout, /^written /m, applied.stdout + applied.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(wt, '.claude', 'settings.local.json'), 'utf8')).plansDirectory, './.keel/local/plans/claude');
  write(wt, '.claude/settings.local.json', JSON.stringify({ autoCompactWindow: 160000 }));
  const transcript = path.join(tmp, 'transcript.jsonl');
  fs.writeFileSync(transcript, `${JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-4-5', usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 149990, output_tokens: 50 } } })}\n`);
  const warned = hookIn('context-warning.js', wt, wt, { transcript_path: transcript, session_id: 's1' });
  assert.match(warned, /160k/, 'the worktree\'s own window applies');
});

gitTest('a task lock holds across folders while the task file is not committed yet', () => {
  const { main, wt } = setup();
  assert.match(run('notes.js', [main, 'task', 'new', 'ABC-9', '--title', 'Nine', '--source', 'text', '--session', 's1'], main, main).stdout, /^created: /m);
  assert.match(hookIn('skill-gate.js', wt, main, { session_id: 's1', tool_name: 'Skill', tool_input: { skill: 'keel:start-planning' } }), /"permissionDecision":"deny"/, 'main to worktree');
  assert.match(run('notes.js', [main, 'task', 'new', 'ABC-8', '--title', 'Eight', '--source', 'text', '--session', 's2'], wt, main).stdout, /^created: /m);
  assert.match(hookIn('skill-gate.js', main, main, { session_id: 's2', tool_name: 'Skill', tool_input: { skill: 'keel:start-planning' } }), /"permissionDecision":"deny"/, 'worktree to main');
});

gitTest('dropping a task in one worktree keeps the marker of a session that works on it in another', () => {
  const { tmp, main, wt } = setup();
  commitTasks(main, ['ABC-1']);
  git(wt, 'merge', '-q', 'main');
  const wt2 = path.join(tmp, 'wt2');
  git(main, 'worktree', 'add', '-q', '-b', 'wt2', wt2);
  assert.match(run('notes.js', [main, 'task', 'activate', 'ABC-1', '--session', 's1'], wt, main).stdout, /^active task: ABC-1$/m);
  assert.match(run('notes.js', [main, 'task', 'drop', 'ABC-1'], wt2, main).stdout, /^dropped: ABC-1$/m);
  assert.match(run('notes.js', [main, 'check', '--session', 's1'], wt, main).stdout, /^active task: ABC-1$/m);
});

gitTest('a closed-tasks.json that cannot be locked leaves task restore and task new undone', () => {
  const { main } = setup({ tasks: { in_git: false } });
  assert.match(run('notes.js', [main, 'task', 'new', 'LOC-2', '--title', 'Two', '--source', 'text'], main, main).stdout, /^created: /m);
  assert.match(run('notes.js', [main, 'task', 'drop', 'LOC-2'], main, main).stdout, /^dropped: LOC-2$/m);
  // A folder where the lock file goes, made old: taking the lock fails at once.
  const lock = path.join(main, '.keel', 'local', 'closed-tasks.json.lock');
  fs.mkdirSync(path.join(lock, 'x'), { recursive: true });
  const old = new Date(Date.now() - 3600 * 1000);
  fs.utimesSync(lock, old, old);
  const back = run('notes.js', [main, 'task', 'restore', 'LOC-2', '--session', 's1'], main, main);
  assert.match(back.stdout, /refused/, back.stdout + back.stderr);
  assert.ok(!fs.existsSync(path.join(main, '.keel', 'local', 'tasks', 'LOC-2')), 'the folder stays in the trash');
  assert.match(run('notes.js', [main, 'task', 'new', 'LOC-2', '--title', 'Again', '--source', 'text'], main, main).stdout, /refused/);
  assert.ok(!fs.existsSync(path.join(main, '.keel', 'local', 'tasks', 'LOC-2')), 'no new folder either');
  assert.ok('LOC-2' in require(path.join(SCRIPTS, 'lib', 'tasks.js')).readClosed(main), 'still closed');
  fs.rmSync(lock, { recursive: true, force: true });
  assert.match(run('notes.js', [main, 'task', 'restore', 'LOC-2', '--session', 's1'], main, main).stdout, /^restored: /m, 'a retry works');
});

gitTest('a stale closed-tasks.json lock is taken over, and no lock or temp file stays behind', () => {
  const { main } = setup({ tasks: { in_git: false } });
  assert.match(run('notes.js', [main, 'task', 'new', 'LOC-3', '--title', 'Three', '--source', 'text'], main, main).stdout, /^created: /m);
  const lock = path.join(main, '.keel', 'local', 'closed-tasks.json.lock');
  fs.writeFileSync(lock, '');
  const old = new Date(Date.now() - 3600 * 1000);
  fs.utimesSync(lock, old, old);
  assert.match(run('notes.js', [main, 'task', 'drop', 'LOC-3'], main, main).stdout, /^dropped: LOC-3$/m);
  assert.deepEqual(fs.readdirSync(path.join(main, '.keel', 'local')).filter((n) => /closed-tasks\.json\./.test(n)), []);
});

gitTest('cleanup restore with no batch named leaves another folder\'s items of a mixed batch in the trash', () => {
  const { tmp, main, wt } = setup();
  const wt2 = path.join(tmp, 'wt2');
  git(main, 'worktree', 'add', '-q', '-b', 'wt2', wt2);
  const trash = require(path.join(SCRIPTS, 'lib', 'trash.js'));
  write(wt, 'a.log', 'a\n');
  write(main, '.keel/local/backups/old.txt', 'o\n');
  const { batch } = trash.moveToTrash(wt, ['a.log', path.relative(wt, path.join(main, '.keel', 'local', 'backups', 'old.txt'))], 'cleanup');
  assert.ok(batch);
  const r = trash.restore(wt2);
  assert.deepEqual(r.restored.map((i) => i.path), ['.keel/local/backups/old.txt']);
  assert.ok(!fs.existsSync(path.join(wt, 'a.log')), 'the other worktree\'s file stays in the trash');
});

gitTest('mainOf through a link to the main .git folder still names the main checkout', () => {
  const { tmp, main, wt } = setup();
  const alias = path.join(tmp, 'alias');
  fs.symlinkSync(path.join(main, '.git'), alias, 'junction');
  fs.rmSync(path.join(wt, '.git'), { force: true });
  write(wt, '.git', `gitdir: ${slash(path.join(alias, 'worktrees', 'wt'))}\n`);
  const { mainOf } = require(path.join(SCRIPTS, 'lib', 'project-dir.js'));
  assert.equal(fs.realpathSync.native(mainOf(wt)).toLowerCase(), fs.realpathSync.native(main).toLowerCase());
});
