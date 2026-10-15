'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validate, checkSchema } = require('../plugins/keel/scripts/lib/schema.js');

test('checkSchema rejects unsupported keywords so schemas cannot rely on them silently', () => {
  assert.match(checkSchema({ type: 'object', oneOf: [] }).join(), /unsupported keyword "oneOf"/);
  assert.match(checkSchema({ type: 'strin' }).join(), /unknown type "strin"/);
  assert.match(checkSchema({ $ref: '#/$defs/missing' }).join(), /unresolved \$ref/);
  assert.match(checkSchema({ type: 'object', required: ['a'], properties: {} }).join(), /required "a" is not in properties/);
  assert.match(checkSchema({ type: 'string', pattern: '(' }).join(), /invalid pattern/);
});

test('types: integer is a number, but a number is not an integer', () => {
  assert.deepEqual(validate(3, { type: 'number' }), []);
  assert.match(validate(3.5, { type: 'integer' }).join(), /expected integer, got number/);
  assert.deepEqual(validate(null, { type: ['string', 'null'] }), []);
  assert.match(validate([], { type: 'object' }).join(), /got array/);
});

test('objects: required, additionalProperties false and schema', () => {
  const s = { type: 'object', required: ['a'], properties: { a: { type: 'string' } }, additionalProperties: false };
  assert.match(validate({}, s).join(), /missing "a"/);
  assert.match(validate({ a: 'x', b: 1 }, s).join(), /\$\.b: unexpected property/);
  const m = { type: 'object', additionalProperties: { type: 'integer' } };
  assert.match(validate({ k: 'v' }, m).join(), /\$\.k: expected integer/);
});

test('arrays: items, bounds and uniqueness report the failing index', () => {
  const s = { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 2, uniqueItems: true };
  assert.match(validate([1], s).join(), /\$\[0\]: expected string/);
  assert.match(validate([], s).join(), /fewer than 1/);
  assert.match(validate(['a', 'b', 'c'], s).join(), /more than 2/);
  assert.match(validate(['a', 'a'], s).join(), /must be unique/);
});

test('enum and const compare by value, including null', () => {
  assert.deepEqual(validate(null, { enum: ['a', null] }), []);
  assert.match(validate('b', { enum: ['a', null] }).join(), /must be one of/);
  assert.match(validate(2, { const: 1 }).join(), /must equal 1/);
});

test('$ref resolves into $defs', () => {
  const s = { type: 'object', properties: { p: { $ref: '#/$defs/pos' } }, $defs: { pos: { type: 'integer', minimum: 1 } } };
  assert.match(validate({ p: 0 }, s).join(), /\$\.p: below 1/);
  assert.deepEqual(validate({ p: 1 }, s), []);
});
