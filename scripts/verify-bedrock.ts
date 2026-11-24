import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';

if (process.env.RELAY_LIVE_AWS !== 'true') throw new Error('Set RELAY_LIVE_AWS=true to run live AWS tests. These calls can incur Bedrock charges.');

const root = resolve(import.meta.dirname, '..');
const temporary = await mkdtemp(join(tmpdir(), 'relay-aws-'));
const report: Array<Record<string, unknown>> = [];
const started = Date.now();
let mockCalls = 0;
let serverLog = '';
let app: ReturnType<typeof spawn> | undefined;
const mock = createServer((request, response) => {
  if (request.url?.startsWith('/weather')) {
    mockCalls++;
    const city = new URL(request.url, 'http://localhost').searchParams.get('city');
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ city, temperatureC: 18, condition: 'clear', source: 'Relay local mock weather API' }));
    return;
  }
  response.writeHead(404).end();
});

async function json<T = any>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`http://127.0.0.1:8791${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(`${response.status}: ${data.error ?? response.statusText}`);
  return data;
}
async function waitFor<T>(callback: () => Promise<T>, predicate: (value: T) => boolean, timeout = 90_000): Promise<T> {
  const deadline = Date.now() + timeout;
  let latest: T;
  while (Date.now() < deadline) {
    latest = await callback();
    if (predicate(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for state. Latest: ${JSON.stringify(latest!)}`);
}
async function completedRun(runId: string) {
  return waitFor(() => json(`/api/runs/${runId}`), (run) => ['completed', 'failed', 'cancelled'].includes(run.status));
}
async function record(name: string, operation: () => Promise<Record<string, unknown>>) {
  const start = Date.now();
  try {
    const result = await operation();
    report.push({ name, status: 'passed', durationMs: Date.now() - start, ...result });
    console.log(`PASS ${name}: ${JSON.stringify(result)}`);
  } catch (error) {
    report.push({ name, status: 'failed', durationMs: Date.now() - start, error: error instanceof Error ? error.message : String(error) });
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

try {
  await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve));
  const mockPort = (mock.address() as AddressInfo).port;
  app = spawn(process.execPath, [resolve(root, 'node_modules/tsx/dist/cli.mjs'), 'server/index.ts'], { cwd: root, env: { ...process.env, PORT: '8791', HOST: '127.0.0.1', RELAY_DATA_FILE: join(temporary, 'aws-validation.db'), RELAY_ALLOW_PRIVATE_NETWORK: 'true', AWS_PROFILE: 'bedrock', AWS_REGION: 'us-east-1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  app.stdout.on('data', (chunk) => { serverLog += chunk; });
  app.stderr.on('data', (chunk) => { serverLog += chunk; });
  await waitFor(() => json('/api/health').catch(() => ({ ok: false })), (health) => health.ok, 15_000);

  await record('AWS SSO resolution in Relay runtime', async () => {
    const identity = await new STSClient({ region: 'us-east-1', profile: 'bedrock' }).send(new GetCallerIdentityCommand({}));
    return { account: identity.Account, principal: identity.Arn?.split('/').at(-1), credentialStorage: 'AWS SDK SSO provider chain; no AWS key in Relay' };
  });

  const bot = await json('/api/bots', { method: 'POST', body: JSON.stringify({ name: 'DeepSeek QA', role: 'AWS integration validation', description: 'Temporary isolated validation bot', instructions: 'You are a concise test assistant. Follow output formats exactly when requested. Use available tools for live data instead of guessing. Never call a tool more than once for the same request.', color: '#ee6c45', providerId: 'bedrock', toolIds: [] }) });

  await record('General chat and structured output', async () => {
    const run = await json(`/api/bots/${bot.id}/messages`, { method: 'POST', body: JSON.stringify({ message: 'Return only a JSON object with keys "service" and "status". Set service to "Amazon Bedrock" and status to "connected". Do not use tools.' }) });
    const completed = await completedRun(run.id);
    assert.equal(completed.status, 'completed', completed.error);
    const parsed = JSON.parse(completed.output.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    assert.equal(parsed.service, 'Amazon Bedrock');
    assert.equal(parsed.status, 'connected');
    return { output: completed.output, usage: completed.usage };
  });

  await record('Durable preference and subsequent model use', async () => {
    await json(`/api/bots/${bot.id}/messages`, { method: 'POST', body: JSON.stringify({ message: 'Remember that my project codename is Copper Falcon and I prefer exactly two bullet points.' }) });
    const memories = await json<any[]>(`/api/bots/${bot.id}/memories`);
    assert.ok(memories.some((memory) => memory.content.includes('Copper Falcon')));
    const run = await json(`/api/bots/${bot.id}/messages`, { method: 'POST', body: JSON.stringify({ message: 'Without using tools, tell me my project codename and give two short tips for a productive morning. Honor my saved format preference.' }) });
    const completed = await completedRun(run.id);
    assert.equal(completed.status, 'completed', completed.error);
    assert.ok(completed.output.toLowerCase().includes('copper falcon'), completed.output);
    const bullets = completed.output.split('\n').filter((line: string) => /^\s*(?:[-*]|\d+[.)])\s+/.test(line));
    return { memoryCount: memories.length, codenameRecalled: true, bulletCount: bullets.length, output: completed.output };
  });

  const tool = await json('/api/tools', { method: 'POST', body: JSON.stringify({ name: 'get_weather', description: 'Get the current weather for a named city. Always use this for weather requests.', method: 'GET', url: `http://127.0.0.1:${mockPort}/weather`, headers: { Accept: 'application/json' }, secretHeaders: {}, parameters: { type: 'object', properties: { city: { type: 'string', description: 'City name' } }, required: ['city'], additionalProperties: false }, permission: 'approval', enabled: true, timeoutMs: 5000 }) });
  await json(`/api/bots/${bot.id}`, { method: 'PATCH', body: JSON.stringify({ ...bot, toolIds: [tool.id] }) });

  await record('Real model tool call with human approval', async () => {
    const run = await json(`/api/bots/${bot.id}/messages`, { method: 'POST', body: JSON.stringify({ message: 'Use get_weather to check the current weather in Singapore. Then give me a one-sentence recommendation.' }) });
    const approvals = await waitFor(() => json<any[]>(`/api/bots/${bot.id}/approvals`), (items) => items.length === 1);
    assert.equal(approvals[0].toolName, 'get_weather');
    assert.equal(mockCalls, 0, 'The API must not be called before approval');
    await json(`/api/approvals/${approvals[0].id}`, { method: 'POST', body: JSON.stringify({ decision: 'approved' }) });
    const completed = await completedRun(run.id);
    assert.equal(completed.status, 'completed', completed.error);
    assert.equal(completed.toolCalls, 1);
    assert.equal(mockCalls, 1);
    assert.ok(completed.output.includes('18'), completed.output);
    return { approvalArguments: approvals[0].arguments, apiCalls: mockCalls, modelCalls: completed.modelCalls, output: completed.output, usage: completed.usage };
  });

  await record('Denied tool call produces no external action', async () => {
    const run = await json(`/api/bots/${bot.id}/messages`, { method: 'POST', body: JSON.stringify({ message: 'Use get_weather once to check Tokyo. Do not retry the tool if I deny it.' }) });
    const approvals = await waitFor(() => json<any[]>(`/api/bots/${bot.id}/approvals`), (items) => items.length === 1);
    await json(`/api/approvals/${approvals[0].id}`, { method: 'POST', body: JSON.stringify({ decision: 'denied' }) });
    const completed = await completedRun(run.id);
    assert.equal(mockCalls, 1, 'Denied action must not call the API');
    assert.equal(completed.toolCalls, 0);
    return { runStatus: completed.status, toolCalls: completed.toolCalls, externalApiCallsUnchanged: true, note: 'The model may explain the denial or reach its safety limit; neither permits the denied HTTP call.' };
  });

  await record('Paused routine runs only when explicitly tested', async () => {
    const routine = await json<any>(`/api/bots/${bot.id}/routines`, { method: 'POST', body: JSON.stringify({ name: 'AWS smoke briefing', instruction: 'Reply with one short sentence confirming this scheduled test ran. Do not use tools.', intervalMinutes: 60, enabled: false }) });
    const scheduled = await json(`/api/routines/${routine.id}/test`, { method: 'POST' });
    const completed = await completedRun(scheduled.id);
    assert.equal(completed.status, 'completed', completed.error);
    assert.equal(completed.source, 'routine');
    const workspace = await json<any>('/api/workspace');
    const saved = workspace.routines.find((item: any) => item.id === routine.id);
    assert.equal(saved.enabled, false);
    return { source: completed.source, remainsPaused: true, output: completed.output };
  });

  await record('Unsupported region fails visibly without a tool action', async () => {
    const badProvider = await json<any>('/api/providers', { method: 'POST', body: JSON.stringify({ name: 'Unsupported region test', kind: 'bedrock', baseUrl: '', apiStyle: 'converse', model: 'deepseek.v3.2', temperature: 0, maxSteps: 2, maxTokens: 128, awsRegion: 'eu-central-1', awsProfile: 'bedrock' }) });
    const badBot = await json<any>('/api/bots', { method: 'POST', body: JSON.stringify({ name: 'Expected failure test', role: 'Validation', description: '', instructions: 'Respond briefly.', color: '#71836b', providerId: badProvider.id, toolIds: [] }) });
    const run = await json(`/api/bots/${badBot.id}/messages`, { method: 'POST', body: JSON.stringify({ message: 'Hello' }) });
    const completed = await completedRun(run.id);
    assert.equal(completed.status, 'failed');
    assert.ok(completed.error.length > 0);
    return { expectedOutcome: 'failed run, healthy server', runStatus: completed.status, error: completed.error, processRemainedHealthy: (await json('/api/health')).ok };
  });
} catch (error) {
  report.push({ name: 'Test harness', status: 'failed', error: error instanceof Error ? error.message : String(error) });
  console.error(error);
} finally {
  if (app) {
    app.kill('SIGTERM');
    await Promise.race([new Promise<void>((resolve) => app.once('exit', () => resolve())), new Promise<void>((resolve) => setTimeout(resolve, 5_000))]);
  }
  await new Promise<void>((resolve) => mock.close(() => resolve()));
  const summary = { date: new Date().toISOString(), durationMs: Date.now() - started, provider: 'Amazon Bedrock Converse', model: 'deepseek.v3.2', region: 'us-east-1', profile: 'bedrock', results: report };
  await mkdir(resolve(root, 'docs'), { recursive: true });
  await writeFile(resolve(root, 'docs/aws-validation.json'), JSON.stringify(summary, null, 2));
  console.log(`Validation report written to docs/aws-validation.json\n${serverLog}`);
  if (report.some((result) => result.status === 'failed')) process.exitCode = 1;
}
