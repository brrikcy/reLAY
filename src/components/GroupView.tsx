import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, AudioLines, Check, ChevronDown, Download, GitBranch, Headphones, Info, Mic, PhoneOff, Plus, Search, ShieldCheck, Users, Volume2, Wrench, X } from 'lucide-react';
import { api } from '../lib/api.ts';
import type { Approval, Attachment, Bot as BotType, Group, GroupMessage } from '../lib/types.ts';
import { AttachmentPanel } from './AttachmentPanel.tsx';
import { BotAvatar } from './BotAvatar.tsx';
import { useGroupVoice } from '../hooks/useGroupVoice.ts';
import { relativeTime } from '../lib/utils.ts';
import { ConversationMessage } from './ConversationMessage.tsx';
import { DateSeparator } from './ConversationTools.tsx';
import { useChatNavigation } from '../hooks/useChatNavigation.ts';

interface GroupViewProps {
  group: Group;
  bots: BotType[];
  messages: GroupMessage[];
  approvals: Approval[];
  onApproval: (id: string, decision: 'approved' | 'denied') => void;
  onNewGroup: () => void;
  onSelectGroup: (id: string) => void;
  groups: Group[];
  onError: (message: string) => void;
  attachments: Attachment[];
  onAttachmentUploaded: (attachment: Attachment) => void;
  onAttachmentDeleted: (attachment: Attachment) => void;
  onBack?: () => void;
}

export function GroupView({ group, bots, messages, approvals, onApproval, onNewGroup, onSelectGroup, groups, onError, attachments, onAttachmentUploaded, onAttachmentDeleted, onBack }: GroupViewProps) {
  const draftKey = `relay.draft.group.${group.id}`;
  const [draft, setDraft] = useState(() => sessionStorage.getItem(draftKey) ?? '');
  const [recipients, setRecipients] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<GroupMessage>();
  const [editing, setEditing] = useState<GroupMessage>();
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchIndex, setSearchIndex] = useState(0);
  const [highlighted, setHighlighted] = useState<string>();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const members = group.botIds.map((id) => bots.find((bot) => bot.id === id)).filter((bot): bot is BotType => Boolean(bot));
  const busy = members.some((bot) => ['working', 'waiting'].includes(bot.status));
  const navigation = useChatNavigation(group.id, messages.length);
  const matches = query.trim().length >= 2 ? messages.filter((message) => message.content.toLowerCase().includes(query.trim().toLowerCase())) : [];
  const currentMatch = matches[searchIndex % Math.max(1, matches.length)];
  const jumpTo = (id: string) => { navigation.followingLatest.current = false; setHighlighted(id); document.getElementById(`message-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  const send = useCallback(async (text: string, inputMode: 'text' | 'voice'): Promise<boolean> => {
    if (!text.trim() || sending) return false;
    setSending(true);
    try {
      await api.sendGroup(group.id, text.trim(), recipients, inputMode, replyTo?.id);
      setDraft(''); setReplyTo(undefined);
      if (inputRef.current) inputRef.current.style.height = 'auto';
      return true;
    } catch (error) { onError(error instanceof Error ? error.message : 'Could not send this group message.'); return false; }
    finally { setSending(false); }
  }, [group.id, onError, recipients, replyTo?.id, sending]);
  const voice = useGroupVoice(members, (transcript) => send(transcript, 'voice'), (message) => onError(message));
  const voiceActive = voice.status !== 'off' && voice.status !== 'error';
  const voiceTitle = voice.status === 'off' ? 'Your voice room is off' : voice.status === 'starting' ? 'Opening your voice room…' : voice.status === 'listening' ? 'Listening…' : voice.status === 'processing' ? 'Thinking it over…' : voice.status === 'speaking' ? `${bots.find((bot) => bot.id === voice.speakerId)?.name ?? 'Your bot'} is speaking` : 'Voice needs attention';
  useEffect(() => { sessionStorage.setItem(draftKey, draft); }, [draft, draftKey]);
  useEffect(() => {
    voice.stop(); setRecipients([]); setDraft(sessionStorage.getItem(draftKey) ?? ''); setReplyTo(undefined); setEditing(undefined); setQuery(''); setSearchOpen(false); setHighlighted(undefined);
  }, [group.id, draftKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const spoken = [...messages].reverse().find((message) => message.role === 'assistant' && message.botId && message.content && !message.deletedAt);
    if (spoken?.botId) voice.speak(spoken.id, spoken.botId, spoken.content);
  }, [messages, voice.speak]);
  useEffect(() => { if (currentMatch) jumpTo(currentMatch.id); }, [currentMatch?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [mention, setMention] = useState<string | null>(null);
  const mentionMatches = mention !== null ? members.filter((bot) => bot.name.toLowerCase().startsWith(mention)) : [];
  const handleDraftChange = (value: string) => {
    setDraft(value);
    const atPos = value.lastIndexOf('@');
    if (atPos !== -1 && /^[\w]*$/.test(value.slice(atPos + 1))) setMention(value.slice(atPos + 1).toLowerCase());
    else setMention(null);
  };
  const pickMention = (name: string) => {
    const atPos = draft.lastIndexOf('@');
    if (atPos !== -1) setDraft(draft.slice(0, atPos) + '@' + name + ' ');
    setMention(null);
    inputRef.current?.focus();
  };
  const toggleRecipient = (id: string) => setRecipients((current) => current.includes(id) ? current.filter((botId) => botId !== id) : [...current, id]);
  const insertMention = (name: string) => setDraft((current) => `${current}${current && !current.endsWith(' ') ? ' ' : ''}@${name} `);
  const submit = () => {
    if (editing) {
      const value = draft.trim(); if (!value) return;
      void api.editGroupMessage(group.id, editing.id, value).then(() => { setEditing(undefined); setDraft(''); }).catch((error) => onError(error instanceof Error ? error.message : 'Could not edit this message.'));
      return;
    }
    void send(draft, 'text');
  };
  const react = (message: GroupMessage, emoji: string) => { void api.reactGroupMessage(group.id, message.id, emoji).catch((error) => onError(error instanceof Error ? error.message : 'Could not react to this message.')); };
  const remove = (message: GroupMessage) => { if (window.confirm('Delete this message from the room?')) void api.deleteGroupMessage(group.id, message.id).catch((error) => onError(error instanceof Error ? error.message : 'Could not delete this message.')); };

  return <div className="group-view"><header className="group-header"><div className="group-heading">{onBack && <button className="mobile-back-btn" onClick={onBack} aria-label="Back to chat list"><ArrowLeft size={22} /></button>}<span className="group-symbol"><Users size={19} /></span><div><div className="group-title-row"><h1>{group.name}</h1><span className="live-badge">SHARED ROOM</span><div className="group-switcher"><select aria-label="Switch group room" value={group.id} onChange={(event) => onSelectGroup(event.target.value)}>{groups.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={12} /></div></div><p>{members.length} specialists · shared context · individual memories</p></div></div><div className="group-header-actions"><button className="icon-button" aria-label="Search this room" onClick={() => setSearchOpen(!searchOpen)}><Search size={17} /></button><a className="button secondary small" href={`/api/groups/${group.id}/export`} download aria-label="Export group conversation"><Download size={14} />Export</a><button className="button secondary small" onClick={onNewGroup}><Plus size={14} />New room</button><button className={`button small voice-toggle ${voiceActive ? 'voice-active' : ''}`} onClick={voiceActive ? voice.stop : () => { voice.prime(); voice.start(); }}><AudioLines size={15} />{voiceActive ? 'End live room' : 'Start live voice'}</button></div></header>
    {searchOpen && <div className="chat-search"><Search size={15} /><input autoFocus value={query} onChange={(event) => { setQuery(event.target.value); setSearchIndex(0); }} onKeyDown={(event) => { if (event.key === 'Escape') { setSearchOpen(false); setQuery(''); setHighlighted(undefined); } if (event.key === 'Enter' && matches.length) setSearchIndex((index) => (index + 1) % matches.length); }} placeholder="Search this room" aria-label="Search this room" />{query.trim().length >= 2 && <span>{matches.length ? `${(searchIndex % matches.length) + 1} of ${matches.length}` : 'No matches'}</span>}<button className="small-icon-button" disabled={!matches.length} aria-label="Previous room search result" onClick={() => setSearchIndex((index) => (index - 1 + matches.length) % matches.length)}><ArrowUp size={13} /></button><button className="small-icon-button" disabled={!matches.length} aria-label="Next room search result" onClick={() => setSearchIndex((index) => (index + 1) % matches.length)}><ArrowDown size={13} /></button><button className="small-icon-button" aria-label="Close room search" onClick={() => { setSearchOpen(false); setQuery(''); setHighlighted(undefined); }}><X size={13} /></button></div>}
    <div className="group-body"><section className="group-conversation"><div className="group-roster">{members.map((bot) => <button key={bot.id} className={`member-chip ${recipients.includes(bot.id) ? 'recipient-selected' : ''} ${voice.speakerId === bot.id ? 'member-speaking' : ''}`} onClick={() => toggleRecipient(bot.id)} title={`${recipients.includes(bot.id) ? 'Remove' : 'Add'} ${bot.name} as a recipient`}><BotAvatar name={bot.name} color={bot.color} status={bot.status} size="small" showStatus /><span><strong>{bot.name}</strong><small>{bot.role}</small></span>{recipients.includes(bot.id) ? <Check size={13} /> : <Plus size={12} />}</button>)}</div>
      <div className="group-transcript" ref={navigation.scrollRef} onScroll={(event) => navigation.onScroll(event.currentTarget)}><div className="group-transcript-inner"><div className="group-context-note"><Users size={13} /><span>One shared conversation. Each bot keeps its own private memory.</span></div>
        {messages.map((message, index) => {
          if (message.role === 'system') return <div className="group-system-message" key={message.id}><Info size={13} /><span>{message.content}</span></div>;
          if (message.role === 'handoff') return <div className="handoff-message" key={message.id}><span className="handoff-icon"><GitBranch size={13} /></span><div><strong>Specialist handoff</strong><p>{message.content}</p><time>{relativeTime(message.createdAt)}</time></div></div>;
          const bot = message.botId ? bots.find((candidate) => candidate.id === message.botId) : undefined;
          const isUser = message.role === 'user';
          const prevMsg = messages[index - 1];
          const grouped = !!(prevMsg && prevMsg.role === message.role && !prevMsg.deletedAt && !message.replyTo && (('botId' in prevMsg && 'botId' in message) ? prevMsg.botId === message.botId : true) && (new Date(message.createdAt).getTime() - new Date(prevMsg.createdAt).getTime() < 5*60*1000));
          const previous = messages[index - 1];
          return <div key={message.id}><DateSeparator value={message.createdAt} previous={previous?.createdAt} /><ConversationMessage message={message} messages={messages} name={bot?.name ?? 'You'} color={bot?.color ?? '#ed704e'} isUser={isUser} highlighted={highlighted === message.id} grouped={grouped} onReply={(target) => { setReplyTo(target as GroupMessage); setEditing(undefined); inputRef.current?.focus(); }} onEdit={isUser ? (target) => { setEditing(target as GroupMessage); setReplyTo(undefined); setDraft(target.content); inputRef.current?.focus(); } : undefined} onReact={(target, emoji) => react(target as GroupMessage, emoji)} onDelete={(target) => remove(target as GroupMessage)} onSpeak={bot && voiceActive ? (target) => voice.speak(`${target.id}-replay-${Date.now()}`, bot.id, target.content) : undefined} onError={onError} /></div>;
        })}
        {approvals.map((approval) => <div className="group-approval-card" key={approval.id}><div className="approval-card-header"><span className="approval-shield"><ShieldCheck size={17} /></span><div><span className="eyebrow">ROOM APPROVAL</span><h3>{bots.find((bot) => bot.id === approval.botId)?.name ?? 'A specialist'} wants to act</h3></div></div><p>Allow <strong>{approval.toolName}</strong> with the proposed arguments?</p><pre>{JSON.stringify(approval.arguments, null, 2)}</pre><div className="approval-actions"><button className="button secondary" onClick={() => onApproval(approval.id, 'denied')}><X size={14} />Deny</button><button className="button primary" onClick={() => onApproval(approval.id, 'approved')}><Check size={14} />Allow once</button></div></div>)}
        {busy && <div className="group-working"><span className="tiny-spinner" />{members.filter((bot) => bot.status === 'working').map((bot) => bot.name).join(' & ') || 'The team'} is working. You can queue a follow-up.</div>}
      </div></div>
      {navigation.showBottom && <button className="jump-bottom group-jump-bottom" onClick={navigation.jumpToLatest} aria-label={navigation.unread ? `Jump to ${navigation.unread} new room messages` : 'Jump to latest room messages'}><ArrowDown size={15} />{navigation.unread ? `${navigation.unread} new message${navigation.unread === 1 ? '' : 's'}` : 'Latest messages'}</button>}
      <div className="group-composer-area"><div className="group-mention-row"><span>TO</span><button className={!recipients.length ? 'selected' : ''} onClick={() => setRecipients([])}>{bots.find((bot) => bot.id === group.coordinatorId)?.name ?? 'Coordinator'}<small>default</small></button><button className={recipients.length === members.length ? 'selected' : ''} onClick={() => setRecipients(members.map((bot) => bot.id))}>Everyone<small>{members.length}</small></button>{members.map((bot) => <button key={bot.id} className={recipients.includes(bot.id) ? 'selected' : ''} onClick={() => toggleRecipient(bot.id)}>@{bot.name}</button>)}</div>
        {replyTo && <div className="reply-composer-preview"><div><strong>Replying to {replyTo.role === 'user' ? 'You' : bots.find((bot) => bot.id === replyTo.botId)?.name ?? 'Specialist'}</strong><p>{replyTo.content.slice(0, 180)}</p></div><button className="icon-button" onClick={() => setReplyTo(undefined)} aria-label="Cancel room reply"><X size={15} /></button></div>}
        {editing && <div className="reply-composer-preview"><div><strong>Edit your room message</strong><p>{editing.content.slice(0, 180)}</p></div><button className="icon-button" onClick={() => { setEditing(undefined); setDraft(''); }} aria-label="Cancel room editing"><X size={15} /></button></div>}
        <div className="group-composer"><textarea ref={inputRef} aria-label={`Message ${group.name}`} placeholder={editing ? 'Edit your room message…' : busy ? 'Queue a follow-up for the team…' : 'Message the team, or @mention a specialist…'} value={draft} onChange={(event) => { handleDraftChange(event.target.value); event.target.style.height = 'auto'; event.target.style.height = `${Math.min(event.target.scrollHeight, 150)}px`; }} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); } if (event.key === 'Escape' && (replyTo || editing)) { setReplyTo(undefined); setEditing(undefined); setDraft(''); } if (event.key === 'Escape' && mention !== null) setMention(null); }} rows={1} disabled={sending} />{mentionMatches.length > 0 && <div className="mention-dropdown">{mentionMatches.map((bot) => <button key={bot.id} className="mention-pick" onClick={() => pickMention(bot.name)}><strong>@{bot.name}</strong><span>{bot.role}</span></button>)}</div>}<div className="group-composer-bottom"><div><AttachmentPanel groupId={group.id} attachments={attachments} onUploaded={onAttachmentUploaded} onDeleted={onAttachmentDeleted} onError={onError} /><span className="group-composer-caption">Enter to send · Shift Enter for a new line</span></div><button className="send-button" aria-label={editing ? 'Save edited room message' : 'Send room message'} onClick={submit} disabled={!draft.trim() || sending}>{editing ? <Check size={18} /> : <ArrowUp size={18} />}</button></div></div>
      </div>
    </section>
    <aside className={`voice-panel ${voiceActive ? 'voice-panel-active' : ''}`}><div className="voice-panel-heading"><span className="eyebrow">LIVE VOICE</span><span className={`voice-status-dot ${voiceActive ? 'active' : ''}`} /></div><div className="voice-orb"><AudioLines size={29} /></div><h2>{voiceTitle}</h2><p>{voice.interim || (voiceActive ? 'Speak naturally. Relay transcribes with AWS and plays bot replies in your browser.' : 'Start a voice room for hands-free conversation with your specialists.')}</p>{voice.voiceNotice && <div className="voice-notice"><Info size={13} />{voice.voiceNotice}</div>}<div className="voice-controls">{voiceActive ? <><button className="voice-mic-button" onClick={voice.status === 'listening' ? voice.finishTalking : voice.beginTalking} aria-label={voice.status === 'listening' ? 'Finish speaking' : 'Start speaking'}><Mic size={20} /></button><button className="icon-button" onClick={voice.stop} aria-label="End voice room"><PhoneOff size={18} /></button></> : <button className="button primary" onClick={() => { voice.prime(); voice.start(); }}><Mic size={16} />Start microphone</button>}</div><div className="voice-members">{members.map((bot) => <div className="live-member-list" key={bot.id}><BotAvatar name={bot.name} color={bot.color} size="small" /><span><strong>{bot.name}</strong><small>{bot.status === 'working' ? 'Working…' : bot.role}</small></span>{voice.speakerId === bot.id && <Volume2 size={14} />}</div>)}</div><div className="room-tip"><Headphones size={15} /><p>Microphone access requires browser permission. Audio is streamed for transcription and is not stored by Relay.</p></div><button className="room-mention-tip" onClick={() => insertMention(members[0]?.name ?? '')}><Wrench size={12} />Insert an @mention</button></aside>
    </div></div>;
}
