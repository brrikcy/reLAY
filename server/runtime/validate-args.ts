import type { Tool } from '../types.ts';

function validateType(value: unknown, type: unknown, path: string): void {
  const valid = (expected: string): boolean => {
    if (expected === 'string') return typeof value === 'string';
    if (expected === 'number') return typeof value === 'number' && Number.isFinite(value);
    if (expected === 'integer') return typeof value === 'number' && Number.isInteger(value);
    if (expected === 'boolean') return typeof value === 'boolean';
    if (expected === 'object') return typeof value === 'object' && value !== null && !Array.isArray(value);
    if (expected === 'array') return Array.isArray(value);
    if (expected === 'null') return value === null;
    return true;
  };
  const types = Array.isArray(type) ? type : [type];
  if (type !== undefined && !types.some((candidate) => valid(String(candidate)))) throw new Error(`${path} must be ${types.join(' or ')}.`);
}

function validateValue(value: unknown, schema: unknown, path: string, depth: number): void {
  if (depth > 8 || !schema || typeof schema !== 'object' || Array.isArray(schema)) return;
  const definition = schema as Record<string, unknown>;
  validateType(value, definition.type, path);
  if (definition.enum && Array.isArray(definition.enum) && !definition.enum.some((candidate) => JSON.stringify(candidate) === JSON.stringify(value))) throw new Error(`${path} must be one of the allowed values.`);
  if (typeof value === 'string') {
    if (typeof definition.minLength === 'number' && value.length < definition.minLength) throw new Error(`${path} is too short.`);
    if (typeof definition.maxLength === 'number' && value.length > definition.maxLength) throw new Error(`${path} is too long.`);
    if (value.length > 100_000) throw new Error(`${path} exceeds the maximum argument length.`);
  }
  if (typeof value === 'number') {
    if (typeof definition.minimum === 'number' && value < definition.minimum) throw new Error(`${path} is below its minimum.`);
    if (typeof definition.maximum === 'number' && value > definition.maximum) throw new Error(`${path} exceeds its maximum.`);
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    if (definition.required && Array.isArray(definition.required)) for (const key of definition.required) if (typeof key === 'string' && object[key] === undefined) throw new Error(`Missing required argument: ${path}.${key}`);
    const properties = definition.properties && typeof definition.properties === 'object' && !Array.isArray(definition.properties) ? definition.properties as Record<string, unknown> : {};
    for (const [key, nested] of Object.entries(object)) {
      if (properties[key] !== undefined) validateValue(nested, properties[key], `${path}.${key}`, depth + 1);
      else if (definition.additionalProperties === false) throw new Error(`Unexpected argument: ${path}.${key}`);
      else if (definition.additionalProperties && typeof definition.additionalProperties === 'object') validateValue(nested, definition.additionalProperties, `${path}.${key}`, depth + 1);
    }
  }
  if (Array.isArray(value)) {
    if (typeof definition.maxItems === 'number' && value.length > definition.maxItems) throw new Error(`${path} has too many items.`);
    if (value.length > 1000) throw new Error(`${path} exceeds the maximum array size.`);
    if (definition.items) value.forEach((item, index) => validateValue(item, definition.items, `${path}[${index}]`, depth + 1));
  }
}

export function validateToolArguments(tool: Tool, args: Record<string, unknown>): Record<string, unknown> {
  if (JSON.stringify(args).length > 100_000) throw new Error('Tool arguments exceed the 100 KB limit.');
  validateValue(args, tool.parameters, 'arguments', 0);
  return args;
}
