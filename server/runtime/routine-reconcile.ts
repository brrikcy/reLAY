import { db } from '../db.ts';
import { now } from '../lib/ids.ts';
import { dispatchAvailableRoutineWork } from './routine-dispatch.ts';

export function tickRoutineRuns(): void {
  const rows = db.prepare("SELECT id, run_id FROM routine_runs WHERE run_id IS NOT NULL AND status = 'accepted'").all() as Array<Record<string, unknown>>;
  for (const row of rows) {
    const run = db.prepare('SELECT status, error, completed_at FROM runs WHERE id = ?').get(String(row.run_id)) as Record<string, unknown> | undefined;
    if (!run || ['running', 'waiting'].includes(String(run.status))) continue;
    const status = String(run.status);
    const retryable = status === 'failed' && !String(run.error ?? '').includes('budget');
    const record = db.prepare('SELECT retry_count FROM routine_runs WHERE id = ?').get(String(row.id)) as Record<string, unknown> | undefined;
    const retry = retryable && Number(record?.retry_count ?? 0) < 2;
    db.prepare('UPDATE routine_runs SET status = ?, error = ?, completed_at = ?, next_attempt_at = ? WHERE id = ?').run(retry ? 'retry' : status, run.error ? String(run.error) : null, retry ? null : run.completed_at ? String(run.completed_at) : now(), retry ? new Date(Date.now() + 60_000).toISOString() : null, String(row.id));
  }
  dispatchAvailableRoutineWork();
}
