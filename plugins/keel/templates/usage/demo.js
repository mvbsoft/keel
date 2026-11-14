'use strict';
// keel usage dashboard: sample data for a local layout check only (index.html?demo=1, when the page
// has no database). window.KeelUsageDemo(toMs) gives the days, machines and calibrations it shows:
// a month of work ending today, generated from a fixed seed, so a load always looks the same.
// toMs is the page's timestamp parser. Every figure below (shares, token counts, percents) is invented
// to make the sample look like a month of real work; none comes from a machine or a price list.
window.KeelUsageDemo = function (toMs) {
  const now = Date.now(); const H = 3600000; const DAY = 24 * H;
  const iso = (m) => new Date(m).toISOString();
  const round = (v, digits) => Math.round(v * 10 ** digits) / 10 ** digits;
  // mulberry32: 32-bit state, one multiply-xorshift mix per call, result in [0, 1)
  let seed = 20260101;
  const rnd = () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const between = (lo, hi) => lo + rnd() * (hi - lo);
  const FABLE = 'claude-fable-5-2-20261101'; const OPUS = 'claude-opus-5-5-20260101'; const SONNET = 'claude-sonnet-5-5-20260101'; const HAIKU = 'claude-haiku-5-5-20260101';
  // sample $ per million tokens: input, cache write 5 min, cache write 1 h, cache read, output
  const PRICE = { [FABLE]: [8, 10, 16, 0.8, 40], [OPUS]: [5, 6.25, 10, 0.5, 25], [SONNET]: [3, 3.75, 6, 0.3, 15], [HAIKU]: [1, 1.25, 2, 0.1, 5] };
  const price = (m, k) => { const p = PRICE[m]; return (k.in * p[0] + k.cw5 * p[1] + k.cw1h * p[2] + k.cr * p[3] + k.out * p[4]) / 1e6; };
  const part = (kind, type, id, model, t0, min, act, req, scale, tools, extra) => {
    const tok = { in: Math.round(9000 * scale), cw5: Math.round(160000 * scale), cw1h: Math.round(12000 * scale), cr: Math.round(2600000 * scale), out: Math.round(38000 * scale) };
    const exact = price(model, tok);
    const usd = Math.round(exact * 100) / 100;
    // The kinds' dollars at the model's prices, scaled by usd / exact so they add up to the rounded usd.
    const only = (k) => ({ in: 0, cw5: 0, cw1h: 0, cr: 0, out: 0, [k]: tok[k] });
    const usd_kind = Object.fromEntries(Object.keys(tok).map((k) => [k, round(price(model, only(k)) * (usd / exact), 6)]));
    return { kind, type, agent_id: id, model, by_model: { [model]: { requests: req, tok, usd, usd_kind } }, start: iso(t0), end: iso(t0 + min * 60000), active_min: act, requests: req, tools, agents_launched: (extra && extra.launched) || 0, tok, usd, output_estimated: false, resumed: (extra && extra.resumed) || 0 };
  };
  const keel = (task, level, f, lines, files, steps) => ({ task, level, findings: f, gates: 'pass', lines, files, steps });
  const T = (t0, off, text, usd, req, ag) => ({ t: iso(t0 + off * 60000), text, usd, requests: req, agents: ag });
  const sess = [];
  const add = (pc, id, project, wallet, t0, min, k, parts, turns, branch) => {
    const usd = Math.round(parts.reduce((a, p) => a + p.usd, 0) * 100) / 100;
    sess.push({ pc, s: { id, project, cwd: '/work/' + project, branch: branch || 'main', wallet, entrypoint: wallet === 'api' ? 'sdk-cli' : 'cli', start: iso(t0), end: iso(t0 + min * 60000), active_min: Math.round(min * 0.72), usd, cost_cc: usd, unpriced: [], keel: k, participants: parts, turns } });
  };

  // ---- the last two days, written by hand (d1 and d3 keep what was done after each message) ----
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
  add('office', 'd3', 'keel', 'subscription', t0, 95, keel('usage calculator', 'maximum', { must: 0, should: 3, nice: 2 }, { add: 640, del: 75 }, 14, [{ title: 'pivot', model: 'sonnet' }, { title: 'page', model: 'opus' }]), [
    part('main', 'main', null, FABLE, t0, 95, 70, 96, 0.85, { Read: 40, Edit: 30, Bash: 22, Agent: 4 }, { launched: 4 }),
    part('agent', 'implementer', 'b1', FABLE, t0 + 15 * 60000, 25, 22, 31, 0.45, { Edit: 18, Read: 9 }),
    part('agent', 'verifier', 'b2', SONNET, t0 + 70 * 60000, 7, 7, 8, 0.15, { Bash: 6 }),
  ], [T(t0, 0, 'continue with the next step', 2.1, 30, 1), T(t0, 50, 'review the diff', 1.4, 25, 2), T(t0, 88, 'commit', 0.3, 4, 0)], 'main');
  t0 = now - 26 * H;
  add('office', 'd4', 'mobile-api', 'subscription', t0, 22, null, [part('main', 'main', null, FABLE, t0, 22, 15, 21, 0.25, { Read: 9, Grep: 6 })], [T(t0, 0, 'why does login fail on staging', 0.95, 21, 0)]);
  t0 = now - 22 * H;
  add('laptop', 'd5', 'shop', 'subscription', t0, 48, keel('SHOP-22 export', 'basic', { must: 0, should: 1, nice: 0 }, { add: 40, del: 6 }, 2, [{ title: 'Export', model: 'haiku' }]), [
    part('main', 'main', null, SONNET, t0, 48, 33, 44, 0.5, { Read: 15, Edit: 6 }, { launched: 1 }),
    part('agent', 'implementer', 'c1', HAIKU, t0 + 8 * 60000, 10, 9, 14, 0.2, { Edit: 5 }),
  ], [T(t0, 0, 'start SHOP-22', 0.8, 20, 1), T(t0, 30, 'end-task', 0.5, 24, 0)]);
  t0 = now - 5 * H;
  add('office', 'd6', 'keel', 'subscription', t0, 70, keel('dashboard page', 'standard', { must: 1, should: 0, nice: 1 }, { add: 900, del: 10 }, 1, [{ title: 'index.html', model: 'opus' }]), [
    part('main', 'main', null, FABLE, t0, 70, 55, 80, 0.7, { Read: 30, Write: 3, Bash: 12, Agent: 2 }, { launched: 2 }),
    part('agent', 'implementer', 'e1', FABLE, t0 + 12 * 60000, 40, 36, 60, 0.6, { Write: 4, Edit: 20, Bash: 15 }),
    part('agent', 'reviewer', 'e2', SONNET, t0 + 55 * 60000, 8, 8, 12, 0.15, { Read: 10 }),
  ], [T(t0, 0, 'build the dashboard page', 3.1, 50, 1), T(t0, 52, 'review it', 1.2, 30, 1)]);
  t0 = now - 2 * H;
  add('laptop', 'd7', 'tools', 'api', t0, 15, null, [part('main', 'main', null, HAIKU, t0, 15, 12, 18, 0.3, { Bash: 5 })], [T(t0, 0, 'rename the build script', 0.2, 18, 0)]);

  // What was done after each message, for two sessions; the others stay without, as a session sent before these details existed.
  const tk = (inp, cw5, cr, out) => ({ in: inp, cw5, cw1h: 0, cr, out });
  const detail = (id, list) => { const turns = sess.find((x) => x.s.id === id).s.turns; list.forEach((d, i) => Object.assign(turns[i], d)); };
  detail('d1', [
    { tools: { Read: 6, Bash: 3, Grep: 2 }, tok: tk(1200, 38000, 210000, 5200), ctx_max: 71000 },
    { tools: { Read: 1 }, tok: tk(300, 9000, 64000, 900), ctx_max: 64000 },
    { tools: { Agent: 3, Read: 4, Bash: 1 }, agent_types: { implementer: 2, context: 1 }, usd_agents: 1.1, tok: tk(2400, 61000, 520000, 17400), ctx_max: 78000 },
    { tools: { Bash: 1 }, tok: tk(200, 6000, 88000, 1100), ctx_max: 88000 },
    { tools: { Bash: 5, Read: 3, Agent: 2, Grep: 2, Edit: 1, Glob: 1, other: 2 }, agent_types: { reviewer: 1, qa: 1 }, usd_agents: 0.9, tok: tk(2100, 52000, 610000, 13800), ctx_max: 94000 },
    { tools: { Edit: 4, Read: 2, Bash: 2 }, agent_types: { implementer: 1 }, usd_agents: 0.5, tok: tk(900, 31000, 330000, 7600), ctx_max: 101000 },
    { tools: { Bash: 2, Read: 1 }, tok: tk(700, 24000, 280000, 6100), ctx_max: 108000 },
  ]);
  detail('d3', [
    { tools: { Read: 14, Edit: 9, Bash: 6, Agent: 1 }, agent_types: { implementer: 1 }, usd_agents: 0.7, tok: tk(3100, 83000, 940000, 21000), ctx_max: 96000 },
    { tools: { Read: 12, Grep: 8, Agent: 2 }, agent_types: { verifier: 1, reviewer: 1 }, usd_agents: 0.6, tok: tk(2600, 70000, 780000, 15500), ctx_max: 112000 },
    { tools: { Bash: 3 }, tok: tk(400, 8000, 120000, 900), ctx_max: 120000 },
  ]);

  // ---- the rest of the month: a few sessions on most working days, none on Sundays and a few other days ----
  const PROMPTS = ['continue with the next step', 'run the tests', 'fix the failing check', 'show what changed', 'rename the helper', 'add a unit test', 'explain this error', 'commit', 'review the diff', 'update the readme', 'why is this slow', 'split this function'];
  const taken = new Set();
  const fresh = (list) => { const free = list.filter((x) => !taken.has(x)); const x = pick(free.length ? free : list); taken.add(x); return x; };
  let shopNo = 1;
  const PROJECTS = [
    [0.4, 'shop', () => `SHOP-${Math.min(shopNo++, 14)} ${pick(['cart totals', 'product import', 'shipping rates', 'invoice export', 'search by SKU', 'refund flow', 'stock alerts'])}`],
    [0.65, 'keel', () => fresh(['pivot tables', 'sync settings', 'limit forecast', 'csv export', 'session list', 'weekly report', 'config checks', 'hook timing', 'status line', 'cache report', 'agent costs', 'plan forecast', 'tool counts', 'spend alerts', 'report layout', 'reset times'])],
    [0.85, 'mobile-api', () => fresh(['login rate limit', 'push tokens', 'order status endpoint', 'api pagination', 'token refresh', 'device list', 'session expiry', 'health check', 'audit log'])],
    [1, 'tools', null],
  ];
  const AGENTS = { basic: ['implementer'], standard: ['context', 'implementer', 'reviewer', 'qa'], maximum: ['context', 'implementer', 'implementer', 'reviewer', 'qa', 'verifier'] };
  const AGENT_MODEL = { context: () => HAIKU, implementer: () => pick([SONNET, HAIKU]), reviewer: () => OPUS, qa: () => SONNET, verifier: () => SONNET };
  const toolCounts = (n) => ({ Read: Math.ceil(n * between(0.4, 0.8)), Edit: Math.ceil(n * between(0.1, 0.4)), Bash: Math.ceil(n * between(0.1, 0.5)) });
  let n = 0;
  for (let age = 29; age >= 3; age--) {
    const day = Math.floor(now / DAY) * DAY - age * DAY;
    const weekday = new Date(day).getUTCDay();
    if (weekday === 0 || (weekday === 6 && rnd() < 0.7) || age === 12 || age === 20) continue;
    for (let k = 0, count = 1 + (rnd() < 0.75 ? 1 : 0); k < count; k++) {
      const r = rnd();
      const [, project, titleOf] = PROJECTS.find(([upTo]) => r < upTo);
      const api = project === 'tools';
      const pc = api || rnd() > 0.7 ? 'laptop' : 'office';
      const id = `g${String(++n).padStart(2, '0')}`;
      const start = day + (8 + Math.floor(rnd() * 9)) * H + Math.floor(rnd() * 4) * 15 * 60000;
      const min = 15 + Math.floor(rnd() * 100);
      const level = !api && rnd() < 0.65 ? pick(['basic', 'standard', 'standard', 'maximum']) : null;
      const scale = between(0.4, 1.5);
      const mainModel = age <= 5 && rnd() < 0.6 ? FABLE : api ? pick([SONNET, HAIKU]) : pick([OPUS, OPUS, SONNET, SONNET, HAIKU]);
      const agentTypes = level ? AGENTS[level] : [];
      const parts = [part('main', 'main', null, mainModel, start, min, Math.round(min * 0.7), Math.round(min * 1.1), scale, toolCounts(min), { launched: agentTypes.length })];
      agentTypes.forEach((type, i) => {
        const dur = 4 + Math.floor(rnd() * 20);
        parts.push(part('agent', type, `${id}a${i}`, AGENT_MODEL[type](), start + (5 + i * 4) * 60000, dur, Math.round(dur * 0.8), Math.round(dur * 1.3), between(0.1, 0.4) * scale, toolCounts(dur), { resumed: rnd() < 0.1 ? 1 : 0 }));
      });
      const usd = parts.reduce((a, p) => a + p.usd, 0);
      const weights = Array.from({ length: 2 + Math.floor(rnd() * 3) }, () => 0.5 + rnd());
      const turns = weights.map((w, i) => T(start, Math.floor((min * i) / weights.length), pick(PROMPTS), round((usd * w) / weights.reduce((a, b) => a + b), 2), 2 + Math.floor(rnd() * 20), i === 1 ? agentTypes.length : 0));
      const steps = ['API', 'UI', 'Tests', 'Docs'].slice(0, 1 + Math.floor(rnd() * 3)).map((title) => ({ title, model: pick(['haiku', 'sonnet', 'opus']) }));
      const task = level ? keel(titleOf(), level, { must: rnd() < 0.3 ? 1 : 0, should: Math.floor(rnd() * 3), nice: Math.floor(rnd() * 4) }, { add: 40 + Math.floor(rnd() * 500), del: Math.floor(rnd() * 80) }, 1 + Math.floor(rnd() * 12), steps) : null;
      add(pc, id, project, api ? 'api' : 'subscription', start, min, task, parts, turns, 'main');
    }
  }

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

  // ---- plan limit: two readings (shortly after the start, at the end) of every subscription session on the office PC ----
  // The weekly limit resets every 7 days at the same moment, the 5-hour window on a 5-hour grid since the epoch; a reading
  // belongs to the window that ends next. The dollars per 1 % are 17.4 (week) and 2.9 (5 hours), with a little spread.
  const WEEK = 7 * DAY; const FIVE = 5 * H;
  const reset7 = now + 3.4 * DAY;
  const weekEnd = (m) => reset7 - WEEK * Math.floor((reset7 - m) / WEEK);
  const weekLevel = {}; const windowLevel = {};
  const mine = sess.filter(({ pc, s }) => pc === 'office' && s.wallet === 'subscription').map(({ s }) => s).sort((a, b) => toMs(a.start) - toMs(b.start));
  const weekly = []; const five = [];
  const pt = (from, to, gain, usd, resets, extra) => Object.assign({ from: iso(from), to: iso(to), gain, usd, rate: round(usd / gain, 2), by_model: { [OPUS]: round(usd * 0.8, 1), [SONNET]: round(usd * 0.2, 1) }, resets_at: iso(resets), pending: false, waiting: [], kept: true }, extra || {});
  let lastEnd = 0;
  mine.forEach((s, i) => {
    // Sessions that overlap on this PC are read one after the other, so the percentage never goes down.
    const first = Math.max(toMs(s.start) + 0.15 * (toMs(s.end) - toMs(s.start)), lastEnd + 60000);
    const end = Math.max(toMs(s.end), first + 10 * 60000);
    lastEnd = end;
    const wk = weekEnd(first);
    const w0 = round(weekLevel[wk] === undefined ? between(4, 14) : weekLevel[wk] + between(0.2, 1.2), 1);
    const gain = round(between(1, 2.4), 1);
    const w1 = round(w0 + gain, 1);
    weekLevel[wk] = w1;
    const win = Math.ceil(first / FIVE) * FIVE;
    const same = win === Math.ceil(end / FIVE) * FIVE;
    const f0 = same ? round(windowLevel[win] === undefined ? between(2, 9) : windowLevel[win] + between(0.5, 3), 1) : null;
    const f1 = same ? round(f0 + gain * 6, 1) : null;
    if (same) windowLevel[win] = f1;
    const reading = (m, w, f) => docOf('office', m).snapshots.push({ t: iso(m), ...(same ? { five_hour: f, five_hour_resets_at: iso(win) } : {}), seven_day: w, seven_day_resets_at: iso(wk), session_id: s.id, cost_usd: 0, src: 'statusline' });
    reading(first, w0, f0); reading(end, w1, f1);
    if (i >= mine.length - 12) weekly.push(pt(first, end, gain, round(gain * 17.4 * between(0.85, 1.2), 1), wk));
    if (same && i >= mine.length - 14) five.push(pt(first, end, round(f1 - f0, 1), round((f1 - f0) * 2.9 * between(0.85, 1.2), 1), win));
  });
  weekly.forEach((p, j) => { if (j % 5 === 3) Object.assign(p, { kept: false, reason: 'other_device' }); });
  Object.assign(weekly[weekly.length - 1], { pending: true, waiting: ['laptop'], kept: false, reason: 'pending' });
  Object.assign(five[1], { usd: 0, rate: 0, kept: false, reason: 'no_spend' });
  const current = mine[mine.length - 1];
  docOf('office', now - 10 * 60000).snapshots.push({ t: iso(now - 10 * 60000), five_hour: 23.4, five_hour_resets_at: iso(now + 2.5 * H), seven_day: round(weekLevel[reset7] + 0.4, 1), seven_day_resets_at: iso(reset7), session_id: current.id, cost_usd: 0, src: 'statusline' });

  const median = (list) => { const v = list.slice().sort((a, b) => a - b); return v.length ? round((v[(v.length - 1) >> 1] + v[v.length >> 1]) / 2, 2) : null; };
  const rateOf = (points) => { const kept = points.filter((p) => p.kept); return { rate: median(kept.map((p) => p.rate)), n: kept.length, points }; };
  const machines = [
    { name: 'office', user: users.office, wallet_default: 'subscription', synced_until: iso(now - H), last_seen: iso(now - H) },
    { name: 'laptop', user: users.laptop, wallet_default: 'subscription', synced_until: iso(now - 20 * H), last_seen: iso(now - 2 * H) },
  ];
  const calibs = [
    { pc: 'office', computed_at: iso(now - H), waiting: ['laptop'], weekly: rateOf(weekly), five_hour: rateOf(five) },
    { pc: 'laptop', computed_at: iso(now - 20 * H), waiting: [], weekly: { rate: 16.8, n: 2, points: [] }, five_hour: { rate: null, n: 0, points: [] } },
  ];
  return { docs: [...docs.values()], machines, calibs };
};
