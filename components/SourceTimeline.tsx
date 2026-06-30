'use client';

import { useMemo } from 'react';
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
import type { UTMTimelinePoint, UTMSeries } from '@/lib/types';

type Range = 30 | 90 | 180;

// Palette for the source/medium series (assigned by order). "Other" gets a
// neutral grey. The Total line uses a distinct slate, like the channel chart.
const PALETTE = ['#34abc7', '#1a2744', '#e8734a', '#2f8487', '#c8b893', '#db5b4f'];
const OTHER_COLOR = '#9aa5b1';
const TOTAL_COLOR = '#475569';

function shortDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export default function SourceTimeline({
  utmTimeline,
  utmSeries,
  range,
  onRangeChange,
}: {
  utmTimeline: UTMTimelinePoint[];
  utmSeries: UTMSeries[];
  range: Range;
  onRangeChange: (r: Range) => void;
}) {
  const colorFor = (key: string, i: number) =>
    key === 'Other' ? OTHER_COLOR : PALETTE[i % PALETTE.length];

  const data = useMemo(
    () =>
      utmTimeline.slice(-range).map((p) => ({
        ...p,
        total: utmSeries.reduce((sum, s) => sum + ((p[s.key] as number) || 0), 0),
      })),
    [utmTimeline, utmSeries, range]
  );
  const tickGap = range === 30 ? 4 : range === 90 ? 12 : 24;

  if (!utmSeries?.length) {
    return (
      <div className="card card-pad">
        <div className="loading" style={{ padding: '40px 0' }}>
          No source/medium data yet — refresh once leads have flowed in.
        </div>
      </div>
    );
  }

  return (
    <div className="card card-pad">
      <div className="row-flex" style={{ marginBottom: 16 }}>
        <div className="metric-label" style={{ textTransform: 'none', fontSize: 13 }}>
          Daily leads by source / medium
        </div>
        <div className="toggle">
          {([30, 90, 180] as Range[]).map((r) => (
            <button key={r} className={r === range ? 'active' : ''} onClick={() => onRangeChange(r)}>
              {r}d
            </button>
          ))}
        </div>
      </div>
      <div style={{ width: '100%', height: 340 }}>
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <defs>
              {utmSeries.map((s, i) => (
                <linearGradient key={s.key} id={`u-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={colorFor(s.key, i)} stopOpacity={0.9} />
                  <stop offset="95%" stopColor={colorFor(s.key, i)} stopOpacity={0.55} />
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
            {utmSeries.map((s, i) => (
              <Area
                key={s.key}
                type="linear"
                dataKey={s.key}
                name={s.name}
                stackId="1"
                stroke={colorFor(s.key, i)}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3 }}
                fill={`url(#u-${i})`}
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
