import { db } from '../db.ts';
import { HttpError } from '../lib/validation.ts';
import { now } from '../lib/ids.ts';

function message(groupId: string, messageId: string): Record<string, unknown> {
  const row = db.prepare('SELECT * FROM group_messages WHERE id = ? AND group_id = ?').get(messageId, groupId) as Record<string, unknown> | undefined;
  if (!row) throw new HttpError(404, 'Message not found.');
  return row;
}

export function reactToGroupMessage(groupId: string, messageId: string, emoji: string): void {
  const row = message(groupId, messageId);
  if (row.deleted_at) throw new HttpError(409, 'Reactions cannot be added to deleted messages.');
  if (!['👍','❤️','😂','😮','😢','🙏'].includes(emoji)) throw new HttpError(400, 'Choose a supported reaction.');
  let reactions: Record<string, number> = {};
  try { reactions = JSON.parse(String(row.reactions ?? '{}')) as Record<string, number>; } catch { /* Reset malformed metadata. */ }
  if (reactions[emoji]) delete reactions[emoji]; else reactions[emoji] = 1;
  db.prepare('UPDATE group_messages SET reactions = ? WHERE id = ? AND group_id = ?').run(JSON.stringify(reactions), messageId, groupId);
}

export function replyToGroupMessage(groupId: string, messageId: string, replyTo: string): void {
  const target = message(groupId, messageId);
  const quoted = message(groupId, replyTo);
  if (target.role !== 'user' || target.deleted_at || quoted.deleted_at) throw new HttpError(409, 'Replies must reference an available message.');
  db.prepare('UPDATE group_messages SET reply_to = ? WHERE id = ? AND group_id = ?').run(replyTo, messageId, groupId);
}

export function editGroupMessage(groupId: string, messageId: string, content: string): void {
  const row = message(groupId, messageId);
  const trimmed = content.trim();
  if (row.role !== 'user' || row.deleted_at) throw new HttpError(409, 'Only your text messages can be edited.');
  if (!trimmed || trimmed.length > 20_000) throw new HttpError(400, 'Enter a message between 1 and 20,000 characters.');
  db.prepare('UPDATE group_messages SET content = ?, edited_at = ? WHERE id = ? AND group_id = ?').run(trimmed, now(), messageId, groupId);
}

export function deleteGroupMessage(groupId: string, messageId: string): void {
  const row = message(groupId, messageId);
  if (row.role === 'system') throw new HttpError(409, 'System messages cannot be deleted.');
  db.prepare("UPDATE group_messages SET content = 'This message was deleted.', deleted_at = ?, reactions = '{}' WHERE id = ? AND group_id = ?").run(now(), messageId, groupId);
}
