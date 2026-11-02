'use strict';
// Writes history.jsonl of the cases tagged start-planning: the conversation in which the person typed
// /keel:start-planning, as Claude Code records it (the command, then its expanded text), its read of
// the planning rules, and keel's reply so far. keel refuses /keel:start-planning in every eval run, so
// these cases resume it instead.
// Run after a change to start-planning/SKILL.md or _shared/planning.md:
// node plugins/keel/evals/_fixtures/start-planning-history.js
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
    const blocks = Array.isArray(content);
    const message = type === 'user' ? { role: 'user', content }
      : { id: `msg_${i + 1}`, type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: blocks ? content : [{ type: 'text', text: content }], stop_reason: blocks ? 'tool_use' : 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } };
    const record = { type, message, ...extra, uuid, parentUuid: parent, sessionId: SID, cwd: '/tmp/work', timestamp: new Date(Date.parse('2026-11-02T10:00:00.000Z') + i * 5000).toISOString(), version: '2.1.299', isSidechain: false, userType: 'external' };
    parent = uuid;
    return JSON.stringify(record);
  }).join('\n') + '\n';
}

// The command's step 3: the planning rules read with the Read tool, as the conversation saw them. A
// resumed run keeps only what the history holds, so without this read it would plan without the rules.
function readRules() {
  const text = fs.readFileSync(path.join(KEEL, 'skills', '_shared', 'planning.md'), 'utf8').replace(/\n$/, '');
  const numbered = text.split('\n').map((l, i) => `${String(i + 1).padStart(6)}\t${l}`).join('\n');
  return [
    ['assistant', [{ type: 'tool_use', id: 'toolu_read_planning', name: 'Read', input: { file_path: `${PLUGIN_ROOT}/skills/_shared/planning.md` } }]],
    ['user', [{ type: 'tool_result', tool_use_id: 'toolu_read_planning', content: numbered }]],
  ];
}

const START = () => [
  ['user', `<command-message>keel:start-planning</command-message>\n<command-name>/keel:start-planning</command-name>\n<command-args>${ARGS}</command-args>`],
  ['user', [{ type: 'text', text: expanded() }], { isMeta: true }],
  ...readRules(),
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

// The look-up skipped and the goal made clear: the next step is the levels.
const GOAL = [
  ['user', 'Skip it, go to the questions.'],
  ['assistant', 'Who should get notifications, and about what?'],
];
const LEVELS = [
  ['user', 'Customers when their order is paid or shipped, and staff when a new order comes in. Today they only see it by reloading the pages.'],
  ['assistant', [
    'Notifications for the shop. Levels:',
    '',
    '1. Minimum: an e-mail to the customer when the order is paid or shipped, a counter of new orders on the staff page. ~2 tickets. Cheap now, low risk; push later means a new channel beside it.',
    '2. Basic: level 1 plus browser push for staff, and customers can turn e-mails off. ~4 tickets. Medium cost, a push service to keep; groups and quiet hours are easy to add later.',
    '3. Full: level 2 plus quiet hours, grouping of frequent events, templates for the texts. ~7 tickets. Higher cost now; little left to add later.',
    '',
    'I recommend 2: staff need to see new orders without reloading, and 3 builds on it without rework. Which level?',
  ].join('\n')],
  ['user', 'Level 2.'],
];
const SNOOZE = [
  ['assistant', 'Level 2 it is. Staff may want to pause notifications for a while: how should they say for how long?'],
];
const RESEARCH = [
  ['assistant', [
    'Browser push is new here: src/ has no notifications, package.json has no dependencies, and Node has no web push built in. So the next step is a small package.',
    '',
    'I suggest the researcher (a Sonnet helper that reads the package registries and docs on the web; dearer than the project map, an estimate) compares at most 3 ways to send web push from Node, writing it ourselves among them. Shall I?',
  ].join('\n')],
];

const CASES = {
  'start-planning-offers-gathering': () => conversation(START()),
  'start-planning-gathers-then-asks': () => conversation([...START(), ...OFFER]),
  'start-planning-offers-levels': () => conversation([...START(), ...OFFER, ...GOAL]),
  'start-planning-elementary-choice': () => conversation([...START(), ...OFFER, ...GOAL, ...LEVELS, ...SNOOZE]),
  'start-planning-compares-packages': () => conversation([...START(), ...OFFER, ...GOAL, ...LEVELS, ...RESEARCH]),
};

if (require.main === module) {
  for (const [name, build] of Object.entries(CASES)) fs.writeFileSync(path.join(KEEL, 'evals', name, 'history.jsonl'), build());
}

module.exports = { CASES };
