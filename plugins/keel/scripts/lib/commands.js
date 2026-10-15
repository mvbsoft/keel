'use strict';
// Finds candidate test / lint / type-check commands for one project part, best source first:
// CI steps → package scripts and task runners → git hooks → tool configs → ecosystem conventions.
// Nothing is run here; every candidate carries the file it came from.
// Also reads which program a shell command runs (programOf, withoutEnv), for every keel script and hook.

const KIND_BY_NAME = [
  ['types', /^(type-?check|types|check-?types|tsc|typecheck:.*|mypy|pyright|phpstan|psalm|analy[sz]e)$/i],
  ['lint', /^(lint(:.*)?|eslint|ruff|flake8|rubocop|cs|phpcs|cs-check|style|format:check|fmt-check)$/i],
  ['test', /^(test(:.*)?|tests|spec|unit)$/i],
];
const KIND_BY_COMMAND = [
  ['types', /\b(tsc\b|mypy|pyright|phpstan|psalm|type-?check|cargo check|srb tc|deno check|dotnet build)/i],
  ['lint', /\b(lint|eslint|ruff|flake8|pylint|rubocop|golangci|clippy|phpcs|php-cs-fixer|stylelint|prettier --check|biome (check|lint)|go vet|dotnet format)/i],
  ['test', /\b(test|tests|pytest|phpunit|pest|jest|vitest|mocha|rspec|ctest|codecept|prove|tox|nox)\b/i],
];

// Leading NAME=value words only set the environment of that one run (`MSYS_NO_PATHCONV=1 docker run ...`):
// the program is the first word after them.
const ENV_PREFIX = /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)*/;
const withoutEnv = (command) => String(command).replace(ENV_PREFIX, '');
const programOf = (command) => withoutEnv(command).split(/\s+/)[0];

function kindOfName(name) {
  for (const [kind, re] of KIND_BY_NAME) if (re.test(name)) return kind;
  return null;
}
// Setup and housekeeping lines in CI are not checks, whatever words they contain.
const NOT_A_CHECK = /^(git|echo|printf|cd|export|set|mkdir|cp|mv|rm|cat|ls|touch|chmod|chown|sleep|source|curl|wget|sudo|apt(-get)?|brew|choco|corepack|nvm|pyenv|if|fi|then|else|for|do|done|docker\s+(login|pull|push|build|tag))\b/;
const INSTALL = /\b(install|ci|sync|restore|setup|bootstrap|fetch)\b/;
// A token that is not part of what the command runs: a flag, a URL, an email or KEY=value.
const NOT_A_WORD = /^-|[@=]|^[a-z][a-z0-9+.-]*:\/\//i;

function kindOfCommand(cmd) {
  const clean = withoutEnv(cmd).trim();
  if (/&&|\|\||;/.test(clean) && !/["']/.test(clean)) { // `npm ci && npm test`: the check is the second step
    for (const step of clean.split(/\s*(?:&&|\|\||;)\s*/)) { const kind = kindOfCommand(step); if (kind) return kind; }
    return null;
  }
  if (NOT_A_CHECK.test(clean)) return null;
  const words = clean.split(/\s+/).filter((w) => !NOT_A_WORD.test(w)).join(' ');
  // Setup comes first: `pip install -e ".[test]"` and `uv sync --extra test` only name a test extra.
  // Script names such as test:ci are not setup.
  if (INSTALL.test(words.replace(/\S*:\S*/g, ''))) return null;
  for (const [kind, re] of KIND_BY_COMMAND) if (re.test(words)) return kind;
  return null;
}

const SCRIPT_PLACEHOLDER = /^echo\s+["']?Error: no test specified/i; // what `npm init` writes
// Watch, fix and dev variants of a script start servers or change files: not checks to run once.
const NOT_ONE_SHOT = /(^|[:_-])(watch|fix|dev)($|[:_-])/i;
const PREFERRED = /^(test|tests|lint|typecheck|type-check|check-types)$/i;

// Package or composer script names that can be a check, the exact names (test, lint, typecheck) first.
function checkScripts(scripts) {
  return Object.keys(scripts)
    .filter((n) => !NOT_ONE_SHOT.test(n) && !(typeof scripts[n] === 'string' && SCRIPT_PLACEHOLDER.test(scripts[n].trim())))
    .sort((a, b) => Number(PREFERRED.test(b)) - Number(PREFERRED.test(a)));
}

function npmScriptCommand(pm, name) {
  if (name === 'test' && pm !== 'bun') return `${pm} test`; // bun test is bun's own runner, not the package script
  return pm === 'yarn' ? `yarn ${name}` : `${pm} run ${name}`;
}

// A value wrapped in one pair of quotes loses them; quotes inside (`npm test "a b"`) stay.
const unwrap = (v) => v.replace(/^(["'])((?:(?!\1).)*)\1$/, '$2');
// A line with a GitHub expression (`npm run ${{ matrix.script }}`) is not a command yet.
const templated = (l) => l.includes('${{');

// Extracts shell lines from `run:` keys (GitHub Actions, lefthook) incl. `run: |` blocks.
function runLines(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const value = m[2].trim();
    if (value && !/^[|>][-+]?$/.test(value)) { out.push(unwrap(value)); continue; }
    const indent = m[1].length;
    for (i++; i < lines.length; i++) {
      const l = lines[i];
      if (l.trim() === '') continue;
      if (l.length - l.trimStart().length <= indent) { i--; break; }
      out.push(l.trim());
    }
  }
  return out.filter((l) => !templated(l));
}

// `script:` list items in GitLab CI and similar YAML.
function listItems(text) {
  return text.split(/\r?\n/).map((l) => /^\s*-\s+(?!id:|name:|uses:)(.+)$/.exec(l)).filter(Boolean).map((m) => unwrap(m[1].trim())).filter((l) => !templated(l));
}

function makeTargets(text) {
  return [...text.matchAll(/^([A-Za-z0-9_.-]+)\s*:(?!=)/gm)].map((m) => m[1]).filter((t) => !t.startsWith('.'));
}
function justRecipes(text) {
  return [...text.matchAll(/^@?([A-Za-z0-9_-]+)(?:\s+[^:\n]*)?:(?!=)/gm)].map((m) => m[1]);
}
function taskNames(text) {
  const block = /^tasks:\s*\n((?:[ \t]+.*\n?|\s*\n)*)/m.exec(text);
  if (!block) return [];
  const indent = /^([ \t]+)\S/m.exec(block[1]);
  if (!indent) return [];
  const re = new RegExp(`^${indent[1]}([A-Za-z0-9_:.-]+):`, 'gm');
  return [...block[1].matchAll(re)].map((m) => m[1]);
}

const join = (part, file) => (part === '.' ? file : `${part}/${file}`);

/**
 * @param {object} ctx { part, files:Set, readText(rel)->string|null, ecosystems:[catalog entries], packageManagers:{id:pm}, catalog, isRoot }
 * @returns {Array<{kind,command,source,rank}>}
 */
function findCommands(ctx) {
  const { part, files, readText, catalog } = ctx;
  const out = [];
  const add = (kind, command, source, rank) => {
    if (kind && command && !out.some((c) => c.kind === kind && c.command === command)) out.push({ kind, command, source, rank });
  };
  const has = (rel) => files.has(join(part, rel));
  const read = (rel) => (has(rel) ? readText(join(part, rel)) : null);

  // 1. CI (root only): what must pass to merge.
  if (ctx.isRoot) {
    for (const f of files) {
      if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(f) || f === '.circleci/config.yml' || f === 'azure-pipelines.yml' || f === 'bitbucket-pipelines.yml') {
        for (const cmd of runLines(readText(f) || '')) add(kindOfCommand(cmd), cmd, f, 1);
      }
      if (f === '.gitlab-ci.yml') for (const cmd of listItems(readText(f) || '')) add(kindOfCommand(cmd), cmd, f, 1);
    }
  }

  // 2. Package scripts and task runners.
  const pkg = read('package.json');
  if (pkg) {
    try {
      const scripts = JSON.parse(pkg).scripts || {};
      const pm = (ctx.packageManagers && ctx.packageManagers.npm) || 'npm';
      for (const name of checkScripts(scripts)) add(kindOfName(name), npmScriptCommand(pm, name), `${join(part, 'package.json')}#scripts.${name}`, 2);
    } catch { /* not JSON: reported by the scan as a gap */ }
  }
  const composer = read('composer.json');
  if (composer) {
    try {
      const scripts = JSON.parse(composer).scripts || {};
      for (const name of checkScripts(scripts)) add(kindOfName(name), `composer ${name}`, `${join(part, 'composer.json')}#scripts.${name}`, 2);
    } catch { /* ignore */ }
  }
  for (const f of catalog.task_runners.make) for (const t of makeTargets(read(f) || '')) add(kindOfName(t), `make ${t}`, join(part, f), 2);
  for (const f of catalog.task_runners.just) for (const t of justRecipes(read(f) || '')) add(kindOfName(t), `just ${t}`, join(part, f), 2);
  for (const f of catalog.task_runners.task) for (const t of taskNames(read(f) || '').filter((n) => !NOT_ONE_SHOT.test(n))) add(kindOfName(t), `task ${t}`, join(part, f), 2);

  // 3. Git hooks.
  if (ctx.isRoot) {
    if (has('.pre-commit-config.yaml')) add('lint', 'pre-commit run --all-files', '.pre-commit-config.yaml', 3);
    for (const f of catalog.git_hooks.lefthook) for (const cmd of runLines(read(f) || '')) add(kindOfCommand(cmd), cmd, f, 3);
    for (const f of catalog.git_hooks.husky) {
      for (const line of (read(f) || '').split(/\r?\n/)) {
        const cmd = line.trim();
        if (cmd && !cmd.startsWith('#') && !/^(\.|source)\s/.test(cmd)) add(kindOfCommand(cmd), cmd, f, 3);
      }
    }
  }

  // 4. Tool configs and 5. ecosystem conventions.
  for (const eco of ctx.ecosystems) {
    const pm = ctx.packageManagers && ctx.packageManagers[eco.id];
    const runner = (eco.runner && pm && eco.runner[pm]) || '';
    for (const tool of Object.values(eco.tools || {})) {
      const found = tool.markers.some((m) => {
        const [file, marker] = m.split('#');
        if (!has(file)) return false;
        return !marker || (read(file) || '').includes(marker);
      });
      if (found) add(tool.kind, (tool.runner === false ? '' : runner) + tool.command, `convention:${eco.id}`, 4);
    }
    for (const [kind, cmds] of Object.entries(eco.commands || {})) {
      for (let cmd of cmds) {
        for (const [wrapperFile, exe] of Object.entries(eco.wrapper || {})) {
          if (has(wrapperFile)) cmd = cmd.replace(/^(mvn|gradle)\b/, exe);
        }
        add(kind, cmd, `convention:${eco.id}`, 5);
      }
    }
  }
  return out.sort((a, b) => a.rank - b.rank);
}

module.exports = { findCommands, programOf, withoutEnv, kindOfName, kindOfCommand, runLines, listItems, makeTargets, justRecipes, taskNames };
