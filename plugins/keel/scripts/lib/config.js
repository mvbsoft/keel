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
  const file = path.join(projectDir, '.keel', 'config.json');
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
  const errors = validate(config, schema);
  return { state: errors.length ? 'invalid' : 'ok', errors, config };
}

module.exports = { checkConfig, loadSchema };
