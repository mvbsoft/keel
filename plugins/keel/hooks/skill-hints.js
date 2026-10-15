'use strict';
// PreToolUse hook on Read, Edit, Write, Bash and PowerShell: when the session touches something one of
// keel's advisory skills covers (a migration, Python code, docs, a new source file, a dependency
// manifest, a commit), it adds a one-line reminder to load that skill. Each skill is named at most
// once per session (one marker file per skill in the OS temp folder, keyed by the session id, so nothing
// is written into the project). Subagents get no hints, except keel's implementer, which has the Skill
// tool and does the work. Only in a project keel is set up in. Rules: data/skill-hints.json. Never decides permissions; prints nothing when no rule
// matches. Fails soft.
//
// The session often reads and writes files through the shell (`cat`, `sed -n`, `cat > f <<EOF`) and
// starts with `cd "<dir>" &&`, so a shell command is split into its parts and each part is read as the
// file tool it stands for: reading commands as Read, `>` to a new file as Write, `>>`, `sed -i` and
// the like as Edit.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { matchesAny } = require('../scripts/lib/patterns.js');
const { withoutEnv } = require('../scripts/lib/commands.js');

const PLUGIN = path.resolve(__dirname, '..');
const RULES = require('../data/skill-hints.json').rules;
const MIGRATION_DIRS = require('../data/catalog.json').database.migration_dirs;
const MIGRATION_GLOBS = MIGRATION_DIRS.flatMap((d) => [`${d}/**`, `**/${d}/**`]);

const READERS = new Set(['cat', 'head', 'tail', 'less', 'more', 'type', 'get-content', 'gc', 'grep', 'rg']);
const WRITERS = new Set(['set-content', 'add-content', 'out-file', 'new-item', 'tee', 'touch']);

// The only subagent that gets hints: it writes the code and can load a skill.
const HINTED_AGENT = 'keel:implementer';

const norm = (p) => p.replace(/\\/g, '/');
const words = (text) => [...text.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);

function relative(file, root) {
  const rel = norm(path.relative(root, path.resolve(root, file)));
  return rel.startsWith('..') || path.isAbsolute(rel) ? null : rel;
}

// A heredoc body is data, not commands: keep its first line (it holds the redirection), drop the rest.
const dropHeredocs = (cmd) => cmd.replace(/(<<-?\s*["']?(\w+)["']?[^\n]*)\n[\s\S]*?\n\s*\2\s*(?=\n|$)/g, '$1');

// The directory a `cd`-like command goes to: flags (`cd -P x`, `Set-Location -Path x`) and cmd's `/d` switch
// are not directories. null when the command names none (`cd`, `cd -`).
function cdTarget(w) {
  const dirs = w.slice(1).filter((a) => !a.startsWith('-'));
  if (dirs.length > 1 && dirs[0].toLowerCase() === '/d') dirs.shift();
  return dirs[0] || null;
}

// Quoted text is data, not syntax: blank it, but keep a quoted redirection target (`> "my file.py"`).
const withoutQuoted = (part) => part.replace(/(>>?\s*)?("[^"]*"|'[^']*')/g, (m, redirect) => (redirect ? m : '""'));

// The parts of a shell command and the files they read or write: { parts, uses: [{ tool, file }] }.
// `cwd` is where the session's shell is, the base for relative paths.
function shell(command, cwd) {
  const parts = [];
  const uses = [];
  for (const raw of dropHeredocs(command).split(/&&|\|\||[;|\n]/)) {
    const part = withoutEnv(raw).trim();
    if (!part) continue;
    const w = words(part);
    const name = (w[0] || '').toLowerCase();
    if (name === 'cd' || name === 'set-location' || name === 'pushd') {
      const dir = cdTarget(w);
      if (dir) cwd = path.resolve(cwd, dir);
      continue;
    }
    parts.push(part);
    const at = (f) => path.resolve(cwd, f);
    const written = (f) => ({ tool: fs.existsSync(at(f)) ? 'Edit' : 'Write', file: at(f) });
    for (const m of withoutQuoted(part).matchAll(/(^|[^0-9&>=])(>>?)\s*("([^"]+)"|'([^']+)'|([^\s;&|<>]+))/g)) {
      const target = m[4] ?? m[5] ?? m[6];
      if (target.startsWith('&') || /^\/dev\/null$|^nul$|^\$null$/i.test(target)) continue;
      uses.push(m[2] === '>>' ? { tool: 'Edit', file: at(target) } : written(target));
    }
    const args = w.slice(1).filter((a) => !a.startsWith('-') && !/^([<>&]|[0-9]+>)/.test(a));
    if (READERS.has(name)) {
      // grep and rg take a pattern first.
      for (const a of (name === 'grep' || name === 'rg' ? args.slice(1) : args)) uses.push({ tool: 'Read', file: at(a) });
    } else if (name === 'sed') {
      const file = args[args.length - 1];
      if (file && args.length > 1) uses.push({ tool: w.some((a) => /^-i/.test(a)) ? 'Edit' : 'Read', file: at(file) });
    } else if (WRITERS.has(name)) {
      const flag = w.findIndex((a) => /^-(path|filepath|literalpath)$/i.test(a));
      const file = flag > 0 ? w[flag + 1] : args[0];
      if (file) uses.push(written(file));
    } else if ((name === 'cp' || name === 'mv' || name === 'copy-item' || name === 'move-item') && args.length > 1) {
      uses.push(written(args[args.length - 1]));
    }
  }
  return { parts, uses };
}

function fileMatches(rule, file, root) {
  const rel = relative(file, root);
  if (rel === null) return false;
  if (rule.not && matchesAny(rel, rule.not)) return false;
  if (rule.new_file && fs.existsSync(path.resolve(root, file))) return false;
  if (rule.migrations) return matchesAny(rel, MIGRATION_GLOBS);
  return matchesAny(rel, rule.paths);
}

function matches(rule, tool, input, root, cmd) {
  if (cmd) {
    if (rule.commands) return rule.tools.includes(tool) && cmd.parts.some((p) => rule.commands.some((c) => p.startsWith(c)));
    return cmd.uses.some((u) => rule.tools.includes(u.tool) && fileMatches(rule, u.file, root));
  }
  return rule.tools.includes(tool) && typeof input.file_path === 'string' && fileMatches(rule, input.file_path, root);
}

// Marks a skill as named in this session; false when it already was. One file per skill, created with
// 'wx', so two parallel tool calls cannot both claim it. If the temp folder is unusable, hint anyway.
function claim(session, skill) {
  const dir = path.join(os.tmpdir(), `keel-skill-hints-${String(session || 'none').replace(/[^\w-]/g, '')}`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, skill.replace(/[^\w-]/g, '')), '', { flag: 'wx' });
    return true;
  } catch (e) {
    return e.code !== 'EEXIST';
  }
}

function hint(input) {
  if (input.agent_id && input.agent_type !== HINTED_AGENT) return null;
  // Project files are judged against the project folder, not the folder the session cd'd into.
  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  if (!require('../scripts/lib/active.js').configured(root)) return null;
  const tool = input.tool_name;
  const toolInput = input.tool_input || {};
  let cmd = null;
  if (tool === 'Bash' || tool === 'PowerShell') {
    const command = String(toolInput.command || '');
    if (norm(command).toLowerCase().includes(norm(PLUGIN).toLowerCase())) return null;
    cmd = shell(command, input.cwd || root);
  }
  const found = RULES.filter((r) => matches(r, tool, toolInput, root, cmd));
  if (!found.length) return null;
  const rule = found.find((r) => claim(input.session_id, r.skill));
  if (!rule) return null;
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: `keel: ${rule.why}. Load the keel:${rule.skill} skill (Skill tool) and follow it, unless you already did in this session.`,
    },
  };
}

if (require.main === module) {
  let out = null;
  try { out = hint(JSON.parse(fs.readFileSync(0, 'utf8'))); } catch { /* fail soft */ }
  if (out) process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

module.exports = { hint, shell };
