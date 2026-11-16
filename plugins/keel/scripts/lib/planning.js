'use strict';
// Which files of a project belong to planning (/keel:start-planning), so tasks leave them alone: a task's
// commit, its verification and the fingerprint of its work skip them. A planning file is anything in a
// feature folder: a folder whose plan.md says `type: plan` with a plan status (plan.md, tickets/,
// reviews/, research/), told by its front matter, not by where it lives (a project picks its own
// tickets_dir; another repository's folder of a feature has one too). A folder counts while its plan.md
// is there. Features kept on this machine live in .keel/local/, which tasks already leave out.
const fs = require('node:fs');
const path = require('node:path');
const { noBom, frontmatter } = require('./repo-read.js');

// The plan states and the ticket file name of lib/plans-drafts.js, written out here so a task's every
// step does not load it.
const PLAN_STATES = new Set(['draft', 'ready', 'in-progress', 'done', 'abandoned']);
const TICKET_FILE = /^T(\d+)-[a-z0-9-]+\.md$/;
const HEAD_BYTES = 4096;

// The start of a file: enough for its front matter.
function head(root, rel) {
  try {
    const fd = fs.openSync(path.join(root, rel), 'r');
    try {
      const buf = Buffer.alloc(HEAD_BYTES);
      return buf.toString('utf8', 0, fs.readSync(fd, buf, 0, HEAD_BYTES, 0));
    } finally { fs.closeSync(fd); }
  } catch { return null; }
}

// (rel) => null | { feature, ticket, plan } for paths relative to the project folder with forward
// slashes: `feature` the folder's name, `ticket` T<n> for its tickets/T<n>-<slug>.md (else null), `plan`
// for its plan.md. One checker per run: feature folders are looked up once.
function planningFiles(root) {
  const folders = new Map();
  const isFeatureFolder = (dir) => {
    if (!folders.has(dir)) {
      const fm = frontmatter(noBom(head(root, `${dir}/plan.md`) || ''));
      folders.set(dir, fm.type === 'plan' && PLAN_STATES.has(fm.status));
    }
    return folders.get(dir);
  };
  return (rel) => {
    const parts = rel.replace(/\\/g, '/').split('/');
    // The project's top folder is never a feature folder: a stray plan.md there must not hide the project.
    for (let i = 1; i < parts.length; i++) {
      if (!isFeatureFolder(parts.slice(0, i).join('/'))) continue;
      const inside = parts.slice(i);
      const m = inside.length === 2 && inside[0] === 'tickets' ? TICKET_FILE.exec(inside[1]) : null;
      return { feature: parts[i - 1], ticket: m ? `T${Number(m[1])}` : null, plan: inside.length === 1 && inside[0] === 'plan.md' };
    }
    return null;
  };
}

// A planned ticket's reference, <feature>/T<n>: { feature, ticket } (ticket upper case), or null.
function ticketRef(value) {
  const m = /^([a-z][a-z0-9-]*)\/t(\d+)$/i.exec(String(value || '').trim());
  return m ? { feature: m[1].toLowerCase(), ticket: `T${Number(m[2])}` } : null;
}

module.exports = { planningFiles, ticketRef };
