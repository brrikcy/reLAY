import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Edit2, MoreHorizontal, Pin, PinOff, Reply, Smile, Trash2, Volume2, X } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BotAvatar } from './BotAvatar.tsx';
import type { ChatMessage, GroupMessage } from '../lib/types.ts';
import { formatTime } from '../lib/utils.ts';

const reactionChoices = ['👍','❤️','😂','😮','😢','🙏'];
type Message = ChatMessage | GroupMessage;

export function ConversationMessage({ message, messages, name, color, isUser, highlighted, pinned, canPin, grouped, onReply, onEdit, onReact, onDelete, onPin, onSpeak, onError }: {
  message: Message;
  messages: Message[];
  name: string;
  color: string;
  isUser: boolean;
  highlighted: boolean;
  pinned?: boolean;
  canPin?: boolean;
  grouped?: boolean;
  onReply: (message: Message) => void;
  onEdit?: (message: Message) => void;
  onReact: (message: Message, emoji: string) => void;
  onDelete: (message: Message) => void;
  onPin?: (message: Message) => void;
  onSpeak?: (message: Message) => void;
  onError: (message: string) => void;
}) {
  const [menu, setMenu] = useState(false);
  const [reactions, setReactions] = useState(false);
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const root = useRef<HTMLElement>(null);
  const reply = message.replyTo ? messages.find((candidate) => candidate.id === message.replyTo) : undefined;
  const deleted = Boolean(message.deletedAt);
  const isRoutine = 'source' in message && message.source === 'routine';
  const isVoice = 'inputMode' in message && message.inputMode === 'voice';

  useEffect(() => {
    if (!menu && !reactions) return;
    const close = (event: Event) => {
      if (event.type === 'keydown' && (event as KeyboardEvent).key === 'Escape') { setMenu(false); setReactions(false); return; }
      if (event.type === 'pointerdown' && root.current && !root.current.contains(event.target as Node)) { setMenu(false); setReactions(false); }
    };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
  }, [menu, reactions]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(message.content); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { onError('Clipboard permission was denied.'); }
  };
  const speak = () => {
    if (speaking) { window.speechSynthesis.cancel(); setSpeaking(false); return; }
    if (!('speechSynthesis' in window)) { onError('Speech playback is not supported in this browser.'); return; }
    const utterance = new SpeechSynthesisUtterance(message.content.replace(/[*_`#>[\]()]/g, '').slice(0, 1600));
    utterance.onend = () => setSpeaking(false); utterance.onerror = () => setSpeaking(false);
    setSpeaking(true); window.speechSynthesis.speak(utterance);
  };

  const rowClass = [
    'message-row',
    isUser ? 'user-message-row' : 'assistant-message-row',
    grouped ? 'grouped-row' : '',
    highlighted ? 'message-highlighted' : '',
    pinned ? 'message-pinned' : '',
  ].filter(Boolean).join(' ');

  const bubbleClass = [
    'message-bubble',
    isUser ? 'user-bubble' : '',
    deleted ? 'message-deleted' : '',
    grouped ? 'bubble-grouped' : 'bubble-first',
  ].filter(Boolean).join(' ');

  return (
    <article ref={root} className={rowClass} id={`message-${message.id}`}>
      {/* Avatar: shown for first message in sequence, spacer for grouped */}
      {!isUser && (
        grouped
          ? <span className="avatar-spacer" aria-hidden="true" />
          : <BotAvatar name={name} color={color} size="small" />
      )}

      <div className="message-content">
        <div className={bubbleClass}>
          {/* Sender name: only on first bot message in sequence */}
          {!isUser && !grouped && (
            <div className="bubble-sender">{name}{isRoutine && <span className="source-tag">ROUTINE</span>}{isVoice && <span className="source-tag">VOICE</span>}</div>
          )}

          {/* Quoted reply */}
          {reply && (
            <button className="reply-quote" onClick={() => document.getElementById(`message-${reply.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
              <strong>{reply.role === 'user' ? 'You' : name}</strong>
              <span>{reply.content.slice(0, 160)}</span>
            </button>
          )}

          {/* Message body */}
          {deleted
            ? <em className="deleted-text">This message was deleted.</em>
            : <Markdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a> }}>{message.content}</Markdown>
          }

          {/* Timestamp + edited — inside bubble, bottom right */}
          <div className="bubble-footer">
            {message.editedAt && <span className="edited-label">edited</span>}
            {isUser && isRoutine && <span className="source-tag">ROUTINE</span>}
            {isUser && isVoice && <span className="source-tag">VOICE</span>}
            <time className="bubble-time" dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
          </div>
        </div>

        {/* Reactions: below bubble */}
        {Object.keys(message.reactions ?? {}).length > 0 && (
          <div className="message-reactions">
            {Object.entries(message.reactions ?? {}).map(([emoji, count]) => (
              <button key={emoji} onClick={() => onReact(message, emoji)} aria-label={`React ${emoji}`}>{emoji}<small>{count}</small></button>
            ))}
          </div>
        )}

        {/* Action bar: appears on hover */}
        {!deleted && (
          <div className="message-actions" aria-label="Message actions">
            <button className="small-icon-button" title="Reply" aria-label="Reply" onClick={() => onReply(message)}><Reply size={13} /></button>
            <button className="small-icon-button" title="React" aria-label="React" onClick={() => { setReactions(!reactions); setMenu(false); }}><Smile size={13} /></button>
            <button className="small-icon-button" title="Copy" aria-label="Copy" onClick={() => void copy()}>{copied ? <Check size={13} /> : <Copy size={13} />}</button>
            {isUser && onEdit && <button className="small-icon-button" title="Edit" aria-label="Edit" onClick={() => onEdit(message)}><Edit2 size={13} /></button>}
            <button className="small-icon-button" title="More" aria-label="More actions" aria-expanded={menu} onClick={() => { setMenu(!menu); setReactions(false); }}><MoreHorizontal size={13} /></button>
            {menu && (
              <div className="message-action-menu">
                <button onClick={() => { onReply(message); setMenu(false); }}><Reply size={12} />Reply</button>
                {isUser && onEdit && <button onClick={() => { onEdit(message); setMenu(false); }}><Edit2 size={12} />Edit</button>}
                <button onClick={() => void copy()}><Copy size={12} />Copy text</button>
                {(onSpeak || !isUser) && <button onClick={() => { if (onSpeak) onSpeak(message); else speak(); setMenu(false); }}><Volume2 size={12} />{speaking ? 'Stop' : 'Read aloud'}</button>}
                {canPin && onPin && <button onClick={() => { onPin(message); setMenu(false); }}>{pinned ? <PinOff size={12} /> : <Pin size={12} />}{pinned ? 'Unpin' : 'Pin'}</button>}
                <button className="danger-text" onClick={() => { onDelete(message); setMenu(false); }}><Trash2 size={12} />Delete</button>
              </div>
            )}
            {reactions && (
              <div className="reaction-picker">
                {reactionChoices.map((emoji) => <button key={emoji} onClick={() => { onReact(message, emoji); setReactions(false); }} aria-label={`React ${emoji}`}>{emoji}</button>)}
                <button onClick={() => setReactions(false)} aria-label="Close reactions"><X size={12} /></button>
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
