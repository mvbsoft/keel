'use strict';
// Writes history.jsonl of the cases tagged start-planning: the conversation in which the person typed
// /keel:start-planning, as Claude Code records it (the command, then its expanded text), and keel's
// reply so far. keel refuses /keel:start-planning in every eval run, so these cases resume it instead.
// Run after a change to start-planning/SKILL.md: node plugins/keel/evals/_fixtures/start-planning-history.js
const fs = require('node:fs');
const path = require('node:path');

const KEEL = path.join(__dirname, '..', '..');
// The chat shop.js marks as planning (its SID).
const SID = '11111111-2222-4333-8444-555555555555';
// Where the Docker command in CONTRIBUTING mounts the repository: the eval run loads keel from there.
const PLUGIN_ROOT = '/work/plugins/keel';
const ARGS = 'develop a notification system';

// SKILL.md as Claude Code expands it: front matter dropped, placeholders filled, the `!` line run.
function expanded() {
  const skill = fs.readFileSync(path.join(KEEL, 'skills', 'start-planning', 'SKILL.md'), 'utf8').replace(/^---\n[\s\S]*?\n---\n\n?/, '');
  return `Base directory for this skill: ${PLUGIN_ROOT}/skills/start-planning\n\n` + skill
    .replaceAll('${CLAUDE_PLUGIN_ROOT}', PLUGIN_ROOT)
    .replaceAll('${CLAUDE_PROJECT_DIR}', '.')
    .replaceAll('${CLAUDE_SESSION_ID}', SID)
    .replaceAll('${user_config.conversation_language}', 'English')
    .replaceAll('$ARGUMENTS', ARGS)
    .replace(/^!`node .*check-config\.js.*`$/m, 'keel-config: ok\nprofile: ok');
}

function conversation(turns) {
  let parent = null;
  return turns.map(([type, content, extra], i) => {
    const uuid = `bbbbbbbb-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
    const message = type === 'user' ? { role: 'user', content }
      : { id: `msg_${i + 1}`, type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: content }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } };
    const record = { type, message, ...extra, uuid, parentUuid: parent, sessionId: SID, cwd: '/tmp/work', timestamp: new Date(Date.parse('2026-11-02T10:00:00.000Z') + i * 5000).toISOString(), version: '2.1.299', isSidechain: false, userType: 'external' };
    parent = uuid;
    return JSON.stringify(record);
  }).join('\n') + '\n';
}

const START = () => [
  ['user', `<command-message>keel:start-planning</command-message>\n<command-name>/keel:start-planning</command-name>\n<command-args>${ARGS}</command-args>`],
  ['user', [{ type: 'text', text: expanded() }], { isMeta: true }],
  ['assistant', [
    'keel advises Opus for planning, since the plan shapes all the work after it; the model stays your choice (`/model`).',
    '',
    'As I understand it: the shop should tell people about events that matter to them. Who gains: its customers and its staff. What is out: nothing named yet. Nothing in the shop sends notifications today.',
    '',
    'Size: large, several conversations, each ended with /keel:end-planning. Name: `notification-system`; its tasks merge into `main`.',
    '',
    'This conversation now plans notification-system: task and session commands wait for /keel:end-planning; no code changes here.',
  ].join('\n')],
];
const OFFER = [
  ['user', 'Go on.'],
  ['assistant', [
    'The description is short, so before the questions I suggest one look-up:',
    '',
    '1. The project map: where notifications would meet the code: the stack, the modules and data they touch, what can be reused. Cheap: a helper on Haiku (an estimate).',
    '',
    'Shall I? You can also skip it and go straight to the questions.',
  ].join('\n')],
];

const CASES = {
  'start-planning-offers-gathering': () => conversation(START()),
  'start-planning-gathers-then-asks': () => conversation([...START(), ...OFFER]),
};

if (require.main === module) {
  for (const [name, build] of Object.entries(CASES)) fs.writeFileSync(path.join(KEEL, 'evals', name, 'history.jsonl'), build());
}

module.exports = { CASES };
