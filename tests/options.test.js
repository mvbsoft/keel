'use strict';
// Settings with a machine value and an optional project value: the project value wins, and removing
// it brings the machine value back.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tempDir } = require('./fixtures/tmp.js');

const PLUGIN = path.join(__dirname, '..', 'plugins', 'keel');
const options = require(path.join(PLUGIN, 'scripts', 'lib', 'options.js'));
const settings = require(path.join(PLUGIN, 'scripts', 'claude-settings.js'));

const tmp = tempDir;
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

function withUserFile(content, fn) {
  const dir = tmp('keel-opt-user-');
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, JSON.stringify(content));
  const before = process.env.KEEL_USER_SETTINGS;
  process.env.KEEL_USER_SETTINGS = file;
  try { return fn(file, dir); } finally { if (before === undefined) delete process.env.KEEL_USER_SETTINGS; else process.env.KEEL_USER_SETTINGS = before; }
}

test('effective options: the project value wins over the plugin option; invalid project values are ignored', () => {
  const root = tmp('keel-opt-');
  const env = { CLAUDE_PLUGIN_OPTION_CONVERSATION_LANGUAGE: 'uk', CLAUDE_PLUGIN_OPTION_ALLOW_OPUS: 'true' };
  assert.deepEqual(options.effectiveOptions(root, env), { conversation_language: 'uk', conversation_language_from: 'machine', allow_opus: true, allow_opus_from: 'machine' });
  options.writeProjectOptions(root, { conversation_language: 'en', allow_opus: false });
  assert.deepEqual(options.effectiveOptions(root, env), { conversation_language: 'en', conversation_language_from: 'project', allow_opus: false, allow_opus_from: 'project' });
  options.writeProjectOptions(root, { allow_opus: null });
  assert.equal(options.effectiveOptions(root, env).allow_opus_from, 'machine');
  fs.writeFileSync(options.optionsFile(root), JSON.stringify({ conversation_language: '../../x', allow_opus: 'no' }));
  assert.deepEqual(options.projectOptions(root), {});
  assert.throws(() => options.writeProjectOptions(root, { model: 'opus' }), /does not write these project options \(unknown key or bad value\): model/);
});

test('claude-settings apply: a project value goes to the project, keel options to .keel/local, null removes it', () => {
  withUserFile({ autoCompactWindow: 300000 }, (file, dir) => {
    const root = tmp('keel-opt-proj-');
    const changes = path.join(dir, 'changes.json');
    fs.writeFileSync(changes, JSON.stringify({ project: { autoCompactWindow: 500000, conversation_language: 'de', prompt_preview: false } }));
    settings.apply(root, changes);
    assert.equal(readJson(file).autoCompactWindow, 300000, 'the machine value is untouched');
    assert.equal(readJson(path.join(root, '.claude', 'settings.local.json')).autoCompactWindow, 500000);
    assert.deepEqual(readJson(options.optionsFile(root)), { conversation_language: 'de', prompt_preview: false });
    const row = (scope, key) => settings.show(root).rows.find((r) => r.scope === scope && r.key === key);
    assert.deepEqual([row('project', 'autoCompactWindow').now, row('project', 'autoCompactWindow').applies], [500000, 'project']);
    assert.match(settings.report(settings.show(root)), /- project autoCompactWindow \[machine or project\]: 500000 \(wins over the machine value\)/);

    fs.writeFileSync(changes, JSON.stringify({ project: { autoCompactWindow: null, conversation_language: null } }));
    settings.apply(root, changes);
    assert.equal(readJson(path.join(root, '.claude', 'settings.local.json')).autoCompactWindow, undefined);
    assert.deepEqual(readJson(options.optionsFile(root)), { prompt_preview: false });
    assert.match(settings.report(settings.show(root)), /- project autoCompactWindow \[machine or project\]: not set \(the machine value applies: 300000\)/);

    fs.writeFileSync(changes, JSON.stringify({ user: { autoCompactWindow: null } }));
    assert.throws(() => settings.apply(root, changes), /a machine value is changed, not removed/);
    fs.writeFileSync(changes, JSON.stringify({ project: { statusLine: { type: 'command', command: 'x' } } }));
    assert.throws(() => settings.apply(root, changes), /does not write these settings: project\.statusLine/, 'the status line is the machine\'s only');
  });
});

test('hooks use the project\'s own language and Opus choice', () => {
  const root = tmp('keel-opt-hook-');
  options.writeProjectOptions(root, { conversation_language: 'de', allow_opus: false });
  fs.writeFileSync(path.join(root, '.keel', 'config.json'), '{}');
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE_')));
  const env = { ...clean, CLAUDE_PLUGIN_ROOT: PLUGIN, CLAUDE_PROJECT_DIR: root, CLAUDE_PLUGIN_OPTION_CONVERSATION_LANGUAGE: 'uk', CLAUDE_PLUGIN_OPTION_ALLOW_OPUS: 'true' };
  const run = (hook, input) => spawnSync(process.execPath, [path.join(PLUGIN, 'hooks', hook)], { input: JSON.stringify(input), env, encoding: 'utf8' }).stdout;
  assert.match(JSON.parse(run('session-start.js', { source: 'startup' })).hookSpecificOutput.additionalContext, /in this language: German \(de\)\./);
  const agent = JSON.parse(run('agent-model.js', { tool_name: 'Agent', tool_input: { subagent_type: 'keel:verifier', model: 'opus', prompt: 'x' } }));
  assert.equal(agent.hookSpecificOutput.updatedInput.model, 'sonnet');
});
