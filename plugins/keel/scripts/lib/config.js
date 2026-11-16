'use strict';
// Reads and validates .keel/config.json. Never throws: returns { state, errors, config }.
// state: 'missing' | 'broken' | 'outdated' | 'invalid' | 'ok'.
// 'outdated' = written for an older schema version: configure asks only the new questions.
const fs = require('node:fs');
const path = require('node:path');
const { validate } = require('./schema.js');
const { parseJson } = require('./json.js');

const SCHEMA = path.join(__dirname, '..', '..', 'schemas', 'config.schema.json');

function loadSchema() {
  return JSON.parse(fs.readFileSync(SCHEMA, 'utf8'));
}

function checkConfig(projectDir) {
  const file = path.join(require('./project-dir.js').configHome(projectDir), '.keel', 'config.json');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { state: 'missing', errors: ['no .keel/config.json'], config: null };
    return { state: 'broken', errors: [`cannot read .keel/config.json: ${e.code || e.message}`], config: null };
  }
  let config;
  try {
    config = parseJson(text);
  } catch (e) {
    return { state: 'broken', errors: [`.keel/config.json is not valid JSON: ${e.message}`], config: null };
  }
  const schema = loadSchema();
  const current = schema.properties.schema_version.const;
  if (config && Number.isInteger(config.schema_version) && config.schema_version < current) {
    return { state: 'outdated', errors: [`schema_version ${config.schema_version} is older than ${current}`], config };
  }
  const inUse = withoutLegacy(config);
  const errors = validate(inUse, schema);
  return { state: errors.length ? 'invalid' : 'ok', errors, config: inUse };
}

// keel 2.0.0's planning fields that keel no longer reads (tickets have no keys and one place now). A
// config that still has them stays valid: they are left out before the check and of the config keel
// works with; config-drift.js names them.
const LEGACY_PLANNING = ['ticket_prefix', 'tickets'];

const legacyFields = (config) => (config && config.planning && typeof config.planning === 'object'
  ? LEGACY_PLANNING.filter((k) => k in config.planning).map((k) => `planning.${k}`) : []);

function withoutLegacy(config) {
  if (!legacyFields(config).length) return config;
  const planning = Object.fromEntries(Object.entries(config.planning).filter(([k]) => !LEGACY_PLANNING.includes(k)));
  return { ...config, planning };
}

// The ticket prefixes keel knows: comments.ticket_prefixes, and keel 2.0.0's planning.ticket_prefix
// until configure moves it into that list. Takes the raw config (checkConfig's leaves the old field
// out), so a value of the wrong type is skipped.
function ticketPrefixes(config) {
  const listed = config && config.comments && config.comments.ticket_prefixes;
  const legacy = config && config.planning && config.planning.ticket_prefix;
  return [...new Set([...(Array.isArray(listed) ? listed : []), ...(typeof legacy === 'string' ? [legacy] : [])])];
}

module.exports = { checkConfig, loadSchema, ticketPrefixes, legacyFields };
