'use strict';
// Stubs: tickets for a repository that is not on this machine (front matter `type: stub` and
// `repo: <its name>`; only the sections that need no code of that repository, lib/plans-format.js
// STUB_SECTIONS). A stub is a ticket of the feature in all else: a status, depends_on, a review.
// - plans.js ticket <f> --title <t> --stub <name> makes T<n> from templates/keel/planning/stub.md.
// - Once that repository is in the repos map and on this machine, plans.js check says the stub can
//   become a full ticket, and plans.js ticket <f> --from-stub T<n> makes it one in place: `type: stub`
//   leaves its front matter and Boundaries, Correct the priors and Where to look come in as the
//   template's placeholders, so check stops until they are written and the ticket needs a review.
const path = require('node:path');
const plans = require('./plans.js');
const { settings, validName } = require('./plans-settings.js');
const { clean } = require('./repo-read.js');
const { bodyOf, TICKET_SECTIONS, CODE_SECTIONS, isStub, outsideFences } = require('./plans-format.js');
const repos = require('./plans-repos.js');

const refuse = (why) => [`plans: ticket refused (${why})`];
const rel = (root, file) => path.relative(root, file).split(path.sep).join('/');
const lf = (text) => String(text).replace(/\r\n/g, '\n');

// The repository of a new stub (`--stub <name>`): { name }, or { why }. Never this project's, and never
// one on this machine: that one gets a ticket.
function stubRepo(root, value) {
  if (typeof value !== 'string' || !value.trim()) return { why: '--stub needs the name of the repository that is not here: --stub <name>' };
  const name = value.trim();
  if (repos.ownNames(root).has(name)) return { why: `--stub: ${clean(name, 120)} is this project: plan a ticket` };
  if (!validName(name)) return { why: `--stub: "${clean(name, 120)}" is not a repository name` };
  const folder = settings(root).repos[name];
  if (folder && repos.isFolder(folder)) return { why: `--stub: ${name} is on this machine (${clean(folder, 200)}): plan a ticket for it (--repo ${name})` };
  return { name };
}

// The body with the sections a stub lacks (CODE_SECTIONS) put in their places, as the ticket template
// has them: placeholders plans.js check stops on until they are written.
function withCodeSections(body) {
  const blocks = (text) => {
    const lines = lf(text).split('\n');
    const plain = outsideFences(lines.join('\n')).split('\n');
    const out = [{ name: null, lines: [] }];
    lines.forEach((line, i) => {
      const m = /^##\s+(.*\S)\s*$/.exec(plain[i]);
      if (m) out.push({ name: m[1], lines: [line] }); else out[out.length - 1].lines.push(line);
    });
    return out;
  };
  const template = blocks(plans.fromTemplate('ticket.md', {}).body);
  const out = blocks(body.replace(/\n*$/, '\n'));
  for (const n of CODE_SECTIONS) {
    if (out.some((b) => b.name === n)) continue;
    const add = template.find((b) => b.name === n);
    const at = out.findIndex((b) => TICKET_SECTIONS.indexOf(b.name) > TICKET_SECTIONS.indexOf(n));
    const block = { name: n, lines: [...add.lines.join('\n').trimEnd().split('\n'), ''] };
    if (at < 0) { out[out.length - 1].lines.push(''); out.push(block); } else out.splice(at, 0, block);
  }
  return `${out.map((b) => b.lines.join('\n')).join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

// plans.js check's note for a stub whose repository is on this machine now.
const offerNote = (feature, id, name) => `note: stub ${id} can become a full ticket: ${name} is on this machine now (plans.js ticket ${feature} --from-stub ${id})`;

// plans.js ticket <feature> --from-stub T<n>: the stub becomes a full ticket in place, once its
// repository is on this machine; its commit goes into after_commit_repos when none is there yet.
function fromStub(root, feature, d, id) {
  if (typeof id !== 'string' || !id.trim()) return refuse('--from-stub needs the stub: --from-stub T5');
  const ask = id.trim().toUpperCase();
  const t = plans.tickets(d).find((x) => x.id === ask);
  if (!t) return refuse(`--from-stub: no ticket ${clean(ask, 40)} in ${feature}`);
  if (!isStub(t.fm)) return refuse(`--from-stub: ${t.id} is no stub`);
  const s = settings(root);
  const target = repos.targetOf(root, t, s);
  if (target.own || target.bad) return refuse(`--from-stub: ${t.id}'s repo "${clean(String(t.fm.repo || ''), 120)}" is not another repository's name`);
  if (!target.folder) return refuse(`--from-stub: ${target.name} is not on this machine yet: plans.js settings set --repo ${target.name}=<folder>`);
  const front = lf(t.text).match(/^---\n[\s\S]*?\n---\n?/)[0].replace(/^type:.*\n/m, '');
  try {
    plans.writeFile(root, d, t.file, `${front}\n${withCodeSections(bodyOf(t.text))}`);
    plans.writePlan(root, d, { after_commit_repos: repos.commitsText(repos.recordCommits(d.fm, [...repos.commitsOf(d.fm).keys(), target.name], s)) });
  } catch (e) { return refuse(e.message); }
  return [
    `converted: ${t.id} (stub -> ticket for ${target.name})`,
    `file: ${rel(root, t.file)}`,
    `next: write ${CODE_SECTIONS.join(', ')} from ${clean(target.folder, 200)}, then plans.js check ${feature} and a review of ${t.id}`,
  ];
}

module.exports = { offerNote, stubRepo, fromStub, withCodeSections };
