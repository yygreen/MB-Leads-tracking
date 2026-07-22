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
import ChartLegend from './ChartLegend';
import type { DateRange } from '@/lib/dateRange';
import { inRange } from '@/lib/dateRange';

interface DailyRecord {
  date: string;
  city: string;
  state: string | null;
  location_id: string;
  calls: number;
  websiteClicks: number;
  directions: number;
  impressions: number;
}

// One colour per location; Total line uses a distinct slate (like the other charts).
const PALETTE = ['#34abc7', '#1a2744', '#e8734a', '#2f8487', '#c8b893', '#db5b4f'];
const TOTAL_COLOR = '#475569';

const dow = (iso: string) => new Date(iso + 'T00:00:00Z').getUTCDay();
function addDays(iso: string, n: number) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// Bucket a date to the start of its day / ISO-week (Monday) / month.
function bucketStart(iso: string, mode: 'day' | 'week' | 'month') {
  if (mode === 'day') return iso;
  if (mode === 'month') return `${iso.slice(0, 7)}-01`;
  return addDays(iso, -((dow(iso) + 6) % 7)); // Monday of that week
}
function nextBucket(iso: string, mode: 'day' | 'week' | 'month') {
  if (mode === 'day') return addDays(iso, 1);
  if (mode === 'week') return addDays(iso, 7);
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}
function label(iso: string, mode: 'day' | 'week' | 'month') {
  const d = new Date(iso + 'T00:00:00Z');
  if (mode === 'month') {
    const mmm = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
    return `${mmm} ’${iso.slice(2, 4)}`; // e.g. Feb ’26
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export default function GBPTimeline({
  records,
  range,
}: {
  records: DailyRecord[];
  range: DateRange;
}) {
  const { data, series, mode, hasCalls } = useMemo(() => {
    const nameOf = (r: DailyRecord) => `${r.city}${r.state ? `, ${r.state}` : ''}`;

    // Stable colour + order per location, derived from the FULL dataset (not the
    // selected range) so a location keeps the same colour/position when you
    // switch 30 ↔ 90 ↔ 180 days.
    const allTotals = new Map<string, number>();
    for (const r of records) allTotals.set(nameOf(r), (allTotals.get(nameOf(r)) || 0) + r.calls);
    const stable = [...allTotals.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name], i) => ({ name, color: PALETTE[i % PALETTE.length], gid: `gbp-${i}` }));

    // Adaptive granularity: daily for short ranges, weekly, then monthly.
    const rows = records.filter((r) => inRange(r.date, range));
    const span =
      Math.round(
        (new Date(range.to + 'T00:00:00Z').getTime() -
          new Date(range.from + 'T00:00:00Z').getTime()) /
          86400000
      ) + 1;
    const m: 'day' | 'week' | 'month' = span <= 14 ? 'day' : span <= 140 ? 'week' : 'month';

    // Zero-filled buckets across the range so areas stay continuous.
    const buckets = new Map<string, Record<string, number>>();
    let cur = bucketStart(range.from, m);
    let guard = 0;
    while (cur <= range.to && guard++ < 2000) {
      const row: Record<string, number> = {} as any;
      (row as any).date = cur;
      stable.forEach((s) => (row[s.name] = 0));
      buckets.set(cur, row);
      cur = nextBucket(cur, m);
    }
    let inRangeCalls = 0;
    for (const r of rows) {
      inRangeCalls += r.calls;
      const row = buckets.get(bucketStart(r.date, m));
      if (row) row[nameOf(r)] = (row[nameOf(r)] || 0) + r.calls;
    }
    const out = [...buckets.values()].map((row) => ({
      ...row,
      total: stable.reduce((s, se) => s + ((row[se.name] as number) || 0), 0),
    }));
    return { data: out, series: stable, mode: m, hasCalls: inRangeCalls > 0 };
  }, [records, range]);

  const tickGap = Math.max(0, Math.floor(data.length / 12));
  const modeWord = mode === 'day' ? 'daily' : mode === 'week' ? 'weekly' : 'monthly';

  if (!hasCalls) {
    return (
      <div className="card card-pad">
        <div className="loading" style={{ padding: '40px 0' }}>
          No GBP calls in this period.
        </div>
      </div>
    );
  }

  return (
    <div className="card card-pad">
      <div className="row-flex" style={{ marginBottom: 16 }}>
        <div className="metric-label" style={{ textTransform: 'none', fontSize: 13 }}>
          GBP calls by location · {modeWord}
        </div>
      </div>
      <div style={{ width: '100%', height: 340 }}>
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <defs>
              {series.map((s) => (
                <linearGradient key={s.gid} id={s.gid} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={s.color} stopOpacity={0.9} />
                  <stop offset="95%" stopColor={s.color} stopOpacity={0.55} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e6e2da" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(v) => label(String(v), mode)}
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
              allowDecimals={false}
            />
            <Tooltip
              labelFormatter={(v) => label(String(v), mode)}
              contentStyle={{
                borderRadius: 10,
                border: '1px solid #e6e2da',
                fontSize: 12.5,
                boxShadow: '0 4px 16px rgba(26,39,68,0.1)',
              }}
            />
            <Legend content={(p: any) => <ChartLegend payload={p?.payload} />} />
            {series.map((s) => (
              <Area
                key={s.name}
                type="linear"
                dataKey={s.name}
                name={s.name}
                stackId="1"
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3 }}
                fill={`url(#${s.gid})`}
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
