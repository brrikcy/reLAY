import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';

/** Back button + title shown only on mobile (<800px) for non-chat views */
export function MobilePageHeader({ title, onBack, action }: { title: string; onBack?: () => void; action?: ReactNode }) {
  if (!onBack) return null;
  return (
    <div className="mobile-page-header">
      <button className="mobile-back-btn" onClick={onBack} aria-label="Back to list">
        <ArrowLeft size={22} />
      </button>
      <span className="mobile-page-title">{title}</span>
      {action && <div className="mobile-page-action">{action}</div>}
    </div>
  );
}
