'use client';

import { useMemo, useState } from 'react';
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

// Neutral colour for the cumulative Total line — deliberately not one of the
// per-source colours so it reads as the envelope, not a channel.
const TOTAL_COLOR = '#475569';
import type { TimelinePoint } from '@/lib/types';

type Range = 30 | 90 | 180;

const SERIES: Array<{ key: keyof TimelinePoint; name: string; color: string }> = [
  { key: 'callrail', name: 'CallRail', color: '#34abc7' },
  { key: 'forms', name: 'Forms', color: '#1a2744' },
  { key: 'gbpCalls', name: 'GBP Calls', color: '#e8734a' },
  { key: 'leadtrap', name: 'Leadtrap', color: '#c8b893' },
  // GA4 sessions are website traffic (30–150/day), not leads — including them
  // here would dwarf the lead channels. They live in their own context instead.
];

function shortDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export default function ChannelTimeline({ timeline }: { timeline: TimelinePoint[] }) {
  const [range, setRange] = useState<Range>(90);

  const data = useMemo(
    () =>
      timeline.slice(-range).map((p) => ({
        ...p,
        total: SERIES.reduce((sum, s) => sum + ((p[s.key] as number) || 0), 0),
      })),
    [timeline, range]
  );
  const tickGap = range === 30 ? 4 : range === 90 ? 12 : 24;

  return (
    <div className="card card-pad">
      <div className="row-flex" style={{ marginBottom: 16 }}>
        <div className="metric-label" style={{ textTransform: 'none', fontSize: 13 }}>
          Daily activity by source
        </div>
        <div className="toggle">
          {([30, 90, 180] as Range[]).map((r) => (
            <button
              key={r}
              className={r === range ? 'active' : ''}
              onClick={() => setRange(r)}
            >
              {r}d
            </button>
          ))}
        </div>
      </div>
      <div style={{ width: '100%', height: 340 }}>
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <defs>
              {SERIES.map((s) => (
                <linearGradient key={s.key} id={`g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={s.color} stopOpacity={0.9} />
                  <stop offset="95%" stopColor={s.color} stopOpacity={0.55} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e6e2da" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={shortDate}
              interval={tickGap}
              tick={{ fontSize: 11, fill: '#5a5a5a' }}
              tickLine={false}
              axisLine={{ stroke: '#e6e2da' }}
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#5a5a5a' }}
              tickLine={false}
              axisLine={false}
              width={36}
            />
            <Tooltip
              labelFormatter={(v) => shortDate(String(v))}
              contentStyle={{
                borderRadius: 10,
                border: '1px solid #e6e2da',
                fontSize: 12.5,
                boxShadow: '0 4px 16px rgba(26,39,68,0.1)',
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12.5, paddingTop: 8 }} iconType="circle" />
            {SERIES.map((s) => (
              <Area
                key={s.key}
                type="linear"
                dataKey={s.key}
                name={s.name}
                stackId="1"
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3 }}
                fill={`url(#g-${s.key})`}
              />
            ))}
            <Line
              type="linear"
              dataKey="total"
              name="Total"
              stroke={TOTAL_COLOR}
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 3 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
