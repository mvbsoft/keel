'use strict';
// The instructions `/doctor prompt-audit` reads besides keel's own, in the project and in the user's
// Claude folder: instruction files with their line counts and the number of entries in each folder.
// The audit is advised from AUDIT_LINES lines in those files or AUDIT_ENTRIES folder entries: below
// that there is too little for two instructions to contradict each other (a judgement, not measured).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const AUDIT_LINES = 50;
const AUDIT_ENTRIES = 3;
const AUDITED_FILES = /^(CLAUDE|CLAUDE\.local|AGENTS|AGENTS\.override)\.md$/;
const AUDITED_DIRS = ['rules', 'skills', 'commands', 'agents', 'output-styles'];

// The folder of the user's Claude Code settings (KEEL_USER_SETTINGS points tests at a file there).
const userClaudeDir = () => (process.env.KEEL_USER_SETTINGS ? path.dirname(process.env.KEEL_USER_SETTINGS) : process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'));

const read = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };
const entries = (dir) => { try { return fs.readdirSync(dir).filter((n) => !n.startsWith('.')).length; } catch { return 0; } };

// ruleFiles: the project's AI instruction files, relative to root (the scan's ai_rules).
function otherInstructions(root, ruleFiles) {
  let lines = 0;
  let folders = 0;
  const list = (base, files, claudeDir) => {
    const out = [];
    for (const f of files) {
      const text = read(path.join(base, f));
      if (!text || !text.trim()) continue;
      const n = text.replace(/\r?\n$/, '').split(/\r?\n/).length;
      lines += n;
      out.push(`${f} (${n} lines)`);
    }
    for (const d of AUDITED_DIRS) {
      const n = entries(path.join(claudeDir, d));
      folders += n;
      if (n) out.push(`${d}: ${n}`);
    }
    return out;
  };
  const project = list(root, ruleFiles.filter((f) => AUDITED_FILES.test(path.basename(f))), path.join(root, '.claude'));
  const user = list(userClaudeDir(), ['CLAUDE.md'], userClaudeDir());
  return { project, user, advise_audit: lines >= AUDIT_LINES || folders >= AUDIT_ENTRIES };
}

// One line for the scan summary.
function describe(ins) {
  const parts = [ins.project.length && `project ${ins.project.join(', ')}`, ins.user.length && `user ~/.claude ${ins.user.join(', ')}`].filter(Boolean);
  return `other instructions: ${parts.join('; ') || 'none'}; audit: ${ins.advise_audit ? 'advise' : 'not needed'}`;
}

module.exports = { otherInstructions, describe };
