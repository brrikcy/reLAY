import { useState } from 'react';
import { Brain } from 'lucide-react';
import { Modal } from './Modal.tsx';
import { api } from '../lib/api.ts';
import type { Bot, Memory } from '../lib/types.ts';

export function MemoryModal({ bot, onClose, onSaved, onError }: { bot: Bot; onClose: () => void; onSaved: (memory: Memory) => void; onError: (message: string) => void }) {
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('preference');
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setSaving(true); try { onSaved(await api.addMemory(bot.id, { content, category, source: 'manual' })); } catch (error) { onError(error instanceof Error ? error.message : 'Could not add this memory.'); setSaving(false); } };
  return <Modal title="Something worth remembering." eyebrow={`${bot.name.toUpperCase()} · MEMORY`} description="Save durable context, not task-specific details or secrets." onClose={onClose}><form className="modal-form" onSubmit={submit}><label className="field"><span>Memory</span><textarea required autoFocus minLength={1} maxLength={2000} rows={5} value={content} onChange={(event) => setContent(event.target.value)} placeholder="e.g. Keep weekly updates under 300 words and include three clear next steps." /></label><label className="field"><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="preference">Preference · how you like to work</option><option value="fact">Fact · stable context</option><option value="rule">Rule · an operating boundary</option><option value="work_log">Work log · a dated outcome</option></select></label><div className="security-note"><Brain size={17} /><div><strong>Memory is context, not a source of truth.</strong><p>Re-check changing facts. Never save passwords, payment details, one-time codes, or API keys here.</p></div></div><footer className="modal-footer"><span /><div className="modal-footer-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={saving || !content.trim()}>{saving ? 'Saving…' : 'Save memory'}</button></div></footer></form></Modal>;
}
