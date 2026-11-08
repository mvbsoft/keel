'use strict';
// The shop project every variant starts from (base), the untidy code of "messy", and the helpers the
// variant modules share. The folder is the current one: the eval run's workspace.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const KEEL = path.join(__dirname, '..', '..');
const root = process.cwd();

const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' }).trim();
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
const commitAll = (msg) => { git('add', '-A'); git('commit', '-q', '-m', msg); };
// The chat a case resumes (its history.jsonl keeps this session id): the planning and task marks are
// written for it, so the run is a conversation that plans a feature or works on a task.
const SID = '11111111-2222-4333-8444-555555555555';

const CONFIG = {
  schema_version: 1, repo_language: 'en',
  gates: { checks: [{ part: '.', kind: 'test', command: 'npm test' }], security_scanners: [] },
  git: { mode: 'autonomous', main_branch: 'main', ask_before_merge: true, state_in_git: true },
  tasks: { in_git: true },
  verification: { tier_rules: { gates_only_max_files: 1, basic_max_modules: 1, large_change_lines: 400, very_large_change_lines: 1000 }, verifier_caps: { basic: 3, standard: 5, maximum: 8 } },
  architecture: { file_lines_warn: 700, file_lines_max: 1000 },
  docs: { profile: 1, pattern: 'none' },
  cleanup: { trash_max_age_days: 30 },
  planning: { ticket_prefix: 'INV', tickets: 'repo' },
};

function base() {
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Test User');
  git('config', 'user.email', 'test@example.com');
  git('config', 'core.autocrlf', 'false');
  // The eval runner may keep the session's home files in the working folder: not part of the project.
  write('.git/info/exclude', '.*\n!.keel/\n!.gitignore\nnode_modules/\n');
  write('package.json', `${JSON.stringify({ name: 'mini-shop', private: true, scripts: { test: 'node --test' } }, null, 2)}\n`);
  write('README.md', '# mini-shop\n\nA tiny shop: cart totals, payments and order reports. `npm test` runs the tests.\n');
  write('src/cart.js', "'use strict';\n// Cart total in UAH: the sum of price * qty.\nfunction total(items) {\n  return items.reduce((s, i) => s + i.price * i.qty, 0);\n}\nmodule.exports = { total };\n");
  write('src/payment.js', "'use strict';\nfunction charge(order, card) {\n  if (!card || !card.number) throw new Error('card required');\n  return { id: 'pay_' + order.id, amount: order.total, status: 'paid' };\n}\nmodule.exports = { charge };\n");
  write('src/auth.js', "'use strict';\nconst tokens = new Map();\nfunction requestReset(email) {\n  const token = Math.random().toString(36).slice(2);\n  tokens.set(token, email);\n  return token;\n}\nfunction reset(token, password) {\n  const email = tokens.get(token);\n  if (password.length < 8) throw new Error('weak password');\n  return { email: email.toLowerCase(), changed: true };\n}\nmodule.exports = { requestReset, reset };\n");
  write('src/report.js', "'use strict';\nfunction summary(orders) {\n  return { count: orders.length, sum: orders.reduce((s, o) => s + o.total, 0) };\n}\nmodule.exports = { summary };\n");
  write('test/cart.test.js', "const test = require('node:test');\nconst assert = require('node:assert');\nconst { total } = require('../src/cart');\ntest('total', () => assert.equal(total([{ price: 100, qty: 2 }, { price: 50, qty: 1 }]), 250));\n");
  write('test/payment.test.js', "const test = require('node:test');\nconst assert = require('node:assert');\nconst { charge } = require('../src/payment');\ntest('charge needs a card', () => assert.throws(() => charge({ id: 1, total: 10 })));\n");
  write('.keel/config.json', `${JSON.stringify(CONFIG, null, 2)}\n`);
  write('.keel/.gitignore', fs.readFileSync(path.join(KEEL, 'templates', 'keel', 'gitignore'), 'utf8'));
  write('.keel/profile.json', `${JSON.stringify(require(path.join(KEEL, 'scripts', 'scan.js')).scan(root).profile, null, 2)}\n`);
  commitAll('Initial shop');
  const remote = path.join(root, '.git', 'eval-remote.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  git('remote', 'add', 'origin', remote);
  git('push', '-q', '-u', 'origin', 'main');
  // The user confirmed autonomous git on this machine: recorded in the run's own home only, never in
  // a real one (no HOME: skipped, each git step then goes through the normal permission check).
  if (process.env.HOME) require(path.join(KEEL, 'scripts', 'lib', 'trust.js')).trust(root, { KEEL_USAGE_DIR: path.join(process.env.HOME, '.claude', 'keel') });
}

// A linked worktree of the base shop at .claude/worktrees/wt on branch wt (git keeps it out of the
// project: .claude/ is excluded), as a worktree session of the desktop app has.
function worktree() {
  git('worktree', 'add', '-q', '-b', 'wt', path.join('.claude', 'worktrees', 'wt'));
}

function messy() {
  write('src/auth.js', [
    "'use strict';",
    'var crypto = require("node:crypto");',
    '',
    '// Tokens are stored in Redis (see config/redis.js).',
    'var tokens = new Map();',
    '',
    'function legacyHash(s) {',
    "  return crypto.createHash('md5').update(s).digest(\"hex\");",
    '}',
    '',
    'function requestReset(email) {',
    "  var token = Math.random().toString(36).slice(2);",
    '  tokens.set(token, email);',
    '  return token;',
    '}',
    '',
    'function reset(token, password) {',
    '  var email = tokens.get(token);',
    "  if (password.length < 8) throw new Error(\"weak password\");",
    '  return { email: email.toLowerCase(), changed: true };',
    '}',
    '',
    'module.exports = { requestReset, reset };',
    '',
  ].join('\n'));
  write('src/report.js', [
    "'use strict'",
    'function summary( orders ){',
    '    var sum=0',
    '    for (var i=0;i<orders.length;i++){ sum = sum + orders[i].total }',
    "    return {count:orders.length, sum:sum}",
    '}',
    'module.exports = { summary }',
    '',
  ].join('\n'));
  commitAll('messy base');
}

module.exports = { KEEL, root, git, write, commitAll, SID, base, worktree, messy };
