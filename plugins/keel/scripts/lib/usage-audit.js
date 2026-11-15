'use strict';
// Checks that the page tells the truth about this machine: the dollars and tokens of each of its sessions on the
// page (its day documents, summed by the dashboard's own pivot.js) against the same sessions
// rebuilt from the local transcripts. A session that went on after the page's copy was synced is not compared.
const store = require('./usage-store.js');
const { flatten } = require('../../templates/usage/pivot.js');

// Half a cent: a smaller gap is rounding of the six-decimal dollars, not a difference.
const CENT = 0.005;

// Per session id: {date, usd, tokens, end, cost_cc, synced_until, truncated, participants}, summed over
// the rows flatten makes. flatten keeps one copy of each session, so participants counts that copy's.
function perSession(docs) {
  const synced = new Map();
  for (const d of docs) for (const s of d.sessions || []) synced.set(s.id, later(synced.get(s.id), d.synced_until));
  const { sessions, rows } = flatten(docs);
  const out = new Map(sessions.map((s) => [s.id, { date: s.date, usd: 0, tokens: 0, end: s.end, cost_cc: s.cost_cc, synced_until: synced.get(s.id), truncated: s.truncated === true, participants: (s.participants || []).length }]));
  for (const r of rows) {
    const e = out.get(r.session_id);
    if (e) { e.usd += r.usd; e.tokens += r.tokens; }
  }
  return out;
}

const { later } = store;

function pageDocs(files, pc, unwrap) {
  const docs = [];
  for (const value of files) {
    // unwrap also returns machine documents, marked kind_: 'machine'; only day documents count.
    for (const d of unwrap(value)) if (d.kind_ !== 'machine' && d.pc === pc) docs.push(d);
  }
  return docs;
}

function audit({ pageFiles, machine, usageDir, projectsRoot, clearedAt, unwrap, nowMs = Date.now() }) {
  const pc = store.sanitizePc(machine.pc);
  const page = perSession(pageDocs(pageFiles.map((f) => store.readJson(f)), pc, unwrap));
  const dates = [...page.values()].map((s) => s.date).sort();
  if (!dates.length) return { compared: 0, days: 0, diffs: [], page: 0 };
  const fromMs = clearedAt ? Date.parse(clearedAt) : undefined;
  // No size limit here: a session the page had to shorten is compared with all of it, so its undercount shows.
  const built = store.buildDays({ projectsRoot, machine, usageDir, sinceMs: Date.parse(`${dates[0]}T00:00:00Z`), nowMs, fromMs, maxDocBytes: Infinity });
  const local = perSession(built.docs.map((d) => d.doc));
  const lastSync = [...page.values()].reduce((a, s) => later(a, s.synced_until), null);
  const diffs = [];
  let compared = 0;
  let ours = 0;
  let cc = 0;
  const days = new Set();
  for (const [id, p] of page) {
    const l = local.get(id);
    if (!l) { diffs.push({ id, date: p.date, kind: 'only_page', page: p.usd }); continue; }
    if (l.end && p.synced_until && Date.parse(l.end) > Date.parse(p.synced_until)) continue;
    compared++;
    days.add(p.date);
    // Shortened only when the page dropped agents: a copy that lost just its turn texts still holds every dollar.
    if (Math.abs(p.usd - l.usd) >= CENT || p.tokens !== l.tokens) diffs.push({ id, date: p.date, kind: 'differs', page: p.usd, local: l.usd, page_tokens: p.tokens, local_tokens: l.tokens, shortened: p.truncated && p.participants < l.participants });
    if (typeof l.cost_cc === 'number') { ours += l.usd; cc += l.cost_cc; }
  }
  // Not compared: sessions before the page's first day, and those that ended after its last sync (not sent yet).
  for (const [id, l] of local) {
    if (page.has(id) || l.date < dates[0] || !lastSync || !l.end || Date.parse(l.end) > Date.parse(lastSync)) continue;
    diffs.push({ id, date: l.date, kind: 'only_local', local: l.usd });
  }
  diffs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
  return { compared, days: days.size, diffs, page: page.size, cc: cc > 0 ? { ours, cc } : null };
}

const usd = (n) => `$${n.toFixed(2)}`;

function auditText(opts) {
  const r = audit(opts);
  if (!r.page) return 'audit: no session of this machine in the saved page documents';
  const out = [`audit: ${r.compared} sessions on ${r.days} days compared; differences: ${r.diffs.length}`];
  for (const d of r.diffs) {
    if (d.kind === 'only_page') out.push(`  ${d.date} ${d.id}: only on the page (${usd(d.page)})`);
    else if (d.kind === 'only_local') out.push(`  ${d.date} ${d.id}: only in the local transcripts (${usd(d.local)})`);
    else out.push(`  ${d.date} ${d.id}: page ${usd(d.page)} / ${d.page_tokens} tokens, local ${usd(d.local)} / ${d.local_tokens} tokens${d.shortened ? '; shortened on the page (too big for one document)' : ''}`);
  }
  if (r.cc) out.push(`Claude Code's own cost of the compared sessions: ${usd(r.cc.cc)}, keel's: ${usd(r.cc.ours)} (${usd(r.cc.ours - r.cc.cc)})`);
  return out.join('\n');
}

module.exports = { audit, auditText };
