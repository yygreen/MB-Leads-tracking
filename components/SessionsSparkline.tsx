'use client';

import { Area, AreaChart, ResponsiveContainer, YAxis, Tooltip } from 'recharts';
import type { TimelinePoint } from '@/lib/types';

function shortDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// Website traffic (GA4 sessions) — kept separate from the lead-volume chart
// because it's on a different scale and isn't a lead channel.
export default function SessionsSparkline({ timeline }: { timeline: TimelinePoint[] }) {
  const last90 = timeline.slice(-90).map((p) => ({ date: p.date, sessions: p.ga4Sessions }));
  const total30 = timeline.slice(-30).reduce((a, p) => a + p.ga4Sessions, 0);
  const live = last90.some((p) => p.sessions > 0);

  return (
    <div className="card card-pad">
      <div className="row-flex" style={{ alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div className="metric-label">Website Sessions · GA4</div>
          <div className="metric-value" style={{ fontSize: 30 }}>
            {total30.toLocaleString('en-US')}
          </div>
          <div className="metric-foot">
            Last 30 days{live ? '' : ' · awaiting GA4 connection'}
          </div>
        </div>
        <span className={`status-text ${live ? 'connected' : 'pending'}`} style={{ marginLeft: 'auto' }}>
          {live ? 'Live' : 'Pending'}
        </span>
      </div>
      <div style={{ width: '100%', height: 60 }}>
        <ResponsiveContainer>
          <AreaChart data={last90} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="sess-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2f8487" stopOpacity={0.32} />
                <stop offset="100%" stopColor="#2f8487" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <YAxis hide domain={[0, 'dataMax']} />
            <Tooltip
              labelFormatter={() => ''}
              formatter={(v: number) => [`${v} sessions`, '']}
              contentStyle={{ borderRadius: 8, border: '1px solid #e6e2da', fontSize: 12 }}
            />
            <Area
              type="linear"
              dataKey="sessions"
              stroke="#2f8487"
              strokeWidth={1.8}
              fill="url(#sess-grad)"
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="metric-foot" style={{ marginTop: 8 }}>90-day trend</div>
    </div>
  );
}
