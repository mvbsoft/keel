'use strict';
// The feature page's language: its labels from locales/<code>.json (page.* keys, English where a
// catalog lacks them) and its texts as written in the md files, or translated when the page's
// language is not the tickets'. Claude translates; this module lists what needs it and keeps the
// translations, inside the page, by a hash of each original text, so an update translates only what
// changed.
const crypto = require('node:crypto');
const { catalog } = require('./i18n.js');

// "uk", "uk-UA", "pt_BR" -> the language part; a name such as "German" or anything else -> null.
function langCode(value) {
  const m = /^([a-z]{2,3})(?:[-_][a-z0-9]{2,8})?$/.exec(String(value || '').trim().toLowerCase());
  return m ? m[1] : null;
}

// The page.* labels in `code`, English for every key its catalog lacks; `own`: the catalog has them.
function labelsFor(code) {
  const en = catalog('en') || {};
  const mine = catalog(code) || {};
  const labels = {};
  for (const k of Object.keys(en).filter((x) => x.startsWith('page.'))) labels[k.slice(5)] = k in mine ? mine[k] : en[k];
  return { labels, own: Object.keys(mine).some((k) => k.startsWith('page.')) };
}

const hashOf = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);

// Every text of the page a translation replaces: [holder, field] pairs, the md files' words only
// (keys, file names, states and repository names stay).
function slots(page) {
  const out = [[page, 'heading']];
  const sections = (list) => { for (const s of list || []) out.push([s, 'text']); };
  if (page.overview) sections(page.overview.sections);
  for (const t of page.terms) out.push([t, 'term'], [t, 'text']);
  for (const t of page.tickets) { out.push([t, 'title']); sections(t.sections); }
  for (const r of page.research) { out.push([r, 'title']); sections(r.sections); }
  return out.filter(([o, f]) => typeof o[f] === 'string' && o[f].trim() !== '');
}

// The texts with no translation in `known` (hash -> text): [{ id, text }], each once.
function missing(page, known) {
  const seen = new Map();
  for (const [o, f] of slots(page)) {
    const id = hashOf(o[f]);
    if (!(id in known) && !seen.has(id)) seen.set(id, o[f]);
  }
  return [...seen].map(([id, text]) => ({ id, text }));
}

// Replaces every text by its translation; returns the translations the page used.
function translate(page, known) {
  const used = {};
  for (const [o, f] of slots(page)) {
    const id = hashOf(o[f]);
    if (typeof known[id] === 'string') { used[id] = known[id]; o[f] = known[id]; }
  }
  return used;
}

// What an earlier page says of itself: its language and translations.
function readPage(html) {
  const meta = (name) => (new RegExp(`<meta name="${name}" content="([^"]*)">`).exec(html) || [])[1] || null;
  let translations = { lang: null, items: {} };
  const m = /<script type="application\/json" id="feature-translations">([\s\S]*?)<\/script>/.exec(html);
  try {
    const t = m ? JSON.parse(m[1]) : null;
    if (t && typeof t.lang === 'string' && t.items && typeof t.items === 'object') translations = { lang: t.lang, items: t.items };
  } catch { /* an unreadable block: translate again */ }
  return { lang: langCode(meta('keel-feature-lang')), translations };
}

module.exports = { langCode, labelsFor, missing, translate, readPage };
