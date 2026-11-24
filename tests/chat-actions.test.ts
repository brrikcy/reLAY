import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
async function request(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  return { status: response.status, body: await response.json() as any };
}

test('WhatsApp-style replies, reactions, edits and deletion are durable message actions', { timeout: 30_000 }, async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), 'relay-chat-actions-'));
  const port = 23000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, [resolve(root, 'node_modules/tsx/dist/cli.mjs'), 'server/index.ts'], { cwd: root, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', RELAY_DATA_FILE: join(temporary, 'test.db') }, stdio: 'ignore' });
  context.after(async () => { const exited = new Promise<void>((resolve) => child.once('exit', () => resolve())); child.kill('SIGTERM'); await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 5000))]); if (child.exitCode === null) child.kill('SIGKILL'); await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 200; attempt++) { try { if ((await request(`${base}/api/health`)).body.ok) break; } catch { /* Starting. */ } await new Promise((resolve) => setTimeout(resolve, 50)); }
  const original = await request(`${base}/api/bots/bot_scout/messages`, { method: 'POST', body: JSON.stringify({ message: 'Original question' }) });
  assert.equal(original.status, 202);
  const list = await request(`${base}/api/bots/bot_scout/messages`);
  const originalMessage = list.body.find((message: any) => message.content === 'Original question');
  assert.ok(originalMessage);
  const reply = await request(`${base}/api/bots/bot_scout/messages`, { method: 'POST', body: JSON.stringify({ message: 'Reply to the original', replyTo: originalMessage.id }) });
  assert.equal(reply.status, 202);
  const withReply = await request(`${base}/api/bots/bot_scout/messages`);
  assert.equal(withReply.body.find((message: any) => message.content === 'Reply to the original').replyTo, originalMessage.id);
  assert.equal((await request(`${base}/api/bots/bot_scout/messages/${originalMessage.id}/reaction`, { method: 'POST', body: JSON.stringify({ emoji: '👍' }) })).status, 200);
  const reacted = await request(`${base}/api/bots/bot_scout/messages`);
  assert.deepEqual(reacted.body.find((message: any) => message.id === originalMessage.id).reactions, { '👍': 1 });
  assert.equal((await request(`${base}/api/bots/bot_scout/messages/${originalMessage.id}/reaction`, { method: 'POST', body: JSON.stringify({ emoji: '👍' }) })).status, 200);
  const toggled = await request(`${base}/api/bots/bot_scout/messages`);
  assert.deepEqual(toggled.body.find((message: any) => message.id === originalMessage.id).reactions, {});
  assert.equal((await request(`${base}/api/bots/bot_scout/messages/${originalMessage.id}`, { method: 'PATCH', body: JSON.stringify({ content: 'Edited question' }) })).status, 200);
  const edited = await request(`${base}/api/bots/bot_scout/messages`);
  assert.equal(edited.body.find((message: any) => message.id === originalMessage.id).content, 'Edited question');
  assert.ok(edited.body.find((message: any) => message.id === originalMessage.id).editedAt);
  assert.equal((await request(`${base}/api/bots/bot_scout/messages/${originalMessage.id}`, { method: 'DELETE' })).status, 200);
  const deleted = await request(`${base}/api/bots/bot_scout/messages`);
  assert.equal(deleted.body.find((message: any) => message.id === originalMessage.id).content, 'This message was deleted.');
  assert.ok(deleted.body.find((message: any) => message.id === originalMessage.id).deletedAt);
  assert.equal((await request(`${base}/api/bots/bot_scout/messages/${originalMessage.id}/reaction`, { method: 'POST', body: JSON.stringify({ emoji: '👍' }) })).status, 409);
});

test('group actions, quoted room replies, pins and honest attachment text downloads are durable', { timeout: 35_000, concurrency: false }, async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), 'relay-chat-parity-'));
  const port = 23500 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, [resolve(root, 'node_modules/tsx/dist/cli.mjs'), 'server/index.ts'], { cwd: root, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', RELAY_DATA_FILE: join(temporary, 'test.db') }, stdio: 'ignore' });
  context.after(async () => { const exited = new Promise<void>((resolve) => child.once('exit', () => resolve())); child.kill('SIGTERM'); await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 5000))]); if (child.exitCode === null) child.kill('SIGKILL'); await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 200; attempt++) { try { if ((await request(`${base}/api/health`)).body.ok) break; } catch { /* Starting. */ } await new Promise((resolve) => setTimeout(resolve, 50)); }
  const attachment = await request(`${base}/api/bots/bot_scout/attachments`, { method: 'POST', body: JSON.stringify({ name: 'notes.txt', mime: 'text/plain', content: 'Bounded attachment preview text.', encoding: 'text' }) });
  assert.equal(attachment.status, 201);
  const download = await fetch(`${base}/api/bots/bot_scout/attachments/${attachment.body.id}/download`);
  assert.equal(download.status, 200); assert.equal(await download.text(), 'Bounded attachment preview text.');
  const wrongOwner = await fetch(`${base}/api/bots/bot_atlas/attachments/${attachment.body.id}/download`);
  assert.equal(wrongOwner.status, 404);
  const pinned = await request(`${base}/api/bots/bot_scout/messages`, { method: 'POST', body: JSON.stringify({ message: 'A useful direct message to pin' }) });
  assert.equal(pinned.status, 202);
  const directMessages = await request(`${base}/api/bots/bot_scout/messages`);
  const direct = directMessages.body.find((message: any) => message.content === 'A useful direct message to pin');
  assert.equal((await request(`${base}/api/bots/bot_scout/messages/${direct.id}/pin`, { method: 'POST', body: JSON.stringify({ pinned: true }) })).status, 200);
  assert.ok((await request(`${base}/api/bots/bot_scout/messages`)).body.find((message: any) => message.id === direct.id).pinnedAt);
  const original = await request(`${base}/api/groups/group_team/messages`, { method: 'POST', body: JSON.stringify({ message: 'Original room question', botIds: [], inputMode: 'text' }) });
  assert.equal(original.status, 202);
  let room = (await request(`${base}/api/groups/group_team/messages`)).body;
  const originalMessage = room.find((message: any) => message.content === 'Original room question');
  const roomReply = await request(`${base}/api/groups/group_team/messages`, { method: 'POST', body: JSON.stringify({ message: 'Quoted room follow-up', botIds: [], inputMode: 'text', replyTo: originalMessage.id }) });
  assert.equal(roomReply.status, 202);
  room = (await request(`${base}/api/groups/group_team/messages`)).body;
  const followup = room.find((message: any) => message.content === 'Quoted room follow-up');
  assert.equal(followup.replyTo, originalMessage.id);
  assert.equal((await request(`${base}/api/groups/group_team/messages/${originalMessage.id}/reaction`, { method: 'POST', body: JSON.stringify({ emoji: '❤️' }) })).status, 200);
  assert.equal((await request(`${base}/api/groups/group_team/messages/${originalMessage.id}`, { method: 'PATCH', body: JSON.stringify({ content: 'Edited room question' }) })).status, 200);
  room = (await request(`${base}/api/groups/group_team/messages`)).body;
  const edited = room.find((message: any) => message.id === originalMessage.id);
  assert.equal(edited.content, 'Edited room question'); assert.ok(edited.editedAt); assert.deepEqual(edited.reactions, { '❤️': 1 });
  assert.equal((await request(`${base}/api/groups/group_team/messages/${followup.id}`, { method: 'DELETE' })).status, 200);
  room = (await request(`${base}/api/groups/group_team/messages`)).body;
  assert.ok(room.find((message: any) => message.id === followup.id).deletedAt);
});
