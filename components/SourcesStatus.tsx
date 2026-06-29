import type { SourceStatusRow, SourceStatus } from '@/lib/types';

const LABELS: Record<SourceStatus, string> = {
  connected: 'Connected',
  partial: 'Partial',
  pending: 'Pending access',
  no_data: 'No data',
  na: 'Not tracked',
};

export default function SourcesStatus({ sources }: { sources: SourceStatusRow[] }) {
  return (
    <div className="pills">
      {sources.map((s) => (
        <div key={s.key} className="pill">
          <span className={`dot ${s.status}`} />
          <div>
            <div className="pill-label">{s.label}</div>
            {s.detail && <div className="pill-detail">{s.detail}</div>}
          </div>
          <span className={`status-text ${s.status}`}>{LABELS[s.status]}</span>
        </div>
      ))}
    </div>
  );
}
