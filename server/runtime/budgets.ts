import { db } from '../db.ts';
import type { UsageBudget } from '../types.ts';
import { now } from '../lib/ids.ts';

const today = () => now().slice(0, 10);

export function budgetFor(botId: string): UsageBudget {
  const date = today();
  let row = db.prepare('SELECT * FROM budgets WHERE bot_id = ?').get(botId) as Record<string, unknown> | undefined;
  if (!row) {
    db.prepare('INSERT INTO budgets (bot_id, date) VALUES (?, ?)').run(botId, date);
    row = db.prepare('SELECT * FROM budgets WHERE bot_id = ?').get(botId) as Record<string, unknown>;
  }
  if (row.date !== date) {
    db.prepare('UPDATE budgets SET date = ?, used_runs = 0, used_input_tokens = 0, used_output_tokens = 0, used_tool_calls = 0 WHERE bot_id = ?').run(date, botId);
    row = db.prepare('SELECT * FROM budgets WHERE bot_id = ?').get(botId) as Record<string, unknown>;
  }
  const maxRuns = Number(row.max_runs_per_day);
  const maxTokens = Number(row.max_tokens_per_day);
  const maxToolCalls = Number(row.max_tool_calls_per_day);
  return { botId, maxRunsPerDay: maxRuns, maxTokensPerDay: maxTokens, maxToolCallsPerDay: maxToolCalls, usedRuns: Number(row.used_runs), usedInputTokens: Number(row.used_input_tokens), usedOutputTokens: Number(row.used_output_tokens), usedToolCalls: Number(row.used_tool_calls), remainingRuns: Math.max(0, maxRuns - Number(row.used_runs)), remainingTokens: Math.max(0, maxTokens - Number(row.used_input_tokens) - Number(row.used_output_tokens)), remainingToolCalls: Math.max(0, maxToolCalls - Number(row.used_tool_calls)), date };
}

export function checkBudget(botId: string, estimatedInputTokens = 0, estimatedOutputTokens = 0, kind: 'run' | 'model' | 'tool' = 'run'): void {
  const budget = budgetFor(botId);
  if (kind === 'run' && budget.remainingRuns < 1) throw new Error(`Daily run budget reached for this bot (${budget.maxRunsPerDay}/day). Increase it in Settings or wait until tomorrow.`);
  if (kind === 'model' && budget.remainingTokens < estimatedInputTokens + estimatedOutputTokens) throw new Error(`Daily token budget would be exceeded for this bot. Remaining: ${budget.remainingTokens.toLocaleString()} tokens.`);
  if (kind === 'tool' && budget.remainingToolCalls < 1) throw new Error(`Daily tool-call budget reached for this bot (${budget.maxToolCallsPerDay}/day). Increase it in Settings or wait until tomorrow.`);
}

export function consumeBudget(botId: string, inputTokens: number, outputTokens: number, toolCalls: number): void {
  db.prepare('UPDATE budgets SET used_input_tokens = used_input_tokens + ?, used_output_tokens = used_output_tokens + ?, used_tool_calls = used_tool_calls + ? WHERE bot_id = ?').run(Math.max(0, inputTokens), Math.max(0, outputTokens), Math.max(0, toolCalls), botId);
}

export function consumeRunBudget(botId: string): void {
  db.prepare('UPDATE budgets SET used_runs = used_runs + 1 WHERE bot_id = ?').run(botId);
}

export function configureBudget(botId: string, maxRunsPerDay: number, maxTokensPerDay: number, maxToolCallsPerDay: number): UsageBudget {
  if (![maxRunsPerDay, maxTokensPerDay, maxToolCallsPerDay].every((value) => Number.isInteger(value) && value > 0)) throw new Error('Budget limits must be positive integers.');
  if (maxRunsPerDay > 1000 || maxTokensPerDay > 10_000_000 || maxToolCallsPerDay > 10_000) throw new Error('Budget limit is too high.');
  budgetFor(botId);
  db.prepare('UPDATE budgets SET max_runs_per_day = ?, max_tokens_per_day = ?, max_tool_calls_per_day = ? WHERE bot_id = ?').run(maxRunsPerDay, maxTokensPerDay, maxToolCallsPerDay, botId);
  return budgetFor(botId);
}
