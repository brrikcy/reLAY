import { useState } from 'react';
import { Bot, Check, Plug, Trash2 } from 'lucide-react';
import { Modal } from './Modal.tsx';
import { api } from '../lib/api.ts';
import type { Bot as BotType, Provider, PublicTool } from '../lib/types.ts';

interface BotModalProps {
  bot?: BotType;
  providers: Provider[];
  tools: PublicTool[];
  onClose: () => void;
  onSaved: (bot: BotType) => void;
  onDeleted: (id: string) => void;
  onError: (message: string) => void;
}

const colors = ['#ee6c45', '#71836b', '#5c7f99', '#9b7eb6', '#c39652', '#343a37'];

export function BotModal({ bot, providers, tools, onClose, onSaved, onDeleted, onError }: BotModalProps) {
  const [name, setName] = useState(bot?.name ?? '');
  const [role, setRole] = useState(bot?.role ?? '');
  const [description, setDescription] = useState(bot?.description ?? '');
  const [instructions, setInstructions] = useState(bot?.instructions ?? 'You are a focused, reliable specialist. Understand the requested outcome, use your tools when they help, and be transparent about what you did. Ask before consequential or irreversible actions.');
  const [color, setColor] = useState(bot?.color ?? colors[0]);
  const [providerId, setProviderId] = useState(bot?.providerId ?? 'demo');
  const [toolIds, setToolIds] = useState<string[]>(bot?.toolIds ?? []);
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true);
    try { const saved = await (bot ? api.updateBot(bot.id, { name, role, description, instructions, color, providerId, toolIds }) : api.createBot({ name, role, description, instructions, color, providerId, toolIds })); onSaved(saved); }
    catch (error) { onError(error instanceof Error ? error.message : 'Could not save this bot.'); setSaving(false); }
  };
  const remove = async () => {
    if (!bot || !window.confirm(`Delete ${bot.name}? This permanently removes its conversations, memories, routines, and run history.`)) return;
    setSaving(true);
    try { await api.deleteBot(bot.id); onDeleted(bot.id); }
    catch (error) { onError(error instanceof Error ? error.message : 'Could not delete this bot.'); setSaving(false); }
  };
  return <Modal title={bot ? `Tune ${bot.name}` : 'Meet your next teammate.'} eyebrow={bot ? 'BOT SETTINGS' : 'CREATE A BOT'} description="Give one clear job to one focused bot. You can change any of this later." onClose={onClose} wide>
    <form onSubmit={submit} className="modal-form"><div className="form-grid two-columns"><label className="field"><span>Name <em>Required</em></span><input required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Scout" /></label><label className="field"><span>Role <em>Required</em></span><input required maxLength={100} value={role} onChange={(event) => setRole(event.target.value)} placeholder="e.g. Research & intelligence" /></label></div><label className="field"><span>Short description</span><input maxLength={240} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What does this bot help you achieve?" /></label><label className="field"><span>Instructions <em>{instructions.length.toLocaleString()} / 12,000</em></span><textarea required maxLength={12000} rows={6} value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Describe its job, expected output, decision rules, and approval boundaries." /><small>Include its responsibilities, sources, definition of done, and what it must never do.</small></label><div className="form-grid two-columns"><label className="field"><span>Model provider</span><select value={providerId} onChange={(event) => setProviderId(event.target.value)}>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}{provider.kind === 'demo' ? ' · no API key' : ` · ${provider.model}`}</option>)}</select><small>The “brain” this bot will use.</small></label><fieldset className="field color-field"><legend>Avatar color</legend><div className="color-options">{colors.map((option) => <button key={option} type="button" className={`color-option ${color === option ? 'selected' : ''}`} style={{ backgroundColor: option }} onClick={() => setColor(option)} aria-label={`Use color ${option}`} aria-pressed={color === option}>{color === option && <Check size={15} />}</button>)}</div><small>A recognizable identity in your roster.</small></fieldset></div><fieldset className="field"><legend>Connected tools <em>{toolIds.length} selected</em></legend>{tools.length ? <div className="tool-picker">{tools.map((tool) => <label className={`tool-pick ${toolIds.includes(tool.id) ? 'selected' : ''} ${!tool.enabled ? 'disabled' : ''}`} key={tool.id}><input type="checkbox" checked={toolIds.includes(tool.id)} disabled={!tool.enabled} onChange={() => setToolIds((current) => current.includes(tool.id) ? current.filter((id) => id !== tool.id) : [...current, tool.id])} /><span className="tool-pick-icon"><Plug size={16} /></span><span><strong>{tool.name}</strong><small>{tool.method} · {tool.permission === 'approval' ? 'Ask first' : tool.permission === 'auto' ? 'Run automatically' : 'Blocked'}{!tool.enabled && ' · Disabled'}</small></span><span className="check-box">{toolIds.includes(tool.id) && <Check size={13} />}</span></label>)}</div> : <div className="form-empty"><Plug size={19} /><span>No API tools yet. Save this bot, then add one under Connections.</span></div>}</fieldset><footer className="modal-footer">{bot ? <button type="button" className="button danger-text" onClick={remove} disabled={saving}><Trash2 size={15} />Delete bot</button> : <span className="footer-note"><Bot size={14} />A new specialist, not another chat session.</span>}<div className="modal-footer-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={saving || !name.trim() || !role.trim() || !instructions.trim()}>{saving ? <span className="spinner light" /> : null}{saving ? 'Saving…' : bot ? 'Save changes' : 'Create bot'}</button></div></footer></form>
  </Modal>;
}
