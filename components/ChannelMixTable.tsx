'use client';

import { useMemo, useState } from 'react';
import type { TimelinePoint } from '@/lib/types';

type Range = 30 | 90 | 180;

const CHANNELS: Array<{ channel: string; key: keyof TimelinePoint }> = [
  { channel: 'CallRail', key: 'callrail' },
  { channel: 'Forms', key: 'forms' },
  { channel: 'GBP Calls', key: 'gbpCalls' },
  { channel: 'Leadtrap', key: 'leadtrap' },
];

export default function ChannelMixTable({ timeline }: { timeline: TimelinePoint[] }) {
  const [range, setRange] = useState<Range>(30);

  const rows = useMemo(() => {
    const slice = timeline.slice(-range);
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
      <div className="row-flex" style={{ marginBottom: 16 }}>
        <div className="metric-label" style={{ textTransform: 'none', fontSize: 13 }}>
          Lead share by channel
        </div>
        <div className="toggle">
          {([30, 90, 180] as Range[]).map((r) => (
            <button key={r} className={r === range ? 'active' : ''} onClick={() => setRange(r)}>
              {r}d
            </button>
          ))}
        </div>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Channel</th>
            <th className="num">{range}-day count</th>
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
