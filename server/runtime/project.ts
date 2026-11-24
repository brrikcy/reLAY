import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { db } from '../db.ts';
import { now } from '../lib/ids.ts';
import type { ProjectFile } from '../types.ts';

const root = resolve(process.env.RELAY_PROJECT_DIR ?? './workspace');
const runFile = promisify(execFile);

export function safeProjectPath(input: string): string {
  if (!/^[a-zA-Z0-9_./-]{1,160}$/.test(input) || input.includes('..') || input.startsWith('/') || /^[a-zA-Z]:/.test(input)) throw new Error('Use a relative project path without traversal or special characters.');
  const path = resolve(root, input);
  if (path !== root && !path.startsWith(`${root}${sep}`)) throw new Error('Project path is outside the workspace.');
  return path;
}

export async function createProjectFile(path: string, content: string): Promise<ProjectFile> {
  if (!content || Buffer.byteLength(content) > 200_000) throw new Error('Each project file must contain between 1 and 200,000 characters.');
  const target = safeProjectPath(path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, { encoding: 'utf8', flag: 'w' });
  const updatedAt = now();
  db.prepare('INSERT INTO project_files (path, content, updated_at, size) VALUES (?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at, size = excluded.size').run(path, content, updatedAt, Buffer.byteLength(content));
  return { path, content, updatedAt, size: Buffer.byteLength(content) };
}

export async function listProjectFiles(): Promise<Array<Omit<ProjectFile, 'content'>>> {
  const files: Array<Omit<ProjectFile, 'content'>> = [];
  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > 5) return;
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (['node_modules', '.git', 'dist'].includes(entry.name)) continue;
      const full = resolve(directory, entry.name);
      if (entry.isDirectory()) await walk(full, depth + 1);
      else if (entry.isFile()) {
        const info = await stat(full);
        const path = full.slice(root.length + 1).replaceAll(sep, '/');
        db.prepare('INSERT INTO project_files (path, content, updated_at, size) VALUES (?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET updated_at = excluded.updated_at, size = excluded.size').run(path, '', info.mtime.toISOString(), info.size);
        files.push({ path, updatedAt: info.mtime.toISOString(), size: info.size });
      }
      if (files.length >= 200) return;
    }
  }
  await mkdir(root, { recursive: true });
  db.prepare('DELETE FROM project_files').run();
  await walk(root, 0);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export async function readProjectFile(path: string): Promise<ProjectFile> {
  const content = await readFile(safeProjectPath(path), 'utf8');
  const info = await stat(safeProjectPath(path));
  return { path, content: content.slice(0, 200_000), updatedAt: info.mtime.toISOString(), size: info.size };
}

const allowedCommands: Record<string, { executable: string; args: string[]; timeout: number }> = {
  check_typescript: { executable: process.execPath, args: ['node_modules/typescript/bin/tsc', '--noEmit'], timeout: 45_000 },
  test_project: { executable: process.execPath, args: ['node_modules/tsx/dist/cli.mjs', '--test', 'tests/*.test.ts'], timeout: 60_000 },
  build_project: { executable: process.execPath, args: ['node_modules/vite/bin/vite.js', 'build'], timeout: 60_000 },
};

export async function runProjectCommand(command: string): Promise<{ command: string; exitCode: number; stdout: string; stderr: string }> {
  const definition = allowedCommands[command];
  if (!definition) throw new Error('Only check_typescript, test_project, and build_project are available for an existing project. Install dependencies manually first.');
  const result = await runFile(definition.executable, definition.args, { cwd: root, timeout: definition.timeout, windowsHide: true, maxBuffer: 256_000, env: { ...process.env, NODE_ENV: 'development' } }).then((output) => ({ code: 0, stdout: output.stdout, stderr: output.stderr })).catch((error: unknown) => error as { code?: number; stdout?: string; stderr?: string });
  return { command, exitCode: result.code ?? 0, stdout: String(result.stdout ?? '').slice(-12_000), stderr: String(result.stderr ?? '').slice(-12_000) };
}

export async function deleteProjectFile(path: string): Promise<void> {
  const target = safeProjectPath(path);
  await unlink(target);
  db.prepare('DELETE FROM project_files WHERE path = ?').run(path);
}
