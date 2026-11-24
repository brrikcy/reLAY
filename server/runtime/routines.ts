import { db, getBot } from '../db.ts';
import { now } from '../lib/ids.ts';
import { publishAll } from '../lib/events.ts';
import { isBotBusy, startRun } from './agent.ts';
import { tickRoutineRuns } from './routine-reconcile.ts';
import { nextRoutineTime } from './routine-execution.ts';

let timer: NodeJS.Timeout | undefined;

export function tickRoutines(): void {
  tickRoutineRuns();
  const due = db.prepare("SELECT * FROM routines WHERE enabled = 1 AND trigger_type IN ('interval','daily') AND next_run_at <= ? ORDER BY next_run_at LIMIT 10").all(now()) as Array<Record<string, unknown>>;
  for (const row of due) {
    const botId = String(row.bot_id);
    const routineId = String(row.id);
    const timestamp = now();
    db.prepare('UPDATE routines SET last_run_at = ?, next_run_at = ? WHERE id = ?').run(timestamp, nextRoutineTime(row), routineId);
    if (isBotBusy(botId) || !getBot(botId)) continue;
    try { const run = startRun(botId, String(row.instruction), 'routine', routineId); db.prepare('UPDATE routines SET last_run_at = ? WHERE id = ?').run(timestamp, routineId); void run; }
    catch { publishAll('workspace'); }
  }
}

export function startScheduler(): void {
  timer = setInterval(tickRoutines, 15_000);
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
}
