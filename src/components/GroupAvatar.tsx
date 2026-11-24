import { Users } from 'lucide-react';

/** Deterministic color from group name — same group always gets the same color. */
const palette = ['#4a7c59', '#5b6ea6', '#7a5ba6', '#a6625b', '#5b9ea6', '#a6885b', '#6e8a4a', '#5b6e8a'];
function groupColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return palette[h % palette.length];
}

function initials(name: string): string {
  return name.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

interface GroupAvatarProps {
  name: string;
  size?: 'small' | 'medium' | 'large';
  memberCount?: number;
}

export function GroupAvatar({ name, size = 'medium', memberCount }: GroupAvatarProps) {
  const color = groupColor(name);
  const dim = size === 'small' ? 34 : size === 'large' ? 52 : 42;
  const fontSize = size === 'small' ? 11 : size === 'large' ? 16 : 13;
  const radius = size === 'small' ? 9 : size === 'large' ? 14 : 11;
  return (
    <span
      className={`group-avatar group-avatar-${size}`}
      style={{ width: dim, height: dim, minWidth: dim, background: color, borderRadius: radius, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 1, flexShrink: 0, position: 'relative' }}
      aria-label={`${name} group`}
    >
      {initials(name) ? (
        <span style={{ color: '#fff', fontFamily: 'var(--heading)', fontWeight: 700, fontSize, lineHeight: 1, letterSpacing: '-0.03em' }}>{initials(name)}</span>
      ) : (
        <Users size={fontSize + 2} color="#fff" />
      )}
      {memberCount !== undefined && size !== 'large' && (
        <span style={{ position: 'absolute', bottom: -3, right: -3, background: '#fff', borderRadius: 6, padding: '0 3px', fontSize: 8, fontWeight: 700, color: color, lineHeight: '14px', border: `1px solid ${color}22`, minWidth: 14, textAlign: 'center' }}>{memberCount}</span>
      )}
    </span>
  );
}
