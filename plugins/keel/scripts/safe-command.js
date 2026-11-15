'use strict';
// Decides whether a gate command may be run once during configure. keel runs only tests, linters and
// type checks; anything that deploys, publishes, migrates, deletes or reaches remote systems is
// refused. Script aliases are followed to the commands they really run: `pnpm run check` is judged
// by the body of the "check" script in package.json, `make test` by its recipe, `./scripts/ci.sh` by
// the file, `cd api && npm test` by the script of api/package.json. Package names and file names that
// start with a read-only verb (check-migration-journal.mjs) are names, not actions.
// Usage: node safe-command.js <projectDir> <partDir> -- <command...>
// Prints "safe" or "refused: <reasons>". Always exits 0.
const fs = require('node:fs');
const path = require('node:path');
const { withoutEnv } = require('./lib/commands.js');
const { readJsonFile } = require('./lib/json.js');

// Options between a tool and its action: `-x` flags, each with at most one value that does not start
// with a dash. A value cannot be read as the next option, so a long run of them has one parse and the
// match stays linear instead of backtracking exponentially.
const OPTIONS = String.raw`(?:\s+-\S+(?:\s+[^-\s]\S*)?)*`;

const DENY = [
  [/\b(deploy|publish|release|rollout|promote|ship)\b/i, 'deploys or publishes'],
  [/\bmigrat(e|es|ion|ions)\b|\bdb:(migrate|seed|reset|drop|create)\b|\bmigrate:(fresh|refresh|reset|rollback)\b|\bseed(ers?)?\b/i, 'changes a database'],
  [new RegExp([
    String.raw`\bprisma(?:@\S+)?\s+db\s+(?:push|execute|seed)\b`,
    String.raw`\balembic${OPTIONS}\s+(?:upgrade|downgrade|stamp)\b`,
    String.raw`\bflask${OPTIONS}\s+db${OPTIONS}\s+(?:upgrade|downgrade|stamp)\b`,
    String.raw`\b(?:manage\.py|django-admin)\s+(?:flush|loaddata|reset_db)\b`,
    String.raw`\bdb:(?:setup|prepare|rollback|redo|purge|wipe|schema:load|structure:load)\b`,
    String.raw`\btypeorm\S*\s+schema:(?:drop|sync)\b`,
    String.raw`\bdrizzle-kit(?:@\S+)?\s+(?:push|drop)\b`,
    String.raw`\bsupabase\s+db\s+reset\b`,
    String.raw`\b(?:diesel|sqlx)\s+database\s+(?:reset|drop)\b`,
    String.raw`\bflyway${OPTIONS}\s+clean\b`,
  ].join('|'), 'i'), 'changes a database'],
  // Flush and drop are matched next to the tool that runs them, so `grep -r flushall src` stays a search.
  // `dropdb` is a command of its own, refused wherever it stands (after an env prefix, inside `bash -c`);
  // the SQL words index, view and column need an SQL client.
  [new RegExp([
    String.raw`\b(?:redis|valkey|keydb)-cli\b.*\bflush(?:all|db)\b`,
    String.raw`\bflush(?:all|db)\b.*\b(?:redis|valkey|keydb)-cli\b`,
    String.raw`\bmongosh?\b.*(?:\.drop(?:Database)?\(|\bdropDatabase\b)`,
    String.raw`\bmongorestore\b.*\s--drop\b`,
    String.raw`\bdrop\s+(?:database|table|schema)\b`,
    String.raw`\btruncate\s+table\b`,
    String.raw`\bdropdb\b`,
    String.raw`\bmysqladmin${OPTIONS}\s+drop\b`,
    String.raw`\b(?:psql|mysql|mariadb|sqlite3|sqlcmd|usql)\b.*\b(?:truncate\s+[^-\s]|drop\s+(?:index|view|column)\b)`,
  ].join('|'), 'i'), 'deletes data'],
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
// A test file is a name whatever words it holds (migrate.test.js, db_migrate_test.go), but only in the
// shapes test runners use: `.test`/`.spec` before a JS or TS extension, `_test`/`_spec` before the
// extension of a language that names its tests that way. `deploy-test.sh` is a script, not a test.
const TEST_FILE = /(?<![\w@.-])(?![\w.-]*\b(?:prod|production|staging)\b)[\w.-]+(?:\.(?:test|spec)\.(?:[cm]?[jt]sx?)|_(?:test|spec)\.(?:go|py|rb|dart|exs|rs|php))(?!\w)/gi;
const READ_ONLY_FILE = new RegExp(`(?<![\\w@.-])(?:${READ_ONLY_VERBS})[-_](?![\\w.-]*\\b(?:prod|production|staging)\\b)[\\w.-]*`, 'gi');
// The Release build configuration is a name too, but only as the option of the build tool itself:
// `dotnet test -c Release`, `msbuild /p:Configuration=Release`, `cargo test --release`,
// `swift test -c release`. A `-c` elsewhere (`bash -c release.sh`) and words after `--` stay visible.
const BUILD_TOOL = /(?<![\w./\\-])(dotnet|swift|msbuild|cargo)(?:\.exe)?(?=\s)/i;
const RELEASE = String.raw`(?=release["')]*$)`;
const RELEASE_OPTION = {
  dotnet: new RegExp(String.raw`^(?:--configuration=|[-/](?:p|property):Configuration=)${RELEASE}`, 'i'),
  swift: new RegExp(String.raw`^--configuration=${RELEASE}`, 'i'),
  msbuild: new RegExp(String.raw`^[-/](?:p|property):Configuration=${RELEASE}`, 'i'),
  cargo: new RegExp(String.raw`^--${RELEASE}`, 'i'),
};
const RELEASE_VALUE = new RegExp(`^${RELEASE}`, 'i');
function withoutReleaseConfig(text) {
  return text.replace(/[^;&|\n]+/g, (piece) => {
    const m = BUILD_TOOL.exec(piece);
    if (!m) return piece;
    const tool = m[1].toLowerCase();
    const at = m.index + m[0].length;
    const parts = piece.slice(at).split(/(\s+)/);
    for (let i = 0; i < parts.length && parts[i] !== '--'; i += 2) {
      const value = /^(dotnet|swift)$/.test(tool) && /^(-c|--configuration)$/i.test(parts[i]) ? i + 2 : -1;
      if (value > 0 && RELEASE_VALUE.test(parts[value] || '')) parts[value] = `<name>${parts[value].slice(7)}`;
      const head = RELEASE_OPTION[tool].exec(parts[i]);
      if (head) parts[i] = `${head[0]}<name>${parts[i].slice(head[0].length + 7)}`;
    }
    return piece.slice(0, at) + parts.join('');
  });
}

function withoutNames(text) {
  return withoutReleaseConfig(text)
    .replace(FILTER_VALUE, '$1$2<name>')
    .replace(NPM_WORKSPACE_VALUE, '$1$2<name>')
    .replace(SCOPED_PACKAGE, '<name>')
    .replace(TEST_FILE, '<name>')
    .replace(READ_ONLY_FILE, '<name>');
}

// Options of package managers that take a value; npm's -w takes one, pnpm's -w is a flag.
const VALUE_OPTS = { npm: ['--prefix', '-w', '--workspace'], pnpm: ['--filter', '-F', '-C', '--dir'], yarn: ['--cwd'], bun: ['--cwd', '--filter', '-F'] };
// Options that run the script in other packages of the workspace, not only in this folder.
const WIDE_OPTS = /^(--prefix|-w|--workspace|--workspaces|-ws|--filter|-F|-C|--dir|--cwd|-r|--recursive)(=|$)/;
const BUILTINS = new Set(['install', 'i', 'ci', 'add', 'exec', 'dlx', 'x']);
// Commands that run the "test" script: `npm t`, `npm cit` (clean install, then test), `pnpm it`.
const TEST_ALIAS = { npm: /^(t|tst|it|install-test|cit|install-ci-test|clean-install-test|sit)$/, pnpm: /^(t|tst|it|install-test)$/ };

// Task runners that run a package script in every package of the workspace: `turbo run test`,
// `nx run-many -t test`, `lerna run test`, `yarn workspaces foreach -A run test`. Every bare word may
// name a task, so each is looked up.
function taskRunner(t) {
  let i = 0;
  if (/^(npx|bunx)$/.test(t[0])) i = 1;
  else if (/^(npm|pnpm|yarn|bun)$/.test(t[0]) && /^(exec|x)$/.test(t[1])) i = 2;
  else if (/^(pnpm|yarn)$/.test(t[0]) && /^(turbo|nx|lerna)(@\S+)?$/.test(t[1])) i = 1;
  while (i && i < t.length && t[i].startsWith('-')) i++;
  let rest;
  if (/^(turbo|nx|lerna)(@\S+)?$/.test(t[i])) rest = t.slice(i + 1);
  else if (t[0] === 'yarn' && t[1] === 'workspaces' && /^(foreach|run)$/.test(t[2])) rest = t.slice(3);
  else return null;
  const end = rest.indexOf('--');
  const names = (end < 0 ? rest : rest.slice(0, end))
    .flatMap((w) => w.replace(/^--?(?:targets?|t)=/, '').split(/[,:]/))
    .filter((w) => w && !w.startsWith('-') && !['run', 'run-many', 'affected', 'exec'].includes(w));
  const runner = /^(turbo|nx)/.exec(t[i]);
  return names.length ? { names, wide: true, runner: runner && runner[1] } : null;
}

// turbo and nx first run the tasks a task depends on: `"test": { "dependsOn": ["^build", "db:reset"] }`
// in turbo.json, or in nx.json `targetDefaults` and a project's own target (`{ "target": "build" }`).
function dependsOnTasks(names, root, runner) {
  let tasks;
  if (runner === 'turbo') {
    const json = readJson(path.join(root, 'turbo.json')) || {};
    tasks = Object.entries(json.tasks || json.pipeline || {});
  } else {
    tasks = Object.entries((readJson(path.join(root, 'nx.json')) || {}).targetDefaults || {});
    for (const file of packageFiles(root)) {
      const json = readJson(file) || {};
      tasks.push(...Object.entries((path.basename(file) === 'project.json' ? json.targets : json.nx && json.nx.targets) || {}));
    }
  }
  const all = new Set(names);
  for (const name of all) {
    for (const [key, task] of tasks) {
      if (key !== name && !key.endsWith(`#${name}`)) continue;
      for (const dep of [].concat((task && task.dependsOn) || [])) {
        const target = typeof dep === 'string' ? dep : dep && dep.target;
        if (typeof target === 'string') all.add(target.replace(/^\^/, '').replace(/^[^#]*#/, ''));
      }
    }
  }
  return [...all];
}

// The package script a command runs: `npm -s run test`, `pnpm --filter web test`, `yarn workspace web test`.
function scriptCall(piece) {
  const t = piece.split(/\s+/);
  const task = taskRunner(t);
  if (task) return task;
  if (!VALUE_OPTS[t[0]]) return null;
  let i = 1;
  let wide = false;
  if (t[0] === 'yarn' && t[1] === 'workspace') { wide = true; i = 3; }
  const isWide = (word) => WIDE_OPTS.test(word) && !(t[0] === 'pnpm' && word === '-w');
  const skipOptions = () => {
    for (; i < t.length && t[i].startsWith('-'); i++) {
      if (isWide(t[i])) wide = true;
      if (VALUE_OPTS[t[0]].includes(t[i])) i++;
    }
  };
  skipOptions();
  const run = t[i] === 'run' || t[i] === 'run-script';
  if (run) { i++; skipOptions(); }
  if (!t[i] || BUILTINS.has(t[i])) return null;
  // Options after the name may still reach the package manager (`npm test --workspaces`); only the
  // words after `--` are the script's own.
  for (let j = i + 1; j < t.length && t[j] !== '--'; j++) if (isWide(t[j])) wide = true;
  const name = !run && TEST_ALIAS[t[0]] && TEST_ALIAS[t[0]].test(t[i]) ? 'test' : t[i];
  return { names: [name], wide };
}

// package.json and nx project.json files of the workspace below dir, for a script that may run in
// any of them.
function packageFiles(dir) {
  const out = [];
  const stack = [[dir, 0]];
  while (stack.length && out.length < 200) {
    const [d, depth] = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isFile() && (e.name === 'package.json' || e.name === 'project.json')) out.push(path.join(d, e.name));
      else if (e.isDirectory() && depth < 4 && !['node_modules', '.git', 'dist', 'build', 'vendor'].includes(e.name)) stack.push([path.join(d, e.name), depth + 1]);
    }
  }
  return out;
}

// `make [-C dir] [-f file] [-j N] [VAR=x] targets...`; no target means the first rule. `$(MAKE)` is
// make inside a recipe.
function makeCall(piece, dir) {
  const t = piece.split(/\s+/);
  if (!/^(make|gmake|mingw32-make|\$\(MAKE\)|\$\{MAKE\})$/.test(t[0])) return null;
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

// The shell commands of a target and its prerequisites. make runs each recipe line in a new shell, so a
// `cd` on one line does not reach the next, unless the Makefile sets `.ONESHELL:`. A line ending in `\`
// goes on the next line; the `@`, `-` and `+` that start a line are make's, not the shell's.
function makeRecipe(makefile, target, seen = new Set()) {
  if (seen.has(target)) return [];
  seen.add(target);
  let text;
  try { text = fs.readFileSync(makefile, 'utf8'); } catch { return []; }
  const lines = text.split(/\r?\n/);
  const head = lines.findIndex((l) => new RegExp(`^${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:(?!=)`).test(l));
  if (head === -1) return [];
  const deps = lines[head].split(':')[1].split(/\s+/).filter(Boolean);
  const body = [];
  for (let i = head + 1; i < lines.length && (/^\t/.test(lines[i]) || /\\$/.test(body[body.length - 1] || '')); i++) {
    const line = lines[i].trim();
    if (/\\$/.test(body[body.length - 1] || '')) body[body.length - 1] = `${body[body.length - 1].slice(0, -1)} ${line}`;
    else body.push(line.replace(/^[@+-]+\s*/, ''));
  }
  const own = /^\.ONESHELL\s*:/m.test(text) ? [body.join('\n')] : body;
  return [...deps.flatMap((d) => makeRecipe(makefile, d, seen)), ...own];
}

// `cd api`, `pushd api`, `Set-Location api`, `cd /d D:\x`: the folder the later pieces run in.
// Redirects (`> /dev/null`, `2>&1`, `*> $null`) are left out before the match; a cd that still does
// not match is refused.
const CD = /^(cd|chdir|pushd|popd|Set-Location|sl|Push-Location|Pop-Location)(?:\s+(?:\/d|-Path|-LiteralPath))?(?:\s+("[^"]*"|'[^']*'|\S+))?$/i;
const CD_VERB = /^(cd|chdir|pushd|popd|Set-Location|sl|Push-Location|Pop-Location)(?=\s|$)/i;
const REDIRECT = /(?:\s+[\d*])?\s*(?:&>>?|>>?|<)\s*(?:&\d+|"[^"]*"|'[^']*'|[^\s<>]+)?/g;

function changeDir([, verb, arg], dir, pushed, ctx) {
  if (/^(popd|Pop-Location)$/i.test(verb)) return pushed.length ? pushed.pop() : dir;
  const target = arg ? arg.replace(/^["']|["']$/g, '') : '';
  if (!target || target === '-' || /^~|[$%]/.test(target)) {
    ctx.refused.add(`changes to a folder keel cannot follow (${[verb, target].join(' ').trim()})`);
    return dir;
  }
  const next = path.resolve(dir, target);
  const rel = path.relative(ctx.root, next);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    ctx.refused.add(`leaves the project folder (${verb} ${target})`);
    return dir;
  }
  if (/^(pushd|Push-Location)$/i.test(verb)) pushed.push(dir);
  return next;
}

// npm, pnpm and yarn run the scripts of the nearest package.json at or above the folder.
function nearestPackage(dir, root) {
  for (let d = dir; ; d = path.dirname(d)) {
    const file = path.join(d, 'package.json');
    if (fs.existsSync(file)) return file;
    const rel = path.relative(root, d);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || path.dirname(d) === d) return path.join(dir, 'package.json');
  }
}

// The commands a package script or an nx target runs.
function scriptBodies(file, name) {
  const json = readJson(file) || {};
  if (path.basename(file) === 'project.json') {
    const target = (json.targets || {})[name] || {};
    const options = target.options || {};
    return [target.command, options.command, ...[].concat(options.commands || []).map((c) => (c && typeof c === 'object' ? c.command : c))].filter((c) => typeof c === 'string');
  }
  const scripts = json.scripts || {};
  return [name, `pre${name}`, `post${name}`].map((n) => scripts[n]).filter((c) => typeof c === 'string');
}

// The lines of a shell script file the piece runs: `./scripts/ci.sh`, `bash -e scripts/ci`,
// `pwsh -File test.ps1`, `script/test` with a `#!/bin/sh` first line. Comment lines are left out. A
// file that cannot be read is judged by its name. The Maven and Gradle wrappers only download and
// start the build tool, so `./mvnw test` is judged by its words.
const SCRIPT_FILE = /\.(?:sh|bash|zsh|ps1|bat|cmd)$/i;
const SHELL_SHEBANG = /^#!\s*(?:\S*\/)?(?:env\s+(?:-\S+\s+)*)?(?:sh|bash|zsh|dash|ksh)(?:\s|$)/;
const WRAPPER = /^(?:mvnw|gradlew)(?:\.cmd|\.bat)?$/i;
function scriptFile(piece, dir, root) {
  const t = piece.split(/\s+/).map((w) => w.replace(/^["']|["']$/g, ''));
  let file = SCRIPT_FILE.test(t[0]) ? t[0] : null;
  if (!file && t[0].includes('/') && !path.isAbsolute(t[0]) && !path.relative(root, path.resolve(dir, t[0])).startsWith('..')) {
    try { if (SHELL_SHEBANG.test(fs.readFileSync(path.resolve(dir, t[0]), 'utf8').split(/\r?\n/, 1)[0])) file = t[0]; } catch {}
  }
  if (!file && /^(?:sh|bash|zsh|dash|ksh|source|\.|pwsh|powershell|cmd)(?:\.exe)?$/i.test(t[0])) {
    file = t.slice(1).find((w) => SCRIPT_FILE.test(w)) || null;
    if (!file && /^(?:sh|bash|zsh|dash|ksh|source|\.)$/.test(t[0])) {
      const i = t.findIndex((w, k) => k > 0 && !w.startsWith('-'));
      if (i > 0 && !t.slice(1, i).some((w) => /^-\w*c$/.test(w))) file = t[i];
    }
  }
  if (!file || WRAPPER.test(path.basename(file))) return null;
  try {
    return fs.readFileSync(path.resolve(dir, file), 'utf8').split(/\r?\n/).filter((l) => !/^\s*(?:#|rem\b|::)/i.test(l)).join('\n');
  } catch { return null; }
}

// Expands a command into everything it really runs (script bodies, recipes, script files), up to a few
// levels. A `cd` moves the later pieces to its folder; a `( ... )` subshell and `sh -c '...'` keep
// their `cd` inside.
function expand(command, dir, depth = 0, ctx = { root: dir, refused: new Set() }) {
  if (depth > 5) return [command];
  const out = [command];
  const subshells = [];
  const pushed = [];
  const quoted = [];
  const text = command.replace(/(?<![\w.-])(?:sh|bash|zsh|dash|ksh)(?:\.exe)?(?:\s+-[a-z]+)*?\s+-[a-z]*c\s+('[^']*'|"[^"]*")/gi, (m, q) => {
    quoted.push(q.slice(1, -1));
    return `${m.slice(0, -q.length)}\u0000${quoted.length - 1}`;
  });
  // `2>&1` and `&>` are redirects, not `&` that runs a command in the background.
  for (const raw of text.split(/&&|\|\||[;\n|]|(?<![<>])&(?!>)/)) {
    for (let n = /^[\s(]*/.exec(raw)[0].split('(').length - 1; n > 0; n--) subshells.push(dir);
    const piece = unwrap(raw);
    const bare = piece.replace(REDIRECT, '').trim();
    const cd = CD_VERB.test(bare) && CD.exec(bare);
    if (cd) dir = changeDir(cd, dir, pushed, ctx);
    else if (CD_VERB.test(bare)) ctx.refused.add(`changes to a folder keel cannot follow (${bare.slice(0, 80)})`);
    else if (piece) {
      for (const [, k] of piece.matchAll(/\u0000(\d+)/g)) out.push(...expand(quoted[k], dir, depth + 1, ctx));
      const npm = scriptCall(piece);
      if (npm) {
        const own = nearestPackage(dir, ctx.root);
        const names = npm.runner ? dependsOnTasks(npm.names, ctx.root, npm.runner) : npm.names;
        for (const file of npm.wide ? [own, ...packageFiles(dir)] : [own]) {
          for (const name of names) for (const body of scriptBodies(file, name)) out.push(...expand(body, path.basename(file) === 'project.json' ? dir : path.dirname(file), depth + 1, ctx));
        }
      }
      const comp = /^composer\s+(?:run-script\s+|run\s+)?([A-Za-z0-9:_.-]+)/.exec(piece);
      if (comp) {
        const json = readJson(path.join(dir, 'composer.json'));
        const body = json && json.scripts && json.scripts[comp[1]];
        for (const b of [].concat(body || [])) out.push(...expand(String(b).replace(/^@/, ''), dir, depth + 1, ctx));
      }
      const make = makeCall(piece, dir);
      if (make) for (const target of make.targets) for (const line of makeRecipe(make.makefile, target)) out.push(...expand(line, path.dirname(make.makefile), depth + 1, ctx));
      const file = scriptFile(piece, dir, ctx.root);
      if (file) out.push(...expand(file, dir, depth + 1, ctx));
    }
    for (let n = /[\s)]*$/.exec(raw)[0].split(')').length - 1; n > 0 && subshells.length; n--) dir = subshells.pop();
  }
  return out;
}

function judge(projectDir, partDir, command) {
  const root = path.resolve(projectDir);
  const dir = path.resolve(root, partDir || '.');
  const inside = path.relative(root, dir);
  if (inside.startsWith('..') || path.isAbsolute(inside)) return { safe: false, reasons: ['the part folder is outside the project'] };
  const ctx = { root, refused: new Set() };
  const reasons = new Set();
  for (const text of expand(command, dir, 0, ctx)) {
    for (const [re, why] of DENY) {
      if (!re.test(withoutNames(text))) continue;
      const lines = text.split('\n');
      reasons.add(`${why} (${(lines.find((l) => re.test(withoutNames(l))) || lines[0]).slice(0, 80)})`);
    }
  }
  for (const why of ctx.refused) reasons.add(why);
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
    const r = judge(require('./lib/project-dir.js').scriptProject(pos[0]), pos[1], args.slice(sep + 1).join(' '));
    line = r.safe ? 'safe' : `refused: ${r.reasons.join('; ')}`;
  }
  process.stdout.write(`${line}\n`);
}
