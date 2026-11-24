import { db, toBot } from '../db.ts';
import { id, now } from '../lib/ids.ts';
import type { Approval, ChatMessage, Run, RunEvent } from '../types.ts';
import type { ModelMessage } from './providers.ts';

type Row = Record<string, unknown>;
const parse = (value: unknown): Record<string, unknown> => {
  try { return JSON.parse(String(value ?? '{}')) as Record<string, unknown>; } catch { return {}; }
};

export function createRun(botId: string, input: string, source: Run['source'], routineId?: string, groupId?: string, handoffDepth = 0): Run {
  const run = { id: id('run'), botId, status: 'running' as const, input, output: '', source, routineId, groupId, handoffDepth, steps: 0, modelCalls: 0, toolCalls: 0, usage: { inputTokens: 0, outputTokens: 0 }, startedAt: now() };
  db.prepare('INSERT INTO runs (id, bot_id, status, input, output, source, routine_id, group_id, handoff_depth, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(run.id, botId, run.status, input, run.output, source, routineId ?? null, groupId ?? null, handoffDepth, run.startedAt);
  return run;
}

export function getRun(runId: string): Run | undefined {
  const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as Row | undefined;
  if (!row) return undefined;
  return { id: String(row.id), botId: String(row.bot_id), status: String(row.status) as Run['status'], input: String(row.input), output: String(row.output), source: String(row.source) as Run['source'], routineId: row.routine_id ? String(row.routine_id) : undefined, groupId: row.group_id ? String(row.group_id) : undefined, handoffDepth: Number(row.handoff_depth ?? 0), steps: Number(row.steps), modelCalls: Number(row.model_calls), toolCalls: Number(row.tool_calls), usage: { inputTokens: Number(row.input_tokens), outputTokens: Number(row.output_tokens) }, error: row.error ? String(row.error) : undefined, startedAt: String(row.started_at), completedAt: row.completed_at ? String(row.completed_at) : undefined };
}

export function listRuns(botId: string, limit = 30): Run[] {
  return (db.prepare('SELECT id FROM runs WHERE bot_id = ? ORDER BY started_at DESC LIMIT ?').all(botId, limit) as Row[]).map((row) => getRun(String(row.id))!);
}

export function saveMessage(botId: string, message: ModelMessage & { runId?: string; source?: ChatMessage['source'] }): ChatMessage {
  const saved = { id: id('msg'), botId, role: message.role, content: message.content.slice(0, 50_000), toolName: message.toolName, toolCallId: message.toolCallId, toolCalls: message.toolCalls, runId: message.runId, source: message.source ?? 'chat', createdAt: now() };
  db.prepare('INSERT INTO messages (id, bot_id, role, content, tool_name, tool_call_id, tool_calls, run_id, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(saved.id, botId, saved.role, saved.content, saved.toolName ?? null, saved.toolCallId ?? null, saved.toolCalls ? JSON.stringify(saved.toolCalls) : null, saved.runId ?? null, saved.source, saved.createdAt);
  return saved;
}

export function listMessages(botId: string): ChatMessage[] {
  return (db.prepare('SELECT * FROM messages WHERE bot_id = ? AND role != ? ORDER BY created_at, rowid').all(botId, 'system') as Row[]).map((row) => ({ id: String(row.id), botId: String(row.bot_id), role: String(row.role) as ChatMessage['role'], content: String(row.content), toolName: row.tool_name ? String(row.tool_name) : undefined, toolCallId: row.tool_call_id ? String(row.tool_call_id) : undefined, toolCalls: row.tool_calls ? JSON.parse(String(row.tool_calls)) : undefined, runId: row.run_id ? String(row.run_id) : undefined, source: String(row.source) as ChatMessage['source'], replyTo: row.reply_to ? String(row.reply_to) : undefined, reactions: JSON.parse(String(row.reactions ?? '{}')) as Record<string, number>, editedAt: row.edited_at ? String(row.edited_at) : undefined, deletedAt: row.deleted_at ? String(row.deleted_at) : undefined, pinnedAt: row.pinned_at ? String(row.pinned_at) : undefined, createdAt: String(row.created_at) }));
}

export function recentModelMessages(botId: string, limit = 35): ModelMessage[] {
  const rows = db.prepare('SELECT role, content, tool_name, tool_call_id, tool_calls FROM messages WHERE bot_id = ? AND source != ? ORDER BY created_at DESC, rowid DESC LIMIT ?').all(botId, 'demo', limit) as Row[];
  const messages = rows.reverse().map((row) => ({ role: String(row.role) as ModelMessage['role'], content: String(row.content).slice(0, 20_000), toolName: row.tool_name ? String(row.tool_name) : undefined, toolCallId: row.tool_call_id ? String(row.tool_call_id) : undefined, toolCalls: row.tool_calls ? JSON.parse(String(row.tool_calls)) : undefined }));
  const firstUser = messages.findIndex((message) => message.role === 'user');
  const history = firstUser >= 0 ? messages.slice(firstUser) : messages.filter((message) => !message.toolCalls && message.role !== 'tool');
  const compacted: ModelMessage[] = [];
  for (const message of history) {
    if (message.role === 'tool') {
      const previous = compacted.at(-1);
      if (previous?.role === 'assistant') compacted.push({ role: 'user', content: `Tool result for ${message.toolName ?? message.toolCallId ?? 'tool'}: ${message.content}` });
      else if (previous) previous.content += `\n\nTool result for ${message.toolName ?? message.toolCallId ?? 'tool'}: ${message.content}`;
      continue;
    }
    const previous = compacted.at(-1);
    if (previous?.role === message.role) previous.content += `\n\n${message.content}`;
    else compacted.push({ role: message.role, content: message.content, toolCalls: message.toolCalls });
  }
  return compacted;
}

export function event(runId: string, type: RunEvent['type'], title: string, detail = '', metadata: Record<string, unknown> = {}): RunEvent {
  const saved = { id: id('evt'), runId, type, title, detail, metadata, createdAt: now() };
  db.prepare('INSERT INTO run_events (id, run_id, type, title, detail, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(saved.id, runId, type, title, detail, JSON.stringify(metadata), saved.createdAt);
  return saved;
}

export function listEvents(runId: string): RunEvent[] {
  return (db.prepare('SELECT * FROM run_events WHERE run_id = ? ORDER BY created_at, rowid').all(runId) as Row[]).map((row) => ({ id: String(row.id), runId: String(row.run_id), type: String(row.type) as RunEvent['type'], title: String(row.title), detail: String(row.detail), metadata: parse(row.metadata), createdAt: String(row.created_at) }));
}

export function updateRun(runId: string, fields: { status?: Run['status']; output?: string; error?: string; steps?: number; modelCalls?: number; toolCalls?: number; inputTokens?: number; outputTokens?: number }): void {
  const mapping: Record<string, string> = { status: 'status', output: 'output', error: 'error', steps: 'steps', modelCalls: 'model_calls', toolCalls: 'tool_calls', inputTokens: 'input_tokens', outputTokens: 'output_tokens' };
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
  if (!entries.length) return;
  const done = fields.status && ['completed', 'failed', 'cancelled'].includes(fields.status);
  db.prepare(`UPDATE runs SET ${entries.map(([key]) => `${mapping[key]} = ?`).join(', ')}${done ? ', completed_at = ?' : ''} WHERE id = ?`).run(...entries.map(([, value]) => value), ...(done ? [now()] : []), runId);
}

export function saveState(runId: string, state: unknown): void {
  db.prepare('INSERT INTO run_state (run_id, state) VALUES (?, ?) ON CONFLICT(run_id) DO UPDATE SET state = excluded.state').run(runId, JSON.stringify(state));
}
export function loadState(runId: string): unknown {
  const row = db.prepare('SELECT state FROM run_state WHERE run_id = ?').get(runId) as Row | undefined;
  return row ? parse(row.state) : undefined;
}

export function createApproval(runId: string, botId: string, toolCallId: string, toolName: string, toolId: string, args: Record<string, unknown>): Approval {
  const approval = { id: id('approval'), runId, botId, toolCallId, toolName, toolId, arguments: args, status: 'pending' as const, createdAt: now() };
  db.prepare('INSERT INTO approvals (id, run_id, bot_id, tool_call_id, tool_name, tool_id, arguments, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(approval.id, runId, botId, toolCallId, toolName, toolId, JSON.stringify(args), approval.status, approval.createdAt);
  return approval;
}

export function toApproval(row: Row): Approval {
  return { id: String(row.id), runId: String(row.run_id), botId: String(row.bot_id), toolCallId: String(row.tool_call_id), toolName: String(row.tool_name), toolId: String(row.tool_id), arguments: parse(row.arguments), status: String(row.status) as Approval['status'], createdAt: String(row.created_at), resolvedAt: row.resolved_at ? String(row.resolved_at) : undefined };
}
export function getApproval(approvalId: string): Approval | undefined {
  const row = db.prepare('SELECT * FROM approvals WHERE id = ?').get(approvalId) as Row | undefined;
  return row ? toApproval(row) : undefined;
}
export function pendingApprovals(botId?: string): Approval[] {
  const rows = (botId ? db.prepare('SELECT * FROM approvals WHERE bot_id = ? AND status = ? ORDER BY created_at').all(botId, 'pending') : db.prepare('SELECT * FROM approvals WHERE status = ? ORDER BY created_at').all('pending')) as Row[];
  return rows.map(toApproval);
}

export function getBotFromRun(runId: string) {
  const row = db.prepare('SELECT bots.* FROM bots JOIN runs ON runs.bot_id = bots.id WHERE runs.id = ?').get(runId) as Row | undefined;
  return row ? toBot(row) : undefined;
}
