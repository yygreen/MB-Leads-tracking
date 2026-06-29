'use client';

import { useState } from 'react';
import type { UTMWindows } from '@/lib/types';

type Range = '30' | '90' | '180';

export default function UTMBreakdown({ windows }: { windows: UTMWindows }) {
  const [range, setRange] = useState<Range>('30');
  const rows = windows[range] || [];
  const total = rows.reduce((a, r) => a + r.count, 0) || 1;

  return (
    <div className="card card-pad">
      <div className="row-flex" style={{ marginBottom: 16 }}>
        <div className="metric-label" style={{ textTransform: 'none', fontSize: 13 }}>
          Attribution by source / medium
        </div>
        <div className="toggle">
          {(['30', '90', '180'] as Range[]).map((r) => (
            <button key={r} className={r === range ? 'active' : ''} onClick={() => setRange(r)}>
              {r}d
            </button>
          ))}
        </div>
      </div>
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
