'use strict';
// Shared helpers for verification scripts: config and profile, secret check, the .keel/local folders.
const fs = require('node:fs');
const path = require('node:path');
const catalog = require('../../data/catalog.json');
const { checkConfig } = require('./config.js');
const { matchesAny } = require('./patterns.js');
const { safeLocalWrite } = require('./safe-path.js');
const { readJsonFile } = require('./json.js');

function loadProject(root) {
  const { state, errors, config } = checkConfig(root);
  if (state !== 'ok') throw new Error(`keel is not configured here (config ${state}${errors.length ? `: ${errors[0]}` : ''}); run /keel:configure`);
  const { profile, isSecret } = secretCheck(root);
  return { config, profile, isSecret };
}

// The secret test without requiring a config: catalog patterns plus the profile's secret_paths.
function secretCheck(root) {
  let profile = null;
  try { profile = readJsonFile(path.join(root, '.keel', 'profile.json')); } catch { /* optional */ }
  const extra = new Set(profile && Array.isArray(profile.secret_paths) ? profile.secret_paths : []);
  const isSecret = (rel) => extra.has(rel) || (matchesAny(rel, catalog.secrets.patterns) && !matchesAny(rel, catalog.secrets.allowed));
  return { profile, isSecret };
}

const localDir = (root, ...parts) => path.join(root, '.keel', 'local', ...parts);

// Refuses a link anywhere on the way (lib/safe-path.js).
const writeLocal = (root, rel, text) => safeLocalWrite(root, rel.split('/'), text);

function readJson(file) {
  try { return readJsonFile(file); } catch { return null; }
}

// "--name value" options and positional arguments.
function parseArgs(argv) {
  const opts = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) opts[key] = argv[++i];
      else opts[key] = true;
    } else pos.push(a);
  }
  return { opts, pos };
}

module.exports = { loadProject, secretCheck, localDir, writeLocal, readJson, parseArgs };
