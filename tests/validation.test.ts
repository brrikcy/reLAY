import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSafeUrl, redactSecrets } from '../server/lib/validation.ts';
import { toolInput } from '../server/schemas.ts';

test('blocks local, embedded-credential, and non-HTTP API targets by default', async () => {
  await assert.rejects(() => assertSafeUrl('http://127.0.0.1:9999/private'), /Private|reserved/);
  await assert.rejects(() => assertSafeUrl('http://169.254.169.254/latest'), /Private|reserved/);
  await assert.rejects(() => assertSafeUrl('https://user:pass@example.com/api'), /Credentials/);
  await assert.rejects(() => assertSafeUrl('file:///etc/passwd'), /HTTP/);
});
test('allows explicitly configured private development targets', async () => {
  assert.equal((await assertSafeUrl('http://127.0.0.1:9999/test', true)).hostname, '127.0.0.1');
});
test('redacts secret values from logs or responses', () => {
  assert.equal(redactSecrets('Bearer top-secret-value', ['top-secret-value']), 'Bearer [REDACTED]');
  assert.equal(redactSecrets('short values stay unchanged', ['abc']), 'short values stay unchanged');
});
test('validates tool schemas and permission policies', () => {
  const valid = toolInput.safeParse({ name: 'get_weather', description: 'Get weather', method: 'GET', url: 'https://example.com/weather', parameters: { type: 'object', properties: {} }, permission: 'approval', enabled: true, timeoutMs: 15000 });
  assert.equal(valid.success, true);
  const invalid = toolInput.safeParse({ name: 'bad name!', description: 'Bad', method: 'GET', url: 'file:///tmp/file', parameters: { type: 'array' }, permission: 'unlimited' });
  assert.equal(invalid.success, false);
});
