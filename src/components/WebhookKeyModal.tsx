import { useState } from 'react';
import { Check, Copy, KeyRound, ShieldCheck } from 'lucide-react';
import { Modal } from './Modal.tsx';
import type { Routine } from '../lib/types.ts';

export function WebhookKeyModal({ routine, credentials, onClose }: { routine: Routine; credentials: { key: string; url: string }; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const endpoint = `${window.location.origin}${credentials.url}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(`URL: ${endpoint}\nAuthorization: Bearer ${credentials.key}`); setCopied(true); }
    catch { /* The selectable fields remain available when clipboard permission is denied. */ }
  };
  return <Modal title="Your webhook key is ready." eyebrow={`${routine.name.toUpperCase()} · SHOWN ONCE`} description="Store this key securely now. Relay stores only its hash and cannot show it again." onClose={onClose}><div className="modal-form"><div className="security-note"><KeyRound size={18} /><div><strong>Rotate invalidates the previous key.</strong><p>Send JSON with an Authorization: Bearer header. This key grants execution of this one routine; keep it out of chat and source code.</p></div></div><label className="field"><span>Endpoint</span><input readOnly value={endpoint} onFocus={(event) => event.target.select()} /></label><label className="field"><span>Bearer key</span><input readOnly value={credentials.key} onFocus={(event) => event.target.select()} /></label><div className="security-note"><ShieldCheck size={17} /><div><strong>Events are accepted only while this routine is enabled.</strong><p>Duplicate event IDs and recent identical payloads are rejected. A busy bot returns HTTP 409 so the sender can retry later.</p></div></div><footer className="modal-footer"><span className="footer-note">{copied ? <><Check size={14} />Copied</> : 'Select the fields or copy them together.'}</span><div className="modal-footer-actions"><button className="button secondary" onClick={onClose}>Done</button><button className="button primary" onClick={() => void copy()}><Copy size={14} />{copied ? 'Copied' : 'Copy URL and key'}</button></div></footer></div></Modal>;
}
