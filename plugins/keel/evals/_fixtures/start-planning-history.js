'use strict';
// Writes history.jsonl of the cases tagged start-planning: the conversation in which the person typed
// /keel:start-planning, as Claude Code records it (the command, then its expanded text), the tool calls
// of its first reply (preflight and planning rules read, the scripts, the premise search), and keel's
// reply so far. keel refuses /keel:start-planning in every eval run, so these cases resume it instead.
// Run after a change to start-planning/SKILL.md, _shared/preflight.md, _shared/planning.md or
// notification-system-brief.md:
// node plugins/keel/evals/_fixtures/start-planning-history.js
const fs = require('node:fs');
const path = require('node:path');

const KEEL = path.join(__dirname, '..', '..');
// The chat the shop fixture marks as planning (SID in shop-base.js).
const SID = '11111111-2222-4333-8444-555555555555';
// Where the Docker command in CONTRIBUTING mounts the repository: the eval run loads keel from there.
const PLUGIN_ROOT = '/work/plugins/keel';
const ARGS = 'develop a notification system';
// The brief /keel:start-task wrote for the same feature (shop.js planning-brief makes the draft from it).
const BRIEF = '.keel/local/plans/briefs/notification-system-brief.md';
const BRIEF_TEXT = fs.readFileSync(path.join(__dirname, 'notification-system-brief.md'), 'utf8');
// The trash batch the history says the brief went to (the fixture's own batch has its run's time).
const BATCH = '20261105-100000';

// SKILL.md as Claude Code expands it: front matter dropped, placeholders filled, the `!` line run.
function expanded(args = ARGS) {
  const skill = fs.readFileSync(path.join(KEEL, 'skills', 'start-planning', 'SKILL.md'), 'utf8').replace(/^---\n[\s\S]*?\n---\n\n?/, '');
  return `Base directory for this skill: ${PLUGIN_ROOT}/skills/start-planning\n\n` + skill
    .replaceAll('${CLAUDE_PLUGIN_ROOT}', PLUGIN_ROOT)
    .replaceAll('${CLAUDE_PROJECT_DIR}', '.')
    .replaceAll('${CLAUDE_SESSION_ID}', SID)
    .replaceAll('${user_config.conversation_language}', 'English')
    .replaceAll('$ARGUMENTS', args)
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

// One tool call of keel's first reply and its result, as Claude Code records them.
function call(id, say, name, input, result) {
  return [
    ['assistant', [{ type: 'text', text: say }, { type: 'tool_use', id: `toolu_${id}`, name, input }]],
    ['user', [{ type: 'tool_result', tool_use_id: `toolu_${id}`, content: result }]],
  ];
}

// A keel file read with the Read tool, as the conversation saw it (another file: its text and path).
function read(id, say, rel, text = fs.readFileSync(path.join(KEEL, rel), 'utf8'), file = `${PLUGIN_ROOT}/${rel}`) {
  const numbered = text.replace(/\n$/, '').split('\n').map((l, i) => `${String(i + 1).padStart(6)}\t${l}`).join('\n');
  return call(id, say, 'Read', { file_path: file }, numbered);
}

const script = (id, say, name, args, result) =>
  call(id, say, 'Bash', { command: `node "${PLUGIN_ROOT}/scripts/${name}" "." ${args}`, description: say }, result);

// The steps behind keel's first reply, as shop.js "planning-new" gives them before the draft and mark
// exist (a brief: read first, moved into the new draft). A resumed run keeps only the history: without
// the planning rules it plans without them, without these calls it takes the reply as unchecked and
// runs the steps, the code search included, again.
const STEPS = ({ brief = false } = {}) => [
  ...read('read_preflight', 'Reading the preflight steps.', 'skills/_shared/preflight.md'),
  ...script('notes_check', 'Checking this conversation\'s lane.', 'notes.js', `check --session ${SID}`,
    'note: missing\nmemory: missing\ntasks: 0 unfinished\nactive task: none\nsession start: not recorded\nnext session log: .keel/sessions/2026-11-02-001.md\n'),
  ...script('mark_get', 'Checking whether this conversation already plans a feature.', 'plans.js', `mark get --session ${SID}`, 'planning: none\n'),
  ...read('read_planning', 'Reading the planning rules.', 'skills/_shared/planning.md'),
  ...script('settings', 'Reading the planning settings.', 'plans.js', 'settings',
    'settings: .keel/local/plans/keel/settings.json\ndraft: pc\ndraft_dir: tickets (default)\nrepos: -\nplanning: .keel/config.json\nticket_prefix: INV\ntickets: repo\ntickets_dir: tickets (default)\nlanguage: en (default)\n'),
  ...(brief ? read('read_brief', 'Reading the brief.', BRIEF, BRIEF_TEXT, `/tmp/work/${BRIEF}`) : []),
  ...call('premise', 'Checking the premise: does anything in the shop send notifications today?', 'Grep',
    { pattern: 'notif|email|mail|sms|push', path: 'src', '-i': true, '-n': true, output_mode: 'content' },
    'src/auth.js:3:function requestReset(email) {\nsrc/auth.js:5:  tokens.set(token, email);\nsrc/auth.js:9:  const email = tokens.get(token);\nsrc/auth.js:11:  return { email: email.toLowerCase(), changed: true };'),
  ...call('branches', 'Listing the branches the tasks could merge into.', 'Bash',
    { command: 'git for-each-ref --format="%(refname:short)" refs/heads refs/remotes', description: 'List local and remote branches' }, 'main\norigin/main\n'),
  ...script('new', 'Making the draft notification-system.', 'plans.js', 'new notification-system',
    'created: .keel/local/plans/keel/notification-system/plan.md\ndraft: .keel/local/plans/keel/notification-system/ (this machine only)\nstatus: draft\nlanguage: en\n'),
  ...(brief ? script('brief', 'Moving the brief into the draft.', 'plans.js', `brief notification-system ${BRIEF}`,
    `brief: ${BRIEF} -> .keel/local/plans/keel/notification-system/plan.md (In plain words, What was gathered, Decisions, Open questions)\nmoved to keel's trash: batch ${BATCH} (/keel:cleanup restore ${BATCH} puts it back)\n`) : []),
  ...script('mark_set', 'Marking this conversation as planning it.', 'plans.js', `mark set notification-system --session ${SID}`, 'planning: notification-system\n'),
];

const START = () => [
  ['user', `<command-message>keel:start-planning</command-message>\n<command-name>/keel:start-planning</command-name>\n<command-args>${ARGS}</command-args>`],
  ['user', [{ type: 'text', text: expanded() }], { isMeta: true }],
  ...STEPS(),
  ['assistant', [
    'keel advises Opus for planning, since the plan shapes all the work after it; the model stays your choice (`/model`).',
    '',
    'As I understand it: the shop should tell people about events that matter to them. Who gains: its customers and its staff. What is out: nothing named yet. Nothing in the shop sends notifications today: the only match in `src/` is a password-reset token kept against an e-mail address (`src/auth.js:3-11`), and nothing is sent.',
    '',
    'Size: large, several conversations, each ended with /keel:end-planning. Name: `notification-system`; its tasks merge into `main`.',
    '',
    'This conversation now plans notification-system: task and session commands wait for /keel:end-planning; no code changes here.',
  ].join('\n')],
];
// Planning from the brief: what it settles is not asked again, so the next step is In plain words and the
// brief's open question.
const START_BRIEF = () => [
  ['user', `<command-message>keel:start-planning</command-message>\n<command-name>/keel:start-planning</command-name>\n<command-args>${BRIEF}</command-args>`],
  ['user', [{ type: 'text', text: expanded(BRIEF) }], { isMeta: true }],
  ...STEPS({ brief: true }),
  ['assistant', [
    'keel advises Opus for planning, since the plan shapes all the work after it; the model stays your choice (`/model`).',
    '',
    'From the brief: customers get an e-mail when their order is paid or shipped and can turn these e-mails off; staff see new orders without reloading the staff page. The premise holds: `src/payment.js:4` gives the paid status, and nothing in `src/` sends e-mail today.',
    '',
    'Size: large, several conversations, each ended with /keel:end-planning. Name: `notification-system`; its tasks merge into `main`.',
    '',
    `The brief's goal, files, decisions and open question are now in the draft's plan.md; the brief went to keel's trash (batch ${BATCH}).`,
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
  'start-planning-from-brief': () => conversation(START_BRIEF()),
};

if (require.main === module) {
  for (const [name, build] of Object.entries(CASES)) fs.writeFileSync(path.join(KEEL, 'evals', name, 'history.jsonl'), build());
}

module.exports = { CASES };
