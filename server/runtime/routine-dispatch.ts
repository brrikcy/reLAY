import { db } from '../db.ts';
import { isBotBusy } from './agent.ts';
import { dispatchRoutineExecution } from './routine-webhooks.ts';

export function dispatchAvailableRoutineWork(botId?: string): void {
  const rows = botId
    ? db.prepare("SELECT id, routine_id FROM routine_runs WHERE routine_id IN (SELECT id FROM routines WHERE bot_id = ?) AND status IN ('queued','retry') ORDER BY started_at LIMIT 5").all(botId) as Array<Record<string, unknown>>
    : db.prepare("SELECT id, routine_id FROM routine_runs WHERE status IN ('queued','retry') ORDER BY started_at LIMIT 10").all() as Array<Record<string, unknown>>;
  for (const row of rows) {
    const routineId = String(row.routine_id);
    const owner = db.prepare('SELECT bot_id FROM routines WHERE id = ?').get(routineId) as Record<string, unknown> | undefined;
    if (!owner || isBotBusy(String(owner.bot_id))) continue;
    try { dispatchRoutineExecution(routineId, String(row.id)); } catch { /* The next scheduler tick will retry a transient start failure. */ }
  }
}
