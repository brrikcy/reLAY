import { db } from '../db.ts';
import { id, now } from '../lib/ids.ts';
import { HttpError } from '../lib/validation.ts';

export interface RoutineExecution {
  id: string;
  routineId: string;
  triggerType: string;
  status: string;
  payload: unknown;
  eventId?: string;
  eventFingerprint?: string;
  runId?: string;
  error?: string;
  startedAt: string;
  completedAt?: string;
  retryCount: number;
  nextAttemptAt: string;
}

export function parseRoutineExecution(row: Record<string, unknown>): RoutineExecution {
  let payload: unknown = {};
  try { payload = JSON.parse(String(row.payload)); } catch { /* Invalid stored JSON remains an empty object. */ }
  return { id: String(row.id), routineId: String(row.routine_id), triggerType: String(row.trigger_type), status: String(row.status), payload, eventId: row.event_id ? String(row.event_id) : undefined, eventFingerprint: row.event_fingerprint ? String(row.event_fingerprint) : undefined, runId: row.run_id ? String(row.run_id) : undefined, error: row.error ? String(row.error) : undefined, startedAt: String(row.started_at), completedAt: row.completed_at ? String(row.completed_at) : undefined, retryCount: Number(row.retry_count ?? 0), nextAttemptAt: String(row.next_attempt_at ?? row.started_at) };
}

export function listRoutineExecutions(routineId: string, limit = 12): RoutineExecution[] {
  return (db.prepare('SELECT * FROM routine_runs WHERE routine_id = ? ORDER BY started_at DESC LIMIT ?').all(routineId, limit) as Array<Record<string, unknown>>).map(parseRoutineExecution);
}

export function scheduleAtLocalTime(time: string, timezone: string, after = new Date()): Date {
  const match = time.match(/^(\d{2}):(\d{2})$/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) throw new HttpError(400, 'Enter a valid daily time in HH:MM format.');
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }); } catch { throw new HttpError(400, 'Enter a valid IANA timezone.'); }
  const [hour, minute] = [Number(match[1]), Number(match[2])];
  const desiredUtc = new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), after.getUTCDate(), hour, minute));
  const offsetFor = (instant: Date): number => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const localUtc = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute), Number(values.second));
    return instant.getTime() - localUtc;
  };
  let result = new Date(desiredUtc.getTime() + offsetFor(desiredUtc));
  if (result.getTime() <= after.getTime()) {
    const nextDay = new Date(desiredUtc.getTime() + 86_400_000);
    result = new Date(nextDay.getTime() + offsetFor(nextDay));
  }
  return result;
}

export function nextRoutineTime(row: Record<string, unknown>, after = new Date()): string {
  if (row.trigger_type === 'daily') return scheduleAtLocalTime(String(row.daily_time || '09:00'), String(row.timezone || 'UTC'), after).toISOString();
  return new Date(after.getTime() + Number(row.interval_minutes ?? row.intervalMinutes) * 60_000).toISOString();
}

export function recordRoutineExecution(routineId: string, triggerType: string, payload: unknown, status = 'accepted', eventId = '', fingerprint = ''): RoutineExecution {
  const execution = { id: id('routine_run'), routineId, triggerType, status, eventId, eventFingerprint: fingerprint, startedAt: now(), nextAttemptAt: now() };
  db.prepare('INSERT INTO routine_runs (id, routine_id, trigger_type, status, payload, event_id, event_fingerprint, started_at, next_attempt_at, retry_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)').run(execution.id, routineId, triggerType, status, JSON.stringify(payload), eventId, fingerprint, execution.startedAt, execution.nextAttemptAt);
  return parseRoutineExecution(db.prepare('SELECT * FROM routine_runs WHERE id = ?').get(execution.id) as Record<string, unknown>);
}

export function claimRoutineExecution(routineId: string): Record<string, unknown> | undefined {
  const row = db.prepare("SELECT * FROM routine_runs WHERE routine_id = ? AND status IN ('queued','retry') AND next_attempt_at <= ? ORDER BY started_at LIMIT 1").get(routineId, now()) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  db.prepare("UPDATE routine_runs SET status = 'accepted', retry_count = retry_count + 1 WHERE id = ? AND status IN ('queued','retry')").run(String(row.id));
  return db.prepare('SELECT * FROM routine_runs WHERE id = ?').get(String(row.id)) as Record<string, unknown>;
}
