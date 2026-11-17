'use strict';
// What is installed for a project, read from disk only, for scripts/skills.js: plugins this project
// sees (`claude plugin list --json`), standalone skills in .claude/skills/ and ~/.claude/skills/, the
// settings that turn them off, and the skill listing Claude gets at the start of a session.
const fs = require('node:fs');
const path = require('node:path');
const { frontMatter, riskFlags } = require('./skills-front.js');
const { readJsonFile, noBom } = require('./json.js');
const { mainOf, settingsHome } = require('./project-dir.js');
const { samePath } = require('./safe-path.js');

// The skill listing budget. code.claude.com/docs/en/env-vars (SLASH_COMMAND_TOOL_CHAR_BUDGET): "scales
// dynamically at 1% of the context window, with a fallback of 8,000 characters" (8,000 is 1% of
// 200k tokens at about 4 characters a token); code.claude.com/docs/en/skills: each entry's description
// and when_to_use together are cut at 1,536 characters. Read 2026-11-17.
const LISTING_FALLBACK = 8000;
const ENTRY_CAP = 1536;
const WALK_LIMIT = 2000;

const readText = (file) => { try { return noBom(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const readJson = (file) => { try { return readJsonFile(file); } catch { return null; } };
const isDir = (p) => { try { return fs.lstatSync(p).isDirectory(); } catch { return false; } };

// Files under `dir`, relative with forward slashes, without following links (links are listed apart).
function walk(dir, limit = WALK_LIMIT) {
  const files = [];
  const links = [];
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    let entries;
    try { entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) links.push(p);
      else if (e.isDirectory()) { if (e.name !== '.git' && e.name !== 'node_modules') stack.push(p); }
      else if (e.isFile()) files.push(p);
      if (files.length >= limit) return { files, links, truncated: true };
    }
  }
  return { files, links, truncated: false };
}

// Settings that hide plugins and skills here: user, then project, then local (later wins).
function settingsHere(root, home) {
  const dir = settingsHome(root);
  const out = { enabledPlugins: {}, skillOverrides: {} };
  for (const file of [path.join(home, '.claude', 'settings.json'), path.join(dir, '.claude', 'settings.json'), path.join(dir, '.claude', 'settings.local.json')]) {
    const s = readJson(file);
    if (!s || typeof s !== 'object') continue;
    if (s.enabledPlugins && typeof s.enabledPlugins === 'object') Object.assign(out.enabledPlugins, s.enabledPlugins);
    if (s.skillOverrides && typeof s.skillOverrides === 'object') Object.assign(out.skillOverrides, s.skillOverrides);
  }
  return out;
}

// One skill folder: its name, SKILL.md fields, risk flags and source.json (written by `install`).
function readSkill(dir, name = path.basename(dir)) {
  const text = readText(path.join(dir, 'SKILL.md')) || '';
  const fm = frontMatter(text);
  const { files, links } = walk(dir);
  const risks = riskFlags(files, text);
  if (links.length) risks.flags.push(`links (${links.length})`);
  const src = readJson(path.join(dir, 'source.json'));
  const source = src && typeof src.repo === 'string' ? src : null;
  return { name, dir, fm, description: typeof fm.fields.description === 'string' ? fm.fields.description : '', risks, source };
}

// Skill folders right under `base` (each with a SKILL.md); dot folders and synced/ are not skills.
function skillsIn(base) {
  let names;
  try { names = fs.readdirSync(base); } catch { return []; }
  return names.filter((n) => !n.startsWith('.') && n !== 'synced' && isDir(path.join(base, n)) && fs.existsSync(path.join(base, n, 'SKILL.md')))
    .sort().map((n) => readSkill(path.join(base, n), n));
}

// Skills synced from claude.ai (~/.claude/skills/synced/<...>/<name>/SKILL.md, up to three levels).
function syncedSkills(home) {
  const base = path.join(home, '.claude', 'skills', 'synced');
  const out = [];
  const visit = (dir, depth) => {
    if (depth > 3) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const sub = path.join(dir, e.name);
      if (fs.existsSync(path.join(sub, 'SKILL.md'))) out.push(sub); else visit(sub, depth + 1);
    }
  };
  visit(base, 1);
  return out.map((d) => {
    const fm = frontMatter(readText(path.join(d, 'SKILL.md')) || '');
    return { name: typeof fm.fields.name === 'string' ? fm.fields.name : path.basename(d), fm };
  });
}

const inProject = (entry, root) => {
  if (typeof entry.projectPath !== 'string' || !entry.projectPath) return false;
  const p = path.resolve(entry.projectPath);
  return samePath(p, path.resolve(root)) || samePath(p, path.resolve(mainOf(root)));
};

// The plugins this project sees: user, managed and synced (from claude.ai) scope, and project or local
// scope recorded for this project (or its main checkout). One entry per id; the narrowest scope wins
// (local, project, then the machine-wide ones).
function pluginsHere(installed, root) {
  const rank = { local: 3, project: 2, user: 1, managed: 1, synced: 1 };
  const byId = new Map();
  for (const e of Array.isArray(installed) ? installed : []) {
    if (!e || typeof e.id !== 'string') continue;
    const here = ['user', 'managed', 'synced'].includes(e.scope) || ((e.scope === 'project' || e.scope === 'local') && inProject(e, root));
    if (!here) continue;
    const had = byId.get(e.id);
    if (!had || (rank[e.scope] || 0) > (rank[had.scope] || 0)) byId.set(e.id, e);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

// Skills and commands a plugin adds to the listing, from its default folders.
function pluginEntries(installPath) {
  if (typeof installPath !== 'string' || !installPath) return [];
  const plugin = (readJson(path.join(installPath, '.claude-plugin', 'plugin.json')) || {}).name || null;
  const out = [];
  for (const s of skillsIn(path.join(installPath, 'skills'))) out.push({ name: s.name, fm: s.fm, plugin });
  let cmds = [];
  try { cmds = fs.readdirSync(path.join(installPath, 'commands')).filter((n) => n.endsWith('.md')); } catch { /* none */ }
  for (const c of cmds) out.push({ name: c.slice(0, -3), fm: frontMatter(readText(path.join(installPath, 'commands', c)) || ''), plugin });
  return out;
}

// Risk flags of an installed plugin: MCP servers from the listing, hooks, bin/ and code from its folder.
function pluginRisks(entry) {
  const flags = [];
  if (entry.mcpServers && typeof entry.mcpServers === 'object' && Object.keys(entry.mcpServers).length) flags.push(`MCP server (${Object.keys(entry.mcpServers).join(', ')})`);
  if (typeof entry.installPath !== 'string' || !isDir(entry.installPath)) return { flags: [...flags, 'not checked'], code: [] };
  const { files, truncated } = walk(entry.installPath);
  const r = riskFlags(files.filter((f) => !/(^|\/)SKILL\.md$/.test(f)), '');
  if (!flags.length && files.some((f) => /^\.?mcp\.json$/i.test(f))) flags.push('MCP server');
  for (const f of r.flags) if (f !== 'MCP server') flags.push(f);
  if (truncated) flags.push(`more than ${WALK_LIMIT} files`);
  return { flags, code: r.code };
}

// One listing entry's characters: its name plus description and when_to_use (cut at ENTRY_CAP).
function entryChars(name, fm, override) {
  if (override === 'name-only') return name.length;
  const f = fm.fields || {};
  const text = [f.description, f.when_to_use].filter((x) => typeof x === 'string' && x).join(' ');
  return name.length + Math.min(text.length, ENTRY_CAP);
}

const hidden = (fm) => String((fm.fields || {})['disable-model-invocation']).trim() === 'true';

// The skill listing Claude gets now: enabled plugins' skills and commands, project, user and synced
// skills. Skills with disable-model-invocation, or turned off by skillOverrides, are not listed.
// Built-in and managed skills cannot be read from disk and are not counted.
function listing({ plugins, settings, project, user, synced }) {
  let count = 0;
  let chars = 0;
  const add = (name, fm, override) => {
    if (hidden(fm) || override === 'off' || override === 'user-invocable-only') return;
    count += 1;
    chars += entryChars(name, fm, override);
  };
  for (const p of plugins) {
    if (!p.enabled_here) continue;
    for (const e of pluginEntries(p.installPath)) add(e.plugin ? `${e.plugin}:${e.name}` : e.name, e.fm);
  }
  for (const s of [...project, ...user]) add(s.name, s.fm, settings.skillOverrides[s.name]);
  for (const s of synced) add(s.name, s.fm, settings.skillOverrides[s.name]);
  const env = Number(process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET);
  return { skills: count, characters: chars, budget: Number.isFinite(env) && env > 0 ? env : LISTING_FALLBACK };
}

module.exports = { walk, settingsHere, readSkill, skillsIn, syncedSkills, pluginsHere, pluginEntries, pluginRisks, listing, LISTING_FALLBACK, ENTRY_CAP };
