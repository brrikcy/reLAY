import { useState } from 'react';
import { Check, ChevronDown, Heart, Wrench } from 'lucide-react';
import type { Bot as BotType, ChatMessage as MessageType, PublicTool } from '../lib/types.ts';
import { prettyJson } from '../lib/utils.ts';
import { api } from '../lib/api.ts';
import { ConversationMessage } from './ConversationMessage.tsx';
import { DateSeparator } from './ConversationTools.tsx';

function ToolActivity({ message, tools }: { message: MessageType; tools: PublicTool[] }) {
  const [expanded, setExpanded] = useState(false);
  const tool = tools.find((candidate) => candidate.name === message.toolName);
  let result = message.content;
  let status: number | undefined;
  try { const parsed = JSON.parse(message.content) as { status?: number; data?: unknown }; status = parsed.status; if (parsed.data !== undefined) result = prettyJson(parsed.data); } catch { /* Keep raw result. */ }
  return <div className="tool-activity"><button className="tool-activity-summary" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}><span className="tool-icon"><Wrench size={14} /></span><span><strong>{message.toolName}</strong><small>{status ? `API responded · HTTP ${status}` : 'Tool response received'}</small></span><span className="tool-success"><Check size={13} />{tool?.method ?? 'API'}</span><ChevronDown size={15} className={expanded ? 'rotate' : ''} /></button>{expanded && <pre className="tool-result">{result.slice(0, 10_000)}</pre>}</div>;
}

export function ChatMessage({ message, previous, bot, tools, messages, onReply, onEdit, onRefresh, onError, highlighted }: { message: MessageType; previous?: MessageType; bot: BotType; tools: PublicTool[]; messages: MessageType[]; onReply: (message: MessageType) => void; onEdit: (message: MessageType) => void; onRefresh: () => void; onError: (message: string) => void; highlighted: boolean }) {
  const isUser = message.role === 'user';
  if (message.role === 'tool') return <ToolActivity message={message} tools={tools} />;
  if (message.role === 'assistant' && !message.content && message.toolCalls) {
    const calls = message.toolCalls as Array<{ function: { name: string } }>;
    return <div className="tool-request-line"><span className="tool-request-icon"><Heart size={13} /></span><span>Preparing to use <strong>{calls.map((call) => call.function.name).join(', ')}</strong></span></div>;
  }
  // Group consecutive messages from the same sender (same role + within 5 min + no reply)
  const grouped = !!(
    previous &&
    previous.role === message.role &&
    !previous.deletedAt &&
    !message.replyTo &&
    !message.pinnedAt &&
    (new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < 5 * 60 * 1000)
  );
  const react = async (emoji: string) => { try { await api.reactMessage(bot.id, message.id, emoji); onRefresh(); } catch (error) { onError(error instanceof Error ? error.message : 'Could not add this reaction.'); } };
  const remove = async () => { if (!window.confirm('Delete this message for everyone in this conversation?')) return; try { await api.deleteMessage(bot.id, message.id); onRefresh(); } catch (error) { onError(error instanceof Error ? error.message : 'Could not delete this message.'); } };
  const pin = async () => { try { await api.pinMessage(bot.id, message.id, !message.pinnedAt); onRefresh(); } catch (error) { onError(error instanceof Error ? error.message : 'Could not update this pin.'); } };
  return <>
    <DateSeparator value={message.createdAt} previous={previous?.createdAt} />
    <ConversationMessage message={message} messages={messages} name={bot.name} color={bot.color} isUser={isUser} highlighted={highlighted} pinned={Boolean(message.pinnedAt)} canPin grouped={grouped} onReply={(target) => onReply(target as MessageType)} onEdit={(target) => onEdit(target as MessageType)} onReact={(_, emoji) => void react(emoji)} onDelete={() => void remove()} onPin={() => void pin()} onError={onError} />
  </>;
}
