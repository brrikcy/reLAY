import test from 'node:test';
import assert from 'node:assert/strict';
import { validateToolArguments } from '../server/runtime/validate-args.ts';
import type { Tool } from '../server/types.ts';

const tool = { parameters: { type: 'object', properties: { city: { type: 'string', minLength: 2 }, units: { type: 'string', enum: ['metric', 'imperial'] }, days: { type: 'integer', minimum: 1, maximum: 7 }, filters: { type: 'object', properties: { active: { type: 'boolean' } }, additionalProperties: false } }, required: ['city'], additionalProperties: false } } as unknown as Tool;

test('accepts arguments matching the tool JSON schema', () => {
  assert.deepEqual(validateToolArguments(tool, { city: 'London', units: 'metric', days: 3, filters: { active: true } }), { city: 'London', units: 'metric', days: 3, filters: { active: true } });
});
test('rejects missing, mistyped, unknown, and out-of-range arguments', () => {
  assert.throws(() => validateToolArguments(tool, {}), /Missing required argument/);
  assert.throws(() => validateToolArguments(tool, { city: 'London', days: 0 }), /minimum/);
  assert.throws(() => validateToolArguments(tool, { city: 'London', units: 'kelvin' }), /allowed values/);
  assert.throws(() => validateToolArguments(tool, { city: 'London', surprise: true }), /Unexpected argument/);
  assert.throws(() => validateToolArguments(tool, { city: 'London', filters: { admin: true } }), /Unexpected argument/);
});
test('rejects oversized argument payloads', () => {
  const loose = { parameters: { type: 'object', properties: { value: { type: 'string' } } } } as unknown as Tool;
  assert.throws(() => validateToolArguments(loose, { value: 'x'.repeat(100_001) }), /100 KB limit|maximum argument length/);
});
