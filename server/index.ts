import express from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { db, getBot, getProvider, listBots, listGroups, toProvider, toTool, closeDatabase, initializeDatabase } from './db.ts';
import { botInput, memoryInput, providerInput, routineInput, toolInput } from './schemas.ts';
import { HttpError, validate } from './lib/validation.ts';
import { errorMessage, id, now } from './lib/ids.ts';
import { closeSubscriptions, publish, publishAll, subscribe } from './lib/events.ts';
import { closeGroupSubscriptions, createGroup, listGroupMessages, publishGroup, requireGroup, sendGroupMessage, subscribeGroup } from './runtime/groups.ts';
import type { Bot, Tool } from './types.ts';
import { addMemory, listMemories } from './runtime/memory.ts';
import { activeRunCount, handleDirectMessage, recoverInterruptedRuns, resolveApproval, startRun, stopAllRuns, stopRun } from './runtime/agent.ts';
import { getRun, listEvents, listMessages, listRuns, pendingApprovals, saveMessage } from './runtime/store.ts';
import { startScheduler, stopScheduler, tickRoutines } from './runtime/routines.ts';
import { WebSocketServer } from 'ws';
import { createVoiceSession, finishAudio, pushAudio, stopAllVoiceSessions, stopVoiceSession } from './runtime/transcription.ts';
import { listSkills, saveSkill } from './runtime/skills.ts';
import { listAttachments, createAttachment, decodeAttachment, deleteAttachment, getAttachment } from './runtime/attachments.ts';
import { budgetFor, configureBudget } from './runtime/budgets.ts';
import { createWebhookKey, triggerWebhook } from './runtime/routine-webhooks.ts';
import { listRoutineExecutions, nextRoutineTime } from './runtime/routine-execution.ts';
import { deleteProjectFile, listProjectFiles, readProjectFile, safeProjectPath } from './runtime/project.ts';
import { editBotMessage, deleteBotMessage, reactToBotMessage, replyToBotMessage, pinBotMessage } from './runtime/chat-actions.ts';
import { reactToGroupMessage, editGroupMessage, deleteGroupMessage } from './runtime/group-chat-actions.ts';

await initializeDatabase();
recoverInterruptedRuns();
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '8mb' }));
app.use((_request, response, next) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

const route = (handler: (request: Request, response: Response) => unknown | Promise<unknown>) => async (request: Request, response: Response, next: NextFunction) => {
  try { await handler(request, response); } catch (error) { next(error); }
};
const text = (value: unknown) => String(value ?? '');
const param = (request: Request, name: string): string => String(request.params[name]);
function publicTool(tool: Tool) { const { secretHeaders, ...safe } = tool; return { ...safe, hasSecrets: Object.keys(secretHeaders).length > 0 }; }
function toolById(toolId: string): Tool | undefined { const row = db.prepare('SELECT * FROM tools WHERE id = ?').get(toolId) as Record<string, unknown> | undefined; return row ? toTool(row) : undefined; }
function requireBot(botId: string): Bot { const bot = getBot(botId); if (!bot) throw new HttpError(404, 'Bot not found.'); return bot; }

app.get('/api/health', (_request, response) => response.json({ ok: true, name: 'Relay', activeRuns: activeRunCount() }));
app.get('/api/workspace', (_request, response) => {
  const providers = (db.prepare('SELECT * FROM providers ORDER BY created_at').all() as Array<Record<string, unknown>>).map(toProvider);
  const tools = (db.prepare('SELECT * FROM tools ORDER BY created_at').all() as Array<Record<string, unknown>>).map(toTool).map(publicTool);
  const routines = (db.prepare('SELECT * FROM routines ORDER BY created_at').all() as Array<Record<string, unknown>>).map((row) => ({ id: text(row.id), botId: text(row.bot_id), name: text(row.name), instruction: text(row.instruction), intervalMinutes: Number(row.interval_minutes), enabled: Boolean(row.enabled), triggerType: text(row.trigger_type), timezone: text(row.timezone), dailyTime: text(row.daily_time || '09:00'), hasWebhookKey: Boolean(row.webhook_key), lastRunAt: row.last_run_at ? text(row.last_run_at) : undefined, nextRunAt: text(row.next_run_at), createdAt: text(row.created_at) }));
  response.json({ bots: listBots(), providers, tools, memories: [], routines, groups: listGroups(), skills: listSkills(), budgets: listBots().map((bot) => budgetFor(bot.id)), activeRuns: [], approvalCount: pendingApprovals().length });
});

app.post('/api/bots', (request, response, next) => validate(botInput, request, response, next), route((request, response) => {
  const input = request.body as Bot;
  if (!getProvider(input.providerId)) throw new HttpError(400, 'Choose a valid model provider.');
  const timestamp = now();
  const botId = id('bot');
  db.prepare('INSERT INTO bots (id, name, role, description, instructions, color, provider_id, tool_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(botId, input.name, input.role, input.description, input.instructions, input.color, input.providerId, JSON.stringify(input.toolIds), timestamp, timestamp);
  publishAll('workspace');
  response.status(201).json(getBot(botId));
}));
app.patch('/api/bots/:id', (request, response, next) => validate(botInput, request, response, next), route((request, response) => {
  const botId = param(request, 'id');
  const input = request.body as Bot;
  requireBot(botId);
  if (!getProvider(input.providerId)) throw new HttpError(400, 'Choose a valid model provider.');
  for (const toolId of input.toolIds) if (!toolById(toolId)) throw new HttpError(400, 'One of the selected tools no longer exists.');
  db.prepare('UPDATE bots SET name = ?, role = ?, description = ?, instructions = ?, color = ?, provider_id = ?, tool_ids = ?, updated_at = ? WHERE id = ?').run(input.name, input.role, input.description, input.instructions, input.color, input.providerId, JSON.stringify(input.toolIds), now(), botId);
  publishAll('workspace');
  response.json(getBot(botId));
}));
app.delete('/api/bots/:id', route((request, response) => {
  const botId = param(request, 'id');
  const bot = requireBot(botId);
  if (bot.status === 'working' || bot.status === 'waiting') throw new HttpError(409, 'Stop this bot’s active run before deleting it.');
  const groups = listGroups();
  for (const group of groups) {
    const remaining = group.botIds.filter((memberId) => memberId !== botId);
    if (remaining.length < 2 || group.coordinatorId === botId) db.prepare('DELETE FROM groups WHERE id = ?').run(group.id);
    else db.prepare('UPDATE groups SET bot_ids = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(remaining), now(), group.id);
  }
  db.prepare('DELETE FROM bots WHERE id = ?').run(botId);
  publishAll('workspace');
  response.json({ ok: true });
}));
app.get('/api/bots/:id/messages', route((request, response) => { requireBot(param(request, 'id')); response.json(listMessages(param(request, 'id'))); }));
app.get('/api/bots/:id/runs', route((request, response) => { requireBot(param(request, 'id')); response.json(listRuns(param(request, 'id'))); }));
app.get('/api/bots/:id/memories', route((request, response) => { requireBot(param(request, 'id')); response.json(listMemories(param(request, 'id'))); }));
app.get('/api/bots/:id/approvals', route((request, response) => { requireBot(param(request, 'id')); response.json(pendingApprovals(param(request, 'id'))); }));
app.get('/api/bots/:id/events', route((request, response) => {
  const botId = param(request, 'id');
  requireBot(botId);
  response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  response.write('event: connected\ndata: {}\n\n');
  const unsubscribe = subscribe(botId, response);
  const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 20_000);
  request.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
}));

app.delete('/api/bots/:id/messages', route((request, response) => {
  const botId = param(request, 'id'); requireBot(botId);
  db.prepare('DELETE FROM messages WHERE bot_id = ?').run(botId);
  publish(botId, 'message');
  response.json({ ok: true });
}));
app.patch('/api/bots/:id/messages/:messageId', route((request, response) => {
  const botId = param(request, 'id');
  requireBot(botId);
  if (typeof request.body?.content !== 'string') throw new HttpError(400, 'Edited message text is required.');
  editBotMessage(botId, param(request, 'messageId'), request.body.content);
  response.json({ ok: true });
}));
app.delete('/api/bots/:id/messages/:messageId', route((request, response) => {
  const botId = param(request, 'id'); requireBot(botId);
  deleteBotMessage(botId, param(request, 'messageId'));
  response.json({ ok: true });
}));
app.post('/api/bots/:id/messages/:messageId/reaction', route((request, response) => {
  const botId = param(request, 'id'); requireBot(botId);
  reactToBotMessage(botId, param(request, 'messageId'), String(request.body?.emoji ?? ''));
  response.json({ ok: true });
}));
app.post('/api/bots/:id/messages/:messageId/reply', route((request, response) => {
  const botId = param(request, 'id'); requireBot(botId);
  replyToBotMessage(botId, param(request, 'messageId'), typeof request.body?.replyTo === 'string' ? request.body.replyTo : undefined);
  response.json({ ok: true });
}));
app.post('/api/bots/:id/messages/:messageId/pin', route((request, response) => {
  const botId = param(request, 'id'); requireBot(botId);
  if (typeof request.body?.pinned !== 'boolean') throw new HttpError(400, 'Specify whether to pin or unpin this message.');
  pinBotMessage(botId, param(request, 'messageId'), request.body.pinned);
  response.json({ ok: true });
}));
app.get('/api/bots/:id/allow-rules', route((request, response) => {
  const botId = param(request, 'id'); requireBot(botId);
  const rows = db.prepare('SELECT * FROM allow_rules WHERE bot_id = ? ORDER BY created_at').all(botId) as Array<Record<string, unknown>>;
  response.json(rows.map((r) => ({ id: text(r.id), botId: text(r.bot_id), toolName: text(r.tool_name), createdAt: text(r.created_at) })));
}));
app.post('/api/bots/:id/allow-rules', route((request, response) => {
  const botId = param(request, 'id'); requireBot(botId);
  if (typeof request.body?.toolName !== 'string' || !request.body.toolName.trim()) throw new HttpError(400, 'toolName is required.');
  const ruleId = id('rule'); const timestamp = now();
  db.prepare('INSERT INTO allow_rules (id, bot_id, tool_name, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(bot_id, tool_name) DO NOTHING').run(ruleId, botId, request.body.toolName.trim(), timestamp);
  response.json({ ok: true });
}));
app.delete('/api/allow-rules/:id', route((request, response) => {
  const result = db.prepare('DELETE FROM allow_rules WHERE id = ?').run(param(request, 'id'));
  if (!result.changes) throw new HttpError(404, 'Rule not found.');
  response.json({ ok: true });
}));
app.get('/api/skills', route((_request, response) => { response.json(listSkills()); }));
app.post('/api/skills', route((request, response) => {
  const { botId, name, description, instructions, shared } = request.body ?? {};
  if (typeof name !== 'string' || typeof description !== 'string' || typeof instructions !== 'string') throw new HttpError(400, 'name, description, and instructions are required.');
  if (botId) requireBot(botId);
  response.status(201).json(saveSkill(botId ?? 'shared', { name, description, instructions, shared: Boolean(shared) }));
}));
app.patch('/api/skills/:id', route((request, response) => {
  const { name, description, instructions } = request.body ?? {};
  const existing = db.prepare('SELECT * FROM skills WHERE id = ?').get(param(request, 'id')) as Record<string, unknown> | undefined;
  if (!existing) throw new HttpError(404, 'Skill not found.');
  db.prepare('UPDATE skills SET name = ?, description = ?, instructions = ?, updated_at = ? WHERE id = ?').run(name ?? existing.name, description ?? existing.description, instructions ?? existing.instructions, now(), param(request, 'id'));
  publishAll('workspace');
  response.json({ ok: true });
}));
app.delete('/api/skills/:id', route((request, response) => {
  const result = db.prepare('DELETE FROM skills WHERE id = ?').run(param(request, 'id'));
  if (!result.changes) throw new HttpError(404, 'Skill not found.');
  publishAll('workspace');
  response.json({ ok: true });
}));
app.post('/api/bots/:id/messages', route((request, response) => {
  const botId = param(request, 'id');
  requireBot(botId);
  const input = request.body?.message;
  if (typeof input !== 'string' || !input.trim() || input.length > 20_000) throw new HttpError(400, 'Enter a message between 1 and 20,000 characters.');
  const direct = handleDirectMessage(botId, input.trim());
  if (direct) {
    const userMessage = saveMessage(botId, { role: 'user', content: input.trim(), source: 'chat' });
    if (typeof request.body.replyTo === 'string') replyToBotMessage(botId, userMessage.id, request.body.replyTo);
    saveMessage(botId, { role: 'assistant', content: direct, source: 'chat' });
    publish(botId, 'message');
    publishAll('workspace');
    response.status(201).json({ direct: true, response: direct });
    return;
  }
  const run = startRun(botId, input.trim(), 'chat', undefined, undefined, 0, typeof request.body.replyTo === 'string' ? request.body.replyTo : undefined);
  response.status(202).json(run);
}));
app.get('/api/search', route((request, response) => {
  const query = typeof request.query.q === 'string' ? request.query.q.trim().slice(0, 200) : '';
  if (query.length < 2) { response.json([]); return; }
  const like = `%${query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
  const direct = db.prepare("SELECT id, bot_id, role, content, run_id, source, created_at FROM messages WHERE content LIKE ? ESCAPE '\\' AND role != 'system' ORDER BY created_at DESC LIMIT 80").all(like) as Array<Record<string, unknown>>;
  const group = db.prepare("SELECT id, group_id, bot_id, role, content, run_id, created_at FROM group_messages WHERE content LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT 80").all(like) as Array<Record<string, unknown>>;
  const results = [
    ...direct.map((row) => ({ id: text(row.id), botId: text(row.bot_id), botName: getBot(text(row.bot_id))?.name ?? 'Former bot', role: text(row.role), content: text(row.content), runId: row.run_id ? text(row.run_id) : undefined, source: text(row.source), createdAt: text(row.created_at) })),
    ...group.map((row) => ({ id: text(row.id), botId: text(row.bot_id), groupId: text(row.group_id), botName: getBot(text(row.bot_id))?.name ?? 'Team', role: text(row.role), content: text(row.content), runId: row.run_id ? text(row.run_id) : undefined, source: 'group', createdAt: text(row.created_at) })),
  ];
  results.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  response.json(results.slice(0, 100));
}));
app.get('/api/groups/:id/export', route((request, response) => {
  const group = requireGroup(param(request, 'id'));
  const messages = listGroupMessages(group.id);
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Content-Disposition', `attachment; filename="relay-${group.id}-conversation.json"`);
  response.send(JSON.stringify({ group, messages, exportedAt: now() }, null, 2));
}));
app.get('/api/bots/:id/export', route((request, response) => {
  const bot = requireBot(param(request, 'id'));
  const messages = listMessages(bot.id);
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Content-Disposition', `attachment; filename="relay-${bot.id}-conversation.json"`);
  response.send(JSON.stringify({ bot, messages, exportedAt: now() }, null, 2));
}));
app.get('/api/group-search', route((request, response) => {
  const query = typeof request.query.q === 'string' ? request.query.q.trim().slice(0, 200) : '';
  if (query.length < 2) { response.json([]); return; }
  const like = `%${query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
  const rows = db.prepare("SELECT id, group_id, bot_id, role, content, run_id, created_at FROM group_messages WHERE content LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT 80").all(like) as Array<Record<string, unknown>>;
  response.json(rows.map((row) => ({ id: text(row.id), botId: text(row.bot_id), botName: getBot(text(row.bot_id))?.name ?? 'Team', groupId: text(row.group_id), role: text(row.role), content: text(row.content), runId: row.run_id ? text(row.run_id) : undefined, source: 'group', createdAt: text(row.created_at) })));
}));
app.get('/api/history', route((_request, response) => {
  const rows = db.prepare('SELECT id, bot_id, status, input, output, source, group_id, steps, model_calls, tool_calls, started_at, completed_at FROM runs ORDER BY started_at DESC LIMIT 100').all() as Array<Record<string, unknown>>;
  response.json(rows.map((row) => ({ id: text(row.id), botId: text(row.bot_id), botName: getBot(text(row.bot_id))?.name ?? 'Former bot', status: text(row.status), input: text(row.input), output: text(row.output), source: text(row.source), groupId: row.group_id ? text(row.group_id) : undefined, steps: Number(row.steps), modelCalls: Number(row.model_calls), toolCalls: Number(row.tool_calls), startedAt: text(row.started_at), completedAt: row.completed_at ? text(row.completed_at) : undefined })));
}));
app.post('/api/routines/:id/webhook-key', route((request, response) => {
  const routineId = param(request, 'id');
  const row = db.prepare('SELECT id FROM routines WHERE id = ?').get(routineId);
  if (!row) throw new HttpError(404, 'Routine not found.');
  response.json({ key: createWebhookKey(routineId), url: `/api/routines/${routineId}/webhook` });
}));
app.post('/api/routines/:id/webhook', route((request, response) => {
  response.status(202).json(triggerWebhook(param(request, 'id'), request.headers.authorization, request.body));
}));
app.get('/api/routines/:id/executions', route((request, response) => {
  const routineId = param(request, 'id');
  if (!db.prepare('SELECT id FROM routines WHERE id = ?').get(routineId)) throw new HttpError(404, 'Routine not found.');
  response.json(listRoutineExecutions(routineId));
}));
app.get('/api/bots/:id/budget', route((request, response) => { requireBot(param(request, 'id')); response.json(budgetFor(param(request, 'id'))); }));
app.patch('/api/bots/:id/budget', route((request, response) => {
  const botId = param(request, 'id'); requireBot(botId);
  const { maxRunsPerDay, maxTokensPerDay, maxToolCallsPerDay } = request.body ?? {};
  response.json(configureBudget(botId, Number(maxRunsPerDay), Number(maxTokensPerDay), Number(maxToolCallsPerDay)));
}));
app.get('/api/bots/:id/attachments', route((request, response) => { requireBot(param(request, 'id')); response.json(listAttachments({ botId: param(request, 'id') })); }));
app.post('/api/bots/:id/attachments', route(async (request, response) => {
  const botId = param(request, 'id'); requireBot(botId);
  const { name, mime, content } = request.body ?? {};
  if (typeof name !== 'string' || typeof mime !== 'string' || typeof content !== 'string') throw new HttpError(400, 'Attachment name, MIME type, and text/base64 content are required.');
  response.status(201).json(await createAttachment({ botId, name, mime, content: decodeAttachment(content, request.body.encoding) }));
}));
app.get('/api/bots/:id/attachments/:attachmentId/download', route((request, response) => {
  const botId = param(request, 'id'); requireBot(botId);
  const attachment = getAttachment(param(request, 'attachmentId'), { botId });
  const text = attachment.text || 'This image was registered for reference only. Relay has not interpreted its pixels.\r\n';
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.setHeader('Content-Disposition', `attachment; filename="${attachment.name.replace(/[^a-zA-Z0-9_. -]/g, '')}.txt"`);
  response.send(text);
}));
app.delete('/api/bots/:id/attachments/:attachmentId', route((request, response) => {
  const botId = param(request, 'id'); requireBot(botId);
  deleteAttachment(param(request, 'attachmentId'), { botId });
  response.json({ ok: true });
}));
app.get('/api/groups/:id/attachments', route((request, response) => { requireGroup(param(request, 'id')); response.json(listAttachments({ groupId: param(request, 'id') })); }));
app.post('/api/groups/:id/attachments', route(async (request, response) => {
  const groupId = param(request, 'id'); requireGroup(groupId);
  const { name, mime, content } = request.body ?? {};
  if (typeof name !== 'string' || typeof mime !== 'string' || typeof content !== 'string') throw new HttpError(400, 'Attachment name, MIME type, and text/base64 content are required.');
  response.status(201).json(await createAttachment({ groupId, name, mime, content: decodeAttachment(content, request.body.encoding) }));
}));
app.get('/api/groups/:id/attachments/:attachmentId/download', route((request, response) => {
  const groupId = param(request, 'id'); requireGroup(groupId);
  const attachment = getAttachment(param(request, 'attachmentId'), { groupId });
  const text = attachment.text || 'This image was registered for reference only. Relay has not interpreted its pixels.\r\n';
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.setHeader('Content-Disposition', `attachment; filename="${attachment.name.replace(/[^a-zA-Z0-9_. -]/g, '')}.txt"`);
  response.send(text);
}));
app.delete('/api/groups/:id/attachments/:attachmentId', route((request, response) => {
  const groupId = param(request, 'id'); requireGroup(groupId);
  deleteAttachment(param(request, 'attachmentId'), { groupId });
  response.json({ ok: true });
}));
app.get('/api/workspace/files', route(async (_request, response) => response.json(await listProjectFiles())));
app.get('/api/workspace/files/:path/download', route((request, response) => {
  const target = safeProjectPath(param(request, 'path'));
  response.download(target, param(request, 'path').split('/').at(-1) ?? 'artifact.txt');
}));
app.get('/api/workspace/files/:path', route(async (request, response) => response.json(await readProjectFile(param(request, 'path')))));
app.delete('/api/workspace/files/:path', route(async (request, response) => { await deleteProjectFile(param(request, 'path')); response.json({ ok: true }); }));

app.post('/api/groups', route((request, response) => {
  const { name, botIds, coordinatorId } = request.body ?? {};
  if (typeof name !== 'string' || !Array.isArray(botIds) || typeof coordinatorId !== 'string') throw new HttpError(400, 'Room name, member IDs, and coordinator are required.');
  response.status(201).json(createGroup(name, botIds, coordinatorId));
}));
app.get('/api/groups/:id/messages', route((request, response) => { requireGroup(param(request, 'id')); response.json(listGroupMessages(param(request, 'id'))); }));
app.get('/api/groups/:id/approvals', route((request, response) => {
  const group = requireGroup(param(request, 'id'));
  const placeholders = group.botIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM approvals WHERE bot_id IN (${placeholders}) AND status = 'pending' ORDER BY created_at`).all(...group.botIds) as Array<Record<string, unknown>>;
  response.json(rows.map((row) => ({ id: text(row.id), runId: text(row.run_id), botId: text(row.bot_id), toolCallId: text(row.tool_call_id), toolName: text(row.tool_name), toolId: text(row.tool_id), arguments: JSON.parse(text(row.arguments)), status: text(row.status), createdAt: text(row.created_at), resolvedAt: row.resolved_at ? text(row.resolved_at) : undefined })));
}));
app.patch('/api/groups/:id/messages/:messageId', route((request, response) => {
  const groupId = param(request, 'id'); requireGroup(groupId);
  if (typeof request.body?.content !== 'string') throw new HttpError(400, 'Edited message text is required.');
  editGroupMessage(groupId, param(request, 'messageId'), request.body.content);
  publishGroup(groupId); response.json({ ok: true });
}));
app.delete('/api/groups/:id/messages/:messageId', route((request, response) => {
  const groupId = param(request, 'id'); requireGroup(groupId);
  deleteGroupMessage(groupId, param(request, 'messageId'));
  publishGroup(groupId); response.json({ ok: true });
}));
app.post('/api/groups/:id/messages/:messageId/reaction', route((request, response) => {
  const groupId = param(request, 'id'); requireGroup(groupId);
  reactToGroupMessage(groupId, param(request, 'messageId'), String(request.body?.emoji ?? ''));
  publishGroup(groupId); response.json({ ok: true });
}));
app.get('/api/groups/:id/events', route((request, response) => {
  const groupId = param(request, 'id'); requireGroup(groupId);
  response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  response.write('event: connected\ndata: {}\n\n');
  const unsubscribe = subscribeGroup(groupId, response);
  const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 20_000);
  request.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
}));
app.post('/api/groups/:id/messages', route((request, response) => {
  const inputMode = request.body?.inputMode === 'voice' ? 'voice' : 'text';
  if (typeof request.body?.message !== 'string' || (request.body.botIds !== undefined && !Array.isArray(request.body.botIds))) throw new HttpError(400, 'Enter a valid group message.');
  response.status(202).json(sendGroupMessage(param(request, 'id'), request.body.message, request.body.botIds ?? [], inputMode, typeof request.body.replyTo === 'string' ? request.body.replyTo : undefined));
}));
app.post('/api/groups/:id/system', route(async (request, response) => {
  const groupId = param(request, 'id'); requireGroup(groupId);
  if (typeof request.body?.content !== 'string' || !request.body.content.trim() || request.body.content.length > 500) throw new HttpError(400, 'System notice must be between 1 and 500 characters.');
  const { addGroupSystemMessage } = await import('./runtime/agent.ts');
  addGroupSystemMessage(groupId, request.body.content.trim());
  response.json({ ok: true });
}));
app.delete('/api/groups/:id', route((request, response) => {
  const groupId = param(request, 'id'); requireGroup(groupId);
  const active = db.prepare("SELECT id FROM runs WHERE group_id = ? AND status IN ('running', 'waiting')").get(groupId);
  if (active) throw new HttpError(409, 'Wait for active room work to finish before deleting this room.');
  db.prepare('DELETE FROM groups WHERE id = ?').run(groupId);
  publishGroup(groupId);
  publishAll('workspace');
  response.json({ ok: true });
}));
app.get('/api/tools/:id/health', route(async (request, response) => {
  const tool = toolById(param(request, 'id'));
  if (!tool) throw new HttpError(404, 'Tool not found.');
  if (!tool.builtin) throw new HttpError(400, 'Health checks are available for built-in read-only tools.');
  const args = tool.name === 'fetch_webpage' ? { url: 'https://en.wikipedia.org/wiki/Amazon_Bedrock' } : tool.name === 'get_weather' ? { latitude: 1.3521, longitude: 103.8198 } : tool.name === 'geocode_city' ? { name: 'Singapore' } : tool.name === 'search_wikipedia' || tool.name === 'search_news' ? { query: 'Amazon Bedrock' } : tool.name === 'lookup_country' ? { name: 'Singapore' } : tool.name === 'get_exchange_rates' ? { base: 'USD', symbols: 'SGD' } : { year: new Date().getFullYear(), countryCode: 'SG' };
  const { executeHttpTool } = await import('./runtime/tools.ts');
  const result = await executeHttpTool(tool, args);
  response.json({ ok: true, name: tool.name, status: result.status, checkedAt: now(), sample: result.data });
}));

app.post('/api/runs/:id/stop', route((request, response) => { stopRun(param(request, 'id')); response.json({ ok: true }); }));
app.get('/api/runs/:id', route((request, response) => { const run = getRun(param(request, 'id')); if (!run) throw new HttpError(404, 'Run not found.'); response.json(run); }));
app.get('/api/runs/:id/events', route((request, response) => { if (!getRun(param(request, 'id'))) throw new HttpError(404, 'Run not found.'); response.json(listEvents(param(request, 'id'))); }));
app.post('/api/approvals/:id', route(async (request, response) => {
  const decision = request.body?.decision;
  if (!['approved', 'denied'].includes(decision)) throw new HttpError(400, 'Decision must be approved or denied.');
  await resolveApproval(param(request, 'id'), decision);
  response.json({ ok: true });
}));

app.post('/api/providers', (request, response, next) => validate(providerInput, request, response, next), route((request, response) => {
  const input = request.body;
  const timestamp = now();
  const providerId = id('provider');
  db.prepare('INSERT INTO providers (id, name, kind, base_url, api_style, model, temperature, max_steps, api_key, key_hint, max_tokens, aws_region, aws_profile, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(providerId, input.name, input.kind, input.baseUrl, input.apiStyle, input.model, input.temperature, input.maxSteps, input.apiKey ?? '', input.apiKey ? `••••${input.apiKey.slice(-4)}` : '', input.maxTokens, input.awsRegion, input.awsProfile, timestamp, timestamp);
  publishAll('workspace');
  response.status(201).json(toProvider(db.prepare('SELECT * FROM providers WHERE id = ?').get(providerId) as Record<string, unknown>));
}));
app.patch('/api/providers/:id', (request, response, next) => validate(providerInput, request, response, next), route((request, response) => {
  const providerId = param(request, 'id');
  const existing = getProvider(providerId);
  if (!existing || existing.kind === 'demo') throw new HttpError(404, 'Editable provider not found.');
  const input = request.body;
  const key = input.apiKey || existing.apiKey;
  db.prepare('UPDATE providers SET name = ?, kind = ?, base_url = ?, api_style = ?, model = ?, temperature = ?, max_steps = ?, api_key = ?, key_hint = ?, max_tokens = ?, aws_region = ?, aws_profile = ?, updated_at = ? WHERE id = ?').run(input.name, input.kind, input.baseUrl, input.apiStyle, input.model, input.temperature, input.maxSteps, key, key ? `••••${key.slice(-4)}` : '', input.maxTokens, input.awsRegion, input.awsProfile, now(), providerId);
  publishAll('workspace');
  response.json(toProvider(db.prepare('SELECT * FROM providers WHERE id = ?').get(providerId) as Record<string, unknown>));
}));
app.delete('/api/providers/:id', route((request, response) => {
  const providerId = param(request, 'id');
  if (['demo', 'xai', 'openai'].includes(providerId)) throw new HttpError(400, 'Built-in providers can be edited but not deleted.');
  const assigned = listBots().find((bot) => bot.providerId === providerId);
  if (assigned) throw new HttpError(409, `Reassign ${assigned.name} before deleting this provider.`);
  db.prepare('DELETE FROM providers WHERE id = ?').run(providerId);
  publishAll('workspace');
  response.json({ ok: true });
}));

app.post('/api/tools', (request, response, next) => validate(toolInput, request, response, next), route((request, response) => {
  const input = request.body;
  const timestamp = now();
  const toolId = id('tool');
  try { db.prepare('INSERT INTO tools (id, name, description, method, url, headers, secret_headers, parameters, permission, enabled, timeout_ms, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(toolId, input.name, input.description, input.method, input.url, JSON.stringify(input.headers), JSON.stringify(input.secretHeaders), JSON.stringify(input.parameters), input.permission, input.enabled ? 1 : 0, input.timeoutMs, timestamp, timestamp); }
  catch (error) { if (errorMessage(error).includes('UNIQUE')) throw new HttpError(409, 'A tool with this name already exists.'); throw error; }
  publishAll('workspace');
  response.status(201).json(publicTool(toolById(toolId)!));
}));
app.patch('/api/tools/:id', (request, response, next) => validate(toolInput, request, response, next), route((request, response) => {
  const toolId = param(request, 'id');
  const existing = toolById(toolId);
  if (!existing) throw new HttpError(404, 'Tool not found.');
  const input = request.body;
  const secrets = { ...existing.secretHeaders };
  for (const [key, value] of Object.entries(input.secretHeaders as Record<string, string>)) { if (value) secrets[key] = value; else delete secrets[key]; }
  db.prepare('UPDATE tools SET name = ?, description = ?, method = ?, url = ?, headers = ?, secret_headers = ?, parameters = ?, permission = ?, enabled = ?, timeout_ms = ?, updated_at = ? WHERE id = ?').run(input.name, input.description, input.method, input.url, JSON.stringify(input.headers), JSON.stringify(secrets), JSON.stringify(input.parameters), input.permission, input.enabled ? 1 : 0, input.timeoutMs, now(), toolId);
  publishAll('workspace');
  response.json(publicTool(toolById(toolId)!));
}));
app.delete('/api/tools/:id', route((request, response) => {
  const toolId = param(request, 'id');
  const existing = toolById(toolId);
  if (!existing) throw new HttpError(404, 'Tool not found.');
  const assigned = listBots().filter((bot) => bot.toolIds.includes(toolId));
  if (assigned.length) throw new HttpError(409, `Disconnect this tool from ${assigned.map((bot) => bot.name).join(', ')} first.`);
  db.prepare('DELETE FROM tools WHERE id = ?').run(toolId);
  publishAll('workspace');
  response.json({ ok: true });
}));

app.post('/api/bots/:id/memories', (request, response, next) => validate(memoryInput, request, response, next), route((request, response) => {
  const botId = param(request, 'id'); requireBot(botId);
  response.status(201).json(addMemory(botId, request.body.content, request.body.category, request.body.source));
}));
app.delete('/api/memories/:id', route((request, response) => {
  const result = db.prepare('DELETE FROM memories WHERE id = ?').run(param(request, 'id'));
  if (!result.changes) throw new HttpError(404, 'Memory not found.');
  response.json({ ok: true });
}));

app.post('/api/bots/:id/routines', (request, response, next) => validate(routineInput, request, response, next), route((request, response) => {
  const botId = param(request, 'id'); requireBot(botId);
  const input = request.body;
  const timestamp = now();
  const routineId = id('routine');
  db.prepare('INSERT INTO routines (id, bot_id, name, instruction, interval_minutes, enabled, trigger_type, timezone, daily_time, next_run_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(routineId, botId, input.name, input.instruction, input.intervalMinutes, input.enabled ? 1 : 0, input.triggerType, input.timezone, input.dailyTime, input.triggerType === 'daily' ? nextRoutineTime(input) : new Date(Date.now() + input.intervalMinutes * 60_000).toISOString(), timestamp);
  publishAll('workspace');
  response.status(201).json({ id: routineId });
}));
app.patch('/api/routines/:id', route((request, response) => {
  const routineId = param(request, 'id');
  const existing = db.prepare('SELECT * FROM routines WHERE id = ?').get(routineId) as Record<string, unknown> | undefined;
  if (!existing) throw new HttpError(404, 'Routine not found.');
  const input = { name: request.body.name ?? text(existing.name), instruction: request.body.instruction ?? text(existing.instruction), intervalMinutes: request.body.intervalMinutes ?? Number(existing.interval_minutes), triggerType: request.body.triggerType ?? text(existing.trigger_type), timezone: request.body.timezone ?? text(existing.timezone), dailyTime: request.body.dailyTime ?? text(existing.daily_time || '09:00'), enabled: request.body.enabled ?? Boolean(existing.enabled) };
  const result = routineInput.safeParse(input);
  if (!result.success) throw new HttpError(400, result.error.issues.map((issue) => issue.message).join('; '));
  db.prepare('UPDATE routines SET name = ?, instruction = ?, interval_minutes = ?, trigger_type = ?, timezone = ?, daily_time = ?, enabled = ?, next_run_at = ? WHERE id = ?').run(result.data.name, result.data.instruction, result.data.intervalMinutes, result.data.triggerType, result.data.timezone, result.data.dailyTime, result.data.enabled ? 1 : 0, nextRoutineTime(result.data), routineId);
  publishAll('workspace');
  response.json({ ok: true });
}));
app.post('/api/routines/:id/test', route((request, response) => {
  const routineId = param(request, 'id');
  const row = db.prepare('SELECT * FROM routines WHERE id = ?').get(routineId) as Record<string, unknown> | undefined;
  if (!row) throw new HttpError(404, 'Routine not found.');
  const timestamp = now();
  db.prepare('UPDATE routines SET last_run_at = ?, next_run_at = ? WHERE id = ?').run(timestamp, new Date(Date.now() + Number(row.interval_minutes) * 60_000).toISOString(), routineId);
  response.status(202).json(startRun(text(row.bot_id), text(row.instruction), 'routine', routineId));
}));
app.delete('/api/routines/:id', route((request, response) => {
  const result = db.prepare('DELETE FROM routines WHERE id = ?').run(param(request, 'id'));
  if (!result.changes) throw new HttpError(404, 'Routine not found.');
  publishAll('workspace');
  response.json({ ok: true });
}));

app.use('/api', (_request, response) => response.status(404).json({ error: 'API route not found.' }));
const dist = resolve('./dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('/{*splat}', (_request, response) => response.sendFile(resolve(dist, 'index.html')));
}
app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (response.headersSent) return;
  const status = error instanceof HttpError ? error.status : 500;
  if (status === 500) console.error(error);
  response.status(status).json({ error: status === 500 ? 'Something went wrong on the Relay server.' : errorMessage(error) });
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 128_000 });
wss.on('connection', (socket) => {
  let sessionId = '';
  let starting = false;
  socket.on('message', (data, isBinary) => {
    if (isBinary) { if (sessionId) pushAudio(sessionId, new Uint8Array(data as Buffer).buffer as ArrayBuffer); return; }
    try {
      const message = JSON.parse(data.toString()) as { type?: string; sampleRate?: number };
      if (message.type === 'start' && !sessionId && !starting) {
        starting = true;
        if (message.sampleRate !== 16000) throw new Error('Audio must be 16 kHz PCM.');
        socket.send(JSON.stringify({ type: 'starting' }));
        void createVoiceSession(socket, process.env.AWS_REGION || 'us-east-1', process.env.AWS_PROFILE || 'bedrock').then((created) => { sessionId = created; socket.send(JSON.stringify({ type: 'ready', sessionId })); }).catch((error) => { socket.send(JSON.stringify({ type: 'error', message: errorMessage(error) })); socket.close(); }).finally(() => { starting = false; });
      }
      if (message.type === 'finish' && sessionId) finishAudio(sessionId);
      if (message.type === 'stop' && sessionId) stopVoiceSession(sessionId);
    } catch { socket.send(JSON.stringify({ type: 'error', message: 'Invalid voice connection message.' })); }
  });
  socket.on('close', () => { if (sessionId) stopVoiceSession(sessionId); });
  socket.on('error', () => { if (sessionId) stopVoiceSession(sessionId); });
});

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';
const server = app.listen(port, host, () => {
  console.log(`\n  Relay is ready → http://${host}:${port}\n  Local data → ${process.env.RELAY_DATA_FILE ?? './data/relay.db'}\n`);
  startScheduler();
  tickRoutines();
});
server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
  if (url.pathname !== '/api/voice/stream') { socket.destroy(); return; }
  const expectedOrigin = `http://${request.headers.host}`;
  const origin = request.headers.origin;
  if (origin && origin !== expectedOrigin && origin !== 'http://localhost:8787' && origin !== 'http://127.0.0.1:8787' && origin !== 'http://localhost:5173' && origin !== 'http://127.0.0.1:5173') { socket.destroy(); return; }
  wss.handleUpgrade(request, socket, head, (client) => wss.emit('connection', client, request));
});
function shutdown(): void {
  stopScheduler();
  stopAllRuns();
  closeSubscriptions();
  closeGroupSubscriptions();
  stopAllVoiceSessions();
  wss.close();
  server.close(() => { closeDatabase(); process.exit(0); });
  server.closeAllConnections();
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
