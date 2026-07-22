'use client';

import { useMemo } from 'react';
import type { TimelinePoint } from '@/lib/types';
import type { DateRange } from '@/lib/dateRange';
import { inRange } from '@/lib/dateRange';

const CHANNELS: Array<{ channel: string; key: keyof TimelinePoint }> = [
  { channel: 'CallRail', key: 'callrail' },
  { channel: 'Forms', key: 'forms' },
  { channel: 'Leadtrap', key: 'leadtrap' },
  { channel: 'Email', key: 'email' },
];

export default function ChannelMixTable({
  timeline,
  range,
}: {
  timeline: TimelinePoint[];
  range: DateRange;
}) {
  const rows = useMemo(() => {
    const slice = timeline.filter((p) => inRange(p.date, range));
    const counts = CHANNELS.map((c) => ({
      channel: c.channel,
      count: slice.reduce((a, p) => a + ((p[c.key] as number) || 0), 0),
    }));
    const total = counts.reduce((a, c) => a + c.count, 0) || 1;
    return counts
      .map((c) => ({ ...c, pct: Math.round((c.count / total) * 1000) / 10 }))
      .sort((a, b) => b.count - a.count);
  }, [timeline, range]);

  const max = Math.max(1, ...rows.map((r) => r.count));

  return (
    <div className="card card-pad">
      <table className="table">
        <thead>
          <tr>
            <th>Channel</th>
            <th className="num">Count</th>
            <th style={{ width: '38%' }}>Share</th>
            <th className="num">% of total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.channel}>
              <td style={{ fontWeight: 600, color: 'var(--navy)' }}>{r.channel}</td>
              <td className="num">{r.count.toLocaleString('en-US')}</td>
              <td className="bar-cell">
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${(r.count / max) * 100}%` }} />
                </div>
              </td>
              <td className="num">{r.pct.toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
