import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
async function request(url: string, init?: RequestInit) { const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } }); return { status: response.status, body: await response.json() as any }; }

test('Progressive model deltas persist and follow-up instructions start after active work', { timeout: 30_000 }, async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), 'relay-streaming-'));
  let modelCalls = 0;
  let releaseFirst: (() => void) | undefined;
  const mock = createServer((request, response) => {
    if (request.url === '/v1/chat/completions') {
      modelCalls++;
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = () => { response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `Answer ${modelCalls}` } }] })}\n\n`); response.end('data: [DONE]\n\n'); };
      if (modelCalls === 1) releaseFirst = send; else send();
      return;
    }
    response.writeHead(404); response.end();
  });
  await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve));
  const mockPort = (mock.address() as AddressInfo).port;
  const port = 24000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, [resolve(root, 'node_modules/tsx/dist/cli.mjs'), 'server/index.ts'], { cwd: root, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', RELAY_DATA_FILE: join(temporary, 'test.db'), RELAY_ALLOW_PRIVATE_NETWORK: 'true' }, stdio: 'ignore' });
  context.after(async () => { const exited = new Promise<void>((resolve) => child.once('exit', () => resolve())); child.kill('SIGTERM'); await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 5000))]); if (child.exitCode === null) child.kill('SIGKILL'); await new Promise<void>((resolve) => mock.close(() => resolve())); await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 200; attempt++) { try { if ((await request(`${base}/api/health`)).body.ok) break; } catch { /* Starting. */ } await new Promise((resolve) => setTimeout(resolve, 50)); }
  const provider = await request(`${base}/api/providers`, { method: 'POST', body: JSON.stringify({ name: 'Mock', kind: 'custom', baseUrl: `http://127.0.0.1:${mockPort}/v1`, apiStyle: 'chat', model: 'mock', apiKey: 'test', temperature: 0, maxSteps: 4, maxTokens: 512 }) });
  const bot = await request(`${base}/api/bots`, { method: 'POST', body: JSON.stringify({ name: 'Streaming tester', role: 'Test', description: '', instructions: 'Answer concisely.', color: '#ee6c45', providerId: provider.body.id, toolIds: [] }) });
  const first = await request(`${base}/api/bots/${bot.body.id}/messages`, { method: 'POST', body: JSON.stringify({ message: 'First task' }) });
  await new Promise((resolve) => setTimeout(resolve, 150));
  const followUp = await request(`${base}/api/bots/${bot.body.id}/messages`, { method: 'POST', body: JSON.stringify({ message: 'Additional instruction while working' }) });
  assert.equal(followUp.status, 202);
  assert.equal(followUp.body.status, 'waiting');
  assert.ok(followUp.body.id.startsWith('queued_'));
  releaseFirst?.();
  let completed: any;
  for (let attempt = 0; attempt < 100; attempt++) { completed = await request(`${base}/api/runs/${first.body.id}`); if (completed.body.status === 'completed') break; await new Promise((resolve) => setTimeout(resolve, 50)); }
  assert.equal(completed.body.status, 'completed');
  for (let attempt = 0; attempt < 100; attempt++) { if (modelCalls >= 2) break; await new Promise((resolve) => setTimeout(resolve, 50)); }
  assert.equal(modelCalls, 2);
  const messages = await request(`${base}/api/bots/${bot.body.id}/messages`);
  assert.ok(messages.body.some((message: any) => message.content === 'Answer 1'));
  assert.ok(messages.body.some((message: any) => message.content === 'Answer 2'));
  assert.ok(messages.body.some((message: any) => message.content === 'Additional instruction while working'));
});
