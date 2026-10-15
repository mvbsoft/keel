'use strict';
// Price table (USD per million tokens): bundled data/prices.json plus an optional machine override
// in ~/.claude/keel/prices.json. Pure helpers: lookup by longest model prefix, cost, sanity warnings, diff.
// A row may carry long_context: {over, mult}: a request whose prompt (input + cache tokens) is larger than `over`
// costs `mult` times the normal price (all token kinds).
// Never throws on a bad override: it is ignored and the bundled table is used.
const fs = require('node:fs');
const path = require('node:path');
const { usageDir } = require('./usage-config.js');
const { readJsonFile } = require('./json.js');

const BUNDLED = path.join(__dirname, '..', '..', 'data', 'prices.json');
const FIELDS = ['input', 'cache_write_5m', 'cache_write_1h', 'cache_read', 'output'];
// Expected ratios to the input price; deviations are warnings, not errors.
const RATIOS = { cache_read: 0.1, cache_write_5m: 1.25, cache_write_1h: 2 };

function readTable(file) {
  try {
    const t = readJsonFile(file);
    const ok = t && typeof t === 'object' && Array.isArray(t.models)
      && t.models.every((m) => m && typeof m === 'object' && typeof m.match === 'string' && m.match);
    return ok ? t : null;
  } catch {
    return null;
  }
}

function loadPrices({ overridePath = path.join(usageDir(), 'prices.json'), bundledPath = BUNDLED } = {}) {
  const bundled = readTable(bundledPath) || { models: [] };
  const override = readTable(overridePath);
  if (!override) return { models: bundled.models, source: 'bundled', about: bundled.about || null };
  const listed = new Set(override.models.map((m) => m.match));
  const models = [...override.models, ...bundled.models.filter((m) => !listed.has(m.match))];
  return { models, source: 'override', about: override.about || bundled.about || null };
}

// The entry with the longest `match` that is a prefix of the model id (a date or suffix may follow).
function priceFor(model, table) {
  if (typeof model !== 'string' || !table || !Array.isArray(table.models)) return null;
  let best = null;
  for (const p of table.models) {
    if (model.startsWith(p.match) && (!best || p.match.length > best.match.length)) best = p;
  }
  return best;
}

function longContext(p) {
  const lc = p.long_context;
  return lc && typeof lc === 'object' && Number.isFinite(lc.over) && lc.over >= 0 && Number.isFinite(lc.mult) && lc.mult > 0 ? lc : null;
}

function costOf(model, tok, table) {
  const p = priceFor(model, table);
  if (!p) return null;
  const t = tok || {};
  const lc = longContext(p);
  const mult = lc && (t.in || 0) + (t.cw5 || 0) + (t.cw1h || 0) + (t.cr || 0) > lc.over ? lc.mult : 1;
  return mult * ((t.in || 0) * p.input + (t.cw5 || 0) * p.cache_write_5m + (t.cw1h || 0) * p.cache_write_1h
    + (t.cr || 0) * p.cache_read + (t.out || 0) * p.output) / 1e6;
}

const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b), 1e-12);
const valid = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;

// Warnings only: a deliberate exception (e.g. a cheaper cache read) is allowed, but shown.
function validate(table) {
  const out = [];
  for (const p of (table && table.models) || []) {
    const bad = FIELDS.filter((f) => !valid(p[f]));
    for (const f of bad) out.push(`${p.match}: ${f} is ${p[f] === undefined ? 'missing' : `invalid (${p[f]})`}`);
    if (p.long_context !== undefined && !longContext(p)) out.push(`${p.match}: long_context needs numeric over >= 0 and mult > 0`);
    if (bad.includes('input')) continue;
    for (const [f, r] of Object.entries(RATIOS)) {
      if (valid(p[f]) && !close(p[f], r * p.input)) out.push(`${p.match}: ${f} ${p[f]} is not ${r} x input (${r * p.input})`);
    }
  }
  return out;
}

function diff(oldTable, newTable) {
  const byMatch = (t) => new Map(((t && t.models) || []).map((m) => [m.match, m]));
  const a = byMatch(oldTable);
  const b = byMatch(newTable);
  const out = [];
  for (const [match, n] of b) {
    const o = a.get(match);
    if (!o) { out.push({ match, field: 'added', old: null, new: n }); continue; }
    for (const f of FIELDS) if (o[f] !== n[f]) out.push({ match, field: f, old: o[f], new: n[f] });
    const lcText = (m) => (longContext(m) ? `over ${m.long_context.over} tokens x${m.long_context.mult}` : 'none');
    if (lcText(o) !== lcText(n)) out.push({ match, field: 'long_context', old: lcText(o), new: lcText(n) });
  }
  for (const [match, o] of a) if (!b.has(match)) out.push({ match, field: 'removed', old: o, new: null });
  return out;
}

module.exports = { loadPrices, priceFor, costOf, validate, diff, FIELDS };
