import { Sparkles } from 'lucide-react';

interface BotAvatarProps {
  name: string;
  color: string;
  status?: string;
  size?: 'small' | 'medium' | 'large';
  showStatus?: boolean;
}

export function BotAvatar({ name, color, status = 'idle', size = 'medium', showStatus = false }: BotAvatarProps) {
  return (
    <span className={`bot-avatar bot-avatar-${size}`} style={{ '--bot-color': color } as React.CSSProperties} aria-label={`${name} avatar`}>
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <rect x="4" y="4" width="56" height="56" rx="20" fill={color} />
        <path d="M15 36c0-12 7-19 17-19s17 7 17 19v9c0 5-4 9-9 9H24c-5 0-9-4-9-9v-9Z" fill="rgba(255,255,255,.93)" />
        <rect x="23" y="29" width="5" height="9" rx="2.5" fill="#292d29" />
        <rect x="36" y="29" width="5" height="9" rx="2.5" fill="#292d29" />
        <path d="M28 45c2.5 2 5.5 2 8 0" fill="none" stroke="#292d29" strokeWidth="2" strokeLinecap="round" />
        <path d="M32 17v-5m-3 0h6" stroke="rgba(255,255,255,.9)" strokeWidth="2" strokeLinecap="round" />
      </svg>
      {status === 'working' && <span className="avatar-spark"><Sparkles size={10} /></span>}
      {showStatus && <span className={`avatar-presence presence-${status}`} />}
    </span>
  );
}
