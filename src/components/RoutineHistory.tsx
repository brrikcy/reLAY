import { useEffect, useState } from 'react';
import { Clock3, ExternalLink, LoaderCircle } from 'lucide-react';
import { api } from '../lib/api.ts';
import { relativeTime } from '../lib/utils.ts';

interface Execution { id: string; status: string; triggerType: string; eventId?: string; runId?: string; error?: string; startedAt: string; completedAt?: string; retryCount: number; nextAttemptAt: string }

export function RoutineHistory({ routineId, onOpenRun }: { routineId: string; onOpenRun: (runId: string) => void }) {
  const [items, setItems] = useState<Execution[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void api.routineExecutions(routineId).then(setItems).finally(() => setLoading(false)).catch(() => setItems([]));
  }, [open, routineId]);
  return <div className="routine-history"><button className="text-button" onClick={() => setOpen(!open)} aria-expanded={open}><Clock3 size={12} />{open ? 'Hide execution history' : 'Execution history'}</button>{open && <div className="routine-history-list">{loading && <LoaderCircle size={14} className="tiny-spinner" />}{items.map((item) => <article key={item.id}><div><strong>{item.status}</strong><span>{item.triggerType}{item.retryCount > 1 ? ` · attempt ${item.retryCount}` : ''}</span></div><small>{relativeTime(item.startedAt)}{item.completedAt ? ` · finished ${relativeTime(item.completedAt)}` : item.nextAttemptAt && ['queued','retry'].includes(item.status) ? ` · next ${relativeTime(item.nextAttemptAt)}` : ''}</small>{item.eventId && <small>Event {item.eventId}</small>}{item.error && <p>{item.error}</p>}{item.runId && <button className="text-button" onClick={() => onOpenRun(item.runId!)}>View run <ExternalLink size={10} /></button>}</article>)}{!loading && !items.length && <p>No executions recorded yet.</p>}</div>}</div>;
}
