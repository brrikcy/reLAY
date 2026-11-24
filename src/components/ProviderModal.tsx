import { useState } from 'react';
import { Cloud, ExternalLink, KeyRound, ShieldCheck } from 'lucide-react';
import { Modal } from './Modal.tsx';
import { api } from '../lib/api.ts';
import type { Provider } from '../lib/types.ts';

interface ProviderModalProps {
  provider?: Provider;
  onClose: () => void;
  onSaved: (provider: Provider) => void;
  onError: (message: string) => void;
}

export function ProviderModal({ provider, onClose, onSaved, onError }: ProviderModalProps) {
  const [name, setName] = useState(provider?.name ?? 'Custom model');
  const [kind, setKind] = useState(provider?.kind === 'demo' ? 'custom' : provider?.kind ?? 'custom');
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl || 'https://api.openai.com/v1');
  const [apiStyle, setApiStyle] = useState(provider?.apiStyle ?? 'chat');
  const [model, setModel] = useState(provider?.model ?? 'gpt-4o');
  const [apiKey, setApiKey] = useState('');
  const [temperature, setTemperature] = useState(provider?.temperature ?? 0.2);
  const [maxSteps, setMaxSteps] = useState(provider?.maxSteps ?? 8);
  const [maxTokens, setMaxTokens] = useState(provider?.maxTokens ?? 2048);
  const [awsRegion, setAwsRegion] = useState(provider?.awsRegion || 'us-east-1');
  const [awsProfile, setAwsProfile] = useState(provider?.awsProfile ?? 'bedrock');
  const [saving, setSaving] = useState(false);
  const isBedrock = kind === 'bedrock';
  const chooseKind = (value: string) => {
    setKind(value as typeof kind);
    if (!provider) {
      if (value === 'xai') { setName('xAI · Grok'); setBaseUrl('https://api.x.ai/v1'); setModel('grok-4.7'); setApiStyle('chat'); }
      if (value === 'openai') { setName('OpenAI'); setBaseUrl('https://api.openai.com/v1'); setModel('gpt-4o'); setApiStyle('chat'); }
      if (value === 'custom') { setName('Custom model'); setBaseUrl('http://127.0.0.1:11434/v1'); setModel('your-model-name'); setApiStyle('chat'); }
      if (value === 'bedrock') { setName('AWS Bedrock · DeepSeek V3.2'); setBaseUrl(''); setModel('deepseek.v3.2'); setApiStyle('converse'); setAwsRegion('us-east-1'); setAwsProfile('bedrock'); }
    }
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true);
    try { onSaved(await api.saveProvider({ name, kind, baseUrl: isBedrock ? '' : baseUrl, apiStyle: isBedrock ? 'converse' : apiStyle, model, apiKey: apiKey || undefined, temperature: Number(temperature), maxSteps: Number(maxSteps), maxTokens: Number(maxTokens), awsRegion, awsProfile }, provider?.id)); }
    catch (error) { onError(error instanceof Error ? error.message : 'Could not save this provider.'); setSaving(false); }
  };
  return <Modal title={provider ? `Configure ${provider.name}` : 'Bring your own model.'} eyebrow="MODEL PROVIDER" description={isBedrock ? 'Use your existing AWS SSO credentials with the native Bedrock Converse API.' : 'Relay supports OpenAI-compatible APIs and Amazon Bedrock Converse.'} onClose={onClose} wide><form onSubmit={submit} className="modal-form"><div className="form-grid two-columns"><label className="field"><span>Display name</span><input required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></label><label className="field"><span>Provider type</span><select value={kind} onChange={(event) => chooseKind(event.target.value)} disabled={['xai', 'openai', 'bedrock'].includes(provider?.id ?? '')}><option value="custom">Custom / local</option><option value="xai">xAI · Grok</option><option value="openai">OpenAI</option><option value="bedrock">Amazon Bedrock</option></select></label></div>{isBedrock ? <div className="form-grid two-columns"><label className="field"><span>AWS region</span><input required value={awsRegion} onChange={(event) => setAwsRegion(event.target.value)} placeholder="us-east-1" /><small>DeepSeek V3.2 uses in-region inference. Choose a region where it is available to your account.</small></label><label className="field"><span>AWS profile <em>Optional</em></span><input value={awsProfile} onChange={(event) => setAwsProfile(event.target.value)} placeholder="Default AWS credential chain" /><small>Leave blank for the default AWS SSO/profile chain. No AWS key is stored here.</small></label></div> : <div className="form-grid two-columns"><label className="field"><span>Base URL</span><input required type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" /><small>Do not include /chat/completions or /responses.</small></label><label className="field"><span>API style</span><select value={apiStyle} onChange={(event) => setApiStyle(event.target.value as typeof apiStyle)}><option value="chat">Chat Completions · /chat/completions</option><option value="responses">Responses · /responses</option></select></label></div>}<div className="form-grid two-columns"><label className="field"><span>{isBedrock ? 'Model or inference profile ID' : 'Model name'}</span><input required value={model} onChange={(event) => setModel(event.target.value)} placeholder={isBedrock ? 'deepseek.v3.2' : 'provider-model-name'} /><small>{isBedrock ? 'DeepSeek V3.2 supports Converse and client-side tools, not Responses.' : 'Use the exact model identifier from your provider.'}</small></label>{!isBedrock && <label className="field"><span>API key {provider?.hasApiKey && <em>{provider.keyHint} saved</em>}</span><div className="input-with-icon"><KeyRound size={16} /><input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={provider?.hasApiKey ? 'Leave blank to keep saved key' : 'Paste your API key'} required={!provider?.hasApiKey} /></div></label>}</div><div className="form-grid two-columns"><label className="field"><span>Temperature <em>{temperature}</em></span><input type="range" min="0" max="2" step="0.1" value={temperature} onChange={(event) => setTemperature(Number(event.target.value))} /><small>Lower is more predictable; higher is more varied.</small></label><label className="field"><span>Maximum agent steps</span><input type="number" min="1" max="20" step="1" value={maxSteps} onChange={(event) => setMaxSteps(Number(event.target.value))} /><small>A hard stop on model/tool iterations per run.</small></label></div><label className="field"><span>Maximum output tokens per model call</span><input type="number" min="64" max="8192" step="64" value={maxTokens} onChange={(event) => setMaxTokens(Number(event.target.value))} /><small>Explicitly capped to limit cost and Bedrock quota reservation. DeepSeek V3.2 supports up to 8K output tokens.</small></label><div className="security-note">{isBedrock ? <Cloud size={17} /> : <ShieldCheck size={17} />}<div><strong>{isBedrock ? 'SSO stays with AWS. No long-term keys here.' : 'Local setup, not a production vault.'}</strong><p>{isBedrock ? 'Relay uses the standard AWS SDK credential chain on the server. Your role needs bedrock:InvokeModel and access to the selected model. Temporary credentials are refreshed through AWS, not saved in SQLite.' : 'Keys are sent only from the Relay server to the configured endpoint. They are hidden from API responses and never sent to the browser. In this development version they are stored unencrypted in data/relay.db. Keep Relay on localhost.'}</p></div></div><footer className="modal-footer"><a className="text-link" href={isBedrock ? 'https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-deepseek-deepseek-v3-2.html' : 'https://docs.x.ai/developers/tools/function-calling'} target="_blank" rel="noreferrer">{isBedrock ? 'DeepSeek on Bedrock' : 'Function-calling reference'}<ExternalLink size={13} /></a><div className="modal-footer-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={saving}>{saving ? 'Saving…' : 'Save provider'}</button></div></footer></form></Modal>;
}
