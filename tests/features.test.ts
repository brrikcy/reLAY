import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
async function request(url: string, init?: RequestInit) {
  const result = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  return { status: result.status, body: await result.json() as any };
}
async function call(url: string, init?: RequestInit): Promise<any> {
  const result = await request(url, init);
  if (result.status >= 300) throw new Error(`${result.status}: ${result.body.error}`);
  return result.body;
}
async function waitFor(url: string, terminal: string): Promise<any> {
  let run: any;
  for (let attempt = 0; attempt < 200; attempt++) {
    run = await call(url);
    if (run.status === terminal) return run;
    if (['failed', 'cancelled'].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return run;
}

test('attachments, budgets, webhooks and unified history', { timeout: 40_000, concurrency: false }, async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), 'relay-features-'));
  let modelCalls = 0;
  let modelSawAttachment = false;
  let releaseFirst = false;
  let firstResponse: (() => void) | undefined;
  const mock = createServer((req, res) => {
    if (req.url === '/v1/chat/completions' && req.method === 'POST') {
      modelCalls++;
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        if (body.includes('Juniper')) modelSawAttachment = true;
        const send = () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: `Completed response ${modelCalls}.` } }], usage: { prompt_tokens: 10, completion_tokens: 5 } })); };
        if (modelCalls === 1 && !releaseFirst) firstResponse = send;
        else send();
      });
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve));
  const mockPort = (mock.address() as AddressInfo).port;
  const port = 21500 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, [resolve(root, 'node_modules/tsx/dist/cli.mjs'), 'server/index.ts'], { cwd: root, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', RELAY_DATA_FILE: join(temporary, 'test.db'), RELAY_ALLOW_PRIVATE_NETWORK: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] });
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
  const base = `http://127.0.0.1:${port}`;
  let healthy = false;
  for (let attempt = 0; attempt < 400; attempt++) {
    try { if ((await request(`${base}/api/health`)).body.ok) { healthy = true; break; } } catch { /* Starting up. */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(healthy, true, `Server did not become healthy: ${serverLog}`);
  const provider = await call(`${base}/api/providers`, { method: 'POST', body: JSON.stringify({ name: 'Mock', kind: 'custom', baseUrl: `http://127.0.0.1:${mockPort}/v1`, apiStyle: 'chat', model: 'mock', apiKey: 'test', temperature: 0, maxSteps: 4, maxTokens: 512 }) });
  const bot = await call(`${base}/api/bots`, { method: 'POST', body: JSON.stringify({ name: 'Feature tester', role: 'Test', description: '', instructions: 'Answer concisely.', color: '#ee6c45', providerId: provider.id, toolIds: [] }) });
  const attachment = await call(`${base}/api/bots/${bot.id}/attachments`, { method: 'POST', body: JSON.stringify({ name: 'notes.txt', mime: 'text/plain', content: 'The release codename is Juniper.', encoding: 'text' }) });
  assert.equal(attachment.text, 'The release codename is Juniper.');
  assert.equal((await call(`${base}/api/bots/${bot.id}/attachments`))[0].metadata.imagePendingAnalysis, false);
  const pdf = await request(`${base}/api/bots/${bot.id}/attachments`, { method: 'POST', body: JSON.stringify({ name: 'fake.pdf', mime: 'application/pdf', content: 'pretend PDF text', encoding: 'text' }) });
  assert.equal(pdf.status, 400);
  const { samplePdf } = await import('./fixtures/pdf.ts');
  const realPdf = await call(`${base}/api/bots/${bot.id}/attachments`, { method: 'POST', body: JSON.stringify({ name: 'release.pdf', mime: 'application/pdf', content: samplePdf().toString('base64'), encoding: 'base64' }) });
  assert.equal(realPdf.metadata.pageCount, 1);
  assert.ok(realPdf.text.includes('Juniper release notes'));
  await call(`${base}/api/bots/${bot.id}/attachments/${realPdf.id}`, { method: 'DELETE' });
  await call(`${base}/api/bots/${bot.id}/budget`, { method: 'PATCH', body: JSON.stringify({ maxRunsPerDay: 2, maxTokensPerDay: 1050, maxToolCallsPerDay: 3 }) });
  const first = await call(`${base}/api/bots/${bot.id}/messages`, { method: 'POST', body: JSON.stringify({ message: 'Use the attached codename in a short reply.' }) });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const queuedRoutine = await call(`${base}/api/bots/${bot.id}/routines`, { method: 'POST', body: JSON.stringify({ name: 'Queued event test', instruction: 'Process a queued event.', intervalMinutes: 60, triggerType: 'webhook', timezone: 'UTC', enabled: true }) });
  const queuedCredentials = await call(`${base}/api/routines/${queuedRoutine.id}/webhook-key`, { method: 'POST' });
  const queued = await request(`${base}/api/routines/${queuedRoutine.id}/webhook`, { method: 'POST', headers: { Authorization: `Bearer ${queuedCredentials.key}` }, body: JSON.stringify({ id: 'queued-event', value: 'held until available' }) });
  assert.equal(queued.status, 202);
  assert.equal(queued.body.status, 'queued');
  assert.equal(queued.body.runId, undefined, 'A busy owner must not start a second run');
  const queuedBeforeRelease = await call(`${base}/api/routines/${queuedRoutine.id}/executions`);
  assert.equal(queuedBeforeRelease[0].status, 'queued');
  releaseFirst = true;
  firstResponse?.();
  await waitFor(`${base}/api/runs/${first.id}`, 'completed');
  assert.equal(modelSawAttachment, true, 'Uploaded document text must be included in model context');
  const releasedExecution = (await call(`${base}/api/routines/${queuedRoutine.id}/executions`))[0];
  const queuedAfterRelease = await waitFor(`${base}/api/runs/${releasedExecution.runId}`, 'completed');
  assert.equal(queuedAfterRelease.status, 'completed');
  let finalExecution: any;
  for (let attempt = 0; attempt < 100; attempt++) {
    finalExecution = (await call(`${base}/api/routines/${queuedRoutine.id}/executions`))[0];
    if (finalExecution.status === 'completed') break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(finalExecution.status, 'completed');
  await call(`${base}/api/bots/${bot.id}/budget`, { method: 'PATCH', body: JSON.stringify({ maxRunsPerDay: 50, maxTokensPerDay: 1050, maxToolCallsPerDay: 3 }) });
  const afterChat = await call(`${base}/api/bots/${bot.id}/budget`);
  assert.equal(afterChat.usedRuns, 2);
  assert.equal(afterChat.usedInputTokens, 20);
  assert.equal(afterChat.usedOutputTokens, 10);
  assert.equal(afterChat.remainingTokens, 1020);
  const routine = await call(`${base}/api/bots/${bot.id}/routines`, { method: 'POST', body: JSON.stringify({ name: 'Webhook test', instruction: 'Process the event.', intervalMinutes: 60, triggerType: 'webhook', timezone: 'UTC', enabled: true }) });
  const credentials = await call(`${base}/api/routines/${routine.id}/webhook-key`, { method: 'POST' });
  const workspace = await call(`${base}/api/workspace`);
  assert.equal(workspace.routines.find((item: any) => item.id === routine.id).hasWebhookKey, true);
  assert.equal(JSON.stringify(workspace).includes(credentials.key), false);
  const url = `${base}${credentials.url}`;
  assert.equal((await request(url, { method: 'POST', body: JSON.stringify({ id: 'event-1', text: 'test' }) })).status, 401);
  const accepted = await request(url, { method: 'POST', headers: { Authorization: `Bearer ${credentials.key}` }, body: JSON.stringify({ id: 'event-1', text: 'test' }) });
  assert.equal(accepted.status, 202);
  assert.ok(accepted.body.executionId);
  const executionList = await call(`${base}/api/routines/${routine.id}/executions`);
  assert.equal(executionList[0].status, 'accepted');
  assert.equal(executionList[0].eventId, 'event-1');
  const completedWebhook = await waitFor(`${base}/api/runs/${accepted.body.runId}`, 'completed');
  assert.equal(completedWebhook.status, 'completed');
  const afterWebhook = await call(`${base}/api/bots/${bot.id}/budget`);
  assert.equal(afterWebhook.usedRuns, 3);
  const duplicateResponse = await request(url, { method: 'POST', headers: { Authorization: `Bearer ${credentials.key}` }, body: JSON.stringify({ id: 'event-1', text: 'test' }) });
  assert.equal(duplicateResponse.status, 409);
  await call(`${base}/api/bots/${bot.id}/budget`, { method: 'PATCH', body: JSON.stringify({ maxRunsPerDay: 3, maxTokensPerDay: 1050, maxToolCallsPerDay: 3 }) });
  const overBudget = await call(`${base}/api/bots/${bot.id}/messages`, { method: 'POST', body: JSON.stringify({ message: 'This run must not call the model.' }) });
  const limitedRun = await waitFor(`${base}/api/runs/${overBudget.id}`, 'failed');
  assert.equal(limitedRun.status, 'failed');
  assert.equal(modelCalls, 3);
  const directMatches = await call(`${base}/api/search?q=attached%20codename`);
  assert.equal(Array.isArray(directMatches), true);
  assert.equal(directMatches.some((item: any) => item.content.includes('attached codename')), true);
  const roomMatches = await call(`${base}/api/search?q=Welcome%20to%20the%20team%20room`);
  assert.equal(roomMatches.some((item: any) => item.groupId === 'group_team'), true);
  await call(`${base}/api/bots/${bot.id}/attachments/${attachment.id}`, { method: 'DELETE' });
  assert.deepEqual(await call(`${base}/api/bots/${bot.id}/attachments`), []);
});
