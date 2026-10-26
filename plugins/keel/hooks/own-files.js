'use strict';
// PreToolUse hook on Read, Glob, Grep, Bash and PowerShell: lets keel use its own files without a
// permission prompt on every turn of a multi-step command such as configure. It allows exactly:
// - reading or searching inside the keel plugin folder;
// - running one of keel's own scripts listed below with node, as one command with no shell
//   operators or characters a shell would expand (~ included; inside quotes only $ and ` count), on
//   the current project: the first argument must be the project folder itself, as an absolute path
//   (a relative one is resolved from the shell's folder, a sub-folder may hold another project's
//   .keel), and for Bash no unquoted backslash (bash drops it, so the script would get another path).
//   These scripts only read the project; some write their results under .keel/local/ (tmp/, last-verify.json, session-start.json)
//   and nowhere else; notes.js `task` writes keel's task folders (.keel/tasks/, .keel/local/); the
//   script touches only `.keel/tasks/<id>/` or `.keel/local/tasks/<id>/` for a validated id and refuses
//   any link on the way or inside; usage.js takes the project as `--project` (it must be the current
//   project), its `--out` folder must be under that project's .keel/local/usage/ and its `--keel` file
//   under .keel/local/;
// - asks, so Claude Code itself shows the confirmation with keel's reason in the conversation language,
//   also when the user's allow rules would let it run: notes.js `task delete` (a finished task's folder
//   to keel's trash; denied with the reason while no verification is recorded) and `task drop`,
//   cleanup.js `empty-trash` (deletes for good), git-flow.js `delete-branch`, `merge` and `trust` (below),
//   plans.js `commit` and `push` (planning files into git and onto the remote);
// - git-flow.js: `status` always; the other steps only when the project's git mode is autonomous
//   and the user confirmed these git settings on this machine (`trust`, which itself always prompts;
//   a changed `git` section needs it again). `merge` asks in every mode, unless the mode is autonomous,
//   confirmed here, and ask_before_merge is off; `push` on the main line (or where git cannot tell the
//   branch) is left to Claude Code's prompt; `delete-branch` always asks;
// - claude-settings.js: `show` only. `apply` writes the user's Claude Code settings and `move-plans`
//   moves the user's plan files, so both are left to Claude Code's own permission prompt;
// - migrate.js: `find`, `refs`, `state` (they only read; `find` writes its result to .keel/local/tmp/).
//   `apply` moves the user's files, so Claude Code asks;
// - cleanup.js: everything but `empty-trash` (moving to keel's trash and back can be undone; deleting
//   the trash cannot).
// - plans.js: everything but `commit` and `push`; its other steps write only the planning files (the
//   drafts, the exported tickets and their status, settings and chat marks), and `drop` moves a feature
//   folder whose tickets are all done to keel's trash, which can be undone. commit or push anywhere
//   else in its command asks too (the shell may pass that step in another order).
// Refused with the reason, so the model sends the plain form: a command joined with shell operators
// (outside quotes) that names keel's folder; a keel script whose arguments the hook cannot read; a step
// that always asks, or a command that holds its word (for plans.js only commit and push), named with any
// project other than the current one's exact absolute path (so no allow rule runs it unconfirmed).
// Everything else is left to the user's normal permissions (no output). Fails soft.
const fs = require('node:fs');
const path = require('node:path');

const SCRIPTS = new Set(['scan.js', 'check-config.js', 'safe-command.js', 'changes.js', 'fingerprint.js', 'votes.js', 'ledger-report.js', 'notes.js', 'plan-steps.js', 'git-flow.js', 'comments.js', 'stack-skills.js', 'claude-settings.js', 'migrate.js', 'cleanup.js', 'usage.js', 'usage-setup.js', 'config-check.js', 'plans.js']);
// Script steps that change the user's files for good or move them outside keel's own folders: left
// to Claude Code's permission prompt.
const ASK = { 'claude-settings.js': ['apply'], 'migrate.js': ['apply'], 'usage-setup.js': ['apply', 'prices-apply', 'install-statusline'] };
const GIT_STEPS = new Set(['start', 'switch', 'commit', 'sync', 'push']);
// plans.js steps Claude Code confirms each time, even when an allow rule would let node run.
const PLANS_ASK = new Set(['commit', 'push']);

const norm = (p) => path.resolve(p).replace(/\\/g, '/').replace(/\/+$/, '');
const sameFs = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
const inside = (file, root) => {
  const f = norm(file);
  const r = norm(root);
  return sameFs(f.slice(0, r.length + 1), `${r}/`) && !f.slice(r.length).split('/').includes('..');
};

function decide(permissionDecision, reason) {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason: reason } };
}
const allow = (reason) => decide('allow', reason);

// keel's confirmation text in the conversation language of the project.
function say(project, key, vars) {
  const { pickLanguage, translator } = require('../scripts/lib/i18n.js');
  return translator(pickLanguage(require('../scripts/lib/options.js').effectiveOptions(project).conversation_language))(key, vars);
}

// Where a task's files are, for the confirmation.
function taskPath(project, id) {
  let t = null;
  try { t = require('../scripts/lib/tasks.js').findTask(project, id); } catch { /* unreadable: the default */ }
  return t && t.folder ? `${path.relative(project, t.folder).split(path.sep).join('/')}/` : `.keel/tasks/${id}/`;
}

// The steps Claude Code confirms each time (or, for merge, unless the user turned that off).
function alwaysAsks(name, [, command, sub]) {
  return (name === 'notes.js' && command === 'task' && (sub === 'delete' || sub === 'drop'))
    || (name === 'cleanup.js' && command === 'empty-trash')
    || (name === 'git-flow.js' && ['merge', 'delete-branch', 'trust'].includes(command))
    || (name === 'plans.js' && PLANS_ASK.has(command));
}

// notes.js task delete / drop, cleanup.js empty-trash: Claude Code confirms each with keel's reason.
function destructive(name, pos, opts) {
  const [project, command, sub, id] = pos;
  if (name === 'notes.js' && command === 'task' && (sub === 'delete' || sub === 'drop') && typeof id === 'string') {
    if (sub === 'delete') {
      // The script refuses it too; denied here, the user is not asked about a step that cannot run.
      if (!fs.existsSync(path.join(project, '.keel', 'local', 'last-verify.json'))) {
        return decide('deny', 'keel: no verification is recorded for this change, so the task cannot be finished yet. Finish the verification (verify.md ends with fingerprint.js save --tier <level>; when the user chose no verification: fingerprint.js save --tier none), then run task delete again.');
      }
      return decide('ask', say(project, 'confirm.task_delete', { id, path: taskPath(project, id) }));
    }
    return decide('ask', say(project, 'confirm.task_drop', { id, path: taskPath(project, id) }));
  }
  if (name === 'cleanup.js' && command === 'empty-trash') {
    // The script's own reading of the options, so the question names exactly what it deletes.
    const trash = require('../scripts/lib/trash.js');
    const how = trash.emptyChoice(opts, trash.maxAgeDays(project));
    if (how.error) return decide('deny', `keel: ${how.error}. Nothing ran.`);
    const which = how.all ? say(project, 'confirm.trash_all') : how.batch !== undefined ? say(project, 'confirm.trash_batch', { batch: how.batch }) : say(project, 'confirm.trash_old', { days: how.olderThanDays });
    return decide('ask', say(project, 'confirm.empty_trash', { which }));
  }
  return null;
}

// The words of a command exactly as bash and PowerShell split them, or null when the split could
// differ: every word is "quoted", 'quoted' or bare, and a quote never starts or ends inside a word.
// Characters either shell acts on are refused: anywhere, $ and ` (both shells expand them inside
// double quotes too), the curly quotes PowerShell also reads as quotes, and a backslash before a quote
// or space; in a bare word also PowerShell's (...), @(...) and {...}, bash's globs (and ~), a bare
// backslash, # that starts a comment, and separators. Inside quotes these are plain text, as in a link
// with ? and &. A bare comma makes a PowerShell array, which may reach node as several words, so it is
// accepted only in a list of numbers (`--items 1,2`), which cannot become a step name. Words split only
// on spaces and tabs, as in bash: a special space is text inside quotes and refused outside them
// (PowerShell splits on it). Control characters other than tab are refused anywhere (Windows
// PowerShell 5.1 splits words on U+0085); U+2028 and U+2029 count as control characters here. A double
// quote inside single quotes is refused: Windows PowerShell 5.1 passes it to node unescaped. So is a
// bare word that starts with one dash and holds a dot or ends with a colon: Windows PowerShell 5.1
// reads -, the en dash, em dash and horizontal bar as a parameter dash, splits such a word at a dot,
// and splits the word after one that ends with a colon.
const CURLY_QUOTES = /[‘-„]/;
const UNSAFE = /[$`‘-„]|\\["' ]/;
const UNSAFE_BARE = /[(){}@*?[\]#;&|<>]/;
// A word PowerShell reads as a parameter: one dash (it counts the en dash, em dash and horizontal bar as
// dashes too) not followed by another.
const PS_PARAMETER = /^[-\u2013-\u2015](?![-\u2013-\u2015])/;
function splitWords(text, bash) {
  if (UNSAFE.test(text) || /[\u0000-\u0008\u000a-\u001f\u007f-\u009f\u2028\u2029]/.test(text)) return null;
  const token = /[ \t]*(?:"([^"]*)"|'([^']*)'|([^\s"']+))(?=[ \t]|$)/y;
  const out = [];
  while (token.lastIndex < text.length) {
    if (/^[ \t]*$/.test(text.slice(token.lastIndex))) break;
    const m = token.exec(text);
    // A shell expands ~ only in a bare word, at its start or after = or :; inside a word, as in a
    // Windows short name such as RUNNER~1, and inside quotes it is plain text.
    if (!m || (m[2] !== undefined && m[2].includes('"')) || (m[3] && UNSAFE_BARE.test(m[3])) || (m[3] && m[3].includes(',') && !/^\d+(,\d+)*$/.test(m[3])) || (m[3] && /(^|[=:])~/.test(m[3])) || (bash && m[3] && m[3].includes('\\')) || (!bash && m[3] && PS_PARAMETER.test(m[3]) && (m[3].includes('.') || m[3].endsWith(':')))) return null;
    out.push(m[1] ?? m[2] ?? m[3]);
  }
  // PowerShell drops `--%` (stop-parsing) and, in Windows PowerShell 5.1, an empty argument before node
  // sees them, so the words the hook reads would not be the ones the script gets.
  if (!bash && out.some((w) => w === '--%' || w === '')) return null;
  return out;
}

// Words that name a step Claude Code must confirm. A command that holds one but does not read as that
// confirmed step is refused rather than allowed: a shell may pass the words in an order the hook
// cannot see.
const CONFIRMED_WORDS = new Set(['delete', 'drop', 'empty-trash', 'merge', 'delete-branch', 'trust']);

// Whether HEAD is on the main line (the configured main branch or a remote's default branch), or git
// cannot tell: a push from there is never silent.
function onMainLine(project, git) {
  const { spawnSync } = require('node:child_process');
  const run = (args) => { const r = spawnSync('git', ['-C', project, ...args], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : null; };
  const branch = run(['symbolic-ref', '--short', '-q', 'HEAD']);
  if (!branch) return true;
  const fold = process.platform === 'win32' || process.platform === 'darwin';
  const same = (b) => typeof b === 'string' && (fold ? b.toLowerCase() === branch.toLowerCase() : b === branch);
  const defaults = (run(['for-each-ref', '--format=%(symref:lstrip=3)', 'refs/remotes/*/HEAD']) || '').split('\n');
  return [git.main_branch, ...defaults].some(same);
}

function gitFlow(pos, opts) {
  const [project, command = 'status'] = pos;
  if (command === 'status') return allow('keel reads the git state');
  if (!project) return null;
  if (command === 'delete-branch') {
    if (typeof opts.name !== 'string') return null;
    return decide('ask', say(project, opts.remote === true ? 'confirm.delete_branch_remote' : 'confirm.delete_branch', { branch: opts.name }));
  }
  // Claude Code's prompt even when a permission rule would allow node commands.
  if (command === 'trust') return decide('ask', say(project, 'confirm.trust'));
  let git = null;
  try { git = require('../scripts/lib/json.js').readJsonFile(path.join(project, '.keel', 'config.json')).git; } catch { /* no config: nothing is trusted */ }
  // The mode comes from the committed config; a clone or a branch could set it, so it counts only when
  // the user confirmed these git settings on this machine (git-flow.js trust).
  const trusted = git && git.mode === 'autonomous' && require('../scripts/lib/trust.js').isTrusted(project);
  if (command === 'merge') {
    const target = typeof opts.into === 'string' ? opts.into : (git && git.main_branch) || 'main';
    return trusted && git.ask_before_merge === false ? allow(`keel git, autonomous mode: merge into ${target}`) : decide('ask', say(project, 'confirm.merge', { target }));
  }
  if (!trusted) return null;
  if (command === 'push' && onMainLine(project, git)) return null;
  if (GIT_STEPS.has(command)) return allow(`keel git, autonomous mode: ${command}`);
  return null;
}

const PLAIN_FORM = 'keel: run keel\'s scripts as one plain command, with the step words in the order keel\'s instructions give: arguments in "quotes" or plain words, no $, `, ~, --%, empty arguments, unquoted backslashes, a backslash before a quote or a space, curly quotes, control characters, double quotes inside single quotes or a bare word starting with one dash that holds a dot or ends with a colon, a comma only between numbers (quote a list), and only plain spaces between words (retype them plainly). Nothing ran; send it again in that form.';

// The decision for `node <keel>/scripts/<name> <args>`. Arguments are read with the scripts' own
// parseArgs, so the step the hook judges is the step the script runs.
function ownScript(name, argText, projectDir, bash) {
  const argv = splitWords(argText, bash);
  // keel's instructions never need shell expansions; refused, the model sends the plain form, which the
  // steps that always ask can recognise.
  if (!argv) return decide('deny', PLAIN_FORM);
  // Loaded here, not at the top: this hook runs on every shell command and these pull in the catalog.
  const { opts, pos } = require('../scripts/lib/project.js').parseArgs(argv);
  // Every listed script but usage.js takes the project folder first; none is called on a sub-folder.
  if (name !== 'usage.js' && !(projectDir && pos[0] && path.isAbsolute(pos[0]) && sameFs(norm(pos[0]), norm(projectDir)))) {
    // A split the hook cannot see may hide the project, so a confirmed step's word anywhere is refused
    // too; for plans.js only its own commit and push, since its search takes free words ("drop old
    // users").
    const words = name === 'plans.js' ? PLANS_ASK : CONFIRMED_WORDS;
    if (alwaysAsks(name, pos) || argv.some((w) => words.has(w))) return decide('deny', 'keel: a step the user confirms each time runs only on the current project, named by its exact absolute path. Nothing ran; send it again with that path.');
    return null;
  }
  if (name === 'usage.js') {
    // usage.js takes the project as --project; its files stay under that project's .keel/local/.
    const local = projectDir && path.join(projectDir, '.keel', 'local');
    if (opts.project !== undefined && !(projectDir && typeof opts.project === 'string' && path.isAbsolute(opts.project) && sameFs(norm(opts.project), norm(projectDir)))) return null;
    // prepare and report read and write a project's files: without --project they would use the
    // shell's folder, which may be another project.
    if (['prepare', 'report'].includes(pos[0]) && opts.project === undefined) return null;
    const under = { out: local && path.join(local, 'usage'), keel: local };
    for (const k of ['out', 'keel']) if (opts[k] !== undefined && !(local && typeof opts[k] === 'string' && inside(opts[k], under[k]))) return null;
    // No usage.js step is confirmed, and --feature takes a feature name (empty-trash is one), so
    // CONFIRMED_WORDS are not refused here.
    return allow('keel runs its own usage.js');
  }
  // plans.js confirms only commit and push: its `drop` (a done feature's folder to keel's trash) runs
  // without a window, and its search takes free words ("drop old users"), so CONFIRMED_WORDS are not
  // refused here. commit or push elsewhere in the command may be that step, passed by the shell in
  // another order, so it asks.
  if (name === 'plans.js') {
    if (alwaysAsks(name, pos)) return decide('ask', say(pos[0], `confirm.plans_${pos[1]}`));
    return argv.some((w) => PLANS_ASK.has(w)) ? decide('ask', say(pos[0], 'confirm.plans_word')) : allow('keel runs its own plans.js');
  }
  if (name === 'git-flow.js') {
    if (!alwaysAsks(name, pos) && argv.some((w) => CONFIRMED_WORDS.has(w))) return decide('deny', PLAIN_FORM);
    return gitFlow(pos, opts);
  }
  const asked = destructive(name, pos, opts);
  if (asked) return asked;
  if (argv.some((w) => CONFIRMED_WORDS.has(w))) return decide('deny', PLAIN_FORM);
  if (name === 'claude-settings.js' && !(pos[1] === 'show' && pos.length === 2 && !Object.keys(opts).length)) return null;
  if (ASK[name] && ASK[name].includes(pos[1])) return null;
  return allow(`keel runs its own ${name}`);
}

function main() {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const root = process.env.CLAUDE_PLUGIN_ROOT;
  if (!root) return null;
  const tool = input.tool_name;
  const args = input.tool_input || {};

  // keel's QA agents write their helper scripts only under the project's .keel/local/tmp/qa/: a write
  // anywhere else (a gitignored .env, dist/) would not show in the tree check that follows them.
  if (tool === 'Write' && /^(keel:)?qa(-break)?$/.test(String(input.agent_type || ''))) {
    const project = process.env.CLAUDE_PROJECT_DIR || input.cwd;
    const tmp = project && path.join(project, '.keel', 'local', 'tmp', 'qa');
    if (tmp && typeof args.file_path === 'string' && inside(path.resolve(project, args.file_path), tmp)) return allow('keel\'s QA agent writes in its temporary folder');
    return decide('deny', 'keel: a QA agent writes only under <project>/.keel/local/tmp/qa/. Nothing was written; write the file there.');
  }
  if (tool === 'Read' && typeof args.file_path === 'string' && inside(args.file_path, root)) {
    return allow('keel reads its own plugin file');
  }
  if ((tool === 'Glob' || tool === 'Grep') && typeof args.path === 'string' && (inside(args.path, root) || sameFs(norm(args.path), norm(root)))) {
    return allow('keel searches its own plugin folder');
  }
  if ((tool === 'Bash' || tool === 'PowerShell') && typeof args.command === 'string') {
    const cmd = args.command.trim();
    // One plain command: no separators, pipes, redirections, substitutions or line breaks. A joined
    // command that names keel's folder is refused with the way to do it, so the model rewrites it
    // instead of the user getting a permission prompt for it.
    // Separators inside quotes are plain text, unless a backslash-quote or a curly quote makes the quoting unclear.
    const unquoted = /\\["']/.test(cmd) || CURLY_QUOTES.test(cmd) ? cmd : cmd.replace(/"[^"$`\n\r]*"|'[^'$`\n\r]*'/g, '""');
    if (/[;&|<>`\n\r]|\$\(/.test(unquoted)) {
      const flat = cmd.replace(/\\/g, '/');
      const mentionsKeel = process.platform === 'win32' ? flat.toLowerCase().includes(norm(root).toLowerCase()) : flat.includes(norm(root));
      if (!mentionsKeel && runsLib(cmd, root)) return decide('deny', LIB);
      if (!mentionsKeel && stepElsewhere(cmd)) return decide('deny', ELSEWHERE);
      return mentionsKeel ? decide('deny', 'keel: run each keel script as its own plain command (no ;, &&, |, redirection, cd or shell variables) and read keel\'s files with the Read tool. Nothing ran; send the commands one by one.') : null;
    }
    const m = /^node(?:\.exe)?\s+("([^"]+)"|'([^']+)'|(\S+))(\s.*)?$/s.exec(cmd);
    const bash = tool === 'Bash';
    const script = m && (m[2] || m[3] || m[4]);
    const name = script && script.replace(/\\/g, '/').split('/').pop();
    if (m && !(bash && m[4] && m[4].includes('\\')) && SCRIPTS.has(name) && inside(script, path.join(root, 'scripts')) && sameFs(norm(path.dirname(script)), norm(path.join(root, 'scripts')))) {
      return ownScript(name, m[5] || '', process.env.CLAUDE_PROJECT_DIR || input.cwd, bash);
    }
    if (runsLib(cmd, root)) return decide('deny', LIB);
    // Any other shape that runs a keel script (node flags, env, bash -c, a wrapper) is one the hook
    // cannot judge, so a broad allow rule could run a step that must be confirmed: refused instead.
    // Reading a script (grep, sed, cat) runs nothing and is left to the user's permissions.
    if (namesKeelScript(cmd, root) && /(^|[^\w.-])(node|nodejs|bun|deno)(\.exe)?(?![\w.-])/i.test(cmd)) {
      return decide('deny', 'keel: run keel\'s scripts in the plain form `node "<keel>/scripts/<name>.js" "<project>" ...`, with no node options, env, wrapper or second shell. Nothing ran; send it again in that form.');
    }
    if (stepElsewhere(cmd)) return decide('deny', ELSEWHERE);
  }
  return null;
}

// A step that must be confirmed, run with a keel step script named by another path ($CLAUDE_PLUGIN_ROOT,
// ~, another copy of the plugin): the hook cannot tell it from keel's own, so it is refused rather than
// left to an allow rule. A project's own scripts/cleanup.js (no keel or plugin root in its path) is not.
const STEP_SCRIPT_ELSEWHERE = /(CLAUDE_PLUGIN_ROOT|keel)[^\s"']*[\/\\]scripts[\/\\](notes|git-flow|cleanup|plans)\.js(?![\w.-])/gi;
const ELSEWHERE = 'keel: a step that needs your confirmation runs only as `node "<keel>/scripts/<name>.js" "<project>" ...` with keel\'s folder written out in full. Nothing ran; send it again in that form.';
function stepElsewhere(cmd) {
  if (!/(^|[^\w.-])(node|nodejs|bun|deno)(\.exe)?(?![\w.-])/i.test(cmd)) return false;
  // plans.js confirms its own steps (PLANS_ASK; its drop is not one of them); a command may name several scripts.
  const words = [...cmd.matchAll(STEP_SCRIPT_ELSEWHERE)].flatMap((m) => [...(m[2].toLowerCase() === 'plans' ? PLANS_ASK : CONFIRMED_WORDS)]);
  return cmd.split(/[\s"'=;&|]+/).some((w) => words.includes(w));
}

// keel's library (scripts/lib/) holds the steps' functions (dropping or deleting a task, emptying the
// trash) without the step scripts' checks, and no keel step runs it directly: a runtime command that
// names it is refused. Best effort: it catches the library named on the command line (by keel's
// folder, $CLAUDE_PLUGIN_ROOT, a path joined from parts, or keel's plugin-cache layout), not code in a
// file that loads it. Reading it (grep, cat) runs nothing and is not refused.
// A runtime in command position: at the start, after a shell operator, or after env, exec, npx...
const RUNTIME = /(^|[;&|(]\s*|\b(?:env|exec|npx|nohup|time|command)\s+(?:-\S+\s+|\w+=\S*\s+)*)(node|nodejs|bun|deno|tsx|ts-node)(\.exe)?(?![\w.-])/i;
const KEEL_LIB = /CLAUDE_PLUGIN_ROOT[^\s"']*\/scripts\/lib\/|\/keel\/(?:[^\s"'\/]+\/)?scripts\/lib\/(tasks|trash|trust|finish)\.js(?![\w.-])/i;
const JOINED_LIB = /['"]scripts['"]\s*,\s*['"]lib['"]|['"]lib['"]\s*,\s*['"][\w.-]+\.js['"]/;
const LIB = 'keel: keel\'s library is not run directly. Run keel\'s scripts in the plain form `node "<keel>/scripts/<name>.js" "<project>" ...` and read its files with the Read tool. Nothing ran.';
function runsLib(cmd, root) {
  if (!RUNTIME.test(cmd)) return false;
  const flat = cmd.replace(/\\/g, '/').replace(/\/\.(?=\/)/g, '').replace(/\/{2,}/g, '/');
  const has = (needle) => (process.platform === 'win32' ? flat.toLowerCase().includes(needle.toLowerCase()) : flat.includes(needle));
  if (has(`${norm(path.join(root, 'scripts', 'lib'))}/`) || KEEL_LIB.test(flat)) return true;
  // Reached through keel's folder: relative to it ($CLAUDE_PLUGIN_ROOT, cd into it) or joined from parts.
  return (has(norm(root)) || /CLAUDE_PLUGIN_ROOT/.test(cmd)) && (/(^|[^\w-])scripts\/lib\//.test(flat) || JOINED_LIB.test(cmd));
}

// Whether a command names one of keel's scripts by its path in keel's scripts folder.
function namesKeelScript(cmd, root) {
  const flat = cmd.replace(/\\/g, '/');
  const dir = `${norm(path.join(root, 'scripts'))}/`;
  const hay = process.platform === 'win32' ? flat.toLowerCase() : flat;
  const needle = process.platform === 'win32' ? dir.toLowerCase() : dir;
  let at = hay.indexOf(needle);
  while (at !== -1) {
    const rest = /^[A-Za-z0-9_.-]+/.exec(hay.slice(at + needle.length));
    if (rest && SCRIPTS.has(rest[0])) return true;
    at = hay.indexOf(needle, at + 1);
  }
  return false;
}

let result;
try { result = main(); } catch { result = null; }
if (result) process.stdout.write(JSON.stringify(result));
process.exit(0);
