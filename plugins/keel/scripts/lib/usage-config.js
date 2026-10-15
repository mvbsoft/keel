'use strict';
// Machine-level usage settings and the wallet a session pays from (subscription, api or credit).
// Files live in ~/.claude/keel/ (KEEL_USAGE_DIR overrides it in tests). Never throws.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readJsonFile } = require('./json.js');

const WALLETS = ['subscription', 'api', 'credit'];
const API_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDE_CODE_USE_MANTLE'];

function usageDir(env = process.env) {
  return env.KEEL_USAGE_DIR || path.join(os.homedir(), '.claude', 'keel');
}

function readJson(file) {
  try { return readJsonFile(file); } catch { return null; }
}

function gitEmail() {
  try { return execFileSync('git', ['config', 'user.email'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { return null; }
}

// ~/.claude/keel/usage.json with defaults filled in. `configured` is false until configure wrote it.
// statusline: { mode: 'keel' | 'wrap' | 'none', original: <the user's previous statusLine object> }.
function loadMachineConfig(env = process.env) {
  const raw = readJson(path.join(usageDir(env), 'usage.json'));
  const c = raw && typeof raw === 'object' ? raw : {};
  return {
    configured: !!raw,
    pc: typeof c.pc === 'string' && c.pc ? c.pc : os.hostname(),
    user: typeof c.user === 'string' && c.user ? c.user : gitEmail(),
    wallet_default: WALLETS.includes(c.wallet_default) ? c.wallet_default : 'subscription',
    cloud_wallet: WALLETS.includes(c.cloud_wallet) ? c.cloud_wallet : 'credit',
    also_api: c.also_api === true,
    prompt_preview: c.prompt_preview !== false,
    history_days: Number.isInteger(c.history_days) && c.history_days >= 0 ? c.history_days : 30,
    artifact_url: typeof c.artifact_url === 'string' && c.artifact_url ? c.artifact_url : null,
    // project artifact URLs (from the committed .keel/config.json) the user approved on this machine
    approved_artifact_urls: Array.isArray(c.approved_artifact_urls) ? c.approved_artifact_urls.filter((u) => typeof u === 'string' && u) : [],
    statusline: c.statusline && typeof c.statusline === 'object' ? c.statusline : { mode: 'none' },
  };
}

function writeMachineConfig(values, env = process.env) {
  const dir = usageDir(env);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'usage.json');
  const next = { ...(readJson(file) || {}), ...values };
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
  return next;
}

// apiKeyHelper in user or project settings means the session bills an API key.
function hasApiKeyHelper(projectDir, env = process.env) {
  const home = env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const files = [path.join(home, 'settings.json')];
  if (projectDir) files.push(path.join(projectDir, '.claude', 'settings.json'), path.join(projectDir, '.claude', 'settings.local.json'));
  return files.some((f) => { const s = readJson(f); return !!(s && s.apiKeyHelper); });
}

// The wallet of the running session. ANTHROPIC_BASE_URL alone does not mean API: the desktop app sets it.
function detectWallet({ env = process.env, projectDir, machine = loadMachineConfig(env) } = {}) {
  if (API_ENV.some((k) => env[k])) return 'api';
  if (hasApiKeyHelper(projectDir, env)) return 'api';
  if (env.CLAUDE_CODE_REMOTE) return machine.cloud_wallet;
  return 'subscription';
}

module.exports = { WALLETS, usageDir, loadMachineConfig, writeMachineConfig, detectWallet, hasApiKeyHelper };
