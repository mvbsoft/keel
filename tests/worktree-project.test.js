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
  const scripts = ['changes.js', 'check-config.js', 'claude-settings.js', 'cleanup.js', 'comments.js', 'config-check.js', 'feature-page.js', 'fingerprint.js', 'git-flow.js', 'ledger-report.js', 'migrate.js', 'notes.js', 'plan-steps.js', 'plans.js', 'safe-command.js', 'scan.js', 'stack-skills.js', 'votes.js'];
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
