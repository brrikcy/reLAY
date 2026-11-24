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
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(`${response.status}: ${body.error ?? response.statusText}`);
  return body;
}
async function eventually<T>(callback: () => Promise<T>, predicate: (value: T) => boolean, timeout = 10_000): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await callback();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for the expected application state.');
}

test('full agent loop: API tool approval, denial, memory, and provider confidentiality', { timeout: 40_000, concurrency: false }, async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), 'relay-test-'));
  let modelRequests = 0;
  let apiCalls = 0;
  let receivedAuth = '';
  let receivedCity = '';
  let denialRequested = false;
  const mock = createServer((request, response) => {
    if (request.url === '/v1/chat/completions' && request.method === 'POST') {
      modelRequests++;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      if (modelRequests === 1 && !denialRequested) response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 'call_weather', type: 'function', function: { name: 'get_weather_mock', arguments: JSON.stringify({ city: 'London' }) } }] } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
      else response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'The verified forecast is 18°C and clear.' } }], usage: { prompt_tokens: 20, completion_tokens: 8 } }));
      return;
    }
    if (request.url?.startsWith('/weather') && request.method === 'GET') {
      apiCalls++;
      receivedAuth = String(request.headers.authorization ?? '');
      receivedCity = new URL(request.url, 'http://localhost').searchParams.get('city') ?? '';
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ temperature: 18, condition: 'clear', city: receivedCity }));
      return;
    }
    response.writeHead(404, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: 'Not found' }));
  });
  await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve));
  const mockPort = (mock.address() as AddressInfo).port;
  const appPort = 19000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, [resolve(root, 'node_modules/tsx/dist/cli.mjs'), 'server/index.ts'], { cwd: root, env: { ...process.env, PORT: String(appPort), HOST: '127.0.0.1', RELAY_DATA_FILE: join(temporary, 'test.db'), RELAY_ALLOW_PRIVATE_NETWORK: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let serverLog = '';
  child.stdout.on('data', (chunk) => { serverLog += chunk; });
  child.stderr.on('data', (chunk) => { serverLog += chunk; });
  context.after(async () => {
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill('SIGTERM');
    await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 5000))]);
    if (child.exitCode === null) child.kill('SIGKILL');
    await new Promise<void>((resolve) => mock.close(() => resolve()));
    await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const base = `http://127.0.0.1:${appPort}`;
  await eventually(() => json(`${base}/api/health`).catch(() => ({ ok: false })), (value) => value.ok);
  try {
    const provider = await json<any>(`${base}/api/providers`, { method: 'POST', body: JSON.stringify({ name: 'Mock model', kind: 'custom', baseUrl: `http://127.0.0.1:${mockPort}/v1`, apiStyle: 'chat', model: 'mock-1', apiKey: 'model-secret-key', temperature: 0, maxSteps: 5 }) });
    assert.equal(provider.apiKey, undefined);
    assert.equal(provider.hasApiKey, true);
    const updatedProvider = await json<any>(`${base}/api/providers/${provider.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'Mock model', kind: 'custom', baseUrl: `http://127.0.0.1:${mockPort}/v1`, apiStyle: 'chat', model: 'mock-1', temperature: 0, maxSteps: 5 }) });
    assert.equal(updatedProvider.apiKey, undefined);
    assert.equal(updatedProvider.hasApiKey, true);
    const tool = await json<any>(`${base}/api/tools`, { method: 'POST', body: JSON.stringify({ name: 'get_weather_mock', description: 'Get weather for a city', method: 'GET', url: `http://127.0.0.1:${mockPort}/weather`, headers: { Accept: 'application/json' }, secretHeaders: { Authorization: 'Bearer tool-secret-key' }, parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'], additionalProperties: false }, permission: 'approval', enabled: true, timeoutMs: 3000 }) });
    assert.equal(tool.secretHeaders, undefined);
    const bot = await json<any>(`${base}/api/bots`, { method: 'POST', body: JSON.stringify({ name: 'Weather tester', role: 'API verification', description: 'Test bot', instructions: 'Use the weather tool when asked about weather.', color: '#ee6c45', providerId: provider.id, toolIds: [tool.id] }) });
    const run = await json<any>(`${base}/api/bots/${bot.id}/messages`, { method: 'POST', body: JSON.stringify({ message: 'What is the weather in London?' }) });
    const pending = await eventually(() => json<any[]>(`${base}/api/bots/${bot.id}/approvals`), (items) => items.length === 1).catch(async (error) => { throw new Error(`${error.message}; first run: ${JSON.stringify(await json(`${base}/api/runs/${run.id}`))}`); });
    assert.equal(pending[0].toolName, 'get_weather_mock');
    assert.equal(apiCalls, 0, 'No API request may happen before approval');
    await json(`${base}/api/approvals/${pending[0].id}`, { method: 'POST', body: JSON.stringify({ decision: 'approved' }) });
    const completed = await eventually(() => json<any>(`${base}/api/runs/${run.id}`), (value) => value.status === 'completed');
    assert.equal(completed.toolCalls, 1);
    assert.equal(completed.modelCalls, 2);
    assert.equal(completed.usage.inputTokens, 30);
    assert.equal(completed.usage.outputTokens, 13);
    assert.equal(apiCalls, 1, 'An approved tool must execute exactly once');
    const approvedBudget = await json<any>(`${base}/api/bots/${bot.id}/budget`);
    assert.equal(approvedBudget.usedRuns, 1, 'Approval resume must not consume a second run');
    assert.equal(approvedBudget.usedToolCalls, 1, 'Only an executed tool call consumes the tool budget');
    assert.equal(receivedCity, 'London', JSON.stringify(await json(`${base}/api/bots/${bot.id}/messages`)));
    assert.equal(receivedAuth, 'Bearer tool-secret-key');
    const messages = await json<any[]>(`${base}/api/bots/${bot.id}/messages`);
    assert.equal(messages.at(-1).content, 'The verified forecast is 18°C and clear.');
    assert.ok(messages.some((message) => message.role === 'tool' && message.content.includes('18')));
    const allProviders = await json<any>(`${base}/api/workspace`).then((workspace) => workspace.providers);
    assert.equal(JSON.stringify(allProviders).includes('model-secret-key'), false);
    assert.equal(JSON.stringify(await json(`${base}/api/workspace`)).includes('tool-secret-key'), false);

    modelRequests = 0;
    const secondRun = await json<any>(`${base}/api/bots/${bot.id}/messages`, { method: 'POST', body: JSON.stringify({ message: 'Check London again.' }) });
    const denial = await eventually(() => json<any[]>(`${base}/api/bots/${bot.id}/approvals`), (items) => items.length === 1).catch(async (error) => { throw new Error(`${error.message}; second run: ${JSON.stringify(await json(`${base}/api/runs/${secondRun.id}`))}`); });
    denialRequested = true;
    await json(`${base}/api/approvals/${denial[0].id}`, { method: 'POST', body: JSON.stringify({ decision: 'denied' }) });
    const deniedRun = await eventually(() => json<any>(`${base}/api/runs/${secondRun.id}`), (value) => value.status === 'completed');
    assert.equal(deniedRun.toolCalls, 0);
    assert.equal(apiCalls, 1, 'A denied tool must not execute');
    const deniedMessages = await json<any[]>(`${base}/api/bots/${bot.id}/messages`);
    assert.ok(deniedMessages.some((message) => message.role === 'tool' && message.content.includes('denied')));

    await json(`${base}/api/bots/${bot.id}/messages`, { method: 'POST', body: JSON.stringify({ message: 'Remember that I prefer metric units.' }) });
    const memories = await json<any[]>(`${base}/api/bots/${bot.id}/memories`);
    assert.ok(memories.some((memory) => memory.content === 'I prefer metric units.' && memory.category === 'preference'));

    const routine = await json<any>(`${base}/api/bots/${bot.id}/routines`, { method: 'POST', body: JSON.stringify({ name: 'Test briefing', instruction: 'Provide a concise test briefing.', intervalMinutes: 60, enabled: false }) });
    const scheduled = await json<any>(`${base}/api/routines/${routine.id}/test`, { method: 'POST' });
    const routineRun = await eventually(() => json<any>(`${base}/api/runs/${scheduled.id}`), (value) => value.status === 'completed');
    assert.equal(routineRun.source, 'routine');
    assert.equal(routineRun.routineId, routine.id);
    const workspaceAfterRoutine = await json<any>(`${base}/api/workspace`);
    const savedRoutine = workspaceAfterRoutine.routines.find((item: any) => item.id === routine.id);
    assert.ok(savedRoutine.lastRunAt);
    assert.equal(savedRoutine.enabled, false);
    await json(`${base}/api/routines/${routine.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: true }) });
    const enabledRoutine = await json<any>(`${base}/api/workspace`).then((workspace) => workspace.routines.find((item: any) => item.id === routine.id));
    assert.equal(enabledRoutine.enabled, true);
  } catch (error) {
    assert.fail(`${error instanceof Error ? error.message : String(error)}\nServer log:\n${serverLog}`);
  }
});
