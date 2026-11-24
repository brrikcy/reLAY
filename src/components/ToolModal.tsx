import { useState } from 'react';
import { Braces, KeyRound, ShieldCheck } from 'lucide-react';
import { Modal } from './Modal.tsx';
import { api } from '../lib/api.ts';
import type { PublicTool } from '../lib/types.ts';

interface ToolModalProps {
  tool?: PublicTool;
  onClose: () => void;
  onSaved: (tool: PublicTool) => void;
  onError: (message: string) => void;
}

function parseObject(value: string, label: string): Record<string, unknown> {
  try { const parsed = JSON.parse(value) as unknown; if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(); return parsed as Record<string, unknown>; }
  catch { throw new Error(`${label} must be a valid JSON object.`); }
}

export function ToolModal({ tool, onClose, onSaved, onError }: ToolModalProps) {
  const [name, setName] = useState(tool?.name ?? 'get_weather');
  const [description, setDescription] = useState(tool?.description ?? 'Get the current weather forecast for a city. Use this when the user asks about weather conditions.');
  const [method, setMethod] = useState(tool?.method ?? 'GET');
  const [url, setUrl] = useState(tool?.url ?? 'https://api.example.com/weather?city={{city}}');
  const [permission, setPermission] = useState(tool?.permission ?? 'approval');
  const [headers, setHeaders] = useState(JSON.stringify(tool?.headers ?? { Accept: 'application/json' }, null, 2));
  const [secretHeaders, setSecretHeaders] = useState('{}');
  const [parameters, setParameters] = useState(JSON.stringify(tool?.parameters ?? { type: 'object', properties: { city: { type: 'string', description: 'City name, e.g. London' } }, required: ['city'] }, null, 2));
  const [timeoutMs, setTimeoutMs] = useState(tool?.timeoutMs ?? 15000);
  const [enabled, setEnabled] = useState(tool?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true);
    try {
      const parsedHeaders = parseObject(headers, 'Headers');
      const parsedSecrets = parseObject(secretHeaders, 'Secret headers');
      for (const [label, object] of [['Headers', parsedHeaders], ['Secret headers', parsedSecrets]] as const) for (const value of Object.values(object)) if (typeof value !== 'string') throw new Error(`${label} values must be strings.`);
      const saved = await api.saveTool({ name, description, method, url, headers: parsedHeaders, secretHeaders: parsedSecrets, parameters: parseObject(parameters, 'Parameter schema'), permission, enabled, timeoutMs: Number(timeoutMs) }, tool?.id);
      onSaved(saved);
    } catch (error) { onError(error instanceof Error ? error.message : 'Could not save this tool.'); setSaving(false); }
  };
  return <Modal title={tool ? `Edit ${tool.name}` : 'Connect an API. Unlock a capability.'} eyebrow="REST API TOOL" description="Define the request once. Your bot gets a typed function it can call during a run." onClose={onClose} wide><form onSubmit={submit} className="modal-form"><div className="form-grid two-columns"><label className="field"><span>Function name</span><input required pattern="[a-zA-Z][a-zA-Z0-9_\-]{1,63}" value={name} onChange={(event) => setName(event.target.value)} /><small>Letters, numbers, underscores, and hyphens only.</small></label><label className="field"><span>Permission policy</span><select value={permission} onChange={(event) => setPermission(event.target.value as typeof permission)}><option value="approval">Ask for approval every time</option><option value="auto">Allow automatically</option><option value="deny">Always block</option></select></label></div><label className="field"><span>What does this tool do?</span><textarea required rows={2} maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} /><small>This description helps the model decide when to call it.</small></label><div className="url-field"><label className="field method-field"><span>Method</span><select value={method} onChange={(event) => setMethod(event.target.value as typeof method)}>{['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((value) => <option key={value}>{value}</option>)}</select></label><label className="field"><span>Endpoint URL</span><input required value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://api.example.com/items/{{id}}" /><small>Use <code>{'{{argument}}'}</code> to insert URL-encoded values. GET/DELETE arguments become query parameters; other methods send JSON.</small></label></div><label className="field"><span>Parameters · JSON Schema</span><div className="code-input"><Braces size={16} /><textarea required rows={9} spellCheck={false} value={parameters} onChange={(event) => setParameters(event.target.value)} /></div><small>Use an object schema with named properties. Include <code>required</code> for essential inputs and <code>default</code> where useful.</small></label><div className="form-grid two-columns"><label className="field"><span>Public headers · JSON</span><textarea className="mono-input" rows={4} spellCheck={false} value={headers} onChange={(event) => setHeaders(event.target.value)} /></label><label className="field"><span>Secret headers · JSON {tool?.hasSecrets && <em>Secrets saved</em>}</span><div className="secret-input"><KeyRound size={15} /><textarea className="mono-input" rows={4} spellCheck={false} value={secretHeaders} onChange={(event) => setSecretHeaders(event.target.value)} placeholder={'{\n  "Authorization": "Bearer YOUR_KEY"\n}'} /></div><small>{tool?.hasSecrets ? 'Leave {} to keep existing values; replace a key or set its value to "" to remove it.' : 'Secrets are never returned to the browser or included in the tool schema.'}</small></label></div><div className="form-grid two-columns"><label className="field"><span>Request timeout · milliseconds</span><input type="number" min="1000" max="60000" step="1000" value={timeoutMs} onChange={(event) => setTimeoutMs(Number(event.target.value))} /></label><label className="toggle-field"><span><strong>Enable this tool</strong><small>Only enabled tools can be assigned and called.</small></span><button type="button" className={`toggle ${enabled ? 'on' : ''}`} onClick={() => setEnabled(!enabled)} aria-label="Enable this tool" aria-pressed={enabled}><span /></button></label></div><div className="security-note"><ShieldCheck size={17} /><div><strong>Start read-only. Keep writes behind approval.</strong><p>Relay checks targets for private/reserved IPs and limits redirects and response sizes. This is a local development safeguard, not a complete SSRF sandbox. Only connect APIs you trust.</p></div></div><footer className="modal-footer"><span className="footer-note">After saving, assign this tool in a bot’s settings.</span><div className="modal-footer-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={saving}>{saving ? 'Saving…' : tool ? 'Save tool' : 'Connect API'}</button></div></footer></form></Modal>;
}
