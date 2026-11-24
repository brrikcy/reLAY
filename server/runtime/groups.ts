import type { Response } from 'express';
import { db, getGroup, listBots, toGroupMessage } from '../db.ts';
import { HttpError } from '../lib/validation.ts';
import { id, now } from '../lib/ids.ts';
import { publishAll } from '../lib/events.ts';
import { startRun } from './agent.ts';
import { replyToGroupMessage } from './group-chat-actions.ts';
import type { Group, GroupMessage } from '../types.ts';

const subscribers = new Map<string, Set<Response>>();

export function publishGroupDelta(groupId: string, botId: string, messageId: string, text: string): void {
  const clients = subscribers.get(groupId);
  if (!clients) return;
  for (const client of clients) client.write(`event: group-delta\ndata: ${JSON.stringify({ botId, messageId, text })}\n\n`);
}

export function publishGroup(groupId: string): void {
  const clients = subscribers.get(groupId);
  if (!clients) return;
  for (const client of clients) client.write(`event: group\ndata: ${JSON.stringify({ updatedAt: now() })}\n\n`);
}

export function subscribeGroup(groupId: string, response: Response): () => void {
  const clients = subscribers.get(groupId) ?? new Set<Response>();
  clients.add(response);
  subscribers.set(groupId, clients);
  return () => { clients.delete(response); if (!clients.size) subscribers.delete(groupId); };
}

export function closeGroupSubscriptions(): void {
  for (const clients of subscribers.values()) for (const client of clients) client.end();
  subscribers.clear();
}

export function listGroupMessages(groupId: string): GroupMessage[] {
  return (db.prepare('SELECT * FROM group_messages WHERE group_id = ? ORDER BY created_at, rowid').all(groupId) as Array<Record<string, unknown>>).map(toGroupMessage);
}

export function requireGroup(groupId: string): Group {
  const group = getGroup(groupId);
  if (!group) throw new HttpError(404, 'Group room not found.');
  return group;
}

export function createGroup(name: string, botIds: string[], coordinatorId: string): Group {
  const unique = [...new Set(botIds)];
  if (unique.length < 2 || unique.length > 6) throw new HttpError(400, 'Choose between 2 and 6 bots for a shared room.');
  const bots = listBots();
  if (unique.some((botId) => !bots.some((bot) => bot.id === botId))) throw new HttpError(400, 'One of the selected bots no longer exists.');
  if (!unique.includes(coordinatorId)) throw new HttpError(400, 'The coordinator must be a member of the room.');
  const timestamp = now();
  const group = { id: id('group'), name: name.trim().slice(0, 100), botIds: unique, coordinatorId, createdAt: timestamp, updatedAt: timestamp };
  if (!group.name) throw new HttpError(400, 'Give the room a name.');
  db.prepare('INSERT INTO groups (id, name, bot_ids, coordinator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(group.id, group.name, JSON.stringify(unique), coordinatorId, timestamp, timestamp);
  db.prepare('INSERT INTO group_messages (id, group_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)').run(id('gmsg'), group.id, 'system', `Room created with ${unique.map((botId) => bots.find((bot) => bot.id === botId)?.name).join(', ')}. Mention a bot by name to direct the next reply, or ask everyone for a round of perspectives.`, timestamp);
  publishAll('workspace');
  return group;
}

export function sendGroupMessage(groupId: string, content: string, requestedBotIds: string[], inputMode: 'text' | 'voice', replyTo?: string): { runIds: string[] } {
  const group = requireGroup(groupId);
  if (!content.trim() || content.length > 20_000) throw new HttpError(400, 'Enter a group message between 1 and 20,000 characters.');
  const recipients = requestedBotIds.length ? [...new Set(requestedBotIds)] : [group.coordinatorId];
  if (recipients.some((botId) => !group.botIds.includes(botId))) throw new HttpError(400, 'You can only mention members of this room.');
  const messageId = id('gmsg');
  db.prepare('INSERT INTO group_messages (id, group_id, role, content, input_mode, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(messageId, groupId, 'user', content.trim(), inputMode, now());
  if (replyTo) replyToGroupMessage(groupId, messageId, replyTo);
  publishGroup(groupId);
  const runIds = recipients.map((botId) => startRun(botId, content.trim(), 'chat', undefined, groupId).id);
  publishAll('workspace');
  return { runIds };
}
