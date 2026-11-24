import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Bot, Group, GroupMessage, Provider, Tool } from './types.ts';
import { id, now } from './lib/ids.ts';

const file = resolve(process.env.RELAY_DATA_FILE ?? './data/relay.db');
mkdirSync(dirname(file), { recursive: true });

export const db = new DatabaseSync(file);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
  CREATE TABLE IF NOT EXISTS bots (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    instructions TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#ee6c45', provider_id TEXT NOT NULL DEFAULT 'demo',
    tool_ids TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'idle',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, base_url TEXT NOT NULL DEFAULT '',
    api_style TEXT NOT NULL DEFAULT 'chat', model TEXT NOT NULL, temperature REAL NOT NULL DEFAULT 0.2,
    max_steps INTEGER NOT NULL DEFAULT 6, api_key TEXT NOT NULL DEFAULT '', key_hint TEXT NOT NULL DEFAULT '',
    max_tokens INTEGER NOT NULL DEFAULT 2048, aws_region TEXT NOT NULL DEFAULT '', aws_profile TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tools (
    id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL, method TEXT NOT NULL,
    url TEXT NOT NULL, headers TEXT NOT NULL DEFAULT '{}', secret_headers TEXT NOT NULL DEFAULT '{}',
    parameters TEXT NOT NULL, permission TEXT NOT NULL DEFAULT 'approval', enabled INTEGER NOT NULL DEFAULT 1, builtin INTEGER NOT NULL DEFAULT 0,
    timeout_ms INTEGER NOT NULL DEFAULT 15000, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    role TEXT NOT NULL, content TEXT NOT NULL, tool_name TEXT, tool_call_id TEXT, tool_calls TEXT,
    run_id TEXT, source TEXT NOT NULL DEFAULT 'chat', created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS messages_bot_idx ON messages(bot_id, created_at);
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    content TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'fact', source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS memories_bot_idx ON memories(bot_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    status TEXT NOT NULL, input TEXT NOT NULL, output TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'chat',
    routine_id TEXT, steps INTEGER NOT NULL DEFAULT 0, model_calls INTEGER NOT NULL DEFAULT 0,
    tool_calls INTEGER NOT NULL DEFAULT 0, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
    error TEXT, started_at TEXT NOT NULL, completed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS runs_bot_idx ON runs(bot_id, started_at DESC);
  CREATE TABLE IF NOT EXISTS run_events (
    id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    type TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS events_run_idx ON run_events(run_id, created_at);
  CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, tool_call_id TEXT NOT NULL,
    tool_name TEXT NOT NULL, tool_id TEXT NOT NULL, arguments TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, resolved_at TEXT
  );
  CREATE TABLE IF NOT EXISTS run_state (
    run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE, state TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS routines (
    id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    name TEXT NOT NULL, instruction TEXT NOT NULL, interval_minutes INTEGER NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0, last_run_at TEXT, next_run_at TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, bot_ids TEXT NOT NULL, coordinator_id TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS allow_rules (
    id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    tool_name TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE(bot_id, tool_name)
  );
  CREATE TABLE IF NOT EXISTS group_messages (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    bot_id TEXT REFERENCES bots(id) ON DELETE CASCADE, role TEXT NOT NULL, content TEXT NOT NULL,
    run_id TEXT, input_mode TEXT NOT NULL DEFAULT 'text', status TEXT NOT NULL DEFAULT 'completed',
    metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS group_messages_idx ON group_messages(group_id, created_at);
  CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL, instructions TEXT NOT NULL,
    bot_ids TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS project_files (
    path TEXT PRIMARY KEY, content TEXT NOT NULL, updated_at TEXT NOT NULL, size INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY, bot_id TEXT, group_id TEXT, name TEXT NOT NULL, mime TEXT NOT NULL,
    size INTEGER NOT NULL, text TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS attachments_bot_idx ON attachments(bot_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS budgets (
    bot_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE,
    max_runs_per_day INTEGER NOT NULL DEFAULT 50, max_tokens_per_day INTEGER NOT NULL DEFAULT 100000,
    max_tool_calls_per_day INTEGER NOT NULL DEFAULT 200, date TEXT NOT NULL,
    used_runs INTEGER NOT NULL DEFAULT 0, used_input_tokens INTEGER NOT NULL DEFAULT 0,
    used_output_tokens INTEGER NOT NULL DEFAULT 0, used_tool_calls INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS routine_runs (
    id TEXT PRIMARY KEY, routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
    trigger_type TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}',
    event_id TEXT, event_fingerprint TEXT, run_id TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT,
    error TEXT, started_at TEXT NOT NULL, completed_at TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS routine_event_idx ON routine_runs(routine_id, event_id) WHERE event_id IS NOT NULL AND event_id != '';
`);

for (const [table, column, definition] of [['providers', 'max_tokens', 'INTEGER NOT NULL DEFAULT 2048'], ['providers', 'aws_region', "TEXT NOT NULL DEFAULT ''"], ['providers', 'aws_profile', "TEXT NOT NULL DEFAULT ''"], ['tools', 'builtin', 'INTEGER NOT NULL DEFAULT 0'], ['runs', 'group_id', 'TEXT'], ['runs', 'handoff_depth', 'INTEGER NOT NULL DEFAULT 0'], ['routines', 'trigger_type', "TEXT NOT NULL DEFAULT 'interval'"], ['routines', 'webhook_key', 'TEXT'], ['routines', 'timezone', "TEXT NOT NULL DEFAULT 'UTC'"], ['routines', 'daily_time', "TEXT NOT NULL DEFAULT '09:00'"], ['routine_runs', 'event_id', 'TEXT'], ['routine_runs', 'event_fingerprint', 'TEXT'], ['routine_runs', 'run_id', 'TEXT'], ['routine_runs', 'retry_count', 'INTEGER NOT NULL DEFAULT 0'], ['routine_runs', 'next_attempt_at', 'TEXT'], ['messages', 'reply_to', 'TEXT'], ['messages', 'reactions', "TEXT NOT NULL DEFAULT '{}'"], ['messages', 'edited_at', 'TEXT'], ['messages', 'deleted_at', 'TEXT'], ['messages', 'pinned_at', 'TEXT'], ['group_messages', 'reply_to', 'TEXT'], ['group_messages', 'reactions', "TEXT NOT NULL DEFAULT '{}'"], ['group_messages', 'edited_at', 'TEXT'], ['group_messages', 'deleted_at', 'TEXT'], ['attachments', 'image_data', 'TEXT']] as const) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

type Row = Record<string, unknown>;
function json<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}
const str = (value: unknown) => String(value ?? '');

export function toBot(row: Row): Bot {
  return { id: str(row.id), name: str(row.name), role: str(row.role), description: str(row.description), instructions: str(row.instructions), color: str(row.color), providerId: str(row.provider_id), toolIds: json(row.tool_ids, []), status: str(row.status) as Bot['status'], createdAt: str(row.created_at), updatedAt: str(row.updated_at) };
}
export function toProvider(row: Row): Provider {
  return { id: str(row.id), name: str(row.name), kind: str(row.kind) as Provider['kind'], baseUrl: str(row.base_url), apiStyle: str(row.api_style) as Provider['apiStyle'], model: str(row.model), temperature: Number(row.temperature), maxSteps: Number(row.max_steps), maxTokens: Number(row.max_tokens ?? 2048), awsRegion: str(row.aws_region), awsProfile: str(row.aws_profile), hasApiKey: str(row.kind) === 'bedrock' || Boolean(row.api_key), keyHint: str(row.key_hint), createdAt: str(row.created_at), updatedAt: str(row.updated_at) };
}
export function toTool(row: Row): Tool {
  return { id: str(row.id), name: str(row.name), description: str(row.description), method: str(row.method) as Tool['method'], url: str(row.url), headers: json(row.headers, {}), secretHeaders: json(row.secret_headers, {}), parameters: json(row.parameters, {}), permission: str(row.permission) as Tool['permission'], enabled: Boolean(row.enabled), timeoutMs: Number(row.timeout_ms), createdAt: str(row.created_at), updatedAt: str(row.updated_at), builtin: Boolean(row.builtin) };
}
export function toGroup(row: Row): Group {
  return { id: str(row.id), name: str(row.name), botIds: json(row.bot_ids, []), coordinatorId: str(row.coordinator_id), createdAt: str(row.created_at), updatedAt: str(row.updated_at) };
}
export function toGroupMessage(row: Row): GroupMessage {
  return { id: str(row.id), groupId: str(row.group_id), botId: row.bot_id ? str(row.bot_id) : undefined, role: str(row.role) as GroupMessage['role'], content: str(row.content), runId: row.run_id ? str(row.run_id) : undefined, inputMode: str(row.input_mode) as GroupMessage['inputMode'], status: str(row.status) as GroupMessage['status'], metadata: json(row.metadata, {}), replyTo: row.reply_to ? str(row.reply_to) : undefined, reactions: json(row.reactions, {}), editedAt: row.edited_at ? str(row.edited_at) : undefined, deletedAt: row.deleted_at ? str(row.deleted_at) : undefined, createdAt: str(row.created_at) };
}
export function getGroup(groupId: string): Group | undefined {
  const row = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId) as Row | undefined;
  return row ? toGroup(row) : undefined;
}
export function listGroups(): Group[] {
  return (db.prepare('SELECT * FROM groups ORDER BY created_at').all() as Row[]).map(toGroup);
}
export function getBot(botId: string): Bot | undefined {
  const row = db.prepare('SELECT * FROM bots WHERE id = ?').get(botId) as Row | undefined;
  return row ? toBot(row) : undefined;
}
export function getProvider(providerId: string): (Provider & { apiKey: string }) | undefined {
  const row = db.prepare('SELECT * FROM providers WHERE id = ?').get(providerId) as Row | undefined;
  return row ? { ...toProvider(row), apiKey: str(row.api_key) } : undefined;
}
export function getTool(toolId: string): Tool | undefined {
  const row = db.prepare('SELECT * FROM tools WHERE id = ?').get(toolId) as Row | undefined;
  return row ? toTool(row) : undefined;
}

export function listBots(): Bot[] {
  return (db.prepare('SELECT * FROM bots ORDER BY created_at').all() as Row[]).map(toBot);
}

function seed(): void {
  if (db.prepare('SELECT COUNT(*) AS count FROM providers').get()!.count === 0) {
    const createdAt = now();
    const addProvider = db.prepare('INSERT INTO providers (id, name, kind, base_url, api_style, model, temperature, max_steps, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    addProvider.run('demo', 'Relay demo', 'demo', '', 'chat', 'local-demo', 0, 4, createdAt, createdAt);
    addProvider.run('xai', 'xAI · Grok', 'xai', 'https://api.x.ai/v1', 'chat', 'grok-4.7', 0.2, 8, createdAt, createdAt);
    addProvider.run('openai', 'OpenAI', 'openai', 'https://api.openai.com/v1', 'chat', 'gpt-4o', 0.2, 8, createdAt, createdAt);
  }
  if (!getProvider('bedrock')) {
    const timestamp = now();
    db.prepare("INSERT INTO providers (id, name, kind, base_url, api_style, model, temperature, max_steps, max_tokens, aws_region, aws_profile, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run('bedrock', 'AWS Bedrock · DeepSeek V3.2', 'bedrock', '', 'converse', 'deepseek.v3.2', 0.2, 8, 2048, 'us-east-1', 'bedrock', timestamp, timestamp);
  }
  if (db.prepare('SELECT COUNT(*) AS count FROM bots').get()!.count === 0) {
    const createdAt = now();
    const addBot = db.prepare('INSERT INTO bots (id, name, role, description, instructions, color, provider_id, tool_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    addBot.run('bot_scout', 'Scout', 'Research & intelligence', 'Find the signal in the noise.', 'You are Scout, a research specialist. Find real facts, cite your sources, and be upfront when something is uncertain. Keep answers tight unless the user clearly wants depth.', '#ee6c45', 'demo', '[]', createdAt, createdAt);
    addBot.run('bot_atlas', 'Atlas', 'Operations & planning', 'Turn loose ends into a clear plan.', 'You are Atlas, a planning and operations specialist. Turn goals into concrete next steps, flag blockers early, and check in before taking any consequential action.', '#71836b', 'demo', '[]', createdAt, createdAt);
    addBot.run('bot_echo', 'Echo', 'Writing & communication', 'Make every word earn its place.', 'You are Echo, a writing partner. Help draft, polish, and adapt tone — casual or formal, brief or detailed, whatever the moment needs. Never send or publish anything without the user\'s explicit go-ahead.', '#9b7eb6', 'demo', '[]', createdAt, createdAt);
    db.prepare('INSERT INTO memories (id, bot_id, content, category, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id('mem'), 'bot_scout', 'Keep research concise and separate verified facts from assumptions.', 'preference', 'manual', createdAt, createdAt);
    const addMessage = db.prepare('INSERT INTO messages (id, bot_id, role, content, source, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    addMessage.run(id('msg'), 'bot_scout', 'assistant', "Hey, I'm **Scout**. I turn open questions into clear, sourced answers.\n\nConnect a research API or just ask me something to see how I work. What are we looking into?", 'demo', createdAt);
    addMessage.run(id('msg'), 'bot_atlas', 'assistant', "I'm **Atlas**. Give me an outcome and I'll help turn it into a practical plan with owners, dependencies, and a clear finish line.", 'demo', createdAt);
    addMessage.run(id('msg'), 'bot_echo', 'assistant', "I'm **Echo**. Bring me a rough thought, a difficult email, or a blank page. I'll help you find the right words — nothing gets sent without you.", 'demo', createdAt);
  }
}
seed();
export async function initializeDatabase(): Promise<void> {
  const { ensureBuiltinTools } = await import('./runtime/builtin-tools.ts');
  ensureBuiltinTools();
  const { ensureWebResearchTool } = await import('./runtime/web-research.ts');
  ensureWebResearchTool();
  const { ensureWorkspaceTools } = await import('./runtime/workspace-tools.ts');
  ensureWorkspaceTools();
  const { ensureDefaultSkills } = await import('./runtime/skills.ts');
  ensureDefaultSkills();
  if (listBots().length >= 3 && db.prepare('SELECT COUNT(*) AS count FROM groups').get()!.count === 0) {
    const timestamp = now();
    db.prepare('INSERT INTO groups (id, name, bot_ids, coordinator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('group_team', 'The team', JSON.stringify(['bot_scout', 'bot_atlas', 'bot_echo']), 'bot_scout', timestamp, timestamp);
    db.prepare('INSERT INTO group_messages (id, group_id, role, content, input_mode, status, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id('gmsg'), 'group_team', 'system', 'Welcome to the team room. Ask everyone for different perspectives, or mention @Scout for research, @Atlas for planning, and @Echo for writing. Start a live voice room to speak and hear replies aloud.', 'text', 'completed', '{}', timestamp);
  }
}

export function closeDatabase(): void { db.close(); }
