import { db } from '../db.ts';
import { now } from '../lib/ids.ts';

const definitions = [
  { id: 'builtin_create_project_file', name: 'create_project_file', description: 'Create or replace a source file in the bounded local project workspace. Use for actual app scaffolds, documentation, or artifacts. Do not use for secrets, arbitrary system paths, or claiming deployment. Requires approval.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Relative path inside the workspace, e.g. src/App.tsx or README.md', minLength: 1, maxLength: 160 }, content: { type: 'string', description: 'Complete file contents, maximum 200,000 characters', minLength: 1, maxLength: 200000 } }, required: ['path', 'content'], additionalProperties: false }, permission: 'approval' },
  { id: 'builtin_read_project_file', name: 'read_project_file', description: 'Read a source file from the local project workspace to inspect an existing artifact before changing it.', parameters: { type: 'object', properties: { path: { type: 'string', minLength: 1, maxLength: 160 } }, required: ['path'], additionalProperties: false }, permission: 'auto' },
  { id: 'builtin_list_project_files', name: 'list_project_files', description: 'List existing files in the local project workspace. Use before editing or validating a project.', parameters: { type: 'object', properties: {}, additionalProperties: false }, permission: 'auto' },
  { id: 'builtin_run_project_command', name: 'run_project_command', description: 'Run a predefined validation command inside the local workspace: check_typescript, test_project, or build_project. Dependencies must already exist; no arbitrary commands or installation are permitted.', parameters: { type: 'object', properties: { command: { type: 'string', enum: ['check_typescript', 'test_project', 'build_project'] } }, required: ['command'], additionalProperties: false }, permission: 'approval' },
  { id: 'builtin_save_skill', name: 'save_skill', description: 'Save a proven reusable workflow as a named skill for this bot or all bots. Include when to use it, steps, validation, and approval boundaries.', parameters: { type: 'object', properties: { bot_id: { type: 'string', description: 'The current bot ID' }, name: { type: 'string', minLength: 2, maxLength: 80 }, description: { type: 'string', maxLength: 500 }, instructions: { type: 'string', minLength: 10, maxLength: 8000 }, shared: { type: 'boolean', description: 'Whether all bots may use it' } }, required: ['bot_id', 'name', 'description', 'instructions', 'shared'], additionalProperties: false }, permission: 'approval' },
] as const;

export function ensureWorkspaceTools(): void {
  const timestamp = now();
  for (const tool of definitions) {
    db.prepare('INSERT OR IGNORE INTO tools (id, name, description, method, url, headers, secret_headers, parameters, permission, enabled, timeout_ms, builtin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(tool.id, tool.name, tool.description, 'POST', `workspace://${tool.name}`, '{}', '{}', JSON.stringify(tool.parameters), tool.permission, 1, 15000, 1, timestamp, timestamp);
    db.prepare('UPDATE tools SET description = ?, parameters = ?, permission = ?, builtin = 1 WHERE id = ?').run(tool.description, JSON.stringify(tool.parameters), tool.permission, tool.id);
  }
  for (const botId of ['bot_scout', 'bot_atlas', 'bot_echo']) {
    const row = db.prepare('SELECT tool_ids FROM bots WHERE id = ?').get(botId) as { tool_ids: string } | undefined;
    if (!row) continue;
    const tools = new Set(JSON.parse(row.tool_ids) as string[]);
    for (const tool of definitions) tools.add(tool.id);
    db.prepare('UPDATE bots SET tool_ids = ? WHERE id = ?').run(JSON.stringify([...tools]), botId);
  }
}
