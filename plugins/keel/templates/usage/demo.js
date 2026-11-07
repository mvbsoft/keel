'use strict';
// keel usage dashboard: sample data for a local layout check only (index.html?demo=1, when the page
// has no database). window.KeelUsageDemo(toMs) gives the days, machines and calibrations it shows;
// toMs is the page's timestamp parser.
window.KeelUsageDemo = function (toMs) {
  const now = Date.now(); const H = 3600000;
  const iso = (m) => new Date(m).toISOString();
  const OPUS = 'claude-opus-5-5-20260101'; const SONNET = 'claude-sonnet-5-5-20260101'; const HAIKU = 'claude-haiku-4-5-20251001';
  const PRICE = { [OPUS]: [5, 6.25, 10, 0.5, 25], [SONNET]: [3, 3.75, 6, 0.3, 15], [HAIKU]: [1, 1.25, 2, 0.1, 5] };
  const price = (m, k) => { const p = PRICE[m]; return (k.in * p[0] + k.cw5 * p[1] + k.cw1h * p[2] + k.cr * p[3] + k.out * p[4]) / 1e6; };
  const part = (kind, type, id, model, t0, min, act, req, scale, tools, extra) => {
    const tok = { in: Math.round(9000 * scale), cw5: Math.round(160000 * scale), cw1h: Math.round(12000 * scale), cr: Math.round(2600000 * scale), out: Math.round(38000 * scale) };
    const usd = Math.round(price(model, tok) * 100) / 100;
    return { kind, type, agent_id: id, model, by_model: { [model]: { requests: req, tok, usd } }, start: iso(t0), end: iso(t0 + min * 60000), active_min: act, requests: req, tools, agents_launched: (extra && extra.launched) || 0, tok, usd, output_estimated: false, resumed: (extra && extra.resumed) || 0 };
  };
  const keel = (task, level, f, lines, files, steps) => ({ task, level, findings: f, gates: 'pass', lines, files, steps });
  const T = (t0, off, text, usd, req, ag) => ({ t: iso(t0 + off * 60000), text, usd, requests: req, agents: ag });
  const sess = [];
  const add = (pc, id, project, wallet, t0, min, k, parts, turns, branch) => {
    const usd = Math.round(parts.reduce((a, p) => a + p.usd, 0) * 100) / 100;
    sess.push({ pc, s: { id, project, cwd: '/work/' + project, branch: branch || 'main', wallet, entrypoint: wallet === 'api' ? 'sdk-cli' : 'cli', start: iso(t0), end: iso(t0 + min * 60000), active_min: Math.round(min * 0.72), usd, cost_cc: usd, unpriced: [], keel: k, participants: parts, turns } });
  };
  let t0 = now - 50 * H;
  add('office', 'd1', 'shop', 'subscription', t0, 112, keel('SHOP-15 order filter in admin', 'standard', { must: 1, should: 2, nice: 3 }, { add: 212, del: 28 }, 7, [{ title: 'Filter API', model: 'haiku' }, { title: 'UI', model: 'sonnet' }, { title: 'Tests', model: 'sonnet' }]), [
    part('main', 'main', null, OPUS, t0, 112, 81, 118, 1.0, { Read: 52, Bash: 31, Edit: 22, Grep: 18, Agent: 6 }, { launched: 6 }),
    part('agent', 'context', 'a1', SONNET, t0 + 3 * 60000, 4, 4, 11, 0.12, { Read: 14, Grep: 9 }),
    part('agent', 'implementer', 'a2', HAIKU, t0 + 10 * 60000, 12, 11, 24, 0.3, { Edit: 9, Read: 12 }),
    part('agent', 'implementer', 'a3', SONNET, t0 + 10 * 60000, 18, 16, 27, 0.35, { Edit: 11, Read: 10, Bash: 4 }, { resumed: 1 }),
    part('agent', 'reviewer', 'a4', OPUS, t0 + 62 * 60000, 6, 6, 12, 0.18, { Read: 8, Grep: 5 }),
    part('agent', 'qa', 'a5', SONNET, t0 + 62 * 60000, 9, 8, 14, 0.2, { Bash: 12, Read: 4 }),
  ], [T(t0, 0, 'Take SHOP-15 from tasks/ and start the task', 0.41, 3, 0), T(t0, 7, 'Yes, the plan is fine', 0.18, 1, 0), T(t0, 10, 'hand out the steps', 1.62, 4, 3), T(t0, 43, 'show what changed', 0.22, 1, 0), T(t0, 61, 'run the verification', 1.37, 8, 2), T(t0, 87, 'fix the must and both should', 1.28, 5, 1), T(t0, 107, '/keel:end-task', 1.21, 3, 0)], 'keel-trial/shop-15');
  t0 = now - 47 * H;
  add('laptop', 'd2', 'tools', 'api', t0, 35, null, [part('main', 'main', null, SONNET, t0, 35, 24, 40, 0.4, { Read: 12, Bash: 9 })], [T(t0, 0, 'write a csv importer', 0.9, 20, 0), T(t0, 20, 'add tests', 0.7, 20, 0)]);
  t0 = now - 30 * H;
  add('office', 'd3', 'keel', 'subscription', t0, 95, keel('usage calculator', 'full', { must: 0, should: 3, nice: 2 }, { add: 640, del: 75 }, 14, [{ title: 'pivot', model: 'sonnet' }, { title: 'page', model: 'opus' }]), [
    part('main', 'main', null, OPUS, t0, 95, 70, 96, 0.85, { Read: 40, Edit: 30, Bash: 22, Agent: 4 }, { launched: 4 }),
    part('agent', 'implementer', 'b1', OPUS, t0 + 15 * 60000, 25, 22, 31, 0.45, { Edit: 18, Read: 9 }),
    part('agent', 'verifier', 'b2', SONNET, t0 + 70 * 60000, 7, 7, 8, 0.15, { Bash: 6 }),
  ], [T(t0, 0, 'continue with the next step', 2.1, 30, 1), T(t0, 50, 'review the diff', 1.4, 25, 2), T(t0, 88, 'commit', 0.3, 4, 0)], 'main');
  t0 = now - 26 * H;
  add('office', 'd4', 'mobile-api', 'subscription', t0, 22, null, [part('main', 'main', null, OPUS, t0, 22, 15, 21, 0.25, { Read: 9, Grep: 6 })], [T(t0, 0, 'why does login fail on staging', 0.95, 21, 0)]);
  t0 = now - 22 * H;
  add('laptop', 'd5', 'shop', 'subscription', t0, 48, keel('SHOP-22 export', 'basic', { must: 0, should: 1, nice: 0 }, { add: 40, del: 6 }, 2, [{ title: 'Export', model: 'haiku' }]), [
    part('main', 'main', null, SONNET, t0, 48, 33, 44, 0.5, { Read: 15, Edit: 6 }, { launched: 1 }),
    part('agent', 'implementer', 'c1', HAIKU, t0 + 8 * 60000, 10, 9, 14, 0.2, { Edit: 5 }),
  ], [T(t0, 0, 'start SHOP-22', 0.8, 20, 1), T(t0, 30, 'end-task', 0.5, 24, 0)]);
  t0 = now - 5 * H;
  add('office', 'd6', 'keel', 'subscription', t0, 70, keel('dashboard page', 'standard', { must: 1, should: 0, nice: 1 }, { add: 900, del: 10 }, 1, [{ title: 'index.html', model: 'opus' }]), [
    part('main', 'main', null, OPUS, t0, 70, 55, 80, 0.7, { Read: 30, Write: 3, Bash: 12, Agent: 2 }, { launched: 2 }),
    part('agent', 'implementer', 'e1', OPUS, t0 + 12 * 60000, 40, 36, 60, 0.6, { Write: 4, Edit: 20, Bash: 15 }),
    part('agent', 'reviewer', 'e2', SONNET, t0 + 55 * 60000, 8, 8, 12, 0.15, { Read: 10 }),
  ], [T(t0, 0, 'build the dashboard page', 3.1, 50, 1), T(t0, 52, 'review it', 1.2, 30, 1)]);
  t0 = now - 2 * H;
  add('laptop', 'd7', 'tools', 'api', t0, 15, null, [part('main', 'main', null, HAIKU, t0, 15, 12, 18, 0.3, { Bash: 5 })], [T(t0, 0, 'rename the build script', 0.2, 18, 0)]);

  const users = { office: 'owner@example.com', laptop: 'teammate@example.com' };
  const docs = new Map();
  const docOf = (pc, ms) => {
    const date = iso(ms).slice(0, 10); const id = date + '_' + pc;
    if (!docs.has(id)) docs.set(id, { schema: 1, date, pc, user: users[pc], part: 1, parts: 1, synced_until: iso(pc === 'office' ? now - H : now - 20 * H), hours: [], snapshots: [], sessions: [] });
    return docs.get(id);
  };
  for (const { pc, s } of sess) {
    docOf(pc, toMs(s.start)).sessions.push(s);
    for (const p of s.participants) {
      const hm = Math.floor(toMs(p.start) / H) * H; const d = docOf(pc, hm);
      let h = d.hours.find((x) => x.h === iso(hm) && x.wallet === s.wallet);
      if (!h) { h = { h: iso(hm), wallet: s.wallet, usd: 0, req: 0, tok: { in: 0, cw5: 0, cw1h: 0, cr: 0, out: 0 }, by_model: {} }; d.hours.push(h); }
      h.usd += p.usd; h.req += p.requests; for (const k in h.tok) h.tok[k] += p.tok[k]; h.by_model[p.model] = (h.by_model[p.model] || 0) + p.usd;
    }
  }
  const reset7 = iso(now + 3.4 * 24 * H);
  const snaps = [[-52, 31.0, 4, 'd1'], [-49, 32.2, 19, 'd1'], [-29.5, 33.6, 12, 'd3'], [-28.6, 35.0, 24, 'd3'], [-25.7, 35.4, 26, 'd4'], [-21, 36.1, 9, 'd5'], [-4.8, 37.0, 6, 'd6'], [-3.9, 38.4, 21, 'd6'], [-1, 38.9, 23, 'd6']];
  for (const [h, sd, fh, sid] of snaps) {
    const tm = now + h * H;
    docOf('office', tm).snapshots.push({ t: iso(tm), five_hour: fh, five_hour_resets_at: iso(Math.ceil(tm / (5 * H)) * 5 * H), seven_day: sd, seven_day_resets_at: reset7, session_id: sid, cost_usd: 0, src: 'statusline' });
  }
  const machines = [
    { name: 'office', user: users.office, wallet_default: 'subscription', synced_until: iso(now - H), last_seen: iso(now - H) },
    { name: 'laptop', user: users.laptop, wallet_default: 'subscription', synced_until: iso(now - 20 * H), last_seen: iso(now - 2 * H) },
  ];
  const pt = (fromH, toH, gain, usd, extra) => Object.assign({ from: iso(now + fromH * H), to: iso(now + toH * H), gain, usd, rate: usd / gain, by_model: { [OPUS]: usd * 0.8, [SONNET]: usd * 0.2 }, resets_at: reset7, pending: false, waiting: [], kept: true }, extra || {});
  const calibs = [
    { pc: 'office', computed_at: iso(now - H), waiting: ['laptop'],
      weekly: { rate: 17.4, n: 4, points: [pt(-52, -49, 1.2, 21.1), pt(-29.5, -28.6, 1.4, 24.0), pt(-28.6, -21, 1.1, 11.2, { kept: false, reason: 'other_device' }), pt(-21, -4.8, 1.0, 17.9), pt(-4.8, -3.9, 1.4, 23.8), pt(-3.9, -1, 1.0, 16.9, { pending: true, waiting: ['laptop'], kept: false, reason: 'pending' })] },
      five_hour: { rate: 2.9, n: 2, points: [pt(-52, -49, 15, 41.5), pt(-29.5, -28.6, 12, 36.0), pt(-4.8, -3.9, 15, 0, { kept: false, reason: 'no_spend', rate: 0 })] } },
    { pc: 'laptop', computed_at: iso(now - 20 * H), waiting: [], weekly: { rate: 16.8, n: 2, points: [] }, five_hour: { rate: null, n: 0, points: [] } },
  ];
  return { docs: [...docs.values()], machines, calibs };
};
