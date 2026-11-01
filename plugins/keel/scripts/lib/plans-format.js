'use strict';
// The formats of keel's planning files, read by their English headings: a ticket (a draft's
// T<n>-<slug>.md or an exported <KEY>-<slug>.md), a draft's plan.md and the feature overview README.md
// that export builds from plan.md. plans.js check stops a review or an export on what ticketStructure
// and planStructure find; style is the ticket reviewer's advice, never checked here.
const path = require('node:path');
const { git, clean } = require('./repo-read.js');
const { sections } = require('./tasks.js');

const TICKET_SECTIONS = ['In plain words', 'Example', 'Goal', 'Acceptance criteria', 'How to check', 'Boundaries', 'Correct the priors', 'Where to look', 'Out of scope', 'Why', 'Dependencies'];
const PLAN_SECTIONS = ['In plain words', 'Level', 'Decisions', 'Contract', 'Out of scope', 'Design sketch', 'Terms', 'What was gathered', 'Open questions', 'Tickets', 'Stubs', 'Next action'];
// plan.md's sections the overview takes, in its order; Tickets is built from the exported tickets.
const README_SECTIONS = ['In plain words', 'Level', 'Decisions', 'Contract', 'Out of scope', 'Terms', 'Tickets', 'Stubs'];
// May be left out; when present they keep their place.
const OPTIONAL = new Set(['Example', 'Correct the priors', 'Stubs']);
const BOUNDARIES = ['always', 'ask first', 'never'];

const missing = (label, secs, names) => names.filter((n) => !OPTIONAL.has(n) && !(n in secs)).map((n) => `${label}: no section "## ${n}"`);

// The text with every line of a fenced code block blanked: a "## Why" in a markdown sample is not a
// section.
function outsideFences(text) {
  let open = '';
  return String(text || '').split(/\r?\n/).map((l) => {
    const fence = (/^\s*(`{3,}|~{3,})/.exec(l) || [])[1];
    const blank = open || fence;
    // A block closes only on a fence of its own character, at least as long as the one that opened it.
    if (fence && !open) open = fence;
    else if (fence && fence[0] === open[0] && fence.length >= open.length) open = '';
    return blank ? '' : l;
  }).join('\n');
}

// A ticket's "# [<id>] <title>" heading as [id, title], both empty when there is none.
function heading(text) {
  const m = /^# \[([^\]\n]*)\][ \t]*(.*\S)?/m.exec(outsideFences(text));
  return m ? [m[1].trim(), m[2] || ''] : ['', ''];
}

// A ticket's structure: its "# [<id>] <title>" heading, its sections once each and in the template's
// order, the three Boundaries labels, the acceptance criteria as a "- [ ]" list. Headings it does not
// know are left alone.
function ticketStructure(label, text) {
  const body = outsideFences(text);
  const secs = sections(body);
  const out = [];
  const [id, title] = heading(body);
  if (id !== label || !title) out.push(`${label}: no "# [${label}] <title>" heading`);
  out.push(...missing(label, secs, TICKET_SECTIONS));
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

const planStructure = (text) => missing('plan.md', sections(text), PLAN_SECTIONS);

// The overview's sections from plan.md: the ones with text, T-numbers swapped for keys, and Tickets: one
// line per exported ticket with its key, title and repository, no states (each ticket carries its own).
function overviewSections(planText, tickets, swap, repo) {
  const secs = sections(planText);
  const text = (n) => (n === 'Tickets' ? tickets.map((t) => `- ${t.key} ${heading(t.text)[1]} (${repo})`).join('\n') : swap(secs[n] || ''));
  return README_SECTIONS.map((n) => [n, text(n)]).filter(([, t]) => t).map(([n, t]) => `## ${n}\n${t}\n`).join('\n');
}

// The repository's name as the overview gives it, the same on every machine: the last part of the
// remote's URL (git@host:team/web.git and https://host/team/web -> web), else the project folder's name.
function repoName(root) {
  const remote = require('../git-flow.js').pickRemote((git(root, ['remote']) || '').split('\n').filter(Boolean));
  const url = remote ? git(root, ['remote', 'get-url', remote]) : null;
  const m = url && /([^/\\:]+?)(?:\.git)?[/\\]*$/.exec(url.trim());
  return clean(m ? m[1] : path.basename(path.resolve(root)), 60);
}

module.exports = { TICKET_SECTIONS, PLAN_SECTIONS, README_SECTIONS, ticketStructure, planStructure, overviewSections, repoName };
