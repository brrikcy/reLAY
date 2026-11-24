import { useState } from 'react';
import { CalendarClock, Clock3, Webhook } from 'lucide-react';
import { Modal } from './Modal.tsx';
import { api } from '../lib/api.ts';
import type { Bot, RoutineTrigger } from '../lib/types.ts';

interface RoutineModalProps {
  bot: Bot;
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}

export function RoutineModal({ bot, onClose, onSaved, onError }: RoutineModalProps) {
  const [name, setName] = useState('Weekly research brief');
  const [instruction, setInstruction] = useState('Review the currently available sources and prepare a concise brief. Separate fresh findings from assumptions, include available source links, and do not contact anyone or publish anything.');
  const [triggerType, setTriggerType] = useState<RoutineTrigger>('interval');
  const [timezone, setTimezone] = useState('UTC');
  const [dailyTime, setDailyTime] = useState('09:00');
  const [intervalMinutes, setIntervalMinutes] = useState(1440);
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true);
    try { await api.saveRoutine(bot.id, { name, instruction, intervalMinutes: Number(intervalMinutes), triggerType, timezone, dailyTime, enabled }); onSaved(); }
    catch (error) { onError(error instanceof Error ? error.message : 'Could not save this routine.'); setSaving(false); }
  };
  return <Modal title="Put good work on repeat." eyebrow={`${bot.name.toUpperCase()} · NEW ROUTINE`} description="Start paused, test with safe inputs, then enable the schedule or webhook." onClose={onClose}><form className="modal-form" onSubmit={submit}><label className="field"><span>Routine name</span><input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} /></label><label className="field"><span>Instruction</span><textarea required rows={6} maxLength={5000} value={instruction} onChange={(event) => setInstruction(event.target.value)} /><small>Define sources, expected output, no-data behavior, and approval boundaries.</small></label><div className="form-grid two-columns"><label className="field"><span>Trigger</span><select aria-label="Routine trigger type" value={triggerType} onChange={(event) => setTriggerType(event.target.value as RoutineTrigger)}><option value="interval">Repeating interval</option><option value="daily">Daily local time</option><option value="webhook">Authenticated webhook</option></select></label><label className="field"><span>Timezone</span><input required maxLength={80} value={timezone} onChange={(event) => setTimezone(event.target.value)} /><small>IANA timezone name</small></label></div>{triggerType === 'daily' && <label className="field"><span>Run at local time</span><input type="time" required value={dailyTime} onChange={(event) => setDailyTime(event.target.value)} /><small>Runs once per day at this time in {timezone}. Missed runs are not replayed.</small></label>}{triggerType === 'interval' && <label className="field"><span>Run every</span><select value={intervalMinutes} onChange={(event) => setIntervalMinutes(Number(event.target.value))}><option value="5">5 minutes · testing only</option><option value="30">30 minutes</option><option value="60">1 hour</option><option value="360">6 hours</option><option value="720">12 hours</option><option value="1440">24 hours</option><option value="10080">7 days</option></select></label>}<label className="toggle-field routine-enable"><span><strong>Enable after saving</strong><small>{triggerType === 'webhook' ? 'Create a key in Routines before sending events.' : 'First run waits for the next scheduled time.'}</small></span><button type="button" className={`toggle ${enabled ? 'on' : ''}`} onClick={() => setEnabled(!enabled)} aria-label="Enable routine after saving" aria-pressed={enabled}><span /></button></label><div className="security-note">{triggerType === 'webhook' ? <Webhook size={17} /> : <Clock3 size={17} />}<div><strong>{triggerType === 'webhook' ? 'External events require a Bearer key.' : 'Runs only while the Relay server is online.'}</strong><p>{triggerType === 'webhook' ? 'Keys are stored only as hashes. Events are queued durably and run when the bot is available. Approval policies still apply.' : 'Each run can spend model credits. Missed intervals are skipped, not replayed. Tool approval policies still apply.'}</p></div></div><footer className="modal-footer"><span className="footer-note"><CalendarClock size={14} />{triggerType === 'webhook' ? 'Keys shown once' : triggerType === 'daily' ? 'Timezone-aware daily run' : 'Minimum interval: 5 minutes'}</span><div className="modal-footer-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={saving} aria-label="Save new routine">{saving ? 'Saving…' : 'Create routine'}</button></div></footer></form></Modal>;
}
