'use strict';
// Plan-limit snapshots: the percentages Claude Code reports for the 5-hour and weekly windows, appended to
// <usageDir>/limits.jsonl only when a percentage or a reset time changes. The last snapshot is kept in
// limits-last.json so the log is never re-read on the hot path (the status line calls this often).
// Never throws: a failing disk must not disturb the status line.
const fs = require('node:fs');
const path = require('node:path');
const { usageDir } = require('./usage-config.js');

const MAX_BYTES = 1024 * 1024;
const LOG = 'limits.jsonl';
const OLD_LOG = 'limits.1.jsonl';
const LAST = 'limits-last.json';

function num(v) { return typeof v === 'number' && Number.isFinite(v) ? v : null; }
function reset(v) { return typeof v === 'number' || typeof v === 'string' ? v : null; }

function changed(a, b) {
  return !a || a.five_hour !== b.five_hour || a.seven_day !== b.seven_day
    || a.five_hour_resets_at !== b.five_hour_resets_at || a.seven_day_resets_at !== b.seven_day_resets_at;
}

function readLast(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, LAST), 'utf8')); } catch { return null; }
}

// Appends the snapshot when it differs from the last one; returns it, or null when nothing was written.
function write(snap, dir) {
  try {
    if (snap.five_hour === null && snap.seven_day === null) return null;
    if (!changed(readLast(dir), snap)) return null;
    fs.mkdirSync(dir, { recursive: true });
    const log = path.join(dir, LOG);
    let size = 0;
    try { size = fs.statSync(log).size; } catch { /* no log yet */ }
    if (size > MAX_BYTES) {
      try { fs.rmSync(path.join(dir, OLD_LOG), { force: true }); } catch { /* the rename replaces it if it can */ }
      fs.renameSync(log, path.join(dir, OLD_LOG));
    }
    fs.appendFileSync(log, JSON.stringify(snap) + '\n');
    fs.writeFileSync(path.join(dir, LAST), JSON.stringify(snap));
    return snap;
  } catch { return null; }
}

// input: the JSON Claude Code passes to the status-line command (rate_limits exists on subscriptions only).
function recordSnapshot(input, { src, dir = usageDir(), now = new Date() } = {}) {
  const limits = input && typeof input === 'object' ? input.rate_limits : null;
  if (!limits || typeof limits !== 'object') return null;
  const five = limits.five_hour && typeof limits.five_hour === 'object' ? limits.five_hour : {};
  const seven = limits.seven_day && typeof limits.seven_day === 'object' ? limits.seven_day : {};
  const snap = {
    t: now.toISOString(),
    five_hour: num(five.used_percentage),
    five_hour_resets_at: reset(five.resets_at),
    seven_day: num(seven.used_percentage),
    seven_day_resets_at: reset(seven.resets_at),
  };
  if (limits.spend_limit && typeof limits.spend_limit === 'object') snap.spend_limit = limits.spend_limit;
  snap.session_id = typeof input.session_id === 'string' ? input.session_id : null;
  snap.cost_usd = input.cost && num(input.cost.total_cost_usd) !== null ? input.cost.total_cost_usd : null;
  snap.src = src || null;
  return write(snap, dir);
}

// Desktop fallback: percentages read from somewhere other than the status line.
function snapshotFromPercents(p, { dir = usageDir(), now = new Date() } = {}) {
  const v = p || {};
  const snap = {
    t: now.toISOString(),
    five_hour: num(v.five_hour),
    five_hour_resets_at: reset(v.five_hour_resets_at),
    seven_day: num(v.seven_day),
    seven_day_resets_at: reset(v.seven_day_resets_at),
    session_id: typeof v.session_id === 'string' ? v.session_id : null,
    cost_usd: null,
    src: 'desktop',
  };
  return write(snap, dir);
}

// Snapshots from limits.1.jsonl then limits.jsonl (oldest first); bad lines are skipped.
function readSnapshots(dir = usageDir(), { sinceMs } = {}) {
  const out = [];
  for (const name of [OLD_LOG, LOG]) {
    let text;
    try { text = fs.readFileSync(path.join(dir, name), 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let s;
      try { s = JSON.parse(line); } catch { continue; }
      if (!s || typeof s !== 'object' || Array.isArray(s)) continue;
      if (sinceMs !== undefined && !(Date.parse(s.t) >= sinceMs)) continue;
      out.push(s);
    }
  }
  return out;
}

module.exports = { recordSnapshot, snapshotFromPercents, readSnapshots };
