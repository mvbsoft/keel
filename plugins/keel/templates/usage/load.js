'use strict';
// keel usage dashboard: reading the page's data sources. window.KeelLoad() gives loadFromDb (the page
// database), fetchJson (the page files, for pivot.js loadPageData) and sleep.
window.KeelLoad = function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function retry(fn) {
    try { return await fn(); } catch (e) {
      if (e && e.code === 'unavailable') { await sleep(400 + Math.random() * 600); return fn(); }
      throw e;
    }
  }
  async function queryDays(db, from, to) {
    const out = new Map();
    let cursor = from;
    for (let guard = 0; guard < 40; guard++) {
      const snap = await retry(() => db.collection('days').where('date', '>=', cursor).where('date', '<=', to).orderBy('date').limit(1000).get());
      let added = 0; let last = cursor;
      for (const d of snap.docs) {
        const body = d.data();
        if (!body) continue;
        if (!out.has(d.id)) { out.set(d.id, body); added++; }
        if (body.date > last) last = body.date;
      }
      if (snap.size < 1000 || added === 0 || last === cursor) break;
      cursor = last; // next page starts at the last date seen; duplicates are skipped by doc id
    }
    return [...out.values()];
  }
  // The database: the days the built-in tool set wrote (and older ones), the machines, the calibrations and the settings.
  async function loadFromDb(db, from, to) {
    const [docs, mach, cal, st] = await Promise.all([
      queryDays(db, from, to),
      retry(() => db.collection('machines').get()).catch(() => null),
      retry(() => db.collection('calib').get()).catch(() => null),
      retry(() => db.doc('meta/settings').get()).catch(() => null),
    ]);
    return {
      docs,
      machines: mach ? mach.docs.map((d) => Object.assign({ name: d.id }, d.data())) : [],
      calibs: cal ? cal.docs.map((d) => Object.assign({ pc: d.id }, d.data())) : [],
      settings: st && st.exists ? (st.data() || {}) : {},
    };
  }
  async function fetchJson(path) {
    const r = await fetch(path, { cache: 'no-store' });
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  }

  return { loadFromDb, fetchJson, sleep };
};
