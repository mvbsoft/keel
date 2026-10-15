'use strict';
// Decides whether a gate command may be run once during configure. keel runs only tests, linters and
// type checks; anything that deploys, publishes, migrates, deletes or reaches remote systems is
// refused. Script aliases are followed to the commands they really run: `pnpm run check` is judged
// by the body of the "check" script in package.json, `make test` by its recipe. Package names and
// file names that start with a read-only verb (check-migration-journal.mjs) are names, not actions.
// Usage: node safe-command.js <projectDir> <partDir> -- <command...>
// Prints "safe" or "refused: <reasons>". Always exits 0.
const fs = require('node:fs');
const path = require('node:path');
const { withoutEnv } = require('./lib/commands.js');
const { readJsonFile } = require('./lib/json.js');

const DENY = [
  [/\b(deploy|publish|release|rollout|promote|ship)\b/i, 'deploys or publishes'],
  [/\bmigrat(e|es|ion|ions)\b|\bdb:(migrate|seed|reset|drop|create)\b|\bmigrate:(fresh|refresh|reset|rollback)\b|\bseed(ers?)?\b/i, 'changes a database'],
  [/\bdrop\s+(database|table|schema)\b|\btruncate\s+table\b/i, 'deletes data'],
  // Global options may stand between git and the action (`git -C . push`, `git --no-pager push`).
  // An option that takes a separate value is matched only by the first branch, so `git -c -c -c ...`
  // has one parse and the match stays linear instead of backtracking exponentially.
  [/\bgit\s+(?:(?:-C|-c|--git-dir|--work-tree|--namespace)\s+\S+\s+|--?(?!(?:C|c|git-dir|work-tree|namespace)\s)[\w-]+(?:=\S+)?\s+)*(?:push|reset|clean|restore|stash|rm|mv|checkout\s+(?:\S+\s+)*?(?:--|\.|-f|--force)|switch\s+(?:\S+\s+)*?(?:-f|--force|--discard-changes)|branch\s+-D|tag)(?=\s|$)/i, 'changes git history, remotes or uncommitted work'],
  [/\b(docker|podman)\s+(push|login)\b|\bdocker\s+(compose\s+)?down\s+(-v|--volumes)\b|\b(docker|podman)\s+(system|volume|image)\s+(prune|rm)\b/i, 'changes containers, images or volumes'],
  [/\bkubectl\s+(apply|create|delete|replace|patch|rollout|scale|edit|drain)\b|\bhelm\s+(install|upgrade|uninstall|delete|rollback)\b/i, 'changes a cluster'],
  [/\b(terraform|tofu|terragrunt)\s+(apply|destroy|import|state)\b|\bpulumi\s+(up|destroy)\b|\bcdk\s+deploy\b|\bserverless\s+(deploy|remove)\b/i, 'changes infrastructure'],
  [/\b(vercel|netlify|flyctl|fly|heroku|firebase|wrangler|eb|amplify|railway|surge)\b/i, 'talks to a hosting platform'],
  [/\b(aws|gcloud|az|doctl|s3cmd)\s/i, 'talks to a cloud account'],
  [/\b(scp|rsync|sftp|ssh)\b/i, 'copies to or runs on another machine'],
  [/\b(npm|pnpm|yarn|bun)\s+(publish|unpublish|deprecate|dist-tag)\b|\bcargo\s+(publish|yank)\b|\btwine\s+upload\b|\bgem\s+push\b|\bnuget\s+push\b|\bdotnet\s+nuget\s+push\b|\bpoetry\s+publish\b|\buv\s+publish\b|\bmvn\s+deploy\b|\bgh\s+(release|pr\s+merge|repo\s+(delete|edit))\b/i, 'publishes a package or release'],
  [/\brm\s+(?:\S+\s+)*?(?:-[a-z]*r[a-z]*|--recursive)(?=\s|$)|\brimraf\b|\b(?:rd|rmdir)\s+\/s\b|\bdel\s+(?:\/\w\s+)*\/[sq]\b|\b(?:Remove-Item|ri|rm|del|erase)\b.*\s-r(?:ecurse)?\b/i, 'deletes files recursively'],
  [/\bfind\b.*\s-(?:delete|exec(?:dir)?\s+(?:rm|mv|del)\b)/i, 'deletes files'],
  [/(?:^|[;&|]\s*)(?:mv|move|rm|del|erase|shred|Move-Item|Remove-Item|ri|mi)\s/i, 'moves or deletes files'],
  [/\bsudo\b|\bdoas\b|\brunas\b/i, 'needs administrator rights'],
  [/\b(curl|wget|iwr|Invoke-WebRequest)\b[^|]*\|\s*(ba|z)?sh\b|\biex\b/i, 'downloads and runs a script'],
  [/\bnpx\s+(?:\S+\s+)*?(?:-y|--yes)(?=\s|$)|\b(?:pnpm|yarn)\s+dlx\b|\bnpm\s+exec\s+(?:\S+\s+)*?(?:-y|--yes)(?=\s|$)|\buvx\b|\bpipx\s+run\b/i, 'downloads and runs a package'],
  [/\b(curl|wget|Invoke-RestMethod|irm|iwr|Invoke-WebRequest)\b.*\s(?:-X\s*|--request[\s=]+|-Method\s+)(?:POST|PUT|PATCH|DELETE)\b|\b(curl|wget)\b.*\s(?:-d|--data\S*|-F|--form|-T|--upload-file|--post-data|--post-file)(?=[\s=]|$)|\bgh\s+api\b.*\s(?:-X|--method)[\s=]*(?:POST|PUT|PATCH|DELETE)\b/i, 'sends changes to a remote system'],
  [/\b(?:delete\s+from|insert\s+into|alter\s+(?:table|database)|update\s+\S+\s+set)\b/i, 'changes data in a database'],
  [/\b(?:python3?|py|node|bun|ruby|perl)\s+(?:-\S+\s+)*?-(?:c|e|-eval)(?=\s|$)|\bphp\s+(?:-\S+\s+)*?-r(?=\s|$)/i, 'runs inline code keel cannot judge'],
  [/\b(prod|production|staging)\b/i, 'targets a shared environment'],
];

// The word rules use \b, which also matches inside names (`-`, `/` and `.` are boundaries), so names are
// blanked before matching: package selectors and compound file names that begin with a read-only verb.
// -w and --workspace take a value only for npm; in pnpm -w is a flag and the next word is the action.
// Directories stay visible: `scripts/deploy/check-x.sh` is still refused because of `deploy/`.
const READ_ONLY_VERBS = 'check|lint|test|verify|validate|audit|inspect|list|show|report';
const FILTER_VALUE = /(--filter|-F)(=|\s+)("[^"]*"|'[^']*'|\S+)/g;
const NPM_WORKSPACE_VALUE = /(\bnpm\b[^;&|\n]*?\s(?:--workspace|-w))(=|\s+)("[^"]*"|'[^']*'|\S+)/g;
const SCOPED_PACKAGE = /@[\w.-]+\/[\w.-]+/g;
// A name that also points at a shared environment (check-deploy-to-prod.js) stays visible.
const READ_ONLY_FILE = new RegExp(`(?<![\\w@.-])(?:${READ_ONLY_VERBS})[-_](?![\\w.-]*\\b(?:prod|production|staging)\\b)[\\w.-]*`, 'gi');

function withoutNames(text) {
  return text
    .replace(FILTER_VALUE, '$1$2<name>')
    .replace(NPM_WORKSPACE_VALUE, '$1$2<name>')
    .replace(SCOPED_PACKAGE, '<name>')
    .replace(READ_ONLY_FILE, '<name>');
}

// Options of package managers that take a value; npm's -w takes one, pnpm's -w is a flag.
const VALUE_OPTS = { npm: ['--prefix', '-w', '--workspace'], pnpm: ['--filter', '-F', '-C', '--dir'], yarn: ['--cwd'], bun: ['--cwd', '--filter', '-F'] };
// Options that run the script in other packages of the workspace, not only in this folder.
const WIDE_OPTS = /^(--prefix|-w|--workspace|--workspaces|-ws|--filter|-F|-C|--dir|--cwd|-r|--recursive)(=|$)/;
const BUILTINS = new Set(['install', 'i', 'ci', 'add', 'exec', 'dlx', 'x']);

// The package script a command runs: `npm -s run test`, `pnpm --filter web test`, `yarn workspace web test`.
function scriptCall(piece) {
  const t = piece.split(/\s+/);
  if (!VALUE_OPTS[t[0]]) return null;
  let i = 1;
  let wide = false;
  if (t[0] === 'yarn' && t[1] === 'workspace') { wide = true; i = 3; }
  const skipOptions = () => {
    for (; i < t.length && t[i].startsWith('-'); i++) {
      if (WIDE_OPTS.test(t[i]) && !(t[0] === 'pnpm' && t[i] === '-w')) wide = true;
      if (VALUE_OPTS[t[0]].includes(t[i])) i++;
    }
  };
  skipOptions();
  if (t[i] === 'run' || t[i] === 'run-script') { i++; skipOptions(); }
  return t[i] && !BUILTINS.has(t[i]) ? { name: t[i], wide } : null;
}

// package.json files of the workspace below dir, for a script that may run in any of them.
function packageFiles(dir) {
  const out = [];
  const stack = [[dir, 0]];
  while (stack.length && out.length < 200) {
    const [d, depth] = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isFile() && e.name === 'package.json') out.push(path.join(d, e.name));
      else if (e.isDirectory() && depth < 4 && !['node_modules', '.git', 'dist', 'build', 'vendor'].includes(e.name)) stack.push([path.join(d, e.name), depth + 1]);
    }
  }
  return out;
}

// `make [-C dir] [-f file] [-j N] [VAR=x] targets...`; no target means the first rule.
function makeCall(piece, dir) {
  const t = piece.split(/\s+/);
  if (!/^(make|gmake|mingw32-make)$/.test(t[0])) return null;
  let at = dir;
  let file = null;
  const targets = [];
  for (let i = 1; i < t.length; i++) {
    const a = t[i];
    if (a === '-C' || a === '--directory') at = path.resolve(at, t[++i] || '.');
    else if (/^-C./.test(a) || a.startsWith('--directory=')) at = path.resolve(at, a.replace(/^-C|^--directory=/, ''));
    else if (a === '-f' || a === '--file' || a === '--makefile') file = t[++i];
    else if (/^--(file|makefile)=/.test(a)) file = a.split('=')[1];
    else if (/^-[jl]$/.test(a)) { if (/^\d+$/.test(t[i + 1] || '')) i++; }
    else if (/^-[IoW]$/.test(a)) i++;
    else if (!a.startsWith('-') && !a.includes('=')) targets.push(a);
  }
  const makefile = file ? path.resolve(at, file) : ['Makefile', 'makefile', 'GNUmakefile'].map((f) => path.join(at, f)).find((f) => fs.existsSync(f));
  if (!makefile) return null;
  if (!targets.length) {
    let text = '';
    try { text = fs.readFileSync(makefile, 'utf8'); } catch {}
    const first = /^([A-Za-z0-9_][A-Za-z0-9_.-]*)\s*:(?!=)/m.exec(text);
    if (first) targets.push(first[1]);
  }
  return { makefile, targets };
}

// Wrappers that run the command after them: `time npm test`, `cross-env X=1 npm test`, `(npm test)`.
function unwrap(piece) {
  let p = withoutEnv(piece).trim();
  for (let before = ''; before !== p;) {
    before = p;
    p = withoutEnv(p.replace(/^\(+\s*|\s*\)+$/g, '').replace(/^(?:time|nice|nohup|command|exec|(?:npx\s+)?cross-env(?:-shell)?|env(?:\s+-\S+)*)\s+/, '')).trim();
  }
  return p;
}

function readJson(file) {
  try { return readJsonFile(file); } catch { return null; }
}

function makeRecipe(makefile, target, seen = new Set()) {
  if (seen.has(target)) return '';
  seen.add(target);
  let text;
  try { text = fs.readFileSync(makefile, 'utf8'); } catch { return ''; }
  const lines = text.split(/\r?\n/);
  const head = lines.findIndex((l) => new RegExp(`^${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:(?!=)`).test(l));
  if (head === -1) return '';
  const deps = lines[head].split(':')[1].split(/\s+/).filter(Boolean);
  const body = [];
  for (let i = head + 1; i < lines.length && /^\t/.test(lines[i]); i++) body.push(lines[i].trim());
  return [...deps.map((d) => makeRecipe(makefile, d, seen)), ...body].join('\n');
}

// Expands a command into everything it really runs (script bodies, recipes), up to a few levels.
function expand(command, dir, depth = 0) {
  if (depth > 5) return [command];
  const out = [command];
  for (const piece of command.split(/&&|\|\||[;\n|&]/).map(unwrap).filter(Boolean)) {
    const npm = scriptCall(piece);
    if (npm) {
      for (const file of npm.wide ? [path.join(dir, 'package.json'), ...packageFiles(dir)] : [path.join(dir, 'package.json')]) {
        const scripts = (readJson(file) || {}).scripts || {};
        for (const name of [npm.name, `pre${npm.name}`, `post${npm.name}`]) if (typeof scripts[name] === 'string') out.push(...expand(scripts[name], path.dirname(file), depth + 1));
      }
    }
    const comp = /^composer\s+(?:run-script\s+|run\s+)?([A-Za-z0-9:_.-]+)/.exec(piece);
    if (comp) {
      const json = readJson(path.join(dir, 'composer.json'));
      const body = json && json.scripts && json.scripts[comp[1]];
      for (const b of [].concat(body || [])) out.push(...expand(String(b).replace(/^@/, ''), dir, depth + 1));
    }
    const make = makeCall(piece, dir);
    if (make) for (const target of make.targets) out.push(...expand(makeRecipe(make.makefile, target), path.dirname(make.makefile), depth + 1));
  }
  return out;
}

function judge(projectDir, partDir, command) {
  const dir = path.resolve(projectDir, partDir || '.');
  const inside = path.relative(path.resolve(projectDir), dir);
  if (inside.startsWith('..') || path.isAbsolute(inside)) return { safe: false, reasons: ['the part folder is outside the project'] };
  const reasons = new Set();
  for (const text of expand(command, dir)) for (const [re, why] of DENY) if (re.test(withoutNames(text))) reasons.add(`${why} (${text.split('\n')[0].slice(0, 80)})`);
  return reasons.size ? { safe: false, reasons: [...reasons] } : { safe: true, reasons: [] };
}

module.exports = { judge, expand };

if (require.main === module) {
  const args = process.argv.slice(2);
  const sep = args.indexOf('--');
  // The same reading of the folders as the permission hook (parseArgs), so both judge one project.
  const pos = sep < 0 ? [] : require('./lib/project.js').parseArgs(args.slice(0, sep)).pos;
  let line;
  if (pos.length < 2) line = 'refused: usage: node safe-command.js <projectDir> <partDir> -- <command>';
  else {
    const r = judge(pos[0], pos[1], args.slice(sep + 1).join(' '));
    line = r.safe ? 'safe' : `refused: ${r.reasons.join('; ')}`;
  }
  process.stdout.write(`${line}\n`);
}
