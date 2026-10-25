'use strict';
// Which files of a project belong to planning (/keel:start-planning), so tasks leave them alone: a task's
// commit, its verification and the fingerprint of its work skip them. Three kinds, told by their front
// matter, not by where they live (a project picks its own ticket folder):
//   draft    everything in a folder whose plan.md says `type: plan` with a plan status (the draft of a
//            feature in the repository: plan.md, tickets/, reviews/)
//   ticket   a .md file with `type: ticket` and a `key` (an exported ticket)
//   feature  a README.md with `type: feature` (the overview of an exported feature)
// A ticket or overview that is gone from the working tree is read from HEAD; a draft folder counts while
// its plan.md is there. Planning drafts kept on this machine live in .keel/local/, which tasks already
// leave out.
const fs = require('node:fs');
const path = require('node:path');
const { git, noBom, frontmatter } = require('./repo-read.js');

const PLAN_STATES = new Set(['draft', 'ready', 'exported', 'abandoned']);
const HEAD_BYTES = 4096;

// The start of a file: enough for its front matter. fromHead: read a file gone from the working tree
// from HEAD.
function head(root, rel, fromHead) {
  try {
    const fd = fs.openSync(path.join(root, rel), 'r');
    try {
      const buf = Buffer.alloc(HEAD_BYTES);
      return buf.toString('utf8', 0, fs.readSync(fd, buf, 0, HEAD_BYTES, 0));
    } finally { fs.closeSync(fd); }
  } catch {
    if (!fromHead) return null;
    const text = git(root, ['cat-file', 'blob', `HEAD:${rel}`]);
    return text === null ? null : text.slice(0, HEAD_BYTES);
  }
}

const fields = (text) => frontmatter(noBom(text || ''));

// (rel) => null | { kind: 'draft' | 'ticket' | 'feature', key }, for paths relative to the project
// folder with forward slashes. One checker per run: draft folders are looked up once.
function planningFiles(root) {
  const drafts = new Map();
  const isDraftFolder = (dir) => {
    if (!drafts.has(dir)) {
      const fm = fields(head(root, `${dir}/plan.md`));
      drafts.set(dir, fm.type === 'plan' && PLAN_STATES.has(fm.status));
    }
    return drafts.get(dir);
  };
  return (rel) => {
    const parts = rel.replace(/\\/g, '/').split('/');
    // The project's top folder is never a draft folder: a stray plan.md there must not hide the project.
    for (let i = 1; i < parts.length; i++) if (isDraftFolder(parts.slice(0, i).join('/'))) return { kind: 'draft', key: null };
    if (!/\.md$/i.test(rel)) return null;
    const fm = fields(head(root, rel, true));
    if (fm.type === 'ticket' && fm.key) return { kind: 'ticket', key: fm.key };
    if (fm.type === 'feature' && parts[parts.length - 1].toLowerCase() === 'readme.md') return { kind: 'feature', key: null };
    return null;
  };
}

module.exports = { planningFiles };
