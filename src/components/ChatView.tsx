import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Bot, Check, ChevronDown, CircleStop, FileText, Globe2, Hash, Mic, MicOff, MoreHorizontal, Pin, Plus, RefreshCw, Search, ShieldCheck, Sparkles, SquareArrowOutUpRight, X } from 'lucide-react';
import { BotAvatar } from './BotAvatar.tsx';
import type { AllowRule, Approval, Attachment, Bot as BotType, ChatMessage as MessageType, Provider, PublicTool, Run, RunEvent, Skill, UsageBudget } from '../lib/types.ts';
import { AttachmentPanel } from './AttachmentPanel.tsx';
import { ChatMessage } from './ChatMessage.tsx';
import { prettyJson } from '../lib/utils.ts';
import { api } from '../lib/api.ts';
import { useChatNavigation } from '../hooks/useChatNavigation.ts';

interface ChatViewProps {
  bot: BotType;
  provider?: Provider;
  tools: PublicTool[];
  attachments: Attachment[];
  budget?: UsageBudget;
  messages: MessageType[];
  approvals: Approval[];
  allowRules: AllowRule[];
  skills: Skill[];
  activeRun?: Run;
  latestRunEvent?: RunEvent;
  loading: boolean;
  sending: boolean;
  onSend: (message: string, replyTo?: string) => void;
  onStop: () => void;
  onApproval: (id: string, decision: 'approved' | 'denied') => void;
  onAllowRule: (toolName: string) => void;
  onRetry: () => void;
  onEdit: () => void;
  onOpenInspector: () => void;
  onMenu: () => void;
  onConfigureProvider: () => void;
  onBudget: () => void;
  onAttachmentUploaded: (attachment: Attachment) => void;
  onAttachmentDeleted: (attachment: Attachment) => void;
  onError: (message: string) => void;
  notice?: string;
  onBack?: () => void;
}

function ApprovalCard({ approval, onApproval, onAllowRule, disabled }: { approval: Approval; onApproval: (id: string, decision: 'approved' | 'denied') => void; onAllowRule: (toolName: string) => void; disabled: boolean }) {
  const [expanded, setExpanded] = useState(false);
  return <div className="approval-card"><div className="approval-card-header"><span className="approval-shield"><ShieldCheck size={19} /></span><div><span className="eyebrow">YOUR CALL</span><h3>Approve this action?</h3></div><span className="approval-pending">Pending</span></div><p className="approval-explanation">Your bot wants to use <strong>{approval.toolName}</strong>. Review the request before anything is sent to the connected API.</p><button className="approval-details-toggle" onClick={() => setExpanded(!expanded)}><span>Review arguments</span><ChevronDown size={15} className={expanded ? 'rotate' : ''} /></button>{expanded && <pre className="approval-arguments">{prettyJson(approval.arguments)}</pre>}<div className="approval-warning"><ShieldCheck size={13} /><span>This approval applies once. Completed actions cannot be undone.</span></div><div className="approval-actions"><button className="button secondary" onClick={() => onApproval(approval.id, 'denied')} disabled={disabled}>Deny</button><button className="button secondary" onClick={() => { onAllowRule(approval.toolName); onApproval(approval.id, 'approved'); }} disabled={disabled} title="Allow now and automatically in future runs for this tool"><Check size={13} />Always allow</button><button className="button primary" onClick={() => onApproval(approval.id, 'approved')} disabled={disabled}><Check size={15} />Allow once</button></div></div>;
}

export function ChatView({ bot, provider, tools, attachments, budget, messages, approvals, allowRules, skills, activeRun, latestRunEvent, loading, sending, onSend, onStop, onApproval, onAllowRule, onRetry, onEdit, onOpenInspector, onMenu, onConfigureProvider, onBudget, onAttachmentUploaded, onAttachmentDeleted, onError, notice, onBack }: ChatViewProps) {
  const draftKey = `relay.draft.${bot.id}`;
  const [draft, setDraft] = useState(() => sessionStorage.getItem(draftKey) ?? '');
  const [replyTo, setReplyTo] = useState<MessageType>();
  const [editing, setEditing] = useState<MessageType>();
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchIndex, setSearchIndex] = useState(0);
  const [highlighted, setHighlighted] = useState<string>();
  const [noticeVisible, setNoticeVisible] = useState(true);
  const [pinIndex, setPinIndex] = useState(0);
  const [showSkills, setShowSkills] = useState(false);
  const [dictating, setDictating] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const busy = sending || bot.status === 'working' || bot.status === 'waiting';
  const matches = query.trim().length >= 2 ? messages.filter((message) => message.content.toLowerCase().includes(query.trim().toLowerCase())) : [];
  const currentMatch = matches[searchIndex % Math.max(1, matches.length)];
  const pinned = messages.filter((message) => message.pinnedAt).sort((left, right) => right.pinnedAt!.localeCompare(left.pinnedAt!));
  const currentPin = pinned[pinIndex % Math.max(1, pinned.length)];
  const navigation = useChatNavigation(bot.id, messages.length);

  // When loading transitions false→true (spinner) → false (messages), the browser
  // clamps scrollTop because the spinner's scrollHeight is tiny. Restore bottom
  // synchronously before the first paint so the user never sees the top.
  useLayoutEffect(() => {
    if (!loading && navigation.followingLatest.current && navigation.scrollRef.current) {
      navigation.scrollRef.current.scrollTop = navigation.scrollRef.current.scrollHeight;
    }
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps
  const availableSkills = skills.filter((skill) => !skill.botIds.length || skill.botIds.includes(bot.id));
  const toolName = latestRunEvent?.type === 'tool_requested' ? latestRunEvent.title.replace('Requested ', '') : undefined;
  const jumpTo = (id: string) => { navigation.followingLatest.current = false; setHighlighted(id); document.getElementById(`message-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  useEffect(() => { sessionStorage.setItem(draftKey, draft); }, [draft, draftKey]);
  useEffect(() => {
    setDraft(sessionStorage.getItem(draftKey) ?? ''); setReplyTo(undefined); setEditing(undefined); setQuery(''); setSearchOpen(false); setHighlighted(undefined); setPinIndex(0);
    if (inputRef.current) inputRef.current.style.height = 'auto';
  }, [bot.id, draftKey]);
  useEffect(() => { if (currentMatch) jumpTo(currentMatch.id); }, [currentMatch?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setNoticeVisible(true); }, [notice]);
  const refresh = () => { window.dispatchEvent(new CustomEvent('relay:refresh-messages', { detail: { botId: bot.id } })); };
  const submit = () => {
    const value = draft.trim();
    if (!value || (busy && !editing && bot.status === 'waiting')) return;
    if (editing) {
      void api.editMessage(bot.id, editing.id, value).then(() => { setEditing(undefined); setDraft(''); refresh(); }).catch((error) => onError(error instanceof Error ? error.message : 'Could not edit this message.'));
      return;
    }
    onSend(value, replyTo?.id);
    setDraft(''); setReplyTo(undefined);
    if (inputRef.current) inputRef.current.style.height = 'auto';
  };
  const startDictation = () => {
    const SpeechRecognition = (window as unknown as Record<string, unknown>)['SpeechRecognition'] ?? (window as unknown as Record<string, unknown>)['webkitSpeechRecognition'];
    if (!SpeechRecognition) { onError('Speech recognition is not supported in this browser. Use Chrome or Edge.'); return; }
    if (dictating) { setDictating(false); return; }
    const recognition = new (SpeechRecognition as new () => SpeechRecognitionInstance)();
    recognition.continuous = false; recognition.interimResults = false; recognition.lang = 'en-US';
    recognition.onresult = (event: SpeechRecognitionEvent) => { const transcript = event.results[0][0].transcript; setDraft((prev) => `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}${transcript}`); setDictating(false); inputRef.current?.focus(); };
    recognition.onerror = () => { setDictating(false); };
    recognition.onend = () => setDictating(false);
    setDictating(true);
    recognition.start();
  };
  const startEdit = (message: MessageType) => { setEditing(message); setReplyTo(undefined); setDraft(message.content); inputRef.current?.focus(); };
  const startReply = (message: MessageType) => { setReplyTo(message); setEditing(undefined); inputRef.current?.focus(); };
  const cancelCompose = () => { setReplyTo(undefined); setEditing(undefined); setDraft(''); if (inputRef.current) inputRef.current.style.height = 'auto'; };
  return <div className="chat-view">
    <header className="chat-header"><div className="chat-identity">{onBack ? <button className="mobile-back-btn" onClick={onBack} aria-label="Back to chat list"><ArrowLeft size={22} /></button> : <button className="mobile-avatar-button" onClick={onMenu} aria-label="Open bot navigation"><BotAvatar name={bot.name} color={bot.color} size="small" /></button>}<div><button className="bot-name-button" onClick={onEdit}>{bot.name}<ChevronDown size={14} /></button><div className="bot-presence"><span className={`status-dot status-${bot.status}`} />{bot.status === 'working' ? 'Working now' : bot.status === 'waiting' ? 'Waiting for your approval' : bot.status === 'error' ? 'Needs attention' : 'Ready when you are'}{toolName && bot.status === 'working' && <span className="tool-progress-badge">· {toolName}</span>}<span className="meta-divider" />{provider?.kind === 'demo' ? 'Demo mode' : provider?.name}</div></div></div><div className="chat-header-actions"><button className="icon-button" title="Search this conversation" aria-label="Search this conversation" onClick={() => setSearchOpen(!searchOpen)}><Search size={17} /></button><span className="persistent-badge"><span className="tiny-dot" />Memory on</span><button className="icon-button" aria-label="Open activity panel" onClick={onOpenInspector}><FileText size={18} /></button><button className="icon-button" aria-label="Edit bot settings" onClick={onEdit}><MoreHorizontal size={20} /></button></div></header>
    {searchOpen && <div className="chat-search"><Search size={15} /><input autoFocus value={query} onChange={(event) => { setQuery(event.target.value); setSearchIndex(0); }} onKeyDown={(event) => { if (event.key === 'Escape') { setSearchOpen(false); setQuery(''); setHighlighted(undefined); } if (event.key === 'Enter' && matches.length) setSearchIndex((index) => (index + 1) % matches.length); }} placeholder="Search this conversation" aria-label="Search this conversation" />{query.trim().length >= 2 && <span>{matches.length ? `${(searchIndex % matches.length) + 1} of ${matches.length}` : 'No matches'}</span>}<button className="small-icon-button" disabled={!matches.length} aria-label="Previous search result" onClick={() => setSearchIndex((index) => (index - 1 + matches.length) % matches.length)}><ArrowDown size={13} /></button><button className="small-icon-button" disabled={!matches.length} aria-label="Next search result" onClick={() => setSearchIndex((index) => (index + 1) % matches.length)}><ArrowDown size={13} /></button><button className="small-icon-button" aria-label="Close search" onClick={() => { setSearchOpen(false); setQuery(''); setHighlighted(undefined); }}><X size={13} /></button></div>}
    {currentPin && <button className="pinned-message-banner" onClick={() => { jumpTo(currentPin.id); setPinIndex((index) => (index + 1) % pinned.length); }} aria-label={`Jump to pinned message${pinned.length > 1 ? `, ${pinned.length} pinned` : ''}`}><Pin size={14} /><span><strong>Pinned message{pinned.length > 1 ? ` · ${(pinIndex % pinned.length) + 1} of ${pinned.length}` : ''}</strong><small>{currentPin.content.slice(0, 150)}</small></span><ChevronDown size={13} /></button>}
    {allowRules.length > 0 && <div className="allow-rules-banner"><ShieldCheck size={13} /><span>{allowRules.length} tool{allowRules.length === 1 ? '' : 's'} set to always allow. <button className="text-link" onClick={onOpenInspector}>Manage in inspector</button></span></div>}
    <div className="conversation" ref={navigation.scrollRef} onScroll={(event) => navigation.onScroll(event.currentTarget)}>
      <div className="conversation-inner">
        <div className="bot-intro"><BotAvatar name={bot.name} color={bot.color} size="large" /><h1>A little help goes a long way.</h1><p>{bot.description || `${bot.name} is your ${bot.role.toLowerCase()} specialist.`}</p><div className="intro-tags"><span><Sparkles size={12} />{bot.role}</span><span><Hash size={12} />Persistent memory</span></div></div>
        {provider?.kind === 'demo' && <div className="demo-banner"><span className="demo-banner-icon"><Sparkles size={18} /></span><div><strong>You're in demo mode. The workspace is real.</strong><p>Explore the interface, then connect a model provider to give {bot.name} a brain.</p></div><button onClick={onConfigureProvider}>Connect a model<ArrowUp size={14} /></button></div>}
        {notice && noticeVisible && <div className="inline-notice"><span>{notice}</span><button className="icon-button" onClick={() => setNoticeVisible(false)} aria-label="Dismiss notice"><X size={15} /></button></div>}
        {loading ? <div className="messages-loading"><span className="spinner" /><span>Opening your conversation…</span></div> : messages.map((message, index) => <ChatMessage key={message.id} message={message} previous={messages[index - 1]} bot={bot} tools={tools} messages={messages} onReply={startReply} onEdit={startEdit} onRefresh={refresh} onError={onError} highlighted={highlighted === message.id} />)}
        {approvals.map((approval) => <ApprovalCard key={approval.id} approval={approval} onApproval={onApproval} onAllowRule={onAllowRule} disabled={sending} />)}
        {bot.status === 'working' && <div className="working-indicator">
          <span className="working-orbit" aria-hidden="true"><span /><span /><span /></span>
          <span>Working on it{toolName && <em className="working-tool-name"> · {toolName}</em>}</span>
          <small>Watch each step in Activity</small>
        </div>}
        {bot.status === 'error' && <div className="error-recovery"><span>Something went wrong with the last run.</span><button className="button secondary small" onClick={onRetry}><RefreshCw size={13} />Try again</button></div>}
        <div className="conversation-bottom-space" />
      </div>
    </div>
    {navigation.showBottom && <button className="jump-bottom" onClick={navigation.jumpToLatest} aria-label={navigation.unread ? `Jump to ${navigation.unread} new messages` : 'Jump to latest messages'}><ArrowDown size={15} />{navigation.unread ? `${navigation.unread} new message${navigation.unread === 1 ? '' : 's'}` : 'Latest messages'}</button>}
    <div className="composer-area"><div className="composer-inner">
      {replyTo && <div className="reply-composer-preview"><div><strong>Replying to {replyTo.role === 'user' ? 'You' : bot.name}</strong><p>{replyTo.content.slice(0, 180)}</p></div><button className="icon-button" onClick={() => setReplyTo(undefined)} aria-label="Cancel reply"><X size={15} /></button></div>}
      {editing && <div className="reply-composer-preview"><div><strong>Edit your message</strong><p>{editing.content.slice(0, 180)}</p></div><button className="icon-button" onClick={cancelCompose} aria-label="Cancel editing"><X size={15} /></button></div>}
      {showSkills && availableSkills.length > 0 && <div className="skill-picker"><div className="skill-picker-header"><strong>Available skills</strong><button className="icon-button" onClick={() => setShowSkills(false)} aria-label="Close skills"><X size={13} /></button></div>{availableSkills.map((skill) => <button key={skill.id} className="skill-pick-item" onClick={() => { setDraft(skill.instructions.slice(0, 500)); setShowSkills(false); inputRef.current?.focus(); }}><strong>{skill.name}</strong><span>{skill.description}</span></button>)}</div>}
      {busy && !editing && <div className="followup-hint">Type now to queue a follow-up. Up to three can wait for this run.</div>}
      <div className={`composer ${busy ? 'composer-busy' : ''}`}><textarea ref={inputRef} value={draft} onChange={(event) => { setDraft(event.target.value); event.target.style.height = 'auto'; event.target.style.height = `${Math.min(event.target.scrollHeight, 180)}px`; }} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); } if (event.key === 'Escape' && (replyTo || editing)) cancelCompose(); if (event.key === '/' && !draft) { event.preventDefault(); setShowSkills(!showSkills); } }} placeholder={editing ? 'Edit your message…' : replyTo ? 'Write a reply…' : busy ? 'Queue a follow-up…' : `Message ${bot.name}…`} aria-label={`Message ${bot.name}`} rows={1} disabled={editing ? false : bot.status === 'waiting'} />
        <div className="composer-bottom"><div className="composer-tools"><AttachmentPanel botId={bot.id} attachments={attachments} onUploaded={onAttachmentUploaded} onDeleted={onAttachmentDeleted} onError={onError} /><button className={`icon-button ${dictating ? 'composer-mic-active' : ''}`} title={dictating ? 'Stop dictation' : 'Voice dictation (Chrome/Edge)'} aria-label="Voice input" onClick={startDictation}>{dictating ? <MicOff size={16} /> : <Mic size={16} />}</button><button className="budget-button" onClick={onBudget} title="Configure daily usage budget"><span>{budget ? `${budget.remainingRuns} runs · ${budget.remainingTokens.toLocaleString()} tokens left` : 'Daily budget'}</span></button><span className="composer-hint">/ for skills · Documents available</span></div>{activeRun && (bot.status === 'working' || bot.status === 'waiting') ? <button className="stop-button" onClick={onStop} title="Stop this run"><CircleStop size={18} /><span>Stop</span></button> : <button className="send-button" onClick={submit} disabled={!draft.trim() || (busy && !editing && bot.status === 'waiting')} aria-label={editing ? 'Save edited message' : busy ? 'Queue follow-up message' : 'Send message'}>{editing ? <Check size={18} /> : <ArrowUp size={18} />}</button>}</div>
      </div>
      <div className="composer-caption"><span><kbd>Enter</kbd> to send · <kbd>Shift Enter</kbd> for a new line · <kbd>/</kbd> for skills</span><span aria-hidden="true">·</span><span>Local · No delivery receipts</span></div>
    </div></div>
  </div>;
}

// Type shim for Web Speech API (not in all TypeScript lib versions)
interface SpeechRecognitionInstance {
  continuous: boolean; interimResults: boolean; lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
  start(): void;
}
interface SpeechRecognitionEvent { results: SpeechRecognitionResultList; }
interface SpeechRecognitionResultList { [index: number]: SpeechRecognitionResult; }
interface SpeechRecognitionResult { [index: number]: SpeechRecognitionAlternative; }
interface SpeechRecognitionAlternative { transcript: string; }

export function Suggestions({ onSelect, hasTools }: { onSelect: (value: string) => void; hasTools: boolean }) {
  const suggestions = hasTools ? [{ icon: Globe2, title: 'Put your tools to work', prompt: 'What can you do with your connected tools?' }, { icon: FileText, title: 'Make a clear plan', prompt: 'Help me turn a goal into a practical plan.' }] : [{ icon: Sparkles, title: 'See what I can do', prompt: 'What can you help me with?' }, { icon: FileText, title: 'Try my memory', prompt: 'Remember that I prefer concise answers with clear next steps.' }];
  return <div className="suggestion-grid">{suggestions.map(({ icon: Icon, title, prompt }) => <button key={title} onClick={() => onSelect(prompt)}><Icon size={17} /><span>{title}</span><SquareArrowOutUpRight size={13} /></button>)}</div>;
}

export function ChatEmpty({ onNewBot }: { onNewBot: () => void }) {
  return <div className="full-empty"><span className="empty-icon"><Bot size={30} /></span><h1>Good things start with a bot.</h1><p>Create a specialist with its own role, model, tools, and memory.</p><button className="button primary" onClick={onNewBot}><Plus size={16} />Create your first bot</button></div>;
}
