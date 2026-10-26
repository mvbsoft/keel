'use strict';
// configure's first step and `/keel:configure check`: the setup check of check-config.js, then, in a
// configured project, what changed since the last configure and which sections it calls for (each with
// the fact and why it matters), and the command that runs only those. It changes no settings; it may
// write keel's local record of the last configure (.keel/local/configure-snapshot.json).
// Usage: node config-check.js <projectDir>
//          the check lines, then the config-check block. No record on this machine → it is rebuilt once
//          from the commit of keel's settings files (a temporary git worktree, removed again)
//        node config-check.js <projectDir> save [--sections "<s1,s2,...>"]
//          configure step 12: record the basis of the sections that ran (names or numbers; default
//          all), keeping the earlier record of the others, then the check lines
// Always exits 0; a failure prints one line starting with `config-check: error:`.
const path = require('node:path');
const { report, memo } = require('./check-config.js');
const drift = require('./lib/config-drift.js');
const { parseArgs, readJson } = require('./lib/project.js');

function main(argv) {
  const { opts, pos } = parseArgs(argv);
  const root = path.resolve(pos[0] || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const scanned = memo(() => require('./scan.js').scan(root));
  const config = readJson(path.join(root, '.keel', 'config.json'));
  if (pos[1] === 'save') {
    // Before the check, so a manifest change the user just confirmed reads as current.
    drift.saveSnapshot(root, { scanResult: scanned(), sections: drift.sectionList(opts.sections) });
    return report(root, true, scanned);
  }
  if (pos[1] !== undefined) return ['usage: node config-check.js <projectDir> [save [--sections "<s1,s2,...>"]]'];
  // First, so the profile line already compares with that record.
  let snapshot = null;
  if (config) { try { snapshot = drift.ensureSnapshot(root); } catch { /* compared with the profile below */ } }
  const lines = report(root, true, scanned);
  if (lines[0] !== 'keel-config: ok' || lines.some((l) => l.startsWith('git: '))) return lines;
  try {
    return [...lines, ...drift.check(root, { scanResult: scanned(), config, profile: readJson(path.join(root, '.keel', 'profile.json')), snapshot })];
  } catch (e) {
    return [...lines, `config-check: error: ${e.message}`];
  }
}

if (require.main === module) {
  let lines;
  try { lines = main(process.argv.slice(2)); } catch (e) { lines = [`config-check: error: ${e.message}`]; }
  process.stdout.write(lines.join('\n') + '\n');
  process.exit(0);
}

module.exports = { main };
