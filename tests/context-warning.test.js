'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOKS = path.join(__dirname, '..', 'plugins', 'keel', 'hooks');

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-ctx-'));
  const project = path.join(dir, 'project');
  fs.mkdirSync(path.join(project, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(project, '.keel'));
  fs.writeFileSync(path.join(project, '.keel', 'config.json'), '{}'); // the hook warns only where keel is set up
  return { dir, project, userSettings: path.join(dir, 'user-settings.json'), transcript: path.join(dir, 'transcript.jsonl') };
}

const assistant = (used, extra = {}) => JSON.stringify({
  type: 'assistant',
  message: { model: 'claude-sonnet-4-5', usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: used - 10, output_tokens: 50 } },
  ...extra,
});
const writeTranscript = (box, ...lines) => fs.writeFileSync(box.transcript, `${lines.join('\n')}\n`);

function run(box, env = {}, input = {}) {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE_')));
  const r = spawnSync(process.execPath, [path.join(HOOKS, 'context-warning.js')], {
    input: JSON.stringify({ transcript_path: box.transcript, cwd: box.project, ...input }),
    env: { ...clean, KEEL_USER_SETTINGS: box.userSettings, ...env },
    encoding: 'utf8',
  });
  return { code: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, raw: r.stdout };
}

test('context-warning: registered under UserPromptSubmit in exec form with a 5 s timeout', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(HOOKS, 'hooks.json'), 'utf8')).hooks;
  const [hook] = cfg.UserPromptSubmit[0].hooks;
  assert.equal(hook.command, 'node');
  assert.deepEqual(hook.args, ['${CLAUDE_PLUGIN_ROOT}/hooks/context-warning.js']);
  assert.equal(hook.timeout, 5);
});

test('context-warning: silent below 90 % of the threshold', () => {
  const box = sandbox();
  writeTranscript(box, assistant(170000));
  const r = run(box);
  assert.equal(r.code, 0);
  assert.equal(r.raw, '');
});

test('context-warning: at 90 % warns the user and the model, counting all three input token kinds', () => {
  const box = sandbox();
  writeTranscript(box, JSON.stringify({
    type: 'assistant',
    message: { model: 'claude-sonnet-4-5', usage: { input_tokens: 1000, cache_creation_input_tokens: 79000, cache_read_input_tokens: 100000, output_tokens: 9999 } },
  }));
  const r = run(box);
  assert.equal(r.code, 0);
  assert.match(r.out.systemMessage, /180k of 200k tokens \(90%\)/);
  assert.match(r.out.systemMessage, /\/compact/);
  assert.equal(r.out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.ok(r.out.hookSpecificOutput.additionalContext.includes(r.out.systemMessage));
  assert.match(r.out.hookSpecificOutput.additionalContext, /Start your reply with this one line/);
});

test('context-warning: the latest response counts, not the largest earlier one', () => {
  const box = sandbox();
  writeTranscript(box, assistant(190000), assistant(30000));
  assert.equal(run(box).raw, '');
});

test('context-warning: subagent entries and entries without usage are skipped', () => {
  const box = sandbox();
  writeTranscript(box, assistant(30000), assistant(199000, { isSidechain: true }), JSON.stringify({ type: 'user', message: { content: 'hi' } }));
  assert.equal(run(box).raw, '');
});

test('context-warning: a session that once passed 200k is taken as a 1M one (threshold 967k)', () => {
  const box = sandbox();
  writeTranscript(box, assistant(500000), assistant(850000));
  assert.equal(run(box).raw, '');
  writeTranscript(box, assistant(500000), assistant(880000));
  assert.match(run(box).out.systemMessage, /880k of 967k tokens \(91%\)/);
});

test('context-warning: a model id ending in [1m] uses the 1M threshold', () => {
  const box = sandbox();
  writeTranscript(box, JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-4-7[1m]', usage: { input_tokens: 190000 } } }));
  assert.equal(run(box).raw, '');
});

test('context-warning: a current model without [1m] is taken as 1M; a 4.x or Haiku model as 200k', () => {
  const box = sandbox();
  writeTranscript(box, JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5-5', usage: { input_tokens: 190000 } } }));
  assert.equal(run(box).raw, '');
  writeTranscript(box, JSON.stringify({ type: 'assistant', message: { model: 'claude-haiku-5-5', usage: { input_tokens: 190000 } } }));
  assert.match(run(box).out.systemMessage, /190k of 200k tokens/);
});

test('context-warning: CLAUDE_CODE_AUTO_COMPACT_WINDOW wins over the settings files', () => {
  const box = sandbox();
  fs.writeFileSync(box.userSettings, JSON.stringify({ autoCompactWindow: 900000 }));
  writeTranscript(box, assistant(95000));
  assert.equal(run(box).raw, '');
  const r = run(box, { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '100000' });
  assert.match(r.out.systemMessage, /95k of 100k tokens \(95%\)/);
});

test('context-warning: a custom window is clamped like Claude Code does: at least 100k, at most the model window', () => {
  const box = sandbox();
  writeTranscript(box, assistant(95000));
  assert.match(run(box, { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '50000' }).out.systemMessage, /95k of 100k tokens/, 'below 100k counts as 100k');
  writeTranscript(box, assistant(190000));
  assert.match(run(box, { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '1000000' }).out.systemMessage, /190k of 200k tokens/, 'a 200k model compacts at its own window');
});

test('context-warning: autoCompactWindow from the user settings', () => {
  const box = sandbox();
  fs.writeFileSync(box.userSettings, JSON.stringify({ autoCompactWindow: 300000 }));
  writeTranscript(box, assistant(280000));
  assert.match(run(box).out.systemMessage, /280k of 300k tokens \(93%\)/);
});

test('context-warning: project settings win over user settings, local over shared', () => {
  const box = sandbox();
  fs.writeFileSync(box.userSettings, JSON.stringify({ autoCompactWindow: 300000 }));
  writeTranscript(box, assistant(280000));
  fs.writeFileSync(path.join(box.project, '.claude', 'settings.json'), JSON.stringify({ autoCompactWindow: 600000 }));
  assert.equal(run(box).raw, '');
  fs.writeFileSync(path.join(box.project, '.claude', 'settings.local.json'), JSON.stringify({ autoCompactWindow: 290000 }));
  assert.match(run(box).out.systemMessage, /280k of 290k tokens/);
});

test('context-warning: a per-model value wins over the top-level key; "auto" and bad values fall back', () => {
  const box = sandbox();
  writeTranscript(box, assistant(190000));
  fs.writeFileSync(box.userSettings, JSON.stringify({ autoCompactWindow: 900000, modelSettings: { 'claude-sonnet-4-5': { autoCompactWindow: 200000 } } }));
  assert.match(run(box).out.systemMessage, /190k of 200k tokens/);
  fs.writeFileSync(box.userSettings, JSON.stringify({ autoCompactWindow: 'auto' }));
  assert.match(run(box).out.systemMessage, /190k of 200k tokens/);
  fs.writeFileSync(box.userSettings, JSON.stringify({ autoCompactWindow: 50 }));
  assert.match(run(box).out.systemMessage, /190k of 200k tokens/);
  fs.writeFileSync(path.join(box.project, '.claude', 'settings.json'), JSON.stringify({ autoCompactWindow: 'auto' }));
  fs.writeFileSync(box.userSettings, JSON.stringify({ autoCompactWindow: 900000 }));
  assert.match(run(box).out.systemMessage, /190k of 200k tokens/);
});

test('context-warning: only the tail of a large transcript is read', () => {
  const box = sandbox();
  const filler = JSON.stringify({ type: 'user', message: { content: 'x'.repeat(1000) } });
  const lines = [assistant(190000), ...Array(700).fill(filler), assistant(195000)];
  writeTranscript(box, ...lines);
  assert.ok(fs.statSync(box.transcript).size > 512 * 1024);
  assert.match(run(box).out.systemMessage, /195k of 200k tokens/);
});

test('context-warning: a missing, empty or garbled transcript is a silent exit 0', () => {
  const box = sandbox();
  assert.deepEqual([run(box).code, run(box).raw], [0, '']);
  fs.writeFileSync(box.transcript, '');
  assert.deepEqual([run(box).code, run(box).raw], [0, '']);
  fs.writeFileSync(box.transcript, '{not json\n\u0000\u0001garbage\n{"type":"assistant","message":');
  assert.deepEqual([run(box).code, run(box).raw], [0, '']);
  assert.deepEqual([run(box, {}, { transcript_path: undefined }).code, run(box, {}, { transcript_path: undefined }).raw], [0, '']);
});

test('context-warning: garbled stdin and garbled settings are a silent exit 0 / ignored', () => {
  const box = sandbox();
  const r = spawnSync(process.execPath, [path.join(HOOKS, 'context-warning.js')], { input: 'nope', encoding: 'utf8' });
  assert.deepEqual([r.status, r.stdout], [0, '']);
  fs.writeFileSync(box.userSettings, '{broken');
  writeTranscript(box, assistant(190000));
  assert.match(run(box).out.systemMessage, /190k of 200k tokens/);
});

test('context-warning: Ukrainian text for uk, English otherwise', () => {
  const box = sandbox();
  writeTranscript(box, assistant(190000));
  const uk = run(box, { CLAUDE_PLUGIN_OPTION_CONVERSATION_LANGUAGE: 'uk' });
  assert.match(uk.out.systemMessage, /контекст 190k із 200k токенів \(95%\)/);
  assert.match(uk.out.systemMessage, /\/compact/);
  assert.match(uk.out.hookSpecificOutput.additionalContext, /контекст 190k/);
  for (const language of ['en', 'de', '']) {
    assert.match(run(box, { CLAUDE_PLUGIN_OPTION_CONVERSATION_LANGUAGE: language }).out.systemMessage, /context is 190k of 200k tokens/);
  }
});

const boundary = () => JSON.stringify({ type: 'system', subtype: 'compact_boundary', compactMetadata: { trigger: 'manual' } });
const summary = () => JSON.stringify({ type: 'user', isCompactSummary: true, message: { content: 'Summary of the conversation' } });

test('context-warning: after /compact the old rows do not count; nothing after the boundary is silent', () => {
  const box = sandbox();
  writeTranscript(box, assistant(195000), boundary(), summary());
  assert.equal(run(box).raw, '', 'nothing follows the boundary yet');
  writeTranscript(box, assistant(195000), boundary(), summary(), assistant(30000));
  assert.equal(run(box).raw, '', 'the new, small context counts');
  writeTranscript(box, assistant(195000), boundary(), summary(), assistant(30000), assistant(190000));
  assert.match(run(box).out.systemMessage, /190k of 200k tokens/, 'growth after the boundary still warns');
});

test('context-warning: the peak before a compact does not make the session a 1M one', () => {
  const box = sandbox();
  writeTranscript(box, assistant(500000), boundary(), summary(), assistant(190000));
  assert.match(run(box).out.systemMessage, /190k of 200k tokens/);
});

test('context-warning: Opus and Sonnet 4.6+ without [1m] are 1M models; 4.0-4.5 (also dated) and Haiku stay 200k', () => {
  const box = sandbox();
  const at = (model) => {
    writeTranscript(box, JSON.stringify({ type: 'assistant', message: { model, usage: { input_tokens: 190000 } } }));
    return run(box).raw;
  };
  for (const model of ['claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-4-6']) assert.equal(at(model), '', model);
  for (const model of ['claude-opus-4-5', 'claude-opus-4-1-20250805', 'claude-sonnet-4-20250514', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5']) {
    assert.match(at(model), /190k of 200k tokens/, model);
  }
});
