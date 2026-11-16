'use strict';
// The formats of keel's planning files, read by their English headings: a ticket (T<n>-<slug>.md) and
// a plan.md. plans.js check stops a review on what ticketStructure and planStructure find; style is the
// ticket reviewer's advice, never checked here.
// A stub (front matter `type: stub`) is a ticket for a repository that is not on this machine: only the
// sections that need no code of that repository (STUB_SECTIONS).
const path = require('node:path');
const { git, clean, frontmatter } = require('./repo-read.js');
const { sections } = require('./tasks.js');

const TICKET_SECTIONS = ['In plain words', 'Example', 'Goal', 'Acceptance criteria', 'How to check', 'Boundaries', 'Correct the priors', 'Where to look', 'Out of scope', 'Why', 'Dependencies'];
// The sections that need the repository's code: a stub has none of them.
const CODE_SECTIONS = ['Boundaries', 'Correct the priors', 'Where to look'];
const STUB_SECTIONS = TICKET_SECTIONS.filter((n) => !CODE_SECTIONS.includes(n));
const PLAN_SECTIONS = ['In plain words', 'Level', 'Decisions', 'Contract', 'Out of scope', 'Design sketch', 'Terms', 'What was gathered', 'Open questions', 'Tickets', 'Next action'];
// May be left out; when present they keep their place.
const OPTIONAL = new Set(['Example', 'Correct the priors']);
const BOUNDARIES = ['always', 'ask first', 'never'];
const isStub = (fm) => Boolean(fm) && fm.type === 'stub';

const missing = (label, secs, names) => names.filter((n) => !OPTIONAL.has(n) && !(n in secs)).map((n) => `${label}: no section "## ${n}"`);

// The text with every line of a fenced code block blanked: a "## Why" in a markdown sample is not a
// section.
function outsideFences(text) {
  return fences(text).lines.join('\n');
}

// The line (from 1) of a code block's opening fence that no fence closes, or 0.
const unclosedFence = (text) => fences(text).openAt;

function fences(text) {
  let open = '';
  let openAt = 0;
  const lines = String(text || '').split(/\r?\n/).map((l, i) => {
    const fence = (/^\s*(`{3,}|~{3,})/.exec(l) || [])[1];
    const blank = open || fence;
    // A block closes only on a fence of its own character, at least as long as the one that opened it.
    if (fence && !open) { open = fence; openAt = i + 1; } else if (fence && fence[0] === open[0] && fence.length >= open.length) open = '';
    return blank ? '' : l;
  });
  return { lines, openAt: open ? openAt : 0 };
}

// The text whose "## " lines are headings: outside the code blocks. A block that is never closed (check
// reports it) hides nothing, so the sections after it are still found.
const headingText = (text) => (unclosedFence(text) ? String(text || '') : outsideFences(text));

// plan.md's "## Name" sections as tasks.js sections() reads them, except that a line inside a code block
// is text: name -> the section's own text, code blocks included.
function sectionsOutsideFences(text) {
  const body = String(text || '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const plain = headingText(body).split(/\r?\n/);
  const out = {};
  let name = null;
  body.split(/\r?\n/).forEach((line, i) => {
    const m = /^##\s+(.*\S)\s*$/.exec(plain[i]);
    if (m) { name = m[1]; out[name] = []; } else if (name) out[name].push(line);
  });
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.join('\n').trim()]));
}

// A ticket's "# [<id>] <title>" heading as [id, title], both empty when there is none.
function heading(text) {
  const m = /^# \[([^\]\n]*)\][ \t]*(.*\S)?/m.exec(outsideFences(text));
  return m ? [m[1].trim(), m[2] || ''] : ['', ''];
}

// A ticket's structure: its "# [<id>] <title>" heading, its sections once each and in the template's
// order, the three Boundaries labels, the acceptance criteria as a "- [ ]" list. Headings it does not
// know are left alone. A stub has the sections of STUB_SECTIONS and none of CODE_SECTIONS.
function ticketStructure(label, text) {
  const body = outsideFences(text);
  const secs = sections(body);
  const out = [];
  const [id, title] = heading(body);
  const stub = isStub(frontmatter(text));
  if (id !== label || !title) out.push(`${label}: no "# [${label}] <title>" heading`);
  out.push(...missing(label, secs, stub ? STUB_SECTIONS : TICKET_SECTIONS));
  if (stub) for (const n of CODE_SECTIONS.filter((x) => x in secs)) out.push(`${label}: a stub has no "## ${n}" (it needs the code of the stub's repository)`);
  const all = [...body.matchAll(/^##\s+(.*\S)\s*$/gm)].map((m) => m[1]).filter((n) => TICKET_SECTIONS.includes(n));
  const known = [...new Set(all)];
  for (const n of new Set(all.filter((n, i) => all.indexOf(n) !== i))) out.push(`${label}: "## ${n}" appears twice`);
  const at = known.findIndex((n, i) => i > 0 && TICKET_SECTIONS.indexOf(n) < TICKET_SECTIONS.indexOf(known[i - 1]));
  if (at > 0) out.push(`${label}: "## ${known[at]}" stands after "## ${known[at - 1]}" (the order: ${TICKET_SECTIONS.join(', ')})`);
  if ('Boundaries' in secs) {
    for (const b of BOUNDARIES) {
      if (!new RegExp(`^\\s*[-*]\\s+(?:\\*\\*)?${b}(?:\\*\\*)?\\s*:`, 'im').test(secs.Boundaries)) out.push(`${label}: Boundaries has no "- ${b}:" item`);
    }
  }
  if ('Acceptance criteria' in secs) {
    const criteria = secs['Acceptance criteria'];
    // Indented lines continue the item above.
    const loose = criteria.split('\n').find((l) => /^\S/.test(l) && !/^[-*] \[[ xX]\] \S/.test(l));
    if (!criteria) out.push(`${label}: acceptance criteria are empty`);
    else if (loose) out.push(`${label}: acceptance criteria are not a "- [ ]" list: "${clean(loose, 40)}"`);
  }
  return out;
}

// A plan written before stubs were tickets has "## Stubs", which no command reads: check stops on it.
const planStructure = (text) => {
  const secs = sectionsOutsideFences(text);
  const all = [...headingText(text).matchAll(/^##\s+(.*\S)\s*$/gm)].map((m) => m[1]).filter((n) => PLAN_SECTIONS.includes(n));
  const twice = [...new Set(all.filter((n, i) => all.indexOf(n) !== i))].map((n) => `plan.md: "## ${n}" appears twice`);
  return [...missing('plan.md', secs, PLAN_SECTIONS), ...twice, ...('Stubs' in secs ? ['plan.md: "## Stubs" is no section any more: make each stub a ticket (plans.js ticket <feature> --title <t> --stub <name>), then remove the section'] : [])];
};

// The repository's names, the same on every machine: `name`, the last part of the remote's URL
// (git@host:team/web.git and https://host/team/web -> web), else the folder's name; `full`, owner/name
// (team/web; without a remote the parent folder's name/the folder's name), for two repositories of one
// name.
function repoNames(root) {
  const remote = require('../git-flow.js').pickRemote((git(root, ['remote']) || '').split('\n').filter(Boolean));
  const url = remote ? git(root, ['remote', 'get-url', remote]) : null;
  const m = url && /(?:([^/\\:]+)[/\\:])?([^/\\:]+?)(?:\.git)?[/\\]*$/.exec(url.trim());
  const folder = path.resolve(root);
  const name = clean(m ? m[2] : path.basename(folder), 60);
  const owner = m ? m[1] : path.basename(path.dirname(folder));
  return { name, full: owner ? clean(`${owner}/${name}`, 120) : name };
}

const repoName = (root) => repoNames(root).name;

const bodyOf = (text) => String(text).replace(/\r\n/g, '\n').replace(/^---\n[\s\S]*?\n---\n?/, '').trimStart();

module.exports = { bodyOf, TICKET_SECTIONS, CODE_SECTIONS, STUB_SECTIONS, isStub, PLAN_SECTIONS, ticketStructure, planStructure, repoName, repoNames, outsideFences, headingText, sectionsOutsideFences, unclosedFence, heading };
