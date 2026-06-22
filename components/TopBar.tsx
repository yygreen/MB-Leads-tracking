'use client';

import Logo from './Logo';

function formatTimestamp(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function TopBar({
  lastUpdated,
  onRefresh,
  refreshing,
}: {
  lastUpdated: string;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <header className="topbar">
      <div className="shell topbar-inner">
        <div className="brand">
          <Logo height={42} />
          <span className="brand-divider" aria-hidden />
          <span className="brand-sub">Marketing Lead Tracking</span>
        </div>
        <div className="topbar-meta">
          <div className="last-updated">
            Last updated <strong>{formatTimestamp(lastUpdated)}</strong>
          </div>
          <button className="refresh-btn" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>
    </header>
  );
}
