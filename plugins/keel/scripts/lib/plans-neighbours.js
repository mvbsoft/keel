'use strict';
// depends_on keys of other repositories: a key whose prefix is not this project's is another
// repository's ticket. Its state is read in that repository's folder on this machine (the repos map of
// lib/plans-settings.js) with the code that reads this project's tickets (lib/plans-state.js): git and
// the files there, never a fetch, so the state is as of that repository's last fetch. No folder for the
// prefix in the map, a folder that is not on this machine or not a git repository: not checked, a note
// and never a problem.
const fs = require('node:fs');
const { settings, PREFIX } = require('./plans-settings.js');
const { stateIn, keysHere, metBy, KEY, prefixOf } = require('./plans-state.js');
const { clean } = require('./repo-read.js');

const NOT_CHECKED = 'not checked';

const isFolder = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

// Whether a key (upper case) is another repository's: a prefix the repos map can take that is neither
// the planning prefix nor that of a ticket here (`here`: this project's ticket keys). A longer prefix
// is no keel repository's, so its key stays this project's and is looked up here.
function foreignTest(root, here) {
  const own = new Set([settings(root).ticket_prefix, ...here.map(prefixOf)]);
  return (k) => KEY.test(k) && PREFIX.test(prefixOf(k)) && !own.has(prefixOf(k));
}

// key -> { state (a ticket state, not found, or not checked), shown, feature, folder, data, why } for
// other repositories' keys, one read per repository.
function neighbourStates(root, keys, now = new Date()) {
  const repos = settings(root).repos;
  const byPrefix = new Map();
  for (const k of new Set(keys.map((x) => x.toUpperCase()))) byPrefix.set(prefixOf(k), [...(byPrefix.get(prefixOf(k)) || []), k]);
  const out = new Map();
  for (const [prefix, list] of byPrefix) {
    const folder = repos[prefix];
    let why = !folder ? `no folder for ${prefix} in the repos map: plans.js settings set --repo ${prefix}=<folder>`
      : !isFolder(folder) ? `${folder} is not on this machine` : null;
    const read = why ? null : stateIn(folder, list, now);
    if (read && !read.inRepo) why = `${folder} is not a git repository`;
    if (why) { for (const k of list) out.set(k, { state: NOT_CHECKED, why: clean(why, 200) }); continue; }
    for (const [k, s] of read.keys) out.set(k, { ...s, folder: clean(folder, 200), data: read.data });
  }
  return out;
}

// Whether another repository's dependency lets a ticket of `feature` start: as a dependency here
// (lib/plans-state.js metBy); not checked does not hold it back.
const met = (s, feature) => s.state === NOT_CHECKED || metBy(s.state, s.feature, feature);

// "API-121 done (/path/to/api, server data from <date>)", or "API-121 not checked (<why>)".
const stateText = (k, s) => `${clean(s.shown || k, 40)} ${s.state} (${s.why || `${s.folder}, ${s.data}`})`;

// The output line for a dependency that could not be checked.
const noteLine = (id, k, why) => `note: ${clean(id, 40)} depends on ${clean(k, 40)}: not checked (${why})`;

// The dependencies among `deps` (as written) that are other repositories' keys: `missing` (key -> the
// problem text's ending: it is not in that repository) and `notes` (key -> why not checked). Another
// repository's key is missing only when that repository lacks it; not checked is never missing.
// `foreign(dep)` tells such a dependency. This project's keys are read only when a dependency's prefix
// is not the planning one.
function lookUp(root, deps) {
  const upper = [...new Set(deps.map((x) => String(x).toUpperCase()))].filter((k) => KEY.test(k) && prefixOf(k) !== settings(root).ticket_prefix);
  const isForeign = upper.length ? foreignTest(root, keysHere(root)) : () => false;
  const list = upper.filter(isForeign);
  const states = list.length ? neighbourStates(root, list) : new Map();
  const missing = new Map();
  const notes = new Map();
  for (const [k, s] of states) {
    if (s.state === 'not found') missing.set(k, `in ${s.folder} (${s.data})`);
    else if (s.state === NOT_CHECKED) notes.set(k, s.why);
  }
  return { foreign: (dep) => states.has(String(dep).toUpperCase()), missing, notes };
}

module.exports = { NOT_CHECKED, foreignTest, neighbourStates, met, stateText, noteLine, lookUp };
