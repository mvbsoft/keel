'use strict';
// Calibration: how many dollars (list-price equivalent) one percent of the subscription plan limit costs.
// A "point" is a window between two limit snapshots of one reset period, with the spend inside it
// divided by the percent gained. Pure functions, no file IO.
const HOUR = 3600000;
const DORMANT_MS = 14 * 24 * HOUR;
const MIN_GAIN = { weekly: 1.0, five_hour: 5.0 };
const FIELD = { weekly: ['seven_day', 'seven_day_resets_at'], five_hour: ['five_hour', 'five_hour_resets_at'] };
const ms = (t) => Date.parse(t);
const round1 = (n) => Math.round(n * 10) / 10;
// Reset times arrive as epoch seconds (status line) or ISO with milliseconds (desktop app):
// group by the minute so both sources land in one reset period.
function periodKey(v) {
  const t = typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : ms(v);
  return Number.isFinite(t) ? new Date(Math.round(t / 60000) * 60000).toISOString() : null;
}

// Subscription spend in (t0, t1]: this machine's requests by time, other machines' hours prorated.
function spendBetween(t0, t1, { localPc, localRequests = [], remoteHours = [] } = {}) {
  const a = ms(t0);
  const b = ms(t1);
  let usd = 0;
  const by_model = {};
  const add = (model, v) => { usd += v; by_model[model] = (by_model[model] || 0) + v; };
  for (const r of localRequests) {
    const t = ms(r.t);
    if (r.wallet === 'subscription' && t > a && t <= b) add(r.model, r.usd);
  }
  for (const h of remoteHours) {
    if (h.wallet !== 'subscription' || h.pc === localPc) continue;
    const s = ms(h.h);
    const overlap = Math.min(b, s + HOUR) - Math.max(a, s);
    if (!(overlap > 0)) continue;
    const f = overlap / HOUR;
    const models = h.by_model && Object.keys(h.by_model).length ? h.by_model : { unknown: h.usd };
    for (const [m, v] of Object.entries(models)) add(m, v * f);
  }
  return { usd, by_model };
}

// A machine not seen for 14 days before the point will not sync any more: it must not block calibration forever.
// Without any date it counts as waiting.
function dormant(m, t) {
  const seen = ms(m.last_seen || m.synced_until);
  return Number.isFinite(seen) && seen < ms(t) - DORMANT_MS;
}

function findPoints({ snapshots = [], machines = [], localPc, localRequests = [], remoteHours = [], kind }) {
  const [vf, rf] = FIELD[kind];
  const minGain = MIN_GAIN[kind];
  // Snapshots without a value or reset time cannot be placed in a reset period.
  const groups = new Map();
  for (const s of [...snapshots].sort((x, y) => ms(x.t) - ms(y.t))) {
    const key = typeof s[vf] === 'number' && s[rf] ? periodKey(s[rf]) : null;
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  const points = [];
  for (const [resets_at, list] of groups) {
    let A = list[0];
    for (let i = 1; i < list.length; i++) {
      const B = list[i];
      if (B[vf] - A[vf] < minGain - 1e-9) continue;
      const waiting = machines.filter((m) => (!m.synced_until || ms(m.synced_until) < ms(B.t)) && !dormant(m, B.t)).map((m) => m.pc);
      const { usd, by_model } = spendBetween(A.t, B.t, { localPc, localRequests, remoteHours });
      const gain = round1(B[vf] - A[vf]);
      const p = { from: A.t, to: B.t, gain, usd, rate: usd / gain, by_model, resets_at, pending: waiting.length > 0, waiting, kept: true };
      if (usd === 0) { p.kept = false; p.reason = 'no_spend'; }
      points.push(p);
      A = B;
    }
  }
  return points.sort((x, y) => ms(x.to) - ms(y.to));
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Rate = median over the last `last` complete points with spend, after dropping low outliers:
// spend on devices without logs raises the percent without local dollars.
function rateFrom(points, { last = 20, dropBelow = 0.30 } = {}) {
  const out = points.map((p) => (p.pending ? { ...p, kept: false, reason: 'pending' } : { ...p }));
  const usable = out.filter((p) => !p.pending && p.usd > 0 && p.kept !== false)
    .sort((a, b) => ms(a.to) - ms(b.to));
  const recent = usable.slice(-last);
  for (const p of usable) if (!recent.includes(p)) { p.kept = false; p.reason = 'older'; }
  if (!recent.length) return { rate: null, n: 0, points: out };
  const M = median(recent.map((p) => p.rate));
  for (const p of recent) if (p.rate < (1 - dropBelow) * M) { p.kept = false; p.reason = 'other_device'; }
  const kept = recent.filter((p) => p.kept !== false);
  return { rate: kept.length ? median(kept.map((p) => p.rate)) : null, n: kept.length, points: out };
}

function calibrate(input) {
  const weekly = rateFrom(findPoints({ ...input, kind: 'weekly' }));
  const five_hour = rateFrom(findPoints({ ...input, kind: 'five_hour' }));
  const waiting = [...new Set([...weekly.points, ...five_hour.points].filter((p) => p.pending).flatMap((p) => p.waiting))];
  return { weekly, five_hour, waiting };
}

const share = (usd, rate) => (rate === null || rate === undefined || !(rate > 0) ? null : usd / rate);

function forecast({ current, usdLast48h, rate, hoursToReset }) {
  if (share(1, rate) === null || current === null || current === undefined) return null;
  return round1(current + (usdLast48h / 48 / rate) * hoursToReset);
}

module.exports = { periodKey, spendBetween, findPoints, rateFrom, calibrate, share, forecast };
