'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'plugins', 'keel', 'templates', 'usage');
const P = require(path.join(dir, 'pivot.js'));
const I18N = require(path.join(dir, 'i18n.js'));
const UK = require(path.join(dir, 'i18n.uk.js'));
I18N.add('uk', UK);

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const OPUS = 'claude-opus-5-5-20260101';
const SONNET = 'claude-sonnet-5-5-20260101';
const HAIKU = 'claude-haiku-5-5-20260101';

function part(o) {
  const tok = { in: 0, cw5: 0, cw1h: 0, cr: 0, out: 0, ...(o.tok || {}) };
  return {
    kind: o.kind || 'agent', agent_id: o.id || null, type: o.type || null, model: o.model,
    by_model: { [o.model]: { requests: o.requests, tok, usd: o.usd } },
    start: o.start, end: o.end, active_min: o.active, requests: o.requests, tools: o.tools || {},
    agents_launched: o.launched || 0, tok, usd: o.usd, output_estimated: !!o.est, resumed: !!o.resumed,
  };
}

// ---- fixture: 3 day docs, 2 PCs, one split part, s2 present in two docs --------------------------------
const S1 = {
  id: 's1', project: 'shop', cwd: '/w/shop', branch: 'main', wallet: 'subscription', entrypoint: 'cli',
  start: '2026-10-09T10:00:00Z', end: '2026-10-09T11:00:00Z', active_min: 45, usd: 13, cost_cc: 12.9, unpriced: false,
  keel: { task: 'Add login, "SSO"', level: 'full', findings: { must: 1, should: 2, nice: 3 }, gates: { tests: 'pass' }, lines: { add: 120, del: 10 }, files: 6, steps: [{ title: 'Impl', model: 'sonnet' }] },
  participants: [
    part({ kind: 'main', model: OPUS, usd: 10, tok: { in: 1000, cw5: 2000, cr: 7000, out: 500 }, requests: 20, active: 40, start: '2026-10-09T10:00:00Z', end: '2026-10-09T11:00:00Z', tools: { Read: 5, Edit: 3 }, launched: 2 }),
    part({ type: 'implementer', id: 'a1', model: SONNET, usd: 2, tok: { in: 100, cw5: 300, cw1h: 100, cr: 1000, out: 200 }, requests: 5, active: 8, start: '2026-10-09T10:10:00Z', end: '2026-10-09T10:20:00Z', tools: { Edit: 4 } }),
    part({ type: 'implementer', id: 'a2', model: SONNET, usd: 1, tok: { in: 50, cw5: 50, cr: 500, out: 100 }, requests: 3, active: 6, start: '2026-10-09T10:30:00Z', end: '2026-10-09T10:40:00Z', tools: { Read: 3 }, resumed: true }),
  ],
  turns: [{ t: '2026-10-09T10:00:00Z', text: 'make login', usd: 6, requests: 10, agents: 1 }, { t: '2026-10-09T10:30:00Z', text: 'fix, bug', usd: 7, requests: 18, agents: 1 }],
};
const S2_STALE = {
  id: 's2', project: 'keel', branch: 'x', wallet: 'subscription', entrypoint: 'cli', start: '2026-10-09T12:00:00Z', end: '2026-10-09T12:10:00Z', active_min: 5, usd: 1, keel: null,
  participants: [part({ kind: 'main', model: SONNET, usd: 1, tok: { in: 100 }, requests: 3, active: 5, start: '2026-10-09T12:00:00Z', end: '2026-10-09T12:10:00Z' })],
  turns: [],
};
const S2 = {
  ...S2_STALE, end: '2026-10-09T12:30:00Z', active_min: 20, usd: 3,
  participants: [part({ kind: 'main', model: SONNET, usd: 3, tok: { in: 400, cr: 600, out: 100 }, requests: 10, active: 20, start: '2026-10-09T12:00:00Z', end: '2026-10-09T12:30:00Z' })],
  turns: [{ t: '2026-10-09T12:00:00Z', text: 'refactor the module', usd: 3, requests: 10, agents: 0 }],
};
const S3 = {
  id: 's3', project: 'shop', branch: 'feature/Pay', wallet: 'api', entrypoint: 'sdk-cli', start: '2026-10-09T09:00:00Z', end: '2026-10-09T09:30:00Z', active_min: 15, usd: 5, keel: null,
  participants: [
    part({ kind: 'main', model: OPUS, usd: 4, tok: { in: 500, cw5: 500, cr: 3000, out: 300 }, requests: 8, active: 15, start: '2026-10-09T09:00:00Z', end: '2026-10-09T09:30:00Z' }),
    part({ type: 'qa', id: 'a3', model: SONNET, usd: 1, tok: { in: 50, cw5: 50, cr: 200, out: 50 }, requests: 2, active: 3, start: '2026-10-09T09:10:00Z', end: '2026-10-09T09:15:00Z' }),
  ],
  turns: [],
};
const S4 = {
  id: 's4', project: 'mobile-api', branch: 'dev', wallet: 'subscription', entrypoint: 'cli', start: '2026-10-10T08:00:00Z', end: '2026-10-10T09:00:00Z', active_min: 30, usd: 5.5,
  keel: { task: 'Search', level: 'quick', findings: { must: 0, should: 0, nice: 0 }, gates: {}, lines: { add: 1, del: 1 }, files: 1, steps: [] },
  participants: [
    part({ kind: 'main', model: SONNET, usd: 5, tok: { in: 200, cw5: 800, cr: 4000, out: 400 }, requests: 12, active: 30, start: '2026-10-10T08:00:00Z', end: '2026-10-10T09:00:00Z', tools: { Bash: 7 }, launched: 1 }),
    part({ type: 'reviewer', id: 'a4', model: HAIKU, usd: 0.5, tok: { in: 100, out: 50 }, requests: 2, active: 3, start: '2026-10-10T08:40:00Z', end: '2026-10-10T08:45:00Z' }),
  ],
  turns: [{ t: '2026-10-10T08:00:00Z', text: 'review the diff', usd: 5.5, requests: 14, agents: 1 }],
};

const SNAP = (t, sd, fh) => ({ t, five_hour: fh, five_hour_resets_at: '2026-10-09T15:00:00Z', seven_day: sd, seven_day_resets_at: '2026-10-15T00:00:00Z', session_id: 's1', cost_usd: 0, src: 'statusline' });
const DOC_A = {
  schema: 1, date: '2026-10-09', pc: 'office', user: 'me@x.com', part: 1, parts: 2, synced_until: '2026-10-09T22:00:00Z',
  hours: [{ h: 10, wallet: 'subscription', usd: 13, req: 28, tok: { in: 1150, cw5: 2350, cw1h: 100, cr: 8500, out: 800 }, by_model: { [OPUS]: 10, [SONNET]: 3 } }],
  snapshots: [SNAP('2026-10-09T10:00:00Z', 20, 10), SNAP('2026-10-09T11:00:00Z', 22, 14), SNAP('2026-10-09T10:00:00Z', 20, 10)],
  sessions: [S1, S2_STALE],
};
const DOC_A2 = { schema: 1, date: '2026-10-09', pc: 'office', user: 'me@x.com', part: 2, parts: 2, synced_until: '2026-10-09T23:30:00Z', hours: [], snapshots: [], sessions: [S2, S3] };
const DOC_C = {
  schema: 1, date: '2026-10-10', pc: 'laptop', user: 'you@y.com', part: 1, parts: 1, synced_until: '2026-10-10T12:00:00Z',
  hours: [{ h: 8, wallet: 'subscription', usd: 5.5, tok: { in: 300, cw5: 800, cw1h: 0, cr: 4000, out: 450 }, by_model: { [SONNET]: 5, [HAIKU]: 0.5 } }],
  snapshots: [SNAP('2026-10-10T09:00:00Z', 23, 5)], sessions: [S4],
};
const DOCS = [DOC_C, DOC_A, DOC_A2];
const UNIQUE = [S1, S2, S3, S4];
const flat = P.flatten(DOCS);

// ---- flatten ---------------------------------------------------------------------------------------------
test('flatten: dedupes a session present in two docs (later synced_until wins) and counts rows', () => {
  assert.equal(flat.sessions.length, 4);
  assert.equal(flat.rows.length, 8);
  const s2 = flat.sessions.find((s) => s.id === 's2');
  assert.equal(s2.usd, 3);
  assert.equal(s2.pc, 'office');
  assert.equal(flat.hours.length, 2);
  assert.equal(flat.snapshots.length, 4); // raw snapshots are kept, weekly() dedupes
  assert.ok(flat.snapshots.every((s) => s.pc));
  // order of docs does not matter
  const rev = P.flatten([DOC_A2, DOC_A, DOC_C]);
  assert.deepEqual(rev.sessions.map((s) => s.key), flat.sessions.map((s) => s.key));
  // the same doc twice (re-sync) is not counted twice
  const again = P.flatten([DOC_A, { ...DOC_A, synced_until: '2026-10-09T21:00:00Z', sessions: [] }, DOC_A2, DOC_C]);
  assert.equal(again.sessions.length, 4);
});

test('flatten: session keys follow start order within day+pc, 1-based', () => {
  const keys = Object.fromEntries(flat.sessions.map((s) => [s.id, s.key]));
  assert.deepEqual(keys, { s3: '2026-10-09_office.1', s1: '2026-10-09_office.2', s2: '2026-10-09_office.3', s4: '2026-10-10_laptop.1' });
  assert.deepEqual(flat.sessions.map((s) => s.id), ['s3', 's1', 's2', 's4']);
});

test('flatten: participant rows carry week, local hour, tokens, time, turns and sessions', () => {
  const main = flat.rows.find((r) => r.session === '2026-10-09_office.2' && r.kind === 'main');
  assert.equal(main.participant, 'main');
  assert.equal(main.date, '2026-10-09');
  assert.equal(main.week, '2026-W41');
  assert.equal(main.hourOfDay, new Date('2026-10-09T10:00:00Z').getHours());
  assert.equal(main.tokens, 1000 + 2000 + 7000 + 500);
  assert.equal(main.time_min, 60);
  assert.equal(main.active_min, 40);
  assert.deepEqual([main.turns, main.sessions, main.tools, main.agents_launched, main.requests], [2, 1, 8, 2, 20]);
  const agents = flat.rows.filter((r) => r.session === '2026-10-09_office.2' && r.kind === 'agent');
  assert.deepEqual(agents.map((r) => [r.participant, r.turns, r.sessions, r.resumed, r.time_min]), [['implementer', 0, 0, false, 10], ['implementer', 0, 0, true, 10]]);
  assert.equal(P.isoWeek('2026-01-01'), '2026-W01');
  assert.equal(P.isoWeek('2025-12-29'), '2026-W01');
  assert.equal(P.isoWeek('2027-01-01'), '2026-W53');
});

test('family: short model names', () => {
  assert.equal(P.family(OPUS), 'opus-5-5');
  assert.equal(P.family('claude-sonnet-4-20250514'), 'sonnet-4');
  assert.equal(P.family('claude-3-5-haiku-20241022'), 'haiku-3-5');
  assert.equal(P.family('gpt-x'), 'gpt-x');
  assert.equal(P.family(null), 'unknown');
});

// ---- filter ----------------------------------------------------------------------------------------------
test('filter: every dimension', () => {
  const R = flat.rows;
  const ids = (rows) => [...new Set(rows.map((r) => r.session_id))].sort();
  assert.equal(P.filter(R, {}).length, 8);
  assert.equal(P.filter(R, null).length, 8);
  assert.deepEqual(ids(P.filter(R, { from: '2026-10-10' })), ['s4']);
  assert.deepEqual(ids(P.filter(R, { to: '2026-10-09' })), ['s1', 's2', 's3']);
  assert.deepEqual(ids(P.filter(R, { from: '2026-10-09', to: '2026-10-09', pc: ['office'] })), ['s1', 's2', 's3']);
  assert.deepEqual(ids(P.filter(R, { pc: ['laptop'] })), ['s4']);
  assert.deepEqual(ids(P.filter(R, { pc: ['laptop', 'office'] })), ['s1', 's2', 's3', 's4']);
  assert.deepEqual(ids(P.filter(R, { user: ['you@y.com'] })), ['s4']);
  assert.deepEqual(ids(P.filter(R, { project: ['shop'] })), ['s1', 's3']);
  assert.deepEqual(ids(P.filter(R, { wallet: ['api'] })), ['s3']);
  assert.equal(P.filter(R, { participant: 'main' }).length, 4);
  assert.equal(P.filter(R, { participant: 'agents' }).length, 4);
  assert.equal(P.filter(R, { participant: 'implementer' }).length, 2);
  assert.equal(P.filter(R, { participant: 'qa' }).length, 1);
  assert.equal(P.filter(R, { participant: null }).length, 8);
  assert.equal(P.filter(R, { model: ['opus'] }).length, 2);
  assert.equal(P.filter(R, { model: [OPUS] }).length, 2);
  assert.equal(P.filter(R, { model: ['claude-opus-4-1'] }).length, 0);
  assert.equal(P.filter(R, { model: ['haiku', 'opus'] }).length, 3);
});

test('filter: all agents + sonnet gives only agent rows on sonnet', () => {
  const rows = P.filter(flat.rows, { participant: 'agents', model: ['sonnet'] });
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.kind === 'agent' && r.model.includes('sonnet')));
  near(rows.reduce((a, r) => a + r.usd, 0), 4);
});

// ---- group / share ---------------------------------------------------------------------------------------
test('group: by day, week, project, pc, user, participant, model, hour', () => {
  const R = flat.rows;
  const usd = (gs) => Object.fromEntries(gs.map((g) => [g.key, g.total.usd]));
  assert.deepEqual(P.group(R, 'day').map((g) => g.key), ['2026-10-09', '2026-10-10']);
  assert.deepEqual(usd(P.group(R, 'day')), { '2026-10-09': 21, '2026-10-10': 5.5 });
  assert.deepEqual(usd(P.group(R, 'week')), { '2026-W41': 26.5 });
  assert.deepEqual(P.group(R, 'project').map((g) => g.key), ['shop', 'mobile-api', 'keel']);
  assert.deepEqual(usd(P.group(R, 'project')), { shop: 18, 'mobile-api': 5.5, keel: 3 });
  assert.deepEqual(usd(P.group(R, 'pc')), { office: 21, laptop: 5.5 });
  assert.deepEqual(usd(P.group(R, 'user')), { 'me@x.com': 21, 'you@y.com': 5.5 });
  assert.deepEqual(P.group(R, 'participant').map((g) => g.key), ['main', 'implementer', 'qa', 'reviewer']);
  assert.deepEqual(usd(P.group(R, 'participant')), { main: 22, implementer: 3, qa: 1, reviewer: 0.5 });
  assert.deepEqual(usd(P.group(R, 'model')), { 'opus-5-5': 14, 'sonnet-5-5': 12, 'haiku-5-5': 0.5 });
  const hours = P.group(R, 'hour');
  assert.deepEqual(hours.map((g) => g.key), hours.map((g) => g.key).sort());
  assert.ok(hours.every((g) => /^\d\d$/.test(g.key)));
  near(hours.reduce((a, g) => a + g.total.usd, 0), 26.5);
  const h10 = String(new Date('2026-10-09T10:00:00Z').getHours()).padStart(2, '0');
  assert.ok(P.group(R, 'hour').find((g) => g.key === h10).total.usd >= 10);
});

test('group: split by model, pc, project, participant', () => {
  const R = flat.rows;
  const byProject = P.group(R, 'project', 'model');
  assert.deepEqual(Object.keys(byProject[0].parts).sort(), ['opus-5-5', 'sonnet-5-5']);
  assert.equal(byProject[0].parts['opus-5-5'].usd, 14);
  assert.equal(byProject[0].parts['sonnet-5-5'].usd, 4);
  const byDay = P.group(R, 'day', 'pc');
  assert.deepEqual(byDay[0].parts, { office: byDay[0].parts.office });
  assert.equal(byDay[0].parts.office.usd, 21);
  assert.equal(byDay[1].parts.laptop.usd, 5.5);
  const byModel = P.group(R, 'model', 'participant');
  assert.equal(byModel.find((g) => g.key === 'sonnet-5-5').parts.implementer.usd, 3);
  assert.equal(byModel.find((g) => g.key === 'haiku-5-5').parts.reviewer.usd, 0.5);
  const byPart = P.group(R, 'participant', 'project');
  assert.equal(byPart.find((g) => g.key === 'main').parts.shop.usd, 14);
  const byPc = P.group(R, 'pc', 'none');
  assert.deepEqual(byPc[0].parts, {});
  for (const split of ['model', 'pc', 'project', 'participant', 'none']) {
    for (const by of ['day', 'week', 'project', 'pc', 'user', 'participant', 'model', 'hour']) {
      const gs = P.group(R, by, split);
      near(gs.reduce((a, g) => a + g.total.usd, 0), 26.5);
      for (const g of gs) near(Object.values(g.parts).reduce((a, p) => a + p.usd, 0), split === 'none' ? 0 : g.total.usd);
    }
  }
});

test('measures: group totals equal raw sums for every measure', () => {
  const uniq = UNIQUE.flatMap((s) => s.participants.map((p) => ({ s, p })));
  const raw = {
    usd: uniq.reduce((a, x) => a + x.p.usd, 0),
    tok_in: uniq.reduce((a, x) => a + x.p.tok.in, 0),
    tok_cw5: uniq.reduce((a, x) => a + x.p.tok.cw5, 0),
    tok_cw1h: uniq.reduce((a, x) => a + x.p.tok.cw1h, 0),
    tok_cr: uniq.reduce((a, x) => a + x.p.tok.cr, 0),
    tok_out: uniq.reduce((a, x) => a + x.p.tok.out, 0),
    requests: uniq.reduce((a, x) => a + x.p.requests, 0),
    active_min: uniq.reduce((a, x) => a + x.p.active_min, 0),
    time_min: uniq.reduce((a, x) => a + (Date.parse(x.p.end) - Date.parse(x.p.start)) / 60000, 0),
    turns: UNIQUE.reduce((a, s) => a + s.turns.length, 0),
    sessions: UNIQUE.length,
  };
  raw.tokens = raw.tok_in + raw.tok_cw5 + raw.tok_cw1h + raw.tok_cr + raw.tok_out;
  assert.deepEqual(P.measures.map((m) => m.id), ['usd', 'tokens', 'tok_in', 'tok_cw5', 'tok_cw1h', 'tok_cr', 'tok_out', 'time_min', 'active_min', 'requests', 'turns', 'sessions']);
  assert.deepEqual(P.measures.map((m) => m.unit), ['usd', 'tokens', 'tokens', 'tokens', 'tokens', 'tokens', 'tokens', 'min', 'min', 'count', 'count', 'count']);
  for (const by of ['day', 'project', 'participant', 'model']) {
    const gs = P.group(flat.rows, by, 'pc');
    for (const m of P.measures) {
      near(gs.reduce((a, g) => a + g.total[m.id], 0), raw[m.id], 1e-6);
      near(gs.reduce((a, g) => a + Object.values(g.parts).reduce((x, p) => x + p[m.id], 0), 0), raw[m.id], 1e-6);
    }
  }
  assert.equal(raw.turns, 4);
  assert.equal(raw.sessions, 4);
});

test('share: percent of the total for a measure', () => {
  const gs = P.share(P.group(flat.rows, 'pc'), 'usd');
  near(gs[0].pct, (21 / 26.5) * 100);
  near(gs.reduce((a, g) => a + g.pct, 0), 100);
  assert.equal(P.share([], 'usd').length, 0);
  assert.equal(P.share(P.group([], 'pc'), 'usd').length, 0);
});

// ---- stats and dashboard series --------------------------------------------------------------------------
test('stats: formulas', () => {
  const s = P.stats(flat.rows, flat.sessions);
  near(s.cache_share, 16300 / (2400 + 3700 + 100 + 16300));
  near(s.usd_per_hour, 26.5 / (110 / 60));
  near(s.usd_per_turn, 26.5 / 4);
  near(s.avg_session_usd, 26.5 / 4);
  near(s.avg_session_active_min, 27.5);
  assert.equal(s.agents_launched, 3);
  assert.equal(s.tool_calls, 8 + 4 + 3 + 7);
  const empty = P.stats([], []);
  assert.deepEqual([empty.cache_share, empty.usd_per_hour, empty.usd_per_turn, empty.avg_session_usd], [null, null, null, null]);
  const laptop = P.stats(P.filter(flat.rows, { pc: ['laptop'] }), flat.sessions);
  near(laptop.avg_session_usd, 5.5);
  near(laptop.usd_per_hour, 5.5 / 0.5);
});

test('weekly, dailyByModel, mainVsAgents, tokenKinds, topProjects', () => {
  const w = P.weekly(flat.snapshots);
  assert.deepEqual(w.map((x) => [x.t, x.seven_day, x.five_hour]), [
    ['2026-10-09T10:00:00Z', 20, 10], ['2026-10-09T11:00:00Z', 22, 14], ['2026-10-10T09:00:00Z', 23, 5]]);
  const d = P.dailyByModel(flat.rows);
  assert.deepEqual(d.days, ['2026-10-09', '2026-10-10']);
  assert.deepEqual(d.models, ['opus-5-5', 'sonnet-5-5', 'haiku-5-5']);
  assert.deepEqual(d.usd['opus-5-5'], [14, 0]);
  near(d.usd['sonnet-5-5'][0] + d.usd['sonnet-5-5'][1], 12);
  const mv = P.mainVsAgents(flat.rows);
  assert.deepEqual([mv.main.usd, mv.agents.usd], [22, 4.5]);
  assert.deepEqual(mv.by_type.map((x) => x.key), ['implementer', 'qa', 'reviewer']);
  const tk = P.tokenKinds(flat.rows);
  assert.deepEqual([tk.in, tk.cw5, tk.cw1h, tk.cr, tk.out], [2400, 3700, 100, 16300, 1700]);
  assert.equal(tk.total, 24200);
  const top = P.topProjects(flat.rows, 2);
  assert.deepEqual(top.map((x) => x.project), ['shop', 'mobile-api']);
  near(top[0].pct, (18 / 26.5) * 100);
  assert.equal(P.topProjects(flat.rows).length, 3);
});

// ---- sessions table --------------------------------------------------------------------------------------
test('sessionsTable: sort, filters, search', () => {
  const S = flat.sessions;
  const keysOf = (o) => P.sessionsTable(S, o).rows.map((r) => r.key.replace(/^.*_/, ''));
  const idsOf = (o) => P.sessionsTable(S, o).rows.map((r) => S.find((s) => s.key === r.key).id);
  assert.deepEqual(idsOf({}), ['s4', 's2', 's1', 's3']);
  assert.deepEqual(idsOf({ sort: 'usd', dir: 'desc' }), ['s1', 's4', 's3', 's2']);
  assert.deepEqual(idsOf({ sort: 'usd', dir: 'asc' }), ['s2', 's3', 's4', 's1']);
  assert.deepEqual(idsOf({ sort: 'project', dir: 'asc' }), ['s2', 's4', 's3', 's1']);
  const byTask = idsOf({ sort: 'task', dir: 'asc' });
  assert.deepEqual(byTask.slice(0, 2), ['s1', 's4']); // 'Add login…' < 'Search'; sessions without a task are last
  assert.deepEqual(idsOf({ sort: 'task', dir: 'desc' }).slice(0, 2), ['s4', 's1']);
  assert.deepEqual(idsOf({ filters: { wallet: ['api'] } }), ['s3']);
  assert.deepEqual(idsOf({ filters: { model: ['haiku'] } }), ['s4']);
  assert.deepEqual(idsOf({ filters: { from: '2026-10-10' } }), ['s4']);
  assert.deepEqual(idsOf({ search: 'SSO' }), ['s1']); // task, case-insensitive
  assert.deepEqual(idsOf({ search: 'refactor THE' }), ['s2']); // turn text
  assert.deepEqual(idsOf({ search: 'feature/pay' }), ['s3']); // branch
  assert.deepEqual(idsOf({ search: 'MOBILE-API' }), ['s4']); // project
  assert.deepEqual(idsOf({ search: 'nothing-like-this' }), []);
  assert.ok(keysOf({}).length === 4);
  const r1 = P.sessionsTable(S, {}).rows.find((r) => r.key === '2026-10-09_office.2'); // gitleaks:allow (a session key, not a secret)
  assert.deepEqual([r1.task, r1.level, r1.week_pct, r1.models], ['Add login, "SSO"', 'full', null, ['opus-5-5', 'sonnet-5-5']]);
  const r2 = P.sessionsTable(S, {}).rows.find((r) => r.key === '2026-10-09_office.3'); // gitleaks:allow (a session key, not a secret)
  assert.deepEqual([r2.task, r2.level], [null, null]);
});

test('sessionsTable: groupBy with subtotals', () => {
  const S = flat.sessions;
  const byProject = P.sessionsTable(S, { groupBy: 'project' });
  assert.deepEqual(byProject.groups.map((g) => g.key), ['shop', 'mobile-api', 'keel']);
  assert.deepEqual(byProject.groups.map((g) => g.subtotal.count), [2, 1, 1]);
  near(byProject.groups[0].subtotal.usd, 18);
  assert.equal(byProject.total.count, 4);
  near(byProject.total.usd, 26.5);
  const byPc = P.sessionsTable(S, { groupBy: 'pc' });
  assert.deepEqual(byPc.groups.map((g) => [g.key, g.subtotal.count]), [['office', 3], ['laptop', 1]]);
  const byDay = P.sessionsTable(S, { groupBy: 'day' });
  assert.deepEqual(byDay.groups.map((g) => g.key), ['2026-10-10', '2026-10-09']);
  assert.equal(P.sessionsTable(S, { groupBy: 'none' }).groups, null);
  const filtered = P.sessionsTable(S, { groupBy: 'project', search: 'shop' });
  assert.deepEqual(filtered.groups.map((g) => g.key), ['shop']);
});

// ---- CSV -------------------------------------------------------------------------------------------------
test('toCSV: RFC 4180 quoting, CRLF, Cyrillic, optional BOM', () => {
  const rows = [{ a: 'x,y', b: 'say "hi"', c: 'line1\nline2', d: 'Привіт, світе', e: null, f: 3 }, { a: 'plain', b: '', c: 'cr\rx', d: ['m1', 'm2'], e: undefined, f: 0 }];
  const csv = P.toCSV(rows, ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.equal(csv, 'a,b,c,d,e,f\r\n"x,y","say ""hi""","line1\nline2","Привіт, світе",,3\r\nplain,,"cr\rx",m1 m2,,0');
  assert.ok(P.toCSV(rows, ['a'], true).startsWith('﻿a\r\n'));
  assert.ok(P.toCSV(rows, ['a'], { bom: true }).startsWith('﻿'));
  assert.ok(!P.toCSV(rows, ['a']).startsWith('﻿'));
  const labelled = P.toCSV([{ usd: 1.234 }], [{ key: 'usd', label: 'Вартість, $', format: (v) => v.toFixed(2) }]);
  assert.equal(labelled, '"Вартість, $"\r\n1.23');
  assert.equal(P.toCSV([], ['a']), 'a');
});

// ---- session page ----------------------------------------------------------------------------------------
test('sessionPage: timeline lanes, participants, turn shares, merged tools, cache block', () => {
  const s1 = flat.sessions.find((s) => s.id === 's1');
  const pg = P.sessionPage(s1);
  assert.deepEqual(pg.lanes.map((l) => [l.label, l.model, l.resumed]), [['main', 'opus-5-5', false], ['implementer', 'sonnet-5-5', false], ['implementer', 'sonnet-5-5', true]]);
  near(pg.lanes[0].left_pct, 0);
  near(pg.lanes[0].width_pct, 100);
  near(pg.lanes[1].left_pct, 100 / 6);
  near(pg.lanes[1].width_pct, 100 / 6);
  near(pg.lanes[2].left_pct, 50);
  assert.equal(pg.span.minutes, 60);
  assert.deepEqual(pg.participants.map((p) => p.agent_id), [null, 'a1', 'a2']);
  assert.equal(pg.participants[2].resumed, true);
  near(pg.participants[0].share, 10 / 13);
  assert.deepEqual(pg.turns.map((t) => [t.n, t.text]), [[1, 'make login'], [2, 'fix, bug']]);
  near(pg.turns[0].share, 6 / 13);
  near(pg.turns[1].share, 7 / 13);
  assert.deepEqual(pg.tools, [{ name: 'Read', n: 8 }, { name: 'Edit', n: 7 }]);
  assert.deepEqual([pg.cache.cw5, pg.cache.cw1h, pg.cache.cr], [2350, 100, 8500]);
  near(pg.cache.cache_share, 8500 / (1150 + 2350 + 100 + 8500));
  assert.deepEqual([pg.totals.requests, pg.totals.turns, pg.totals.agents], [28, 2, 2]);
  const bare = P.sessionPage({});
  assert.deepEqual([bare.lanes, bare.turns, bare.tools, bare.cache.cache_share], [[], [], [], null]);
});

// ---- calibration view ------------------------------------------------------------------------------------
test('calibrationView: rows newest first, medians, waiting machines', () => {
  const points = [
    { from: '2026-10-09T10:00:00Z', to: '2026-10-09T20:00:00Z', gain: 2, usd: 36, rate: 18, kept: true },
    { from: '2026-10-09T20:00:00Z', to: '2026-10-10T10:00:00Z', gain: 2, usd: 40, rate: 20, kept: true },
    { from: '2026-10-10T10:00:00Z', to: '2026-10-10T12:00:00Z', gain: 1, usd: 5, rate: 5, kept: false, reason: 'other_device' },
    { from: '2026-10-10T12:00:00Z', to: '2026-10-10T14:00:00Z', gain: 1, usd: 18, rate: 18, kept: false, reason: 'pending', pending: true, waiting: ['laptop'] },
  ];
  const machines = [{ pc: 'office', synced_until: '2026-10-10T15:00:00Z' }, { pc: 'laptop', synced_until: '2026-10-10T06:00:00Z', last_seen: '2026-10-10T06:05:00Z' }];
  const v = P.calibrationView(points, machines, '2026-10-10T16:00:00Z');
  assert.deepEqual(v.rows.map((r) => r.status), ['pending', 'dropped', 'kept', 'kept']);
  assert.equal(v.rows[1].reason, 'other_device');
  assert.deepEqual(v.waiting, ['laptop']);
  assert.equal(v.medians.weekly, 19);
  assert.equal(v.medians.five_hour, null);
  assert.deepEqual(v.machines.map((m) => [m.pc, m.waiting]), [['office', false], ['laptop', true]]);
  near(v.machines[0].age_min, 60);
  assert.equal(v.empty, false);
  const none = P.calibrationView([], machines, '2026-10-10T16:00:00Z');
  assert.deepEqual([none.empty, none.rows, none.waiting, none.medians.weekly], [true, [], [], null]);
});

// ---- i18n ------------------------------------------------------------------------------------------------
test('i18n: every en key exists in uk and vice versa, placeholders match', () => {
  const missing = Object.keys(I18N.en).filter((k) => !(k in UK));
  assert.deepEqual(missing, []);
  assert.deepEqual(Object.keys(UK).filter((k) => !(k in I18N.en)), []);
  const vars = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
  for (const k of Object.keys(I18N.en)) assert.equal(vars(UK[k]), vars(I18N.en[k]), k);
  for (const k of Object.keys(UK)) assert.ok(UK[k].length > 0, k);
});

test('i18n: t falls back to en, then to the key; substitutes variables', () => {
  assert.equal(I18N.t('uk', 'tab.dashboard'), 'Дашборд');
  assert.equal(I18N.t('uk', 'tab.analysis'), 'Аналіз');
  assert.equal(I18N.t('uk', 'tab.calibration'), 'Калібрування');
  assert.equal(I18N.t('en', 'empty.state'), 'No data yet. Data arrives after the first /keel:end-task or /keel:end-session on any machine.');
  assert.match(I18N.t('uk', 'empty.state'), /^Даних ще немає\..*\/keel:end-task.*\/keel:end-session/);
  assert.equal(I18N.t('de', 'tab.sessions'), 'Sessions'); // unknown language -> en
  assert.equal(I18N.t('uk', 'no.such.key'), 'no.such.key');
  assert.equal(I18N.t('en', 'tile.rate', { usd: '$18' }), '1 % ≈ $18');
  assert.equal(I18N.t('uk', 'cal.waiting_for', { pc: 'laptop' }), 'чекаємо на laptop');
  assert.equal(I18N.t('en', 'cal.waiting_for', { pc: 'laptop' }), 'waiting for laptop');
  assert.equal(I18N.t('en', 'cal.waiting_for'), 'waiting for {pc}');
  assert.equal(I18N.t('en', 'common.no_keel'), 'without keel');
  assert.equal(I18N.t('en', 'cal.none'), 'no calibration yet');
});

test('a participant that used two models gives one row per model: spend by model is not all on the one used most', () => {
  const mixed = part({ kind: 'main', model: HAIKU, usd: 5.1, requests: 25, active: 30, start: '2026-10-12T10:00:00Z', end: '2026-10-12T10:30:00Z', tools: { Read: 4 } });
  mixed.by_model = {
    [OPUS]: { requests: 10, tok: { in: 100, cw5: 0, cw1h: 0, cr: 900, out: 50 }, usd: 5 },
    [HAIKU]: { requests: 15, tok: { in: 10, cw5: 0, cw1h: 0, cr: 90, out: 5 }, usd: 0.1 },
  };
  const doc = { schema: 1, date: '2026-10-12', pc: 'home', user: 'me@x.com', part: 1, parts: 1, synced_until: '2026-10-12T22:00:00Z', hours: [], snapshots: [],
    sessions: [{ id: 'm1', project: 'shop', wallet: 'subscription', start: '2026-10-12T10:00:00Z', end: '2026-10-12T10:30:00Z', usd: 5.1, participants: [mixed], turns: [{ t: '2026-10-12T10:00:00Z', text: 'x', usd: 5.1, requests: 25 }] }] };
  const { rows } = P.flatten([doc]);
  assert.deepEqual(rows.map((r) => [r.model, r.usd, r.requests]), [[HAIKU, 0.1, 15], [OPUS, 5, 10]]);
  const d = P.dailyByModel(rows);
  assert.deepEqual([d.usd['opus-5-5'][0], d.usd['haiku-5-5'][0]], [5, 0.1]);
  // Counts that are not per model are not doubled.
  assert.equal(rows.reduce((a, r) => a + r.sessions, 0), 1);
  assert.equal(rows.reduce((a, r) => a + r.tools, 0), 4);
  assert.equal(rows.reduce((a, r) => a + r.active_min, 0), 30);
});
