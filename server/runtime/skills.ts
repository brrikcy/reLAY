import { db, listBots } from '../db.ts';
import { id, now } from '../lib/ids.ts';
import type { Skill } from '../types.ts';

export function listSkills(): Skill[] {
  return (db.prepare('SELECT * FROM skills ORDER BY name').all() as Array<Record<string, unknown>>).map((row) => ({ id: String(row.id), name: String(row.name), description: String(row.description), instructions: String(row.instructions), botIds: JSON.parse(String(row.bot_ids)) as string[], createdAt: String(row.created_at), updatedAt: String(row.updated_at) }));
}

export function skillContext(botId: string): string {
  const skills = listSkills().filter((skill) => !skill.botIds.length || skill.botIds.includes(botId));
  if (!skills.length) return '';
  return `\n\nReusable skills available to you:\n${skills.map((skill) => `- ${skill.name}: ${skill.description}\n  When this matches the task, follow: ${skill.instructions}`).join('\n').slice(0, 8000)}\nUse a matching skill when relevant; do not claim to have created a skill unless a tool confirms it.`;
}

export function saveSkill(botId: string, input: { name: string; description: string; instructions: string; shared: boolean }): Skill {
  const name = input.name.trim();
  if (!/^[\w .-]{2,80}$/i.test(name) || !input.instructions.trim() || input.instructions.length > 8000 || input.description.length > 500) throw new Error('Skill name, description, and instructions must be valid and bounded.');
  const timestamp = now();
  const skill = { id: id('skill'), name, description: input.description.trim(), instructions: input.instructions.trim(), botIds: input.shared ? [] : [botId], createdAt: timestamp, updatedAt: timestamp };
  db.prepare('INSERT INTO skills (id, name, description, instructions, bot_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET description = excluded.description, instructions = excluded.instructions, bot_ids = excluded.bot_ids, updated_at = excluded.updated_at').run(skill.id, skill.name, skill.description, skill.instructions, JSON.stringify(skill.botIds), timestamp, timestamp);
  return listSkills().find((candidate) => candidate.name === skill.name)!;
}

export function ensureDefaultSkills(): void {
  if (db.prepare('SELECT COUNT(*) AS count FROM skills').get()!.count) return;
  const bots = listBots();
  if (bots.length < 3) return;
  saveSkill('bot_scout', { name: 'Sourced research brief', description: 'Research a current topic and produce a concise, linked brief without speculation.', instructions: 'Clarify the decision the research supports. Use search_news for recent events and search_wikipedia for background. Distinguish verified facts from inference, cite returned links, and do not claim to have read an article when only its headline was returned. End with three practical next steps.', shared: true });
  saveSkill('bot_atlas', { name: 'Morning action brief', description: 'Turn available context into a short morning priorities brief.', instructions: 'Use available sources and current context. Summarize what changed, what needs the user today, and any scheduling conflicts. Clearly label missing sources rather than inventing inbox, calendar, or Slack activity. Format as three priorities and one thing to defer.', shared: true });
  saveSkill('bot_echo', { name: 'Clear communication draft', description: 'Draft a clear message in the user’s preferred tone for review.', instructions: 'Identify audience, goal, and desired action. Draft concise natural language, preserve factual uncertainty, and do not send, publish, or claim approval. Include a shorter alternate version when useful.', shared: true });
  saveSkill('bot_atlas', { name: 'Build a project scaffold', description: 'Create an actual small web-app scaffold in the Relay project workspace, not just a description.', instructions: 'Clarify the target user and essential workflow. Prefer a lightweight PWA for a lightweight app request. Use create_project_file for a small set of source files and validate the result with run_project_command. Do not promise production readiness, store deployment, or device testing without evidence. Android native builds require an explicit approved toolchain and cannot be simulated.', shared: false });
}
