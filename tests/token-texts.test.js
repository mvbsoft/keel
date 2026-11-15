'use strict';
// Texts that save model requests: one preflight block in every command, steps that go in one message,
// one `save` git call, the options of `task new`, and the `head:`/`today:` lines of `notes.js check`.
const test = require('node:test');
const assert = require('node:assert/strict');
const { shared, skill, flat, part, says } = require('./fixtures/texts.js');

const COMMANDS = ['start-session', 'start-task', 'end-task', 'end-session', 'start-planning', 'end-planning', 'cleanup', 'tasks', 'feature-page'];

// Step 1 of a command: from its number to the next step.
const stepOne = (name) => {
  const text = skill(name);
  const from = text.indexOf('\n1. ');
  assert.ok(from >= 0, `${name}: has a step 1`);
  const to = text.indexOf('\n2. ', from);
  return text.slice(from + 1, to);
};

test('step 1 of the nine commands is one identical block that skips preflight.md when the state is ok', () => {
  const blocks = COMMANDS.map(stepOne);
  for (const [i, block] of blocks.entries()) assert.equal(block, blocks[0], `${COMMANDS[i]}: the block differs from ${COMMANDS[0]}`);
  says(blocks[0], ['`keel-config: ok`', '`profile: ok`', 'exactly the two lines', 'with no other line', 'go on without reading preflight.md']);
  says(blocks[0], ['Any other line (such as `git: refused`), or no state above', 'read `<keel>/skills/_shared/preflight.md`', 'act on it']);
  assert.ok(blocks[0].length < 1500, `the block stays short (${blocks[0].length} characters)`);
});

test('the rules in that block are the rules of preflight.md, word for word', () => {
  const block = flat(stepOne('start-task'));
  const rules = block.slice(block.indexOf('Run every keel script'));
  assert.ok(rules.length > 300 && rules.length < 900, `${rules.length} characters`);
  assert.ok(flat(shared('preflight.md')).includes(rules), 'preflight.md holds the same rules sentence');
  says(rules, ['as its own plain command', 'never joined with `;`, `&&`, pipes or redirections']);
  says(rules, ['`\\\\`', '`//server/share/...`']);
  says(rules, ['Read keel\'s own files with Read, Grep and Glob, not the shell']);
  says(rules, ['Before each action say in one short line what it will do']);
  says(rules, ['ask, never guess']);
  says(rules, ['Steps that need nothing from each other\'s output', 'one message as separate calls', 'where the command says so']);
  says(rules, ['refused by a project hook', 'preflight.md']);
});

test('only the safe steps are paired: reminder with final-report.md after the cost report, lint and type checks', () => {
  for (const name of ['end-task', 'end-session']) {
    const text = skill(name);
    says(text, ['Run usage-sync.md step 4 (the cost report)', 'Then, in one message as two calls', 'cleanup.js" "<project>" reminder', 'read `<keel>/skills/_shared/final-report.md`'], name);
    assert.ok(text.indexOf('step 4 (the cost report)') < text.indexOf('in one message as two calls'), `${name}: the cost report stays first`);
    assert.doesNotMatch(text, /notes\.js[^\n]*check[^\n]*--begin[^\n]*(in one message|as two calls)/, name);
  }
  const gates = part(shared('verify.md'), '## 2. Gates', '## 3.');
  says(gates, ['Lint, format and type checks may run in one message as separate calls', 'test and build commands one at a time', 'a database, a port or a build folder']);
});

test('verify.md: changes.js --start does the comment check; no separate comments.js run in a command text', () => {
  const verify = shared('verify.md');
  says(verify, ['changes.js" "<project>" --start', 'first lines are the comment check', 'always goes on', 'on each note now','run `changes.js --start` again', 'only kept comments on purpose', 'not a red gate']);
  assert.doesNotMatch(verify, /changes: not started/);
  assert.doesNotMatch(verify, /comments\.js/);
  for (const name of ['start-task', 'end-task', 'end-session']) assert.doesNotMatch(skill(name), /comments\.js/, name);
});

test('git.md: one `save` call replaces commit, handoff push and switch, sync and push', () => {
  const git = shared('git.md');
  const step = part(git, '2. Write', '3. **Merge**');
  says(step, ['one call that commits', 'syncs, pushes and switches back', '`save --message-file "<project>/.keel/local/tmp/commit-message.txt"`']);
  says(step, ['**finish**', '`--sync <base>`', '`--tickets "<keys>"`']);
  says(step, ['**handoff**', '`--back-to <base>`', '`push: refused (...)`']);
  says(step, ['First line `ok` → step 3', 'The script leaves out secret files and lists them: tell the user', '`nothing to commit` is fine']);
  says(step, ['`stopped` → read `reason:`, `done:` and `left:`']);
  says(step, ['`conflict` → show the files', 'Offer: resolve together now']);
  says(step, ['`sync merged N new commits ...; run the gates again before the push`', 'green → `push`', 'red → show them']);
  says(git, ['adds', '`--finish <id> --session <sid>`', 'every `start`, `save` and', '`push`']);
  assert.doesNotMatch(git, /^\d+\. `(commit|sync|push)`/m, 'no separate commit, sync or push step is left');
  says(skill('end-task'), ['add `--finish <id> --session <sid>` to every `start`, `save` and `push`']);
  says(skill('end-session'), ["git.md's `save` then adds `--tickets"]);
  // The steps git-end-of-feature.md points at exist.
  const end = shared('git-end-of-feature.md');
  says(end, ['"Step 3 (Merge)"', 'step of `<keel>/skills/_shared/git.md`']);
  assert.doesNotMatch(end, /step [56]\b/);
});

test('git-manual.md: each step the user asked for is its own git-flow.js command; save only for commit and push together', () => {
  says(shared('git-manual.md'), ['as its own `git-flow.js` command', '`commit --message-file ...`', '`sync --from <base>`', '`switch --name <base>`', '`save` only when they asked for commit and push together']);
});

test('intake.md: task new takes the branch, base, target, execution and a plan file instead of hand edits', () => {
  const intake = shared('intake.md');
  const two = part(intake, '2. `node "<keel>/scripts/notes.js" "<project>" task new', '3. Work through the plan');
  says(two, ['--branch <branch>', '--base <base>', '--merge-into <target>', '--execution <here|delegate|fresh>', '[--plan-file <plan file>]']);
  says(two, ['`--plan-file` copies it into the task folder as `plan.md`', 'sets `plan: plan.md`', 'only when the plan file is already in the language', 'else write `plan.md` yourself']);
  says(two, ['A line starting `notes:` is a refusal', 'read it, fix the argument']);
  assert.doesNotMatch(two, /front matter `branch`/, 'the front matter is not edited by hand');
});

test('handoff.md and end-task take head and date from notes.js check, and the size has a character limit', () => {
  const handoff = shared('handoff.md');
  says(handoff, ['`after_commit` and `date`', '`head:` and `today:` lines', 'no separate git or date call']);
  says(handoff, ['At most 150 lines and 12000 characters (`notes.js check`)', 'Over either → compress']);
  assert.doesNotMatch(handoff, /git rev-parse/);
  const endTask = skill('end-task');
  says(endTask, ['`updated` and `after_commit` from the `today:` and `head:` lines', 'step 2 `notes.js check`', 'the file\'s own commit follows']);
  assert.doesNotMatch(endTask, /git rev-parse/);
});
