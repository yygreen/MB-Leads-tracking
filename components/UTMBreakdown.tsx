'use client';

import { useMemo } from 'react';
import type { UTMRecord } from '@/lib/types';
import type { DateRange } from '@/lib/dateRange';
import { inRange } from '@/lib/dateRange';

export default function UTMBreakdown({
  records,
  range,
}: {
  records: UTMRecord[];
  range: DateRange;
}) {
  const rows = useMemo(() => {
    const m = new Map<string, { source: string; medium: string; count: number }>();
    records.forEach((r) => {
      if (!inRange(r.date, range)) return;
      const key = `${r.source}|${r.medium}`;
      const cur = m.get(key) || { source: r.source, medium: r.medium, count: 0 };
      cur.count += 1;
      m.set(key, cur);
    });
    return [...m.values()].sort((a, b) => b.count - a.count);
  }, [records, range]);

  const total = rows.reduce((a, r) => a + r.count, 0) || 1;

  if (!rows.length) {
    return (
      <div className="card card-pad">
        <div className="loading" style={{ padding: '32px 0' }}>
          No attributed leads in this period.
        </div>
      </div>
    );
  }

  return (
    <div className="card card-pad">
      <table className="table">
        <thead>
          <tr>
            <th>UTM source</th>
            <th>Medium</th>
            <th className="num">Count</th>
            <th className="num">%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.source}-${r.medium}`}>
              <td style={{ fontWeight: 600, color: 'var(--navy)' }}>{r.source}</td>
              <td>
                <span className="tag-medium">{r.medium}</span>
              </td>
              <td className="num">{r.count.toLocaleString('en-US')}</td>
              <td className="num muted">{((r.count / total) * 100).toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
