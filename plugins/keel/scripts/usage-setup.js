'use strict';
// configure section 12 (usage and costs): this machine's usage settings and the price table.
// Usage: node usage-setup.js <projectDir> show
//        node usage-setup.js <projectDir> apply <changes.json>      writes ~/.claude/keel/usage.json (only KEYS below)
//        node usage-setup.js <projectDir> prices-diff <prices.json> old → new diff and multiplier warnings, writes nothing
//        node usage-setup.js <projectDir> prices-apply <prices.json> writes the machine price override
//        node usage-setup.js <projectDir> install-statusline        writes the stable shim, prints the statusLine command
//        node usage-setup.js <projectDir> page                      copies the dashboard page to .keel/local/tmp/usage-page
//          (the Artifact tool publishes only files under the project or the scratchpad) and prints the
//          template fingerprint that configure saves as page_template once the page is published
// `show` also says what the status line is now: keel's runner, a command keel could wrap, or none,
// and whether the published page still runs an older template than this keel's.
// The status line itself is written by claude-settings.js (key statusLine), which keeps a backup.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseArgs } = require('./lib/project.js');
const { WALLETS, usageDir, loadMachineConfig, writeMachineConfig, detectWallet } = require('./lib/usage-config.js');
const prices = require('./lib/prices.js');
const { readJsonFile } = require('./lib/json.js');

const RUNNER = path.join(__dirname, '..', 'statusline', 'run.js');
// The statusLine setting points at a shim in the usage folder, not into the plugin: the plugin folder
// changes with every update. The SessionStart hook writes the current plugin folder to plugin-root.txt;
// without it the shim runs the wrapped original command, so the user's line never disappears.
const SHIM = `'use strict';
// Written by keel (usage-setup.js install-statusline). Runs keel's status line from the current plugin folder.
const fs = require('node:fs');
const path = require('node:path');
let root = '';
try { root = fs.readFileSync(path.join(__dirname, 'plugin-root.txt'), 'utf8').trim(); } catch {}
const runner = root && path.join(root, 'statusline', 'run.js');
if (runner && fs.existsSync(runner)) require(runner);
else {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(__dirname, 'usage.json'), 'utf8').replace(/^\\uFEFF/, '')).statusline || {};
    const cmd = s.mode === 'wrap' && s.original && s.original.command;
    if (cmd) {
      const r = require('node:child_process').spawnSync(cmd, { input: fs.readFileSync(0), shell: true, timeout: 5000, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
      if (r.stdout) process.stdout.write(r.stdout);
    }
  } catch {}
}
`;
const KEYS = {
  pc: (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v),
  user: (v) => typeof v === 'string' && v.length > 0 && v.length < 200,
  wallet_default: (v) => WALLETS.includes(v),
  cloud_wallet: (v) => WALLETS.includes(v),
  also_api: (v) => typeof v === 'boolean',
  prompt_preview: (v) => typeof v === 'boolean',
  history_days: (v) => Number.isInteger(v) && v >= 0 && v <= 3650,
  artifact_url: (v) => v === null || (typeof v === 'string' && /^https:\/\/claude\.ai\//.test(v)),
  approved_artifact_urls: (v) => Array.isArray(v) && v.length <= 20 && v.every((u) => typeof u === 'string' && /^https:\/\/claude\.ai\//.test(u)),
  page_template: (v) => typeof v === 'string' && /^[0-9a-f]{12}$/.test(v),
  statusline: (v) => v && typeof v === 'object' && ['keel', 'wrap', 'none'].includes(v.mode),
};

function userSettings() {
  const file = process.env.KEEL_USER_SETTINGS || path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json');
  try { return readJsonFile(file); } catch { return {}; }
}

// keel's runner or its shim in the usage folder.
const KEEL_LINE = /statusline[\\/]+run\.js|keel[\\/]+statusline\.js/;

// What the statusLine setting runs now, and what configure can offer.
function statusLineState(settings = userSettings()) {
  const s = settings.statusLine;
  const command = s && typeof s.command === 'string' ? s.command : null;
  if (!command) return { now: 'none', command: null, offer: 'install' };
  if (KEEL_LINE.test(command)) return { now: 'keel', command, offer: null };
  return { now: 'other', command, original: s, offer: 'wrap' };
}

function show(root = process.cwd()) {
  const m = loadMachineConfig();
  const table = prices.loadPrices();
  const sl = statusLineState();
  return [
    `usage folder: ${usageDir()}${m.configured ? '' : ' (not configured on this machine yet)'}`,
    `pc: ${m.pc} | user: ${m.user || 'unknown'} | wallet of this session: ${detectWallet({ projectDir: root, machine: m })}`,
    `wallet_default: ${m.wallet_default} | cloud_wallet: ${m.cloud_wallet} | also_api: ${m.also_api} | prompt_preview: ${m.prompt_preview}`,
    `artifact_url: ${m.artifact_url || 'not set'}${m.approved_artifact_urls.length ? ` | approved project urls: ${m.approved_artifact_urls.join(', ')}` : ''}`,
    ...(m.artifact_url || m.approved_artifact_urls.length ? [pageTemplateLine(m.page_template)] : []),
    `status line now: ${sl.now}${sl.command ? ` (${sl.command})` : ''}${sl.offer ? ` | offer: ${sl.offer}` : ''}`,
    ...(sl.original ? [`status line setting to keep as statusline.original when wrapping: ${JSON.stringify(sl.original)}`] : []),
    `prices: ${table.source}, ${table.models.length} models${prices.validate(table).length ? ` | notes: ${prices.validate(table).join('; ')}` : ''}`,
  ].join('\n');
}

function apply(file) {
  const changes = readJsonFile(file);
  const bad = Object.entries(changes).filter(([k, v]) => !KEYS[k] || !KEYS[k](v)).map(([k]) => k);
  if (bad.length) throw new Error(`keel does not write these usage settings (unknown key or bad value): ${bad.join(', ')}`);
  // Wrapping keel's own runner would call itself forever.
  if (changes.statusline && changes.statusline.mode === 'wrap') {
    const cmd = changes.statusline.original && changes.statusline.original.command;
    if (typeof cmd !== 'string' || !cmd.trim() || KEEL_LINE.test(cmd)) throw new Error('statusline.original.command must be the previous status line command, not keel\'s runner');
    // The wrapped command runs on every status line refresh, so only the user's own current line (or the
    // one already wrapped) is accepted, never a new command.
    const stored = loadMachineConfig().statusline;
    if (cmd !== statusLineState().command && !(stored && stored.original && stored.original.command === cmd)) throw new Error('statusline.original.command must be the status line command in your Claude Code settings now');
  }
  writeMachineConfig(changes);
  return path.join(usageDir(), 'usage.json');
}

function installStatusline() {
  const dir = usageDir();
  fs.mkdirSync(dir, { recursive: true });
  const shim = path.join(dir, 'statusline.js');
  fs.writeFileSync(shim, SHIM);
  fs.writeFileSync(path.join(dir, 'plugin-root.txt'), path.join(__dirname, '..'));
  return { type: 'command', command: `node "${shim}"`, padding: 0 };
}

const PAGE_FILES = ['index.html', 'pivot.js', 'i18n.js', 'i18n.uk.js'];
const TEMPLATE = path.join(__dirname, '..', 'templates', 'usage');
// Line endings do not count: a checkout with CRLF publishes the same page.
function pageTemplate(dir = TEMPLATE) {
  const h = crypto.createHash('sha256');
  for (const name of PAGE_FILES) h.update(`${name}\n${fs.readFileSync(path.join(dir, name), 'utf8').replace(/\r\n/g, '\n')}\n`);
  return h.digest('hex').slice(0, 12);
}

// A page published before keel recorded the fingerprint has none, and is offered the update too.
function pageTemplateLine(saved) {
  const now = pageTemplate();
  return saved === now ? `page template: ${now} (this keel's)` : `page template: ${saved || 'unknown'}, this keel's: ${now} | offer: update`;
}

function page(root) {
  const to = require('./lib/safe-path.js').safeLocalPath(root, 'tmp', 'usage-page');
  fs.mkdirSync(to, { recursive: true });
  for (const name of PAGE_FILES) fs.copyFileSync(path.join(TEMPLATE, name), path.join(to, name));
  return to;
}

function readTable(file) {
  const t = readJsonFile(file);
  if (!t || !Array.isArray(t.models) || t.models.some((m) => !m || typeof m.match !== 'string' || !m.match)) throw new Error(`${file}: expected { models: [{ match, input, cache_write_5m, cache_write_1h, cache_read, output }] }`);
  return t;
}

function pricesDiff(file) {
  const next = readTable(file);
  const changes = prices.diff(prices.loadPrices(), next);
  const out = changes.length ? changes.map((c) => (c.field === 'added' || c.field === 'removed' ? `${c.field}: ${c.match}` : `${c.match} ${c.field}: ${c.old} → ${c.new}`)) : ['no changes'];
  const warn = prices.validate(next);
  if (warn.length) out.push(...warn.map((w) => `check: ${w}`));
  return out.join('\n');
}

function pricesApply(file) {
  const next = readTable(file);
  const target = path.join(usageDir(), 'prices.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target)) fs.copyFileSync(target, `${target}.bak`);
  fs.writeFileSync(target, `${JSON.stringify({ ...next, updated: new Date().toISOString() }, null, 2)}\n`);
  return target;
}

if (require.main === module) {
  const { pos: args } = parseArgs(process.argv.slice(2));
  const root = path.resolve(args[0] || '.');
  const pos = args.slice(1);
  try {
    if (pos[0] === 'show') process.stdout.write(`${show(root)}\n`);
    else if (pos[0] === 'apply' && pos[1]) process.stdout.write(`written ${apply(path.resolve(pos[1]))}\n`);
    else if (pos[0] === 'prices-diff' && pos[1]) process.stdout.write(`${pricesDiff(path.resolve(pos[1]))}\n`);
    else if (pos[0] === 'prices-apply' && pos[1]) process.stdout.write(`written ${pricesApply(path.resolve(pos[1]))} (previous kept as prices.json.bak)\n`);
    else if (pos[0] === 'page') process.stdout.write(`page files in ${page(root)}: ${PAGE_FILES.join(', ')}\npage_template: ${pageTemplate()}\n`);
    else if (pos[0] === 'install-statusline') process.stdout.write(`${JSON.stringify(installStatusline())}\n`);
    else process.stdout.write('usage: usage-setup.js <projectDir> show | apply <changes.json> | prices-diff <prices.json> | prices-apply <prices.json> | install-statusline | page\n');
  } catch (e) {
    process.stdout.write(`usage-setup: ${e.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { show, apply, statusLineState, installStatusline, page, pageTemplate, pricesDiff, pricesApply, RUNNER };
