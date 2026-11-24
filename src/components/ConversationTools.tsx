import type { ChatMessage, GroupMessage } from '../lib/types.ts';
import { dayLabel, sameDay } from '../lib/utils.ts';

export function DateSeparator({ value, previous }: { value: string; previous?: string }) {
  if (previous && sameDay(value, previous)) return null;
  return <div className="date-separator"><span>{dayLabel(value)}</span></div>;
}

export function isGroupMessage(message: ChatMessage | GroupMessage): message is GroupMessage {
  return 'groupId' in message;
}
