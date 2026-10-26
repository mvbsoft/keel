'use strict';
// own-files.js against ways of making the hook approve one thing while the shell or the script does
// another.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PLUGIN = path.join(__dirname, '..', 'plugins', 'keel');
const SCRIPTS = path.join(PLUGIN, 'scripts').split(path.sep).join('/');

function hook(tool, toolInput, env = {}, cwd = undefined) {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE_') && k !== 'KEEL_USAGE_DIR'));
  const r = spawnSync(process.execPath, [path.join(PLUGIN, 'hooks', 'own-files.js')], {
    input: JSON.stringify({ tool_name: tool, tool_input: toolInput }),
    env: { ...clean, KEEL_USAGE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'keel-usage-')), CLAUDE_PLUGIN_ROOT: PLUGIN, CLAUDE_PROJECT_DIR: '/p', ...env },
    encoding: 'utf8',
    cwd,
  });
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : null;
}
const decide = (...args) => hook(...args)?.permissionDecision ?? null;
const shell = (command, tool = 'Bash', env, cwd) => decide(tool, { command }, env, cwd);

function project(git) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-own-'));
  fs.mkdirSync(path.join(dir, '.keel'));
  fs.writeFileSync(path.join(dir, '.keel', 'config.json'), JSON.stringify({ git: { main_branch: 'main', ask_before_merge: true, ...git } }));
  return dir.split(path.sep).join('/');
}

test('an option before the step cannot hide the step: the hook reads arguments like the scripts', () => {
  const manual = project({ mode: 'manual' });
  for (const cmd of [
    `node "${SCRIPTS}/git-flow.js" "${manual}" --x status merge`,
    `node "${SCRIPTS}/git-flow.js" "${manual}" --x status push`,
    `node "${SCRIPTS}/cleanup.js" "/p" --x 1 empty-trash`,
    `node "${SCRIPTS}/cleanup.js" "/p" --batch b empty-trash`,
    `node "${SCRIPTS}/migrate.js" "/p" --from .old apply plan.json`,
    `node "${SCRIPTS}/usage-setup.js" "/p" --m x apply f.json`,
    `node "${SCRIPTS}/claude-settings.js" "/p" --x show apply`,
  ]) {
    assert.notEqual(shell(cmd), 'allow', cmd);
    assert.notEqual(shell(cmd, 'PowerShell'), 'allow', cmd);
  }
  assert.equal(shell(`node "${SCRIPTS}/git-flow.js" "${manual}" status --x 1`, 'Bash', { CLAUDE_PROJECT_DIR: manual }), 'allow', 'options after the step are fine');
});

test('characters a shell expands inside an argument are refused with the plain form to use', () => {
  for (const arg of ['(Set-Content x.txt pwned)', '@(iex x)', '{ iex x }', '$env:X', '"$HOME"', "'a'b", 'a"b c"d', '"a\\" b', '*.json', 'x#y', '/p/x,empty-trash']) {
    const cmd = `node "${SCRIPTS}/check-config.js" "/p" ${arg}`;
    assert.equal(shell(cmd, 'PowerShell'), 'deny', cmd);
    assert.equal(shell(cmd), 'deny', cmd);
  }
  assert.equal(shell(`node "${SCRIPTS}/cleanup.js" "/p" move --items 1,2 --red 5`), 'allow', 'a list of numbers is fine');
});

test('a link or title in quotes may hold & ? # and separators; outside quotes they still refuse', () => {
  const proj = project({ mode: 'manual' });
  const env = { CLAUDE_PROJECT_DIR: proj };
  for (const arg of ['"https://docs.google.com/d/1?usp=sharing&ouid=1"', '"#123"', '--title "A & B; C | D"', "'a<b>c'"]) {
    const cmd = `node "${SCRIPTS}/notes.js" "${proj}" lane ${arg}`;
    assert.equal(shell(cmd, 'Bash', env), 'allow', cmd);
    assert.equal(shell(cmd, 'PowerShell', env), 'allow', cmd);
  }
  for (const arg of ['"a" & calc', 'a&b', '"a$(id)b"', '"x“ & calc & “y"', '\\" & calc & \\"', '"a`nb"']) {
    const cmd = `node "${SCRIPTS}/notes.js" "${proj}" lane ${arg}`;
    assert.notEqual(shell(cmd, 'Bash', env), 'allow', cmd);
    assert.notEqual(shell(cmd, 'PowerShell', env), 'allow', cmd);
  }
});

test('a config saved with a byte order mark still decides the git mode', () => {
  const proj = project({ mode: 'autonomous', ask_before_merge: false });
  const file = path.join(proj, '.keel', 'config.json');
  fs.writeFileSync(file, '\uFEFF' + fs.readFileSync(file, 'utf8'));
  assert.equal(shell(`node "${SCRIPTS}/git-flow.js" "${proj}" merge`, 'Bash', { CLAUDE_PROJECT_DIR: proj }), 'ask', 'not trusted here: the merge asks');
  const { trust } = require(path.join(PLUGIN, 'scripts', 'lib', 'trust.js'));
  const usage = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-usage-'));
  trust(proj, { KEEL_USAGE_DIR: usage });
  assert.equal(shell(`node "${SCRIPTS}/git-flow.js" "${proj}" merge`, 'Bash', { CLAUDE_PROJECT_DIR: proj, KEEL_USAGE_DIR: usage }), 'allow', 'trusted, with ask_before_merge off');
});

test('trust always gets Claude Code\'s own prompt, whatever the permission rules allow', () => {
  const proj = project({ mode: 'autonomous' });
  assert.equal(shell(`node "${SCRIPTS}/git-flow.js" "${proj}" trust`, 'Bash', { CLAUDE_PROJECT_DIR: proj }), 'ask');
});

test('only scripts in keel\'s own scripts folder', () => {
  const evil = fs.mkdtempSync(path.join(os.tmpdir(), 'evil-')).split(path.sep).join('/');
  for (const cmd of [
    `node "${evil}/scan.js" "/p"`,
    `node "${SCRIPTS}/../scan.js" "/p"`,
    `node "${SCRIPTS}-evil/scan.js" "/p"`,
  ]) assert.equal(shell(cmd), null, cmd);
  assert.equal(shell(`node "${SCRIPTS}/lib/project.js" "/p"`), 'deny', 'keel\'s library is never run directly');
  if (process.platform === 'win32') assert.equal(shell(`node "${SCRIPTS.replace(/\//g, '\\')}\\scan.js" "/p"`, 'PowerShell'), 'allow', 'backslashes name the same script');
  if (process.platform === 'win32') assert.equal(shell(`node "${SCRIPTS.toUpperCase()}/scan.js" "/p"`, 'PowerShell'), 'allow', 'Windows paths ignore case');
});

test('every shell operator next to a keel script is refused, never allowed', () => {
  for (const tail of ['| sh', '< /etc/passwd', '`id`', '\nid', '\rid', '; id', '&& id', '|| id', '& id', '> out.txt']) {
    assert.equal(shell(`node "${SCRIPTS}/scan.js" "/p" ${tail}`), 'deny', tail);
  }
});

test('the project argument must be the current project; usage.js writes only under its .keel/local', () => {
  const proj = project({ mode: 'manual' });
  const env = { CLAUDE_PROJECT_DIR: proj };
  assert.equal(shell(`node "${SCRIPTS}/scan.js" "${proj}"`, 'Bash', env), 'allow');
  assert.equal(shell(`node "${SCRIPTS}/scan.js" "${os.homedir().split(path.sep).join('/')}"`, 'Bash', env), null);
  // Each of these was allowed once and then ran on another folder.
  for (const arg of [
    '~', '"~"', '~/x', '--x=~/y', // bash expands ~ after the hook said yes
    `"${proj}/pkg"`, `"${proj}/apps/api"`, // a sub-folder may be another project with its own .keel
    '.', `"${path.basename(proj)}"`, // relative: resolved from the shell's folder, not the project
  ]) {
    // run from inside the project, where a relative path resolves into it
    assert.notEqual(shell(`node "${SCRIPTS}/notes.js" ${arg} task inventory X-1`, 'Bash', env, proj), 'allow', arg);
    assert.notEqual(shell(`node "${SCRIPTS}/notes.js" ${arg} task inventory X-1`, 'PowerShell', env, proj), 'allow', arg);
    // a step that always asks is refused in that form, so no allow rule can run it unconfirmed
    assert.equal(shell(`node "${SCRIPTS}/notes.js" ${arg} task drop X-1`, 'Bash', env, proj), 'deny', arg);
  }
  assert.equal(shell(`node "${SCRIPTS}/notes.js" "${proj}" task inventory X-1`, 'Bash', env), 'allow');
  assert.equal(shell(`node "${SCRIPTS}/notes.js" "${proj}" task inventory X-1`, 'Bash', {}), null, 'no known project, no decision');
  if (process.platform === 'win32') {
    const back = proj.replace(/\//g, '\\');
    const winEnv = { CLAUDE_PROJECT_DIR: back };
    // bash drops an unquoted backslash (C:\p becomes C:p); quoted, the path reaches node as written
    assert.equal(shell(`node "${SCRIPTS}/notes.js" ${back} check`, 'Bash', winEnv), 'deny');
    // an unquoted backslash path to a keel script is not the plain form either: refused, so it is resent plainly
    assert.equal(shell(`node ${SCRIPTS.replace(/\//g, '\\')}\\notes.js "${back}" check`, 'Bash', winEnv), 'deny');
    assert.equal(shell(`node "${SCRIPTS}/notes.js" "${back}" check`, 'Bash', winEnv), 'allow');
    assert.equal(shell(`node "${SCRIPTS}/notes.js" ${back} check`, 'PowerShell', winEnv), 'allow', 'PowerShell keeps backslashes');
  }
  // Without --project, prepare would use the shell's folder, which may be another project.
  assert.equal(shell(`node "${SCRIPTS}/usage.js" prepare`, 'Bash', env), null);
  assert.equal(shell(`node "${SCRIPTS}/usage.js" prepare --project "${proj}" --out "${proj}/.keel/local/usage/out"`, 'Bash', env), 'allow');
  assert.equal(shell(`node "${SCRIPTS}/usage.js" ack --batch 1`, 'Bash', env), 'allow', 'machine-level steps need no project');
  assert.equal(shell(`node "${SCRIPTS}/usage.js" prepare --project "${proj}" --out "${os.homedir().split(path.sep).join('/')}"`, 'Bash', env), null);
  // --project names the current project; --keel is read only from its .keel/local/
  const home = os.homedir().split(path.sep).join('/');
  assert.equal(shell(`node "${SCRIPTS}/usage.js" prepare --project "${proj}" --keel "${proj}/.keel/local/tmp/keel.json"`, 'Bash', env), 'allow');
  for (const feature of ['empty-trash', 'delete-branch']) {
    for (const tool of ['Bash', 'PowerShell']) assert.equal(shell(`node "${SCRIPTS}/usage.js" prepare --project "${proj}" --session abc --feature ${feature}`, tool, env), 'allow', `a feature named ${feature}`);
  }
  assert.equal(shell(`node "${SCRIPTS}/usage.js" prepare --project "${home}"`, 'Bash', env), null);
  assert.equal(shell(`node "${SCRIPTS}/usage.js" prepare --project .`, 'Bash', env, proj), null, 'a relative --project');
  assert.equal(shell(`node "${SCRIPTS}/usage.js" prepare --project "${proj}" --keel "${proj}/credentials.json"`, 'Bash', env), null);
  assert.equal(shell(`node "${SCRIPTS}/usage.js" prepare --project "${proj}" --keel "${home}/.aws/credentials.json"`, 'Bash', env), null);
});

test('Glob and Grep are allowed only inside keel\'s folder', () => {
  for (const p of [os.homedir(), `${PLUGIN}-evil`, path.join(PLUGIN, '..')]) {
    assert.equal(decide('Glob', { pattern: '**/*', path: p }), null, p);
    assert.equal(decide('Grep', { pattern: 'x', path: p }), null, p);
  }
  assert.equal(decide('Grep', { pattern: 'x' }), null, 'no path: the project, not keel');
  assert.equal(decide('Grep', { pattern: 'x', path: path.join(PLUGIN, 'skills') }), 'allow');
});

test('scan.js and check-config.js read their arguments like the hook: the project is the first word that is no option value', () => {
  const cur = project({ mode: 'manual' });
  fs.rmSync(path.join(cur, '.keel', 'config.json'));
  const other = project({ mode: 'manual' });
  fs.writeFileSync(path.join(other, '.keel', 'config.json'), '{');
  const node = (script, ...args) => spawnSync(process.execPath, [path.join(SCRIPTS, script), ...args], { encoding: 'utf8' }).stdout.trim().split('\n');
  assert.equal(node('check-config.js', '--x', other, cur)[0], 'keel-config: missing', 'the hook judged the current project, the script checks it');
  assert.equal(shell(`node "${SCRIPTS}/check-config.js" --x "${other}" "${cur}"`, 'Bash', { CLAUDE_PROJECT_DIR: cur }), 'allow');
  assert.ok(node('check-config.js', cur, '--profile').includes('profile: missing'));
  const out = `${cur}/.keel/local/tmp/scan.json`;
  assert.match(node('scan.js', '--x', other, cur, '--out', out)[0], /^scan: \d+ files/);
  assert.ok(fs.existsSync(out), 'written in the current project');
});

test('usage.js --out must be under .keel/local/usage/', () => {
  const proj = project({ mode: 'manual' });
  const env = { CLAUDE_PROJECT_DIR: proj };
  assert.equal(shell(`node "${SCRIPTS}/usage.js" prepare --project "${proj}" --out "${proj}/.keel/local/trash"`, 'Bash', env), null);
  assert.equal(shell(`node "${SCRIPTS}/usage.js" prepare --project "${proj}" --out "${proj}/.keel/local"`, 'Bash', env), null);
  assert.equal(shell(`node "${SCRIPTS}/usage.js" prepare --project "${proj}" --out "${proj}/.keel/local/usage/out"`, 'Bash', env), 'allow');
});

test('a step that must be confirmed is refused when keel\'s script is named by another path ($CLAUDE_PLUGIN_ROOT, ~, another copy)', () => {
  const proj = project({ mode: 'manual' });
  const env = { CLAUDE_PROJECT_DIR: proj };
  for (const script of ['"$CLAUDE_PLUGIN_ROOT/scripts/git-flow.js"', '"${CLAUDE_PLUGIN_ROOT}/scripts/git-flow.js"', '~/.claude/plugins/cache/keel/keel/1.0.0/scripts/git-flow.js', '/opt/keel-copy/scripts/git-flow.js']) {
    assert.equal(shell(`node ${script} "${proj}" merge`, 'Bash', env), 'deny', script);
    assert.equal(shell(`node ${script} "${proj}" trust`, 'Bash', env), 'deny', script);
  }
  assert.equal(shell(`node "$CLAUDE_PLUGIN_ROOT/scripts/notes.js" "${proj}" task drop X-1`, 'Bash', env), 'deny');
  assert.equal(shell(`node ~/keel/scripts/cleanup.js "${proj}" empty-trash`, 'Bash', env), 'deny');
  assert.equal(shell(`cd "${proj}" && node "$CLAUDE_PLUGIN_ROOT/scripts/notes.js" "${proj}" task delete X-1`, 'Bash', env), 'deny', 'joined');
  assert.equal(shell(`node "$CLAUDE_PLUGIN_ROOT/scripts/scan.js" "${proj}"`, 'Bash', env), null, 'a step that only reads is left to the user\'s permissions');
  assert.equal(shell('node scripts/cleanup.js delete', 'Bash', env), null, 'the project\'s own script of the same name is not keel\'s');
});

test('keel\'s library run directly (its functions drop or delete without the step scripts) is refused', () => {
  const proj = project({ mode: 'manual' });
  const env = { CLAUDE_PROJECT_DIR: proj };
  for (const lib of [`${SCRIPTS}/lib/tasks.js`, `${SCRIPTS}/./lib/tasks.js`, `${SCRIPTS}//lib/tasks.js`, '$CLAUDE_PLUGIN_ROOT/scripts/lib/tasks.js', '${CLAUDE_PLUGIN_ROOT}/scripts/lib/trash.js', '~/.claude/plugins/cache/keel/keel/1.0.0/scripts/lib/tasks.js']) {
    assert.equal(shell(`node -e "require('${lib}').taskDrop('${proj}', 'X-1')"`, 'Bash', env), 'deny', lib);
    assert.equal(shell(`node --eval "require(\\"${lib}\\")"`, 'Bash', env), 'deny', lib);
  }
  assert.equal(shell(`node "${SCRIPTS}/lib/tasks.js"`, 'Bash', env), 'deny', 'run as a file');
  assert.equal(shell(`cat "${SCRIPTS}/lib/tasks.js"`, 'Bash', env), null, 'reading it runs nothing');
  assert.equal(shell('node -e "require(\'./src/lib/tasks.js\')"', 'Bash', env), null, 'the project\'s own lib is not keel\'s');
  assert.equal(shell('node /home/u/keeler-app/scripts/lib/build.js', 'Bash', env), null, 'a project with keel in its path keeps its own scripts/lib');
  for (const cmd of ['node /Users/jkeeling/app/scripts/lib/tasks.js', 'node /srv/keel-app/scripts/lib/finish.js', `grep -rn node "${SCRIPTS}/lib/"`, `grep "require('node:fs')" "${SCRIPTS}/lib/tasks.js"`]) {
    assert.equal(shell(cmd, 'Bash', env), null, `not keel's library run: ${cmd}`);
  }
  for (const cmd of [`cd "$CLAUDE_PLUGIN_ROOT" && node -e "require('./scripts/lib/tasks.js')"`, `node -e "require(require('path').join('${SCRIPTS}', 'lib', 'tasks.js'))"`,
    `node -e "require(require('path').join(process.env.CLAUDE_PLUGIN_ROOT, 'scripts', 'lib', 'tasks.js'))"`, `npx tsx -e "require('${SCRIPTS}/lib/tasks.js')"`, `env FOO=1 node "${SCRIPTS}/lib/tasks.js"`]) {
    assert.equal(shell(cmd, 'Bash', env), 'deny', cmd);
  }
});

test('keel\'s QA agents write only under the project\'s .keel/local/tmp/qa/', () => {
  const proj = project({ mode: 'manual' });
  const write = (agent, file) => {
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE_') && k !== 'KEEL_USAGE_DIR'));
    const r = spawnSync(process.execPath, [path.join(PLUGIN, 'hooks', 'own-files.js')], {
      input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: file, content: 'x' }, ...(agent && { agent_id: 'a1', agent_type: agent }) }),
      env: { ...clean, KEEL_USAGE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'keel-usage-')), CLAUDE_PLUGIN_ROOT: PLUGIN, CLAUDE_PROJECT_DIR: proj },
      encoding: 'utf8',
    });
    return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : null;
  };
  for (const agent of ['keel:qa', 'keel:qa-break']) {
    assert.equal(write(agent, `${proj}/.keel/local/tmp/qa/check.js`), 'allow', `${agent}: its own folder, no prompt`);
    for (const file of [`${proj}/.env`, `${proj}/src/app.js`, `${proj}/.keel/local/tmp/qa/../../config.json`, '/tmp/elsewhere.js', `${proj}/.keel/local/tmp/qa-other/x.js`]) {
      assert.equal(write(agent, file), 'deny', `${agent}: ${file}`);
    }
  }
  assert.equal(write('keel:implementer', `${proj}/src/app.js`), null, 'the implementer writes code');
  assert.equal(write(null, `${proj}/src/app.js`), null, 'the main conversation writes code');
});

test('words split only on spaces and tabs: a special space or control character cannot move a step past the hook', () => {
  const proj = project({ mode: 'autonomous' });
  const env = { CLAUDE_PROJECT_DIR: proj };
  const n = (name) => `node "${SCRIPTS}/${name}" "${proj}"`;
  for (const tool of ['Bash', 'PowerShell']) {
    // Bash keeps a non-breaking space inside a word (`<proj> /../<name>` resolves back to the project);
    // Windows PowerShell 5.1 splits words on U+0085. Either way the hook would read another step.
    for (const cmd of [`${n('plans.js')}\u00a0"/../${path.basename(proj)}" push f1`, `node "${SCRIPTS}/usage.js" prepare --project\u00a0"${proj}"`,
      `${n('plans.js')} --k v\u0085push f1`, `${n('git-flow.js')} --k v\u0085merge`, `${n('cleanup.js')} --k v\u0085empty-trash`,
      `${n('plans.js')} --k v\u000bpush f1`, `${n('plans.js')} --k v\u00a0push f1`, `${n('plans.js')} "x\u0085y" push f1`]) {
      assert.equal(shell(cmd, tool, env), 'deny', `${tool}: ${JSON.stringify(cmd)}`);
    }
    // Inside quotes both shells keep a special space as text: a title copied from a tracker, French text.
    for (const cmd of [`${n('plans.js')} ticket f1 --title "Fix\u00a0export"`, `${n('plans.js')} ticket f1 --title 'Prix\u202f: 10\u00a0€\u3000x'`]) {
      assert.equal(shell(cmd, tool, env), 'allow', `${tool}: ${JSON.stringify(cmd)}`);
    }
    assert.equal(shell(`${n('plans.js')} find стара оплата користувачів`, tool, env), 'allow', `${tool}: words in other alphabets`);
    // U+2028 and U+2029 count as control characters, also inside quotes; refused with the plain form to use.
    for (const ch of ['\u2028', '\u2029']) {
      const out = hook(tool, { command: `${n('plans.js')} ticket f1 --title "a${ch}b"` }, env);
      const what = `${tool}: U+${ch.charCodeAt(0).toString(16).toUpperCase()} in a title`;
      assert.equal(out?.permissionDecision, 'deny', what);
      assert.match(out.permissionDecisionReason, /^keel: run keel's scripts as one plain command/, what);
    }
  }
});

test('a double quote inside single quotes is refused: Windows PowerShell 5.1 passes it to node unescaped', () => {
  const proj = project({ mode: 'autonomous' });
  const env = { CLAUDE_PROJECT_DIR: proj };
  const n = (name) => `node "${SCRIPTS}/${name}" "${proj}"`;
  for (const tool of ['Bash', 'PowerShell']) {
    for (const cmd of [`${n('plans.js')} '"commit"' -m x`, `${n('plans.js')} '""push'`, `${n('plans.js')} --t 'a"' '"b' push`, `${n('plans.js')} 'push" "f1" "--a b'`,
      `${n('cleanup.js')} '"empty-trash"' --all`, `${n('notes.js')} task '"drop"' t1`, `${n('notes.js')} task '"delete"' t1`, `${n('git-flow.js')} '"merge"'`]) {
      assert.equal(shell(cmd, tool, env), 'deny', `${tool}: ${cmd}`);
    }
  }
});

test('a bare word starting with one - that holds a dot is refused in PowerShell: Windows PowerShell 5.1 splits it at the dot', () => {
  const proj = project({ mode: 'autonomous' });
  const env = { CLAUDE_PROJECT_DIR: proj };
  // PowerShell passes `-a.` as `-a` and `.`: node reads --x -a and the project ".", the current folder,
  // so the confirmed step runs while the hook would read no project at all.
  const hidden = [`node "${SCRIPTS}/cleanup.js" --x -a. empty-trash --all`, `node "${SCRIPTS}/git-flow.js" --x -a. merge`, `node "${SCRIPTS}/notes.js" --x -a. task drop 3`];
  for (const tool of ['Bash', 'PowerShell']) {
    for (const cmd of hidden) assert.equal(shell(cmd, tool, env), 'deny', `${tool}: ${cmd}`);
  }
  const out = hook('PowerShell', { command: `node "${SCRIPTS}/plans.js" "${proj}" ticket f1 --title "x" -t.x` }, env);
  assert.equal(out?.permissionDecision, 'deny', 'PowerShell: a bare -t.x after the project');
  assert.match(out.permissionDecisionReason, /^keel: run keel's scripts as one plain command/);
  assert.equal(shell(`node "${SCRIPTS}/plans.js" "${proj}" ticket f1 --title "x" -t.x`, 'Bash', env), 'allow', 'Bash passes -t.x as one word');
});

test('a confirmed step word in a command whose project is not the current one is refused, but not plans.js search words', () => {
  const proj = project({ mode: 'autonomous' });
  const env = { CLAUDE_PROJECT_DIR: proj };
  for (const tool of ['Bash', 'PowerShell']) {
    assert.equal(shell(`node "${SCRIPTS}/git-flow.js" "/elsewhere" status merge`, tool, env), 'deny', `${tool}: git-flow.js`);
    assert.equal(shell(`node "${SCRIPTS}/plans.js" "/elsewhere" find drop users`, tool, env), null, `${tool}: plans.js find`);
  }
});

test('a comma list of words reaches keel only quoted: PowerShell would pass a bare one as an array', () => {
  const proj = project({ mode: 'autonomous' });
  const env = { CLAUDE_PROJECT_DIR: proj };
  const n = (name) => `node "${SCRIPTS}/${name}" "${proj}"`;
  // end-session's commit of the tickets it marked done, as git.md runs it.
  const commit = `${n('git-flow.js')} commit --message-file "${proj}/.keel/local/tmp/commit-message.txt" --tickets`;
  for (const tool of ['Bash', 'PowerShell']) {
    assert.equal(shell(`${n('plans.js')} ticket f1 --title "x" --depends T1,T2`, tool, env), 'deny', `${tool}: bare --depends`);
    assert.equal(shell(`${n('plans.js')} ticket f1 --title "x" --depends "T1,T2"`, tool, env), 'allow', `${tool}: quoted --depends`);
    assert.equal(shell(`${commit} K-1,K-2`, tool, env), 'deny', `${tool}: bare --tickets`);
    assert.equal(shell(`${commit} "K-1,K-2"`, tool, env), null, `${tool}: quoted --tickets, left to the git mode (not confirmed here)`);
  }
});

test('a step word in quotes is plain text: a title "drop" or a branch "merge" runs, bare they are refused', () => {
  const proj = project({ mode: 'autonomous' });
  const env = { CLAUDE_PROJECT_DIR: proj };
  for (const tool of ['Bash', 'PowerShell']) {
    const notes = (title) => shell(`node "${SCRIPTS}/notes.js" "${proj}" task new T1 --title ${title} --source text --session s1`, tool, env);
    assert.equal(notes('"drop"'), 'allow', `${tool}: a quoted title`);
    assert.equal(notes('drop'), 'deny', `${tool}: a bare title`);
    const start = (name) => shell(`node "${SCRIPTS}/git-flow.js" "${proj}" start --name ${name}`, tool, env);
    assert.notEqual(start('"merge"'), 'deny', `${tool}: a quoted branch name`);
    assert.equal(start('merge'), 'deny', `${tool}: a bare branch name`);
  }
});

test('on Windows only A-Z fold: a path with the Kelvin sign for k is another folder, for the hook and for trust', { skip: process.platform !== 'win32' }, () => {
  const proj = project({ mode: 'autonomous' });
  const env = { CLAUDE_PROJECT_DIR: proj };
  const other = proj.replace('k', '\u212a');
  assert.notEqual(other, proj);
  assert.equal(shell(`node "${SCRIPTS}/plans.js" "${other}" drop f1`, 'Bash', env), null, 'the Kelvin sign names another folder');
  assert.equal(shell(`node "${SCRIPTS}/plans.js" "${proj.toUpperCase()}" drop f1`, 'Bash', env), 'allow', 'A-Z case does not matter');
  const { trust, isTrusted, trustState } = require(path.join(PLUGIN, 'scripts', 'lib', 'trust.js'));
  const tenv = { KEEL_USAGE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'keel-usage-')) };
  trust(proj, tenv);
  assert.equal(isTrusted(proj.toUpperCase(), tenv), true);
  assert.equal(trustState(other, tenv), 'none', 'no confirmation is found for the other folder');
});

test('plans.js is keel\'s own: its steps run silently (drop and done too), commit and push always ask, also named elsewhere', () => {
  const proj = project({ mode: 'autonomous' });
  const env = { CLAUDE_PROJECT_DIR: proj };
  const plans = (args, tool = 'Bash') => shell(`node "${SCRIPTS}/plans.js" "${proj}" ${args}`, tool, env);
  for (const args of ['list', 'find drop old users', 'find delete merge trust', 'new csv-export', 'ticket csv-export --title "Drop the old column"', 'check csv-export', 'state csv-export ready', 'settings set --draft repo', 'mark set csv-export --session s1', 'tickets', 'tickets PROJ-1 --fetch', 'done PROJ-1', 'done PROJ-1 --undo', 'drop csv-export']) {
    assert.equal(plans(args), 'allow', args);
    assert.equal(plans(args, 'PowerShell'), 'allow', args);
  }
  // Planning files into git and onto the remote: Claude Code asks every time, even in autonomous mode
  // or with an allow rule for node.
  for (const args of ['commit', 'push', 'commit csv-export', '--x 1 push']) assert.equal(plans(args), 'ask', args);
  assert.equal(shell(`node "${SCRIPTS}/plans.js" "/elsewhere" commit`, 'Bash', env), 'deny', 'only on the current project');
  assert.equal(shell(`node "${SCRIPTS}/plans.js" "/elsewhere" list`, 'Bash', env), null);
  // Named by another path, commit and push are refused; its other steps are left to the user's permissions.
  for (const cmd of [`node "$CLAUDE_PLUGIN_ROOT/scripts/plans.js" "${proj}" commit`, `node ~/keel/scripts/plans.js "${proj}" push`, `cd "${proj}" && node "$CLAUDE_PLUGIN_ROOT/scripts/plans.js" "${proj}" push`]) {
    assert.equal(shell(cmd, 'Bash', env), 'deny', cmd);
  }
  // drop is not a step that asks: named by another path it is left to the user's permissions.
  for (const args of ['find drop users', 'drop csv-export', 'done PROJ-1']) assert.equal(shell(`node "$CLAUDE_PLUGIN_ROOT/scripts/plans.js" "${proj}" ${args}`, 'Bash', env), null, args);
  // Several scripts in one command: each one's confirmed steps count.
  for (const cmd of [
    `node "$CLAUDE_PLUGIN_ROOT/scripts/plans.js" "${proj}" list && node "$CLAUDE_PLUGIN_ROOT/scripts/notes.js" "${proj}" task drop T1`,
    `node "$CLAUDE_PLUGIN_ROOT/scripts/notes.js" "${proj}" tasks && node "$CLAUDE_PLUGIN_ROOT/scripts/plans.js" "${proj}" commit`,
  ]) assert.equal(shell(cmd, 'Bash', env), 'deny', cmd);
});

test('PowerShell reads the en dash, em dash and horizontal bar as a dash too, and a bare -a: splits the -b:c after it', () => {
  const proj = project({ mode: 'autonomous' });
  const env = { CLAUDE_PROJECT_DIR: proj };
  for (const d of ['\u2013', '\u2014', '\u2015']) {
    // PowerShell passes `<dash>a.` as `<dash>a` and `.`: node reads the project "." and runs commit unconfirmed.
    for (const tool of ['Bash', 'PowerShell']) assert.equal(shell(`node "${SCRIPTS}/plans.js" --x ${d}a. commit f1`, tool, env), 'deny', `${tool}: ${d}a. before commit`);
    assert.equal(shell(`node "${SCRIPTS}/plans.js" "${proj}" find ${d}a.b`, 'PowerShell', env), 'deny', `PowerShell: ${d}a.b`);
    assert.equal(shell(`node "${SCRIPTS}/plans.js" "${proj}" find ${d}a.b`, 'Bash', env), 'allow', `Bash: ${d}a.b`);
  }
  // Two dashes of any kind: PowerShell passes the word whole.
  assert.equal(shell(`node "${SCRIPTS}/plans.js" "${proj}" find \u2013\u2013a.b -\u2013a.b`, 'PowerShell', env), 'allow');
  // `-a: -b:commit` reaches node as -a:, -b: and commit.
  assert.equal(shell(`node "${SCRIPTS}/plans.js" "${proj}" find -a: x`, 'PowerShell', env), 'deny', 'PowerShell: -a:');
  assert.equal(shell(`node "${SCRIPTS}/plans.js" "${proj}" find -a: x`, 'Bash', env), 'allow', 'Bash: -a:');
});

test('plans.js commit or push anywhere in its command is never silent: refused off the current project, asked on it', () => {
  const proj = project({ mode: 'autonomous' });
  const env = { CLAUDE_PROJECT_DIR: proj };
  for (const tool of ['Bash', 'PowerShell']) {
    for (const cmd of [`node "${SCRIPTS}/plans.js" "/elsewhere" find commit`, `node "${SCRIPTS}/plans.js" --x y "push" f1`, `node "${SCRIPTS}/plans.js" "${proj}/sub" new push`]) {
      const out = hook(tool, { command: cmd }, env);
      assert.equal(out?.permissionDecision, 'deny', `${tool}: ${cmd}`);
      assert.match(out.permissionDecisionReason, /exact absolute path/, `${tool}: ${cmd}`);
    }
    assert.equal(shell(`node "${SCRIPTS}/plans.js" "${proj}" find commit history`, tool, env), 'ask', `${tool}: find commit history`);
    assert.equal(shell(`node "${SCRIPTS}/plans.js" "${proj}" new push`, tool, env), 'ask', `${tool}: new push`);
    assert.equal(shell(`node "${SCRIPTS}/plans.js" "${proj}" find "commit history"`, tool, env), 'allow', `${tool}: quoted search`);
    assert.equal(shell(`node "${SCRIPTS}/plans.js" "${proj}" ticket f1 --title "Push notifications"`, tool, env), 'allow', `${tool}: title`);
  }
});

test('a confirmed step word with a project path that is not the current one\'s exact path is refused, naming that path', () => {
  const proj = project({ mode: 'autonomous' });
  const env = { CLAUDE_PROJECT_DIR: proj };
  for (const tool of ['Bash', 'PowerShell']) {
    const out = hook(tool, { command: `node "${SCRIPTS}/git-flow.js" "${proj}/sub" start --name drop --from main` }, env);
    assert.equal(out?.permissionDecision, 'deny', tool);
    assert.match(out.permissionDecisionReason, /exact absolute path/, tool);
  }
});
