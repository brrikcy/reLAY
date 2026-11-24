import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
async function json<T = any>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(`${response.status}: ${data.error ?? response.statusText}`);
  return data;
}
async function eventually<T>(callback: () => Promise<T>, predicate: (value: T) => boolean, timeout = 10_000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await callback(); if (predicate(value)) return value; await new Promise((resolve) => setTimeout(resolve, 50)); }
  throw new Error('Timed out waiting for state.');
}

test('A repeatedly failing tool cannot cause an unbounded model/tool loop', { timeout: 30_000, concurrency: false }, async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), 'relay-loop-'));
  let modelCalls = 0;
  let toolCalls = 0;
  const mock = createServer((request, response) => {
    if (request.url === '/v1/chat/completions') {
      modelCalls++;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      if (modelCalls <= 20) response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Trying the unavailable source.', tool_calls: [{ id: `call_${modelCalls}`, type: 'function', function: { name: 'broken_search', arguments: '{"query":"same"}' } }] } }] }));
      return;
    }
    toolCalls++;
    response.writeHead(503, { 'Content-Type': 'application/json' }); response.end('{"error":"unavailable"}');
  });
  await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve));
  const mockPort = (mock.address() as AddressInfo).port;
  const port = 20500 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, [resolve(root, 'node_modules/tsx/dist/cli.mjs'), 'server/index.ts'], { cwd: root, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', RELAY_DATA_FILE: join(temporary, 'test.db'), RELAY_ALLOW_PRIVATE_NETWORK: 'true' }, stdio: 'ignore' });
  context.after(async () => {
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill('SIGTERM');
    await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 5000))]);
    if (child.exitCode === null) child.kill('SIGKILL');
    await new Promise<void>((resolve) => mock.close(() => resolve()));
    await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const base = `http://127.0.0.1:${port}`;
  await eventually(() => json(`${base}/api/health`).catch(() => ({ ok: false })), (health) => health.ok);
  const provider = await json<any>(`${base}/api/providers`, { method: 'POST', body: JSON.stringify({ name: 'Mock', kind: 'custom', baseUrl: `http://127.0.0.1:${mockPort}/v1`, apiStyle: 'chat', model: 'mock', apiKey: 'test', temperature: 0, maxSteps: 20, maxTokens: 512, awsRegion: '', awsProfile: '' }) });
  const tool = await json<any>(`${base}/api/tools`, { method: 'POST', body: JSON.stringify({ name: 'broken_search', description: 'Broken search', method: 'GET', url: `http://127.0.0.1:${mockPort}/broken`, headers: {}, secretHeaders: {}, parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }, permission: 'auto', enabled: true, timeoutMs: 2000 }) });
  const bot = await json<any>(`${base}/api/bots`, { method: 'POST', body: JSON.stringify({ name: 'Loop tester', role: 'Test', description: '', instructions: 'Use the tool when needed, but stop when it is unavailable.', color: '#ee6c45', providerId: provider.id, toolIds: [tool.id] }) });
  const run = await json<any>(`${base}/api/bots/${bot.id}/messages`, { method: 'POST', body: JSON.stringify({ message: 'Research this topic.' }) });
  const completed = await eventually(() => json<any>(`${base}/api/runs/${run.id}`), (value) => ['completed', 'failed', 'cancelled'].includes(value.status));
  assert.equal(completed.status, 'completed');
  assert.equal(toolCalls, 1, 'The unavailable endpoint must only be called once per run');
  assert.ok(modelCalls <= 4, `Repeated failures should stop quickly, got ${modelCalls} model calls`);
  const messages = await json<any[]>(`${base}/api/bots/${bot.id}/messages`);
  assert.ok(messages.some((message) => message.content.includes('duplicate request blocked') || message.content.includes('already attempted') || message.content.includes('unavailable for the rest')));
  assert.ok(messages.every((message) => !message.content.includes('<|DSML|function_calls')));
});
