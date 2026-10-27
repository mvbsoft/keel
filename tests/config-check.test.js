'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { scan } = require('../plugins/keel/scripts/scan.js');
const { tempDir } = require('./fixtures/tmp.js');

const PLUGIN = path.join(__dirname, '..', 'plugins', 'keel');
const SCRIPT = path.join(PLUGIN, 'scripts', 'config-check.js');
const CHECK_CONFIG = path.join(PLUGIN, 'scripts', 'check-config.js');
const tmp = tempDir;
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const CONFIG = {
  schema_version: 1,
  repo_language: 'en',
  gates: { checks: [{ part: '.', kind: 'test', command: 'npm test' }, { part: '.', kind: 'lint', command: 'npm run lint' }], security_scanners: [] },
  git: { mode: 'manual', main_branch: 'main', ask_before_merge: true, state_in_git: true },
  verification: {
    tier_rules: { gates_only_max_files: 1, basic_max_modules: 1, large_change_lines: 400, very_large_change_lines: 1000 },
    verifier_caps: { basic: 3, standard: 5, maximum: 8 },
  },
  architecture: { file_lines_warn: 700, file_lines_max: 1000 },
  docs: { profile: 1, pattern: 'none' },
};
const GIT_ENV = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x.y', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x.y' };
const git = (dir, ...args) => {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
const pkg = (dir, change) => {
  const file = path.join(dir, 'package.json');
  const p = JSON.parse(fs.readFileSync(file, 'utf8'));
  change(p);
  fs.writeFileSync(file, JSON.stringify(p, null, 2));
};

// A configured npm project in git, with usage settings on this "machine" unless usage: false.
function project({ usage = true } = {}) {
  const dir = tmp('keel-cc-');
  write(path.join(dir, 'package.json'), JSON.stringify({ name: 'shop', private: true, scripts: { test: 'node --test', lint: 'node --check a.js' } }, null, 2));
  write(path.join(dir, 'a.js'), 'module.exports = 1;\n');
  write(path.join(dir, 'CLAUDE.md'), '# Rules\n');
  write(path.join(dir, '.keel', 'config.json'), JSON.stringify(CONFIG));
  write(path.join(dir, '.keel', 'profile.json'), JSON.stringify(scan(dir).profile));
  write(path.join(dir, '.gitignore'), '.keel/local/\n');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'set up keel');
  const usageDir = tmp('keel-cc-usage-');
  if (usage) write(path.join(usageDir, 'usage.json'), JSON.stringify({ pc: 'pc', wallet_default: 'subscription' }));
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE_'))), KEEL_USAGE_DIR: usageDir };
  const run = (script, ...args) => {
    const r = spawnSync(process.execPath, [script, dir, ...args], { encoding: 'utf8', env });
    assert.equal(r.status, 0, 'always exits 0');
    return r.stdout.trim().split('\n');
  };
  return {
    dir,
    check: () => run(SCRIPT),
    save: (...args) => run(SCRIPT, 'save', ...args),
    profile: () => run(CHECK_CONFIG, '--profile').find((l) => l.startsWith('profile: ')),
    commit: (msg = 'work') => { git(dir, 'add', '-A'); git(dir, 'commit', '-qm', msg); },
  };
}
const block = (lines) => lines.slice(lines.findIndex((l) => l.startsWith('config-check: ')));

test('no configure record on this machine: rebuilt from the commit of the settings files, in a worktree that is removed again', () => {
  const p = project();
  pkg(p.dir, (x) => { x.scripts['test:e2e'] = 'node --test e2e'; });
  p.commit('e2e');
  const lines = p.check();
  assert.equal(lines[1], 'profile: stale (the project changed since the last configure; /keel:configure check says what to update)');
  assert.match(lines[2], /^config-check: compared with the last configure on \d{4}-\d{2}-\d{2}, 1 commit since \(rebuilt from its commit: no configure record on this machine\)$/);
  assert.ok(lines.includes('- gates [needed]: new command in the project: npm run test:e2e | keel does not run it before a task is finished'), 'the full check runs: the new command is found');
  const snap = JSON.parse(fs.readFileSync(path.join(p.dir, '.keel', 'local', 'configure-snapshot.json'), 'utf8'));
  assert.equal(snap.rebuilt, true);
  assert.equal(git(p.dir, 'worktree', 'list').split('\n').length, 1, 'the temporary worktree is gone');
});

test('settings never committed: compared with the profile, and the checks that need a record are named', () => {
  const dir = tmp('keel-cc-new-');
  write(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'node --test' } }));
  write(path.join(dir, '.keel', 'config.json'), JSON.stringify(CONFIG));
  write(path.join(dir, '.keel', 'profile.json'), JSON.stringify(scan(dir).profile));
  git(dir, 'init', '-q', '-b', 'main');
  const r = spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8', env: { ...process.env, KEEL_USAGE_DIR: dir } });
  const lines = block(r.stdout.trim().split('\n'));
  assert.equal(lines[0], 'config-check: compared with .keel/profile.json (no configure record on this machine)');
  assert.match(lines.at(-1), /^not checked without a configure record on this machine: review paths, new test, lint and type commands, ticket ids, new stack plugins/);
});

test('a project keel is not set up in gets only the setup check', () => {
  const dir = tmp('keel-cc-bare-');
  write(path.join(dir, 'package.json'), '{"name":"x"}');
  const r = spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' });
  assert.match(r.stdout, /^keel-config: missing\n/);
  assert.doesNotMatch(r.stdout, /config-check:/);
});

test('save records the project; nothing changed, or only a dependency version, needs nothing and the profile is not stale', () => {
  const p = project();
  assert.deepEqual(p.save().slice(0, 2), ['keel-config: ok', 'profile: ok']);
  assert.ok(fs.existsSync(path.join(p.dir, '.keel', 'local', 'configure-snapshot.json')));
  assert.deepEqual(block(p.check()).slice(1), ['result: nothing to reconfigure']);
  pkg(p.dir, (x) => { x.dependencies = { 'left-pad': '1.3.0' }; });
  p.commit('bump');
  assert.equal(p.profile(), 'profile: ok', 'the fingerprint moved, the structure did not');
  assert.deepEqual(block(p.check()), [`config-check: compared with the last configure on ${new Date().toISOString().slice(0, 10)}, 1 commit since`, 'result: nothing to reconfigure']);
});

test('a new test command and a gate whose script is gone: gates needed, the command runs only that section, the profile is stale', () => {
  const p = project();
  p.save();
  pkg(p.dir, (x) => { x.scripts['test:e2e'] = 'node --test e2e'; delete x.scripts.lint; });
  assert.match(p.profile(), /^profile: stale \(the project changed since the last configure; \/keel:configure check says what to update\)$/);
  assert.deepEqual(block(p.check()).slice(1), [
    'result: needed gates; worth a look none',
    '- gates [needed]: new command in the project: npm run test:e2e | keel does not run it before a task is finished',
    '- gates [needed]: gate "npm run lint": the script or task behind it is gone | the gate may fail or run nothing',
    'run: /keel:configure gates',
  ]);
});

test('a new workspace part: scan and gates needed, in section order', () => {
  const p = project();
  p.save();
  pkg(p.dir, (x) => { x.workspaces = ['apps/*']; });
  write(path.join(p.dir, 'apps', 'admin', 'package.json'), JSON.stringify({ name: 'admin', scripts: { test: 'node --test' } }));
  const lines = block(p.check());
  assert.equal(lines[1], 'result: needed scan, gates; worth a look none');
  assert.ok(lines.some((l) => /^- scan \[needed\]: new part apps\/admin \(npm/.test(l)), lines.join('\n'));
  assert.ok(lines.some((l) => /^- gates \[needed\]: new part apps\/admin has no gates; found: npm test/.test(l)), lines.join('\n'));
  assert.equal(lines.at(-1), 'run: /keel:configure scan,gates');
});

test('the main branch is gone: git needed, naming the remote\'s default branch', () => {
  const p = project();
  p.save();
  const remote = tmp('keel-cc-remote-');
  git(remote, 'init', '-q', '--bare');
  git(p.dir, 'branch', '-m', 'main', 'trunk');
  git(p.dir, 'remote', 'add', 'origin', remote);
  git(p.dir, 'push', '-q', 'origin', 'trunk');
  git(p.dir, 'remote', 'set-head', 'origin', 'trunk');
  const lines = block(p.check());
  assert.ok(lines.includes('- git [needed]: main branch "main" is not in the repository; the remote\'s default branch is "trunk" | keel starts each task from it and merges the work back into it'), lines.join('\n'));
  assert.equal(lines.at(-1), 'run: /keel:configure git');
});

test('worth a look: ticket ids, a checked plugin, a grown CLAUDE.md, another notes system, a new setting, no usage settings', () => {
  const p = project({ usage: false });
  p.save('--sections', 'scan,gates,code,plugins,docs,migration,settings');
  const file = path.join(p.dir, '.keel', 'local', 'configure-snapshot.json');
  const snap = JSON.parse(fs.readFileSync(file, 'utf8'));
  snap.sections.settings.keys = snap.sections.settings.keys.filter((k) => k !== 'plansDirectory');
  fs.writeFileSync(file, JSON.stringify(snap));
  pkg(p.dir, (x) => { x.dependencies = { '@prisma/client': '5.0.0' }; });
  write(path.join(p.dir, 'CLAUDE.md'), Array.from({ length: 250 }, (_, i) => `rule ${i}`).join('\n'));
  write(path.join(p.dir, '.ai', 'handoff.md'), '# where we stopped\n');
  p.commit('SHOP-1 cart');
  write(path.join(p.dir, 'a.js'), 'module.exports = 2;\n');
  p.commit('SHOP-2 totals');
  const lines = block(p.check());
  assert.equal(lines[1], 'result: needed none; worth a look code, plugins, docs, migration, settings, usage');
  assert.deepEqual(lines.slice(2, -1).map((l) => l.split(' | ')[0]), [
    '- code [worth]: ticket ids in the git history: SHOP (2 ids)',
    "- plugins [worth]: keel's checked list has plugins for what the project uses now: prisma@claude-plugins-official",
    '- docs [worth]: CLAUDE.md has 250 lines (1 at the last configure)',
    '- migration [worth]: another notes or memory system: .ai',
    `- settings [worth]: keel ${require('../plugins/keel/.claude-plugin/plugin.json').version} recommends settings your last configure did not have: plansDirectory`,
    '- usage [worth]: this machine has no usage settings',
  ]);
  assert.equal(lines.at(-1), 'run: /keel:configure code,plugins,docs,migration,settings,usage');
});

test('a recommended value that changed is worth a look once: a record from an older keel counts as its old value', () => {
  const p = project();
  p.save();
  const file = path.join(p.dir, '.keel', 'local', 'configure-snapshot.json');
  const snap = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(snap.sections.settings.recommended.plansDirectory, './.keel/local/plans/claude');
  assert.deepEqual(block(p.check()).slice(1, 2), ['result: nothing to reconfigure']);
  delete snap.sections.settings.recommended;
  fs.writeFileSync(file, JSON.stringify(snap));
  const lines = block(p.check());
  assert.equal(lines[1], 'result: needed none; worth a look settings');
  assert.equal(lines[2].split(' | ')[0], `- settings [worth]: keel ${require('../plugins/keel/.claude-plugin/plugin.json').version} recommends new values: plansDirectory "./.keel/local/plans/claude" (was "./.keel/local/plans")`);
  p.save('--sections', 'settings');
  assert.deepEqual(block(p.check()).slice(1, 2), ['result: nothing to reconfigure'], 'the next configure records the new value, whatever the user chose');
});

test('a run of some sections records only those: the reason of a section that did not run stays', () => {
  const p = project();
  p.save();
  pkg(p.dir, (x) => { x.workspaces = ['apps/*']; });
  write(path.join(p.dir, 'apps', 'admin', 'package.json'), JSON.stringify({ name: 'admin', scripts: { test: 'node --test' } }));
  pkg(p.dir, (x) => { x.scripts['test:e2e'] = 'node --test e2e'; });
  assert.equal(block(p.check())[1], 'result: needed scan, gates; worth a look none');
  p.save('--sections', '3');
  const lines = block(p.check());
  assert.equal(lines[1], 'result: needed scan, gates; worth a look none', 'gates ran, but the new part is still unknown to the profile and has no gates');
  assert.ok(!lines.some((l) => l.includes('test:e2e')), 'the command gates saw is no longer new');
});

test('quick setup skips plugins: a plugin for what was already there is still worth a look', () => {
  const p = project();
  pkg(p.dir, (x) => { x.dependencies = { '@prisma/client': '5.0.0' }; });
  p.commit('prisma');
  p.save('--sections', '1,2,3,4,5,6,8,9,10,11');
  assert.ok(block(p.check()).some((l) => l.startsWith("- plugins [worth]: keel's checked list has plugins for what the project uses now: prisma@claude-plugins-official")));
});

test('a teammate\'s later configure: what the committed profile already lists is not new here', () => {
  const p = project();
  p.save();
  pkg(p.dir, (x) => { x.workspaces = ['apps/*']; });
  write(path.join(p.dir, 'apps', 'admin', 'package.json'), JSON.stringify({ name: 'admin', scripts: { test: 'node --test' } }));
  write(path.join(p.dir, 'AGENTS.md'), '# Rules\n');
  const config = { ...CONFIG, gates: { ...CONFIG.gates, checks: [...CONFIG.gates.checks, { part: 'apps/admin', kind: 'test', command: 'npm test' }] } };
  write(path.join(p.dir, '.keel', 'config.json'), JSON.stringify(config));
  write(path.join(p.dir, '.keel', 'profile.json'), JSON.stringify(scan(p.dir).profile));
  p.commit('teammate: reconfigure keel');
  const lines = block(p.check());
  assert.equal(lines[1], 'result: nothing to reconfigure', lines.join('\n'));
});

test('a part the user added by hand in the profile is not reported as gone', () => {
  const p = project();
  const file = path.join(p.dir, '.keel', 'profile.json');
  const profile = JSON.parse(fs.readFileSync(file, 'utf8'));
  write(path.join(p.dir, 'tools', 'site', 'build.sh'), 'echo build\n');
  profile.parts.push({ path: 'tools/site', ecosystems: [], commands: {}, run_command: null });
  write(file, JSON.stringify(profile));
  p.commit('add a part by hand');
  assert.equal(block(p.check())[1], 'result: nothing to reconfigure');
});

test('a damaged record never breaks the setup check of other commands', () => {
  const p = project();
  write(path.join(p.dir, '.keel', 'local', 'configure-snapshot.json'), JSON.stringify({ schema: 2, sections: { scan: {} } }));
  pkg(p.dir, (x) => { x.dependencies = { 'left-pad': '1.3.0' }; });
  assert.match(p.profile(), /^profile: (ok|stale)/);
  assert.equal(p.check()[0], 'keel-config: ok');
});

test('configure: check answers from the injected block without the flow; sections by comma; step 12 saves the record', () => {
  const skill = fs.readFileSync(path.join(PLUGIN, 'skills', 'configure', 'SKILL.md'), 'utf8');
  assert.match(skill, /^argument-hint: "\[check \| section\[,section\.\.\.\] \| machine\]"$/m);
  assert.match(skill, /\*\*The first word of the arguments is `check`\*\* → only answer from the output above; do not read the\s+configure flow, run nothing, write nothing/);
  assert.ok(skill.indexOf('is `check`') < skill.indexOf('configure-flow.md'), 'check is decided before the flow is read');
  const flow = fs.readFileSync(path.join(PLUGIN, 'skills', '_shared', 'configure-flow.md'), 'utf8');
  assert.match(flow, /separated by commas or spaces, such as `gates,git` or `3,4`\) runs only those, in section order/);
  assert.match(flow, /then section 12 once for what they changed/);
  assert.match(flow, /3\. Run `node "<keel>\/scripts\/config-check\.js" "<project>" save`/);
  assert.match(flow, /add\s+`--sections "<those that did>"`, comma-separated in quotes: a run of chosen sections → those; quick\s+setup → `"1,2,3,4,5,6,8,9,10,11"`/);
  assert.doesNotMatch(flow, /check-config\.js/, 'step 12 checks through config-check.js');
  const preflight = fs.readFileSync(path.join(PLUGIN, 'skills', '_shared', 'preflight.md'), 'utf8');
  assert.match(preflight, /`stale`, say in one line that\s+the project changed since the last configure and that `\/keel:configure check` says/);
});
