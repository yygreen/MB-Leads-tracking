'use client';

import { useMemo } from 'react';
import type { UTMRecord } from '@/lib/types';
import type { DateRange } from '@/lib/dateRange';
import { inRange } from '@/lib/dateRange';
import { channelOf, CHANNEL_LABELS, CHANNEL_ORDER, type ChannelKey } from '@/lib/channels';

// Leads grouped by the channel a person would name, with the underlying UTM
// tags listed beneath each row. The raw tags are unchanged — this is grouping
// for legibility, not a rewrite of the tagging.

type Row = {
  key: ChannelKey;
  count: number;
  tags: Array<{ label: string; count: number }>;
};

// Enough that Organic & AI search lists every engine rather than truncating the
// AI ones, which are the smallest counts and the most interesting to watch.
const TAGS_SHOWN = 8;

export default function UTMBreakdown({
  records,
  range,
}: {
  records: UTMRecord[];
  range: DateRange;
}) {
  const rows = useMemo<Row[]>(() => {
    const groups = new Map<ChannelKey, Map<string, number>>();
    records.forEach((r) => {
      if (!inRange(r.date, range)) return;
      const key = channelOf(r.source, r.medium);
      const tag = `${r.source} / ${r.medium}`;
      if (!groups.has(key)) groups.set(key, new Map());
      const g = groups.get(key)!;
      g.set(tag, (g.get(tag) || 0) + 1);
    });

    return CHANNEL_ORDER.filter((k) => groups.has(k)).map((key) => {
      const g = groups.get(key)!;
      const tags = [...g.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count);
      return { key, count: tags.reduce((a, t) => a + t.count, 0), tags };
    });
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
            <th>Channel</th>
            <th className="num">Leads</th>
            <th className="num">%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>
                <span style={{ fontWeight: 600, color: 'var(--navy)' }}>
                  {CHANNEL_LABELS[r.key]}
                </span>
                {/* The raw tags behind the group, so the grouping is always
                    auditable against the UTM data. */}
                <div className="cell-sub">
                  {r.tags
                    .slice(0, TAGS_SHOWN)
                    .map((t) => `${t.label} (${t.count})`)
                    .join(' · ')}
                  {r.tags.length > TAGS_SHOWN && ` · +${r.tags.length - TAGS_SHOWN} more`}
                </div>
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
