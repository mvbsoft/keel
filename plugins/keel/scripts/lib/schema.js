'use strict';
// Minimal JSON Schema validator for keel's own schemas. No dependencies.
// Supports only the keywords listed in KNOWN; a schema using anything else is
// rejected by checkSchema(), so a schema can never silently rely on an
// unsupported keyword.

const KNOWN = new Set([
  '$schema', '$id', '$defs', '$ref', '$comment', 'title', 'description', 'default', 'examples',
  'type', 'enum', 'const', 'properties', 'required', 'additionalProperties', 'items',
  'minItems', 'maxItems', 'uniqueItems', 'minLength', 'maxLength', 'pattern',
  'minimum', 'maximum', 'propertyNames',
]);
const TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null']);

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function matchesType(v, t) {
  const actual = typeOf(v);
  return actual === t || (t === 'number' && actual === 'integer');
}

function resolveRef(root, ref) {
  if (!ref.startsWith('#/$defs/')) throw new Error(`unsupported $ref: ${ref}`);
  const target = root.$defs && root.$defs[ref.slice('#/$defs/'.length)];
  if (!target) throw new Error(`unresolved $ref: ${ref}`);
  return target;
}

// Returns a list of problems in the schema itself (unknown keywords, bad types, broken refs).
function checkSchema(schema, root = schema, at = '#') {
  const problems = [];
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
    return [`${at}: schema must be an object`];
  }
  for (const key of Object.keys(schema)) {
    if (!KNOWN.has(key)) problems.push(`${at}: unsupported keyword "${key}"`);
  }
  const types = schema.type === undefined ? [] : [].concat(schema.type);
  for (const t of types) if (!TYPES.has(t)) problems.push(`${at}: unknown type "${t}"`);
  if (schema.$ref) {
    try { resolveRef(root, schema.$ref); } catch (e) { problems.push(`${at}: ${e.message}`); }
  }
  if (schema.pattern !== undefined) {
    try { new RegExp(schema.pattern, 'u'); } catch { problems.push(`${at}: invalid pattern`); }
  }
  const sub = (s, p) => problems.push(...checkSchema(s, root, p));
  for (const [k, s] of Object.entries(schema.properties || {})) sub(s, `${at}/properties/${k}`);
  for (const [k, s] of Object.entries(schema.$defs || {})) sub(s, `${at}/$defs/${k}`);
  if (typeof schema.additionalProperties === 'object') sub(schema.additionalProperties, `${at}/additionalProperties`);
  if (schema.items) sub(schema.items, `${at}/items`);
  if (schema.propertyNames) sub(schema.propertyNames, `${at}/propertyNames`);
  for (const r of schema.required || []) {
    if (schema.properties && !Object.hasOwn(schema.properties, r)) problems.push(`${at}: required "${r}" is not in properties`);
  }
  return problems;
}

// Returns a list of errors; an empty list means the value is valid.
function validate(value, schema, root = schema, at = '$') {
  if (schema.$ref) return validate(value, resolveRef(root, schema.$ref), root, at);
  const errors = [];
  const types = schema.type === undefined ? null : [].concat(schema.type);
  if (types && !types.some((t) => matchesType(value, t))) {
    return [`${at}: expected ${types.join(' or ')}, got ${typeOf(value)}`];
  }
  if (schema.const !== undefined && JSON.stringify(value) !== JSON.stringify(schema.const)) {
    errors.push(`${at}: must equal ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
    errors.push(`${at}: must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${at}: shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${at}: longer than ${schema.maxLength}`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) errors.push(`${at}: does not match ${schema.pattern}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${at}: below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${at}: above ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${at}: fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${at}: more than ${schema.maxItems} items`);
    if (schema.uniqueItems && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) errors.push(`${at}: items must be unique`);
    if (schema.items) value.forEach((v, i) => errors.push(...validate(v, schema.items, root, `${at}[${i}]`)));
  }
  if (typeOf(value) === 'object') {
    for (const r of schema.required || []) if (!Object.hasOwn(value, r)) errors.push(`${at}: missing "${r}"`);
    const props = schema.properties || {};
    for (const [k, v] of Object.entries(value)) {
      const p = `${at}.${k}`;
      if (schema.propertyNames) errors.push(...validate(k, schema.propertyNames, root, `${p} (name)`));
      if (Object.hasOwn(props, k)) errors.push(...validate(v, props[k], root, p));
      else if (schema.additionalProperties === false) errors.push(`${p}: unexpected property`);
      else if (typeof schema.additionalProperties === 'object') errors.push(...validate(v, schema.additionalProperties, root, p));
    }
  }
  return errors;
}

// Removes, in place, the properties a schema does not allow (additionalProperties: false) and returns
// their paths, so a caller can keep a report whose only fault is an extra field.
function prune(value, schema, root = schema, at = '$') {
  if (schema.$ref) return prune(value, resolveRef(root, schema.$ref), root, at);
  const removed = [];
  if (Array.isArray(value) && schema.items) {
    value.forEach((v, i) => removed.push(...prune(v, schema.items, root, `${at}[${i}]`)));
  } else if (typeOf(value) === 'object' && schema.properties) {
    const required = new Set(schema.required || []);
    for (const k of Object.keys(value)) {
      // An optional field sent empty ("reproduce": "") means "none": a Haiku reviewer did this and lost
      // every finding of its report.
      if (Object.hasOwn(schema.properties, k) && value[k] === '' && !required.has(k)) { delete value[k]; removed.push(`${at}.${k}`); }
      else if (Object.hasOwn(schema.properties, k)) removed.push(...prune(value[k], schema.properties[k], root, `${at}.${k}`));
      else if (schema.additionalProperties === false) { delete value[k]; removed.push(`${at}.${k}`); }
    }
  }
  return removed;
}

module.exports = { validate, checkSchema, prune };
