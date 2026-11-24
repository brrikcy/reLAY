export function relativeTime(value: string): string {
  const difference = Date.now() - new Date(value).getTime();
  if (difference < 60_000) return 'Just now';
  if (difference < 3_600_000) return `${Math.floor(difference / 60_000)}m ago`;
  if (difference < 86_400_000) return `${Math.floor(difference / 3_600_000)}h ago`;
  if (difference < 604_800_000) return `${Math.floor(difference / 86_400_000)}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value));
}

export function dayLabel(value: string): string {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' }).format(date);
}

export function sameDay(left: string, right: string): boolean {
  return new Date(left).toDateString() === new Date(right).toDateString();
}

export function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

export function intervalLabel(minutes: number): string {
  if (minutes < 60) return `Every ${minutes} minutes`;
  if (minutes % 1440 === 0) return `Every ${minutes / 1440 === 1 ? '' : `${minutes / 1440} `}day${minutes === 1440 ? '' : 's'}`.trim();
  if (minutes % 60 === 0) return `Every ${minutes / 60 === 1 ? '' : `${minutes / 60} `}hour${minutes === 60 ? '' : 's'}`.trim();
  return `Every ${minutes} minutes`;
}

export function initials(name: string): string {
  return name.split(/\s+/).map((word) => word[0]).join('').slice(0, 2).toUpperCase();
}

export function providerLabel(kind: string): string {
  return ({ demo: 'Local demo', xai: 'xAI', openai: 'OpenAI', custom: 'Custom endpoint', bedrock: 'Amazon Bedrock' } as Record<string, string>)[kind] ?? kind;
}

export function prettyJson(value: unknown): string {
  if (typeof value === 'string') {
    try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
  }
  return JSON.stringify(value, null, 2);
}
