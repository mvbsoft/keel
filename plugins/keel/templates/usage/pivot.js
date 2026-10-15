'use strict';
// keel usage dashboard: pure data functions (no DOM, no dependencies). Works in the browser as
// window.KeelPivot and in node via require. Input is the `days` collection of the artifact database
// (written by scripts/lib/usage-store.js); output feeds the Dashboard, Analysis, Sessions, Session and
// Calibration tabs.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KeelPivot = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // ---- helpers -------------------------------------------------------------------------------------
  const TOK_KEYS = ['in', 'cw5', 'cw1h', 'cr', 'out'];

  const MEASURES = [
    { id: 'usd', unit: 'usd' },
    { id: 'tokens', unit: 'tokens' },
    { id: 'tok_in', unit: 'tokens' },
    { id: 'tok_cw5', unit: 'tokens' },
    { id: 'tok_cw1h', unit: 'tokens' },
    { id: 'tok_cr', unit: 'tokens' },
    { id: 'tok_out', unit: 'tokens' },
    { id: 'time_min', unit: 'min' },
    { id: 'active_min', unit: 'min' },
    { id: 'requests', unit: 'count' },
    { id: 'turns', unit: 'count' },
    { id: 'sessions', unit: 'count' },
  ];

  const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
  const ms = (t) => { const v = t ? Date.parse(t) : NaN; return Number.isFinite(v) ? v : NaN; };
  const pad2 = (n) => String(n).padStart(2, '0');

  function value(row, id) {
    switch (id) {
      case 'tok_in': return num(row.tok && row.tok.in);
      case 'tok_cw5': return num(row.tok && row.tok.cw5);
      case 'tok_cw1h': return num(row.tok && row.tok.cw1h);
      case 'tok_cr': return num(row.tok && row.tok.cr);
      case 'tok_out': return num(row.tok && row.tok.out);
      default: return num(row[id]);
    }
  }

  function emptyMeasures() {
    const o = {};
    for (const m of MEASURES) o[m.id] = 0;
    return o;
  }

  function addRow(acc, row) {
    for (const m of MEASURES) acc[m.id] += value(row, m.id);
    return acc;
  }

  function sumRows(rows) {
    const acc = emptyMeasures();
    for (const r of rows) addRow(acc, r);
    return acc;
  }

  // 'claude-opus-5-5-20260101' -> 'opus-5-5'; 'claude-3-5-haiku-20241022' -> 'haiku-3-5'; unknown ids stay as is.
  function family(model) {
    if (!model) return 'unknown';
    const s = String(model).replace(/\[[^\]]*\]$/, '');
    const m = /^claude-(.+?)(?:-\d{8})?$/.exec(s);
    if (!m) return s;
    const old = /^(\d+(?:-\d+)*)-(opus|sonnet|haiku)$/.exec(m[1]);
    return old ? `${old[2]}-${old[1]}` : m[1];
  }

  function isoWeek(dateStr) {
    const p = String(dateStr || '').split('-').map(Number);
    if (p.length < 3 || p.some((x) => !Number.isFinite(x))) return 'unknown';
    const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    const day = dt.getUTCDay() || 7;
    dt.setUTCDate(dt.getUTCDate() + 4 - day);
    const y0 = Date.UTC(dt.getUTCFullYear(), 0, 1);
    const w = Math.ceil(((dt.getTime() - y0) / 86400000 + 1) / 7);
    return `${dt.getUTCFullYear()}-W${pad2(w)}`;
  }

  function dominantModel(p) {
    if (p.model) return p.model;
    let best = null;
    let bestUsd = -1;
    for (const [k, v] of Object.entries(p.by_model || {})) {
      const usd = num(v && v.usd);
      if (usd > bestUsd) { best = k; bestUsd = usd; }
    }
    return best || 'unknown';
  }

  function sumValues(obj) {
    let s = 0;
    for (const v of Object.values(obj || {})) s += num(v);
    return s;
  }

  function strCmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

  // ---- flatten -------------------------------------------------------------------------------------
  function flatten(docs) {
    const list = (docs || []).filter(Boolean);
    // 1. the same doc twice (re-sync): keep the one with the later synced_until, the later one on a tie.
    const byDoc = new Map();
    for (const d of list) {
      const id = `${d.date}_${d.pc}_${d.part || 1}`;
      const old = byDoc.get(id);
      if (!old || !(ms(d.synced_until) < ms(old.synced_until))) byDoc.set(id, d);
    }
    const uniq = [...byDoc.values()];
    // 2. the same session in two docs: keep the doc with the later synced_until.
    const bySession = new Map();
    for (const d of uniq) {
      for (const s of d.sessions || []) {
        const old = bySession.get(s.id);
        if (!old || ms(d.synced_until) > ms(old.doc.synced_until)) bySession.set(s.id, { s, doc: d });
      }
    }
    // 3. stable keys: order by start within day+pc.
    const groups = new Map();
    for (const e of bySession.values()) {
      const g = `${e.doc.date}_${e.doc.pc}`;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(e);
    }
    const sessions = [];
    for (const [g, arr] of groups) {
      arr.sort((a, b) => strCmp(String(a.s.start || ''), String(b.s.start || '')) || strCmp(String(a.s.id), String(b.s.id)));
      arr.forEach((e, i) => {
        sessions.push({ ...e.s, key: `${g}.${i + 1}`, date: e.doc.date, pc: e.doc.pc, user: e.doc.user, wallet: e.s.wallet || 'unknown' });
      });
    }
    sessions.sort((a, b) => strCmp(String(a.start || ''), String(b.start || '')) || strCmp(a.key, b.key));

    const rows = [];
    for (const s of sessions) {
      const sStart = ms(s.start);
      for (const p of s.participants || []) {
        const main = p.kind === 'main';
        const pStart = ms(p.start);
        const pEnd = ms(p.end);
        const hSrc = Number.isFinite(pStart) ? pStart : sStart;
        const tok = {};
        for (const k of TOK_KEYS) tok[k] = num(p.tok && p.tok[k]);
        const base = {
          session: s.key,
          session_id: s.id,
          date: s.date,
          week: isoWeek(s.date),
          hourOfDay: Number.isFinite(hSrc) ? new Date(hSrc).getHours() : null,
          pc: s.pc,
          user: s.user,
          project: s.project,
          wallet: s.wallet,
          participant: main ? 'main' : (p.type || 'agent'),
          kind: main ? 'main' : 'agent',
          agent_id: p.agent_id || null,
          model: dominantModel(p),
          usd: num(p.usd),
          tok,
          tokens: TOK_KEYS.reduce((a, k) => a + tok[k], 0),
          time_min: Number.isFinite(pStart) && Number.isFinite(pEnd) ? Math.max(0, (pEnd - pStart) / 60000) : 0,
          active_min: num(p.active_min),
          requests: num(p.requests),
          turns: main ? (s.turns || []).length : 0,
          sessions: main ? 1 : 0,
          tools: sumValues(p.tools),
          agents_launched: num(p.agents_launched),
          resumed: !!p.resumed,
          output_estimated: !!p.output_estimated,
        };
        // A participant that used several models (a /model switch, an agent's fallback) gives one row
        // per model with that model's dollars, tokens and requests, so spend by model is not all put on
        // the model used most. Counts that are not per model stay on the first row only.
        const models = Object.entries(p.by_model || {}).filter(([, v]) => v && typeof v === 'object');
        if (models.length < 2) { rows.push(base); continue; }
        const first = base.model;
        models.sort(([a], [b]) => (a === first ? -1 : b === first ? 1 : strCmp(a, b)));
        models.forEach(([model, v], i) => {
          const t = {};
          for (const k of TOK_KEYS) t[k] = num(v.tok && v.tok[k]);
          rows.push({
            ...base,
            model,
            usd: num(v.usd),
            tok: t,
            tokens: TOK_KEYS.reduce((a, k) => a + t[k], 0),
            requests: num(v.requests),
            ...(i ? { time_min: 0, active_min: 0, turns: 0, sessions: 0, tools: 0, agents_launched: 0 } : {}),
          });
        });
      }
    }

    const hours = [];
    const snapshots = [];
    for (const d of uniq) {
      for (const h of d.hours || []) hours.push({ ...h, date: d.date, pc: d.pc, user: d.user });
      for (const sn of d.snapshots || []) snapshots.push({ ...sn, pc: d.pc, user: d.user });
    }
    hours.sort((a, b) => strCmp(a.date, b.date) || strCmp(String(a.h), String(b.h)) || strCmp(a.pc, b.pc));
    return { sessions, rows, hours, snapshots };
  }

  // ---- filter --------------------------------------------------------------------------------------
  function inList(list, v) {
    return !list || !list.length || list.includes(v);
  }

  function modelMatches(list, model) {
    if (!list || !list.length) return true;
    const m = String(model || '');
    return list.some((f) => m === f || m.includes(f) || family(m) === f);
  }

  function filter(rows, f) {
    const q = f || {};
    return (rows || []).filter((r) => {
      if (q.from && r.date < q.from) return false;
      if (q.to && r.date > q.to) return false;
      if (!inList(q.pc, r.pc) || !inList(q.user, r.user) || !inList(q.project, r.project) || !inList(q.wallet, r.wallet)) return false;
      if (q.participant) {
        if (q.participant === 'main') { if (r.kind !== 'main') return false; }
        else if (q.participant === 'agents') { if (r.kind === 'main') return false; }
        else if (r.participant !== q.participant) return false;
      }
      return modelMatches(q.model, r.model);
    });
  }

  // ---- group ---------------------------------------------------------------------------------------
  function dimKey(row, by) {
    let v;
    switch (by) {
      case 'day': v = row.date; break;
      case 'week': v = row.week; break;
      case 'project': v = row.project; break;
      case 'pc': v = row.pc; break;
      case 'user': v = row.user; break;
      case 'participant': v = row.participant; break;
      case 'model': return family(row.model);
      case 'hour': return Number.isFinite(row.hourOfDay) ? pad2(row.hourOfDay) : 'unknown';
      default: v = row[by];
    }
    return v == null || v === '' ? 'unknown' : String(v);
  }

  function group(rows, by, split) {
    const sp = split && split !== 'none' ? split : null;
    const map = new Map();
    for (const r of rows || []) {
      const k = dimKey(r, by);
      let g = map.get(k);
      if (!g) { g = { key: k, total: emptyMeasures(), parts: {} }; map.set(k, g); }
      addRow(g.total, r);
      if (sp) {
        const sk = dimKey(r, sp);
        if (!g.parts[sk]) g.parts[sk] = emptyMeasures();
        addRow(g.parts[sk], r);
      }
    }
    const out = [...map.values()];
    if (by === 'day' || by === 'week' || by === 'hour') out.sort((a, b) => strCmp(a.key, b.key));
    else out.sort((a, b) => b.total.usd - a.total.usd || strCmp(a.key, b.key));
    return out;
  }

  function share(groups, measure) {
    const total = (groups || []).reduce((a, g) => a + num(g.total[measure]), 0);
    return (groups || []).map((g) => ({ ...g, pct: total ? (num(g.total[measure]) / total) * 100 : 0 }));
  }

  // ---- stats ---------------------------------------------------------------------------------------
  function stats(rows, sessions) {
    const list = rows || [];
    const t = sumRows(list);
    const keys = new Set(list.map((r) => r.session));
    const sess = (sessions || []).filter((s) => keys.has(s.key));
    const input = t.tok_in + t.tok_cw5 + t.tok_cw1h + t.tok_cr;
    // Wall-clock active time of the sessions (agents run alongside the main session, so summing
    // participants would count the same minutes twice). Without session data fall back to main rows.
    const activeMin = sessions
      ? sess.reduce((a, s) => a + num(s.active_min), 0)
      : list.filter((r) => r.kind === 'main').reduce((a, r) => a + r.active_min, 0);
    const n = keys.size;
    return {
      cache_share: input ? t.tok_cr / input : null,
      usd_per_hour: activeMin ? t.usd / (activeMin / 60) : null,
      usd_per_turn: t.turns ? t.usd / t.turns : null,
      avg_session_usd: n ? t.usd / n : null,
      avg_session_active_min: sessions ? (sess.length ? activeMin / sess.length : null) : (n ? activeMin / n : null),
      agents_launched: list.reduce((a, r) => a + r.agents_launched, 0),
      tool_calls: list.reduce((a, r) => a + r.tools, 0),
    };
  }

  // ---- dashboard series ----------------------------------------------------------------------------
  function weekly(snapshots) {
    const byT = new Map();
    for (const s of snapshots || []) {
      if (!Number.isFinite(ms(s.t))) continue;
      const sd = s.seven_day == null ? null : num(s.seven_day);
      const fh = s.five_hour == null ? null : num(s.five_hour);
      if (sd == null && fh == null) continue;
      byT.set(s.t, { t: s.t, seven_day: sd, five_hour: fh });
    }
    return [...byT.values()].sort((a, b) => ms(a.t) - ms(b.t));
  }

  function dailyByModel(rows) {
    const days = [...new Set((rows || []).map((r) => r.date))].sort();
    const idx = new Map(days.map((d, i) => [d, i]));
    const totals = new Map();
    const usd = {};
    for (const r of rows || []) {
      const m = family(r.model);
      if (!usd[m]) usd[m] = days.map(() => 0);
      usd[m][idx.get(r.date)] += num(r.usd);
      totals.set(m, (totals.get(m) || 0) + num(r.usd));
    }
    const models = [...totals.keys()].sort((a, b) => totals.get(b) - totals.get(a) || strCmp(a, b));
    return { days, models, usd };
  }

  function mainVsAgents(rows) {
    const list = rows || [];
    const agents = list.filter((r) => r.kind !== 'main');
    return {
      main: sumRows(list.filter((r) => r.kind === 'main')),
      agents: sumRows(agents),
      by_type: group(agents, 'participant').map((g) => ({ key: g.key, total: g.total })),
    };
  }

  function tokenKinds(rows) {
    const t = sumRows(rows || []);
    return { in: t.tok_in, cw5: t.tok_cw5, cw1h: t.tok_cw1h, cr: t.tok_cr, out: t.tok_out, total: t.tokens };
  }

  function topProjects(rows, n = 5) {
    const gs = share(group(rows || [], 'project'), 'usd');
    return gs.slice(0, n).map((g) => ({ project: g.key, usd: g.total.usd, pct: g.pct, sessions: g.total.sessions }));
  }

  // ---- sessions table ------------------------------------------------------------------------------
  function sessionModels(s) {
    const set = new Set();
    for (const p of s.participants || []) {
      const keys = Object.keys(p.by_model || {});
      if (keys.length) keys.forEach((k) => set.add(family(k)));
      else if (p.model) set.add(family(p.model));
    }
    return [...set];
  }

  function sessionRow(s) {
    return {
      key: s.key,
      date: s.date,
      start: s.start || null,
      pc: s.pc,
      user: s.user,
      project: s.project,
      branch: s.branch || null,
      wallet: s.wallet,
      task: s.keel && s.keel.task ? s.keel.task : null,
      models: sessionModels(s),
      usd: num(s.usd),
      week_pct: null,
      level: s.keel && s.keel.level ? s.keel.level : null,
      active_min: num(s.active_min),
    };
  }

  function sessionPasses(s, row, f, needle) {
    if (f.from && s.date < f.from) return false;
    if (f.to && s.date > f.to) return false;
    if (!inList(f.pc, s.pc) || !inList(f.user, s.user) || !inList(f.project, s.project) || !inList(f.wallet, s.wallet)) return false;
    if (f.model && f.model.length) {
      const ids = new Set();
      for (const p of s.participants || []) {
        Object.keys(p.by_model || {}).forEach((k) => ids.add(k));
        if (p.model) ids.add(p.model);
      }
      if (![...ids].some((id) => modelMatches(f.model, id))) return false;
    }
    if (needle) {
      const hay = [s.project, row.task, s.branch, ...(s.turns || []).map((t) => t.text)].filter(Boolean).join('\n').toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  }

  function sessionsTable(sessions, opts) {
    const o = opts || {};
    const sort = o.sort || 'date';
    const dir = o.dir === 'asc' ? 1 : -1;
    const f = o.filters || {};
    const needle = o.search ? String(o.search).trim().toLowerCase() : '';
    let rows = [];
    for (const s of sessions || []) {
      const row = sessionRow(s);
      if (sessionPasses(s, row, f, needle)) rows.push(row);
    }
    const sortVal = (r) => (sort === 'models' ? r.models.join(',') : r[sort]);
    rows = rows.sort((a, b) => {
      const va = sortVal(a);
      const vb = sortVal(b);
      const na = va == null || va === '';
      const nb = vb == null || vb === '';
      if (na !== nb) return na ? 1 : -1; // empty values last in both directions
      let c = 0;
      if (!na) c = typeof va === 'number' && typeof vb === 'number' ? va - vb : strCmp(String(va).toLowerCase(), String(vb).toLowerCase());
      if (c === 0) c = strCmp(String(a.start || a.date), String(b.start || b.date)) || strCmp(a.key, b.key);
      return c * dir;
    });
    const sum = (arr) => ({ count: arr.length, usd: arr.reduce((x, r) => x + r.usd, 0), active_min: arr.reduce((x, r) => x + r.active_min, 0) });
    const total = sum(rows);
    let groups = null;
    const by = o.groupBy && o.groupBy !== 'none' ? o.groupBy : null;
    if (by) {
      const field = by === 'day' ? 'date' : by;
      const map = new Map();
      for (const r of rows) {
        const k = r[field] == null || r[field] === '' ? 'unknown' : String(r[field]);
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(r);
      }
      groups = [...map.entries()].map(([key, rs]) => ({ key, rows: rs, subtotal: sum(rs) }));
      if (by === 'day') groups.sort((a, b) => strCmp(b.key, a.key));
      else groups.sort((a, b) => b.subtotal.usd - a.subtotal.usd || strCmp(a.key, b.key));
    }
    return { rows, groups, total };
  }

  // ---- CSV -----------------------------------------------------------------------------------------
  function csvCell(v) {
    if (v == null) return '';
    const s = Array.isArray(v) ? v.join(' ') : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  // columns: ['key', ...] or [{key, label, format(value, row)}]. Third argument: true or {bom:true}.
  function toCSV(rows, columns, opts) {
    const bom = opts === true || !!(opts && opts.bom);
    const cols = (columns || []).map((c) => (typeof c === 'string' ? { key: c, label: c } : { label: c.key, ...c }));
    const lines = [cols.map((c) => csvCell(c.label)).join(',')];
    for (const r of rows || []) {
      lines.push(cols.map((c) => csvCell(c.format ? c.format(r[c.key], r) : r[c.key])).join(','));
    }
    return (bom ? '﻿' : '') + lines.join('\r\n');
  }

  // ---- session page --------------------------------------------------------------------------------
  function sessionPage(session) {
    const s = session || {};
    const parts = [...(s.participants || [])].sort((a, b) => strCmp(String(a.start || ''), String(b.start || '')) || strCmp(String(a.agent_id || ''), String(b.agent_id || '')));
    const starts = parts.map((p) => ms(p.start)).concat(ms(s.start)).filter(Number.isFinite);
    const ends = parts.map((p) => ms(p.end)).concat(ms(s.end)).filter(Number.isFinite);
    const t0 = starts.length ? Math.min(...starts) : NaN;
    const t1 = ends.length ? Math.max(...ends) : NaN;
    const spanMs = Number.isFinite(t0) && Number.isFinite(t1) ? Math.max(0, t1 - t0) : 0;
    const pctAt = (t) => (spanMs && Number.isFinite(t) ? ((t - t0) / spanMs) * 100 : 0);
    const totalUsd = parts.reduce((a, p) => a + num(p.usd), 0);

    const participants = parts.map((p) => {
      const tok = {};
      for (const k of TOK_KEYS) tok[k] = num(p.tok && p.tok[k]);
      return {
        label: p.kind === 'main' ? 'main' : (p.type || 'agent'),
        kind: p.kind === 'main' ? 'main' : 'agent',
        agent_id: p.agent_id || null,
        type: p.type || null,
        model: dominantModel(p),
        family: family(dominantModel(p)),
        start: p.start || null,
        end: p.end || null,
        active_min: num(p.active_min),
        requests: num(p.requests),
        tokens: TOK_KEYS.reduce((a, k) => a + tok[k], 0),
        tok,
        usd: num(p.usd),
        share: totalUsd ? num(p.usd) / totalUsd : 0,
        resumed: !!p.resumed,
        output_estimated: !!p.output_estimated,
        agents_launched: num(p.agents_launched),
      };
    });

    const lanes = participants.map((p) => {
      const a = pctAt(ms(p.start));
      const b = pctAt(ms(p.end));
      return { label: p.label, start: p.start, end: p.end, model: p.family, kind: p.kind, resumed: p.resumed, left_pct: a, width_pct: Math.max(0, b - a) };
    });

    const turnTotal = (s.turns || []).reduce((a, t) => a + num(t.usd), 0);
    const turns = (s.turns || []).map((t, i) => ({
      n: i + 1, t: t.t, text: t.text == null ? null : t.text, usd: num(t.usd), requests: num(t.requests), agents: num(t.agents),
      share: turnTotal ? num(t.usd) / turnTotal : 0,
    }));

    const toolMap = {};
    for (const p of parts) for (const [k, v] of Object.entries(p.tools || {})) toolMap[k] = (toolMap[k] || 0) + num(v);
    const tools = Object.entries(toolMap).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || strCmp(a.name, b.name));

    const tok = { in: 0, cw5: 0, cw1h: 0, cr: 0, out: 0 };
    for (const p of participants) for (const k of TOK_KEYS) tok[k] += p.tok[k];
    const input = tok.in + tok.cw5 + tok.cw1h + tok.cr;
    const cache = { cache_share: input ? tok.cr / input : null, cw5: tok.cw5, cw1h: tok.cw1h, cr: tok.cr, in: tok.in, out: tok.out, tokens: input + tok.out };

    return {
      span: { start: Number.isFinite(t0) ? new Date(t0).toISOString() : null, end: Number.isFinite(t1) ? new Date(t1).toISOString() : null, minutes: spanMs / 60000 },
      lanes,
      participants,
      turns,
      tools,
      cache,
      totals: { usd: num(s.usd) || totalUsd, requests: participants.reduce((a, p) => a + p.requests, 0), turns: turns.length, agents: participants.filter((p) => p.kind === 'agent').length },
    };
  }

  // ---- calibration ---------------------------------------------------------------------------------
  function median(xs) {
    if (!xs.length) return null;
    const a = [...xs].sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  // points: calibrate.js points ({from,to,gain,usd,rate,kept,reason,pending,waiting,kind?}).
  // machines: [{pc, synced_until, last_seen?}].
  function calibrationView(points, machines, now) {
    const pts = points || [];
    const nowMs = now == null ? Date.now() : (typeof now === 'number' ? now : ms(now));
    const newest = pts.reduce((a, p) => (ms(p.to) > a ? ms(p.to) : a), -Infinity);
    const rows = [...pts]
      .sort((a, b) => ms(b.to) - ms(a.to))
      .map((p) => ({
        kind: p.kind || 'weekly',
        from: p.from, to: p.to, gain: p.gain, usd: p.usd, rate: p.rate,
        status: p.pending ? 'pending' : p.kept === false ? 'dropped' : 'kept',
        reason: p.reason || null,
        by_model: p.by_model || null,
      }));
    const machineRows = (machines || []).map((m) => {
      const synced = ms(m.synced_until);
      return {
        pc: m.pc,
        synced_until: m.synced_until || null,
        last_seen: m.last_seen || null,
        age_min: Number.isFinite(synced) && Number.isFinite(nowMs) ? Math.max(0, (nowMs - synced) / 60000) : null,
        waiting: Number.isFinite(newest) && !(synced >= newest),
      };
    });
    const medians = {};
    for (const kind of ['weekly', 'five_hour']) {
      medians[kind] = median(rows.filter((r) => r.kind === kind && r.status === 'kept').map((r) => r.rate));
    }
    return { rows, machines: machineRows, waiting: machineRows.filter((m) => m.waiting).map((m) => m.pc), medians, empty: rows.length === 0 };
  }

  return {
    flatten, filter, group, share, stats, weekly, dailyByModel, mainVsAgents, tokenKinds, topProjects,
    sessionsTable, toCSV, sessionPage, calibrationView,
    measures: MEASURES, value, family, isoWeek,
  };
});
