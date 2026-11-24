import { db } from '../db.ts';
import { HttpError } from '../lib/validation.ts';
import { now } from '../lib/ids.ts';
import type { ChatMessage } from '../types.ts';

export function messageForBot(botId: string, messageId: string): ChatMessage {
  const row = db.prepare('SELECT * FROM messages WHERE id = ? AND bot_id = ?').get(messageId, botId) as Record<string, unknown> | undefined;
  if (!row) throw new HttpError(404, 'Message not found.');
  return { id: String(row.id), botId: String(row.bot_id), role: String(row.role) as ChatMessage['role'], content: String(row.content), toolName: row.tool_name ? String(row.tool_name) : undefined, toolCallId: row.tool_call_id ? String(row.tool_call_id) : undefined, toolCalls: row.tool_calls ? JSON.parse(String(row.tool_calls)) : undefined, runId: row.run_id ? String(row.run_id) : undefined, source: String(row.source) as ChatMessage['source'], createdAt: String(row.created_at), replyTo: row.reply_to ? String(row.reply_to) : undefined, reactions: JSON.parse(String(row.reactions ?? '{}')) as Record<string, number>, editedAt: row.edited_at ? String(row.edited_at) : undefined, deletedAt: row.deleted_at ? String(row.deleted_at) : undefined, pinnedAt: row.pinned_at ? String(row.pinned_at) : undefined };
}

export function editBotMessage(botId: string, messageId: string, content: string): void {
  const message = messageForBot(botId, messageId);
  if (message.role !== 'user' || message.deletedAt) throw new HttpError(409, 'Only your text messages can be edited.');
  const trimmed = content.trim();
  if (!trimmed || trimmed.length > 20_000) throw new HttpError(400, 'Enter a message between 1 and 20,000 characters.');
  db.prepare('UPDATE messages SET content = ?, edited_at = ? WHERE id = ? AND bot_id = ?').run(trimmed, now(), messageId, botId);
}

export function deleteBotMessage(botId: string, messageId: string): void {
  const message = messageForBot(botId, messageId);
  if (message.role === 'system') throw new HttpError(409, 'System messages cannot be deleted.');
  db.prepare("UPDATE messages SET content = 'This message was deleted.', deleted_at = ?, reactions = '{}' WHERE id = ? AND bot_id = ?").run(now(), messageId, botId);
}

export function reactToBotMessage(botId: string, messageId: string, emoji: string): void {
  const message = messageForBot(botId, messageId);
  if (message.deletedAt) throw new HttpError(409, 'Reactions cannot be added to deleted messages.');
  const allowed = new Set(['👍','❤️','😂','😮','😢','🙏']);
  if (!allowed.has(emoji)) throw new HttpError(400, 'Choose one of the supported reactions.');
  const reactions = { ...(message.reactions ?? {}) };
  if (reactions[emoji]) delete reactions[emoji];
  else reactions[emoji] = 1;
  db.prepare('UPDATE messages SET reactions = ? WHERE id = ? AND bot_id = ?').run(JSON.stringify(reactions), messageId, botId);
}

export function pinBotMessage(botId: string, messageId: string, pinned: boolean): void {
  const message = messageForBot(botId, messageId);
  if (message.deletedAt) throw new HttpError(409, 'Deleted messages cannot be pinned.');
  if (pinned) {
    const count = db.prepare('SELECT COUNT(*) AS count FROM messages WHERE bot_id = ? AND pinned_at IS NOT NULL').get(botId)!.count as number;
    if (!message.pinnedAt && count >= 4) throw new HttpError(409, 'Unpin a message first. Relay keeps at most four pinned messages per conversation.');
  }
  db.prepare('UPDATE messages SET pinned_at = ? WHERE id = ? AND bot_id = ?').run(pinned ? now() : null, messageId, botId);
}

export function replyToBotMessage(botId: string, messageId: string, replyTo?: string): void {
  if (replyTo && messageForBot(botId, replyTo).deletedAt) throw new HttpError(409, 'Replies must reference an available message.');
  db.prepare('UPDATE messages SET reply_to = ? WHERE id = ? AND bot_id = ?').run(replyTo ?? null, messageId, botId);
}
