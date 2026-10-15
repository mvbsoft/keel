'use strict';
// PreToolUse hook on Bash and PowerShell: refuses a `git commit` or `gh pr create/edit` whose text
// carries AI attribution (a Co-Authored-By trailer naming an AI, "Generated with Claude Code"), with
// the reason, so the session sends it again without. The text is the command itself and any message
// file it names (`-F file`, `--file file`, `--body-file file`). keel's standards forbid it, but in test
// runs the session added the trailer on 2 of 2 commits anyway. Only in a project keel is set up in.
// Everything else is left to the user's normal permissions (no output). Fails soft.
const fs = require('node:fs');
const path = require('node:path');
const { hasAttribution } = require('../scripts/lib/attribution.js');

const PUBLISHES = /\bgit\b[^\n]*\bcommit\b|\bgh\s+pr\s+(create|edit)\b/i;
// A message file the command names: -F file, --file file, --file=file, --body-file file (`-` is stdin).
const FILE_FLAG = /(?:^|\s)(?:-F|--file|--body-file)(?:=|\s+)("[^"]+"|'[^']+'|[^\s;&|<>]+)/g;
const MAX_FILE_BYTES = 256 * 1024;

function messageFiles(command, cwd) {
  const texts = [];
  for (const m of command.matchAll(FILE_FLAG)) {
    const name = m[1].replace(/^["']|["']$/g, '');
    if (name === '-') continue;
    try {
      const fd = fs.openSync(path.resolve(cwd || process.cwd(), name), 'r');
      try {
        const buf = Buffer.alloc(MAX_FILE_BYTES);
        texts.push(buf.toString('utf8', 0, fs.readSync(fd, buf, 0, buf.length, 0)));
      } finally {
        fs.closeSync(fd);
      }
    } catch { /* a missing or unreadable file: nothing to check */ }
  }
  return texts;
}

function check(input) {
  const command = input && input.tool_input && input.tool_input.command;
  if (typeof command !== 'string' || !PUBLISHES.test(command)) return null;
  if (!require('../scripts/lib/active.js').configured(process.env.CLAUDE_PROJECT_DIR || input.cwd)) return null;
  const texts = [command, ...messageFiles(command, input.cwd)];
  if (!texts.some(hasAttribution)) return null;
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: 'keel: no AI or tool attribution in commits and pull requests (no Co-Authored-By naming an AI, no "Generated with ..."). Nothing ran; send the same command again without it.',
    },
  };
}

if (require.main === module) {
  let out = null;
  try { out = check(JSON.parse(fs.readFileSync(0, 'utf8'))); } catch { /* fail soft */ }
  if (out) process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

module.exports = { check };
