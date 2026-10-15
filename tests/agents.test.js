'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PLUGIN = path.join(__dirname, '..', 'plugins', 'keel');
const AGENTS = path.join(PLUGIN, 'agents');
const PROTOCOLS = path.join(PLUGIN, 'protocols');

function agent(name) {
  const text = fs.readFileSync(path.join(AGENTS, `${name}.md`), 'utf8');
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  assert.ok(fm, `${name}: frontmatter`);
  const meta = Object.fromEntries(fm[1].split(/\r?\n/).map((l) => /^([A-Za-z]+):\s*(.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]));
  return { meta, body: fm[2] };
}

// 12 verification agents and the generalist reviewer, plus the implementer.
const TEAM = {
  qa: { model: 'sonnet', runsCode: true, writesTemp: true },
  'qa-break': { model: 'sonnet', runsCode: true, writesTemp: true },
  reviewer: { model: 'sonnet', noPrinciples: true },
  'bug-hunter': { model: 'sonnet' },
  'test-reviewer': { model: 'sonnet', runsCode: true },
  architect: { model: 'sonnet', protocols: ['architecture'], noPrinciples: true },
  security: { model: 'opus', protocols: ['security', 'business-rules'], noPrinciples: true },
  data: { model: 'sonnet', protocols: ['database', 'api', 'performance'], noPrinciples: true },
  docs: { model: 'sonnet', protocols: ['docs', 'comments', 'requirements'], noPrinciples: true },
  env: { model: 'sonnet', protocols: ['dependencies', 'infrastructure'], noPrinciples: true },
  context: { model: 'haiku', notSearch: true, noPrinciples: true },
  verifier: { model: 'sonnet', notSearch: true },
  judge: { model: 'sonnet', notSearch: true },
};

test('the verification team is complete and every agent file belongs to it', () => {
  const files = fs.readdirSync(AGENTS).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();
  assert.deepEqual(files, [...Object.keys(TEAM), 'implementer'].sort());
});

test('agent implementer: Sonnet on high, 350 turns, edits files, never spawns agents, reports per criterion', () => {
  const { meta, body } = agent('implementer');
  assert.equal(meta.name, 'implementer');
  assert.ok(meta.description && meta.description.length < 250, 'one-sentence description');
  assert.equal(meta.model, 'sonnet', 'plan 8: Sonnet; Opus only per step, on the user\'s yes');
  assert.equal(meta.effort, 'high');
  assert.equal(meta.maxTurns, '350', 'plan 10.4: 350 for the implementer');
  const tools = meta.tools.split(',').map((t) => t.trim());
  for (const t of ['Read', 'Edit', 'Write', 'Bash']) assert.ok(tools.includes(t), t);
  assert.ok(!tools.includes('Agent'), 'steps go one after another: no nested agents');
  assert.ok(body.includes('status: done | partial | blocked'), 'report states the step status');
  assert.match(body, /^criteria:$/m, 'report checks each done-when criterion');
  assert.match(body, /git diff --stat/);
  assert.ok(body.includes('.keel/local/tmp/implementer/'), 'temporary files only under .keel/local/tmp');
  assert.match(body, /main session handles git/, 'no git state changes');
  // Owner decision: the section keeps keel's rules without naming where they came from.
  assert.match(body, /^## Principles$/m);
});

for (const [name, spec] of Object.entries(TEAM)) {
  test(`agent ${name}: frontmatter, tools, protocols and principles`, () => {
    const { meta, body } = agent(name);
    assert.equal(meta.name, name);
    assert.ok(meta.description && meta.description.length < 250, 'one-sentence description');
    assert.equal(meta.model, spec.model);
    assert.equal(meta.effort, 'high', 'plan 10.4: every agent on high');
    assert.equal(meta.maxTurns, '60', 'review agents: 60 turns (measured p90 about 52)');
    const tools = meta.tools.split(',').map((t) => t.trim());
    const writes = tools.filter((t) => ['Write', 'Edit', 'NotebookEdit', 'Agent'].includes(t));
    // QA agents write their helper scripts with Write (a shell heredoc asks the user each time); the
    // tree check after each of them catches anything written outside .keel/local/.
    assert.deepEqual(writes, spec.writesTemp ? ['Write'] : [], 'no agent edits files or spawns agents');
    if (spec.writesTemp) assert.match(body, /\.keel\/local\/tmp\/qa\/|<keel>\/agents\/qa\.md/, 'writes only under its temporary folder');
    assert.equal(tools.includes('Bash'), !!spec.runsCode, spec.runsCode ? 'runs code' : 'read-only: no shell');
    if (!spec.notSearch) assert.match(body, /<keel>\/protocols\/_search\.md/, 'reads the shared search rules');
    for (const p of spec.protocols || []) assert.match(body, new RegExp(`<keel>/protocols/${p}\\.md`), `names protocol ${p}`);
    // An agent whose rules all live in its protocols (or in its body) has no Principles section: a
    // section that only points elsewhere or repeats the body is text the agent reads for nothing.
    if (spec.noPrinciples) assert.doesNotMatch(body, /^## Principles$/m, 'no section without rules of its own');
    else assert.match(body, /^## Principles$/m, 'the agent states its own principles');
  });
}

// Protocols whose principles only restated their own body have none (no duplicate text).
const PROTOCOLS_WITHOUT_PRINCIPLES = new Set(['api.md', 'architecture.md', 'comments.md', 'docs.md']);

test('every protocol has a checklist or method, evidence, exclusions, severity and, unless they repeat it, principles', () => {
  const files = fs.readdirSync(PROTOCOLS).filter((f) => f.endsWith('.md'));
  assert.deepEqual(files.sort(), ['_search.md', 'api.md', 'architecture.md', 'business-rules.md', 'comments.md', 'database.md', 'dependencies.md', 'docs.md', 'infrastructure.md', 'performance.md', 'requirements.md', 'security.md'].sort());
  for (const f of files.filter((x) => x !== '_search.md')) {
    const text = fs.readFileSync(path.join(PROTOCOLS, f), 'utf8');
    assert.match(text, /^## (Checklist|Method|Steps|Cases)/m, `${f}: what to check`);
    assert.match(text, /^## Evidence/m, `${f}: evidence standard`);
    assert.match(text, /^## Do not (flag|treat)/m, `${f}: exclusions`);
    assert.match(text, /^## Severity/m, `${f}: severity`);
    if (PROTOCOLS_WITHOUT_PRINCIPLES.has(f)) assert.doesNotMatch(text, /^## Principles/m, `${f}: no repeated principles`);
    else assert.match(text, /^## Principles/m, `${f}: principles`);
  }
});

test('agent and protocol files name no outside sources', () => {
  // Owner decision: keel's rules stand as its own; no links, paper ids or borrowed project names.
  const files = [
    ...fs.readdirSync(AGENTS).filter((f) => f.endsWith('.md')).map((f) => path.join(AGENTS, f)),
    ...fs.readdirSync(PROTOCOLS).filter((f) => f.endsWith('.md')).map((f) => path.join(PROTOCOLS, f)),
  ];
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(text, /https?:\/\/|arXiv|superpowers|^## Sources/im, path.basename(f));
  }
});

test('the shared search rules describe the findings schema the scripts validate', () => {
  const text = fs.readFileSync(path.join(PROTOCOLS, '_search.md'), 'utf8');
  const schema = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'schemas', 'findings.schema.json'), 'utf8'));
  for (const field of schema.$defs.finding.required) assert.match(text, new RegExp(`"${field}"`), field);
  assert.match(text, /findings\.schema\.json/);
  // One verification rule, as votes.js applies it: critical and important within the cap, minor unverified.
  assert.match(text, /refute the critical and important findings \(critical first, within the level's cap\); minor findings\s+are listed unverified, and QA findings proven by a reproduce command skip verification/);
  assert.doesNotMatch(text, /unverified findings are dropped|^## Principles/m);
});

test('topics in the lineup script match the protocol files', () => {
  const { lineup } = require(path.join(PLUGIN, 'scripts', 'lib', 'tier.js'));
  const groups = { security: { topics: ['security', 'business-rules'] }, data: { topics: ['database', 'api', 'performance'] }, docs: { topics: ['docs'] }, env: { topics: ['dependencies', 'infrastructure'] } };
  const team = lineup('maximum', { groups, sizes: [], architect_signal: [] });
  for (const a of team.agents) {
    assert.ok(TEAM[a.agent], `${a.agent} has an agent file`);
    for (const t of a.topics || []) assert.ok(fs.existsSync(path.join(PROTOCOLS, `${t}.md`)), `protocol for ${t}`);
  }
});

test('verify.md names only scripts and agents that exist', () => {
  const text = fs.readFileSync(path.join(PLUGIN, 'skills', '_shared', 'verify.md'), 'utf8');
  for (const m of text.matchAll(/<keel>\/scripts\/([a-z-]+\.js)/g)) assert.ok(fs.existsSync(path.join(PLUGIN, 'scripts', m[1])), m[1]);
  for (const m of text.matchAll(/[`"]keel:([a-z-]+)/g)) assert.ok(TEAM[m[1]], `keel:${m[1]}`);
  for (const step of ['## 1.', '## 6.', '## 11.', '## 12.']) assert.ok(text.includes(step), step);
});
