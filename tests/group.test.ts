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
async function eventually<T>(callback: () => Promise<T>, predicate: (value: T) => boolean, timeout = 12_000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await callback(); if (predicate(value)) return value; await new Promise((resolve) => setTimeout(resolve, 60)); }
  throw new Error('Timed out waiting for group state.');
}

test('Group delegation returns the specialist result and room approvals are discoverable', { timeout: 35_000, concurrency: false }, async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), 'relay-group-'));
  const requests: any[] = [];
  const mock = createServer((request, response) => {
    if (request.url !== '/v1/chat/completions') { response.writeHead(404).end(); return; }
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      const input = JSON.parse(body);
      requests.push(input);
      const reply = requests.length === 1 ? { role: 'assistant', content: '', tool_calls: [{ id: 'delegate_1', type: 'function', function: { name: 'relay_delegate', arguments: JSON.stringify({ bot_name: 'Atlas', task: 'Give a concise MVP plan.' }) } }] } : requests.length === 2 ? { role: 'assistant', content: 'Atlas recommends a three-step MVP plan.' } : { role: 'assistant', content: 'Scout used Atlas’s recommendation: start with a three-step MVP plan.' };
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: reply }], usage: { prompt_tokens: 5, completion_tokens: 5 } }));
    });
  });
  await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve));
  const mockPort = (mock.address() as AddressInfo).port;
  const port = 22000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, [resolve(root, 'node_modules/tsx/dist/cli.mjs'), 'server/index.ts'], { cwd: root, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', RELAY_DATA_FILE: join(temporary, 'group.db'), RELAY_ALLOW_PRIVATE_NETWORK: 'true' }, stdio: 'ignore' });
  context.after(async () => {
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill('SIGTERM');
    await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 5000))]);
    if (child.exitCode === null) child.kill('SIGKILL');
    await new Promise<void>((resolve) => mock.close(() => resolve()));
    await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const base = `http://127.0.0.1:${port}`;
  await eventually(() => json(`${base}/api/health`).catch(() => ({ ok: false })), (value) => value.ok);
  const provider = await json<any>(`${base}/api/providers`, { method: 'POST', body: JSON.stringify({ name: 'Mock', kind: 'custom', baseUrl: `http://127.0.0.1:${mockPort}/v1`, apiStyle: 'chat', model: 'mock', apiKey: 'test', temperature: 0, maxSteps: 5, maxTokens: 512, awsRegion: '', awsProfile: '' }) });
  for (const bot of await json<any>(`${base}/api/workspace`).then((workspace) => workspace.bots)) {
    await json(`${base}/api/bots/${bot.id}`, { method: 'PATCH', body: JSON.stringify({ ...bot, providerId: provider.id, toolIds: [] }) });
  }
  const run = await json<any>(`${base}/api/groups/group_team/messages`, { method: 'POST', body: JSON.stringify({ message: 'Delegate a narrow planning task to Atlas, then summarize it.', botIds: ['bot_scout'], inputMode: 'text' }) });
  const completed = await eventually(() => json<any>(`${base}/api/runs/${run.runIds[0]}`), (value) => value.status === 'completed');
  assert.ok(completed.output.includes('three-step MVP'), JSON.stringify({ completed, requests: requests.map((request) => request.messages), messages: await json(`${base}/api/groups/group_team/messages`), botMessages: await json(`${base}/api/bots/bot_scout/messages`), lastRequest: requests.at(-1) }));
  const messages = await json<any[]>(`${base}/api/groups/group_team/messages`);
  assert.ok(messages.some((message) => message.botId === 'bot_atlas' && message.content.includes('three-step MVP')));
  assert.ok(messages.some((message) => message.botId === 'bot_scout' && message.content.includes('Atlas')));
  const approvalResponse = await json<any[]>(`${base}/api/groups/group_team/approvals`);
  assert.deepEqual(approvalResponse, []);
  assert.ok(requests.length >= 3, 'Coordinator and specialist must each call the model');
});
