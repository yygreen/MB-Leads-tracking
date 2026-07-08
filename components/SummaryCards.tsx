'use client';

import { useMemo } from 'react';
import type { TimelinePoint } from '@/lib/types';
import type { DateRange } from '@/lib/dateRange';
import { inRange } from '@/lib/dateRange';

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

export default function SummaryCards({
  timeline,
  range,
}: {
  timeline: TimelinePoint[];
  range: DateRange;
}) {
  const totals = useMemo(() => {
    const slice = timeline.filter((p) => inRange(p.date, range));
    const sum = (k: keyof TimelinePoint) => slice.reduce((a, p) => a + ((p[k] as number) || 0), 0);
    const callrail = sum('callrail');
    const forms = sum('forms');
    const gbp = sum('gbpCalls');
    const leadtrap = sum('leadtrap');
    const email = sum('email');
    return { callrail, forms, gbp, leadtrap, email, total: callrail + forms + gbp + leadtrap + email };
  }, [timeline, range]);

  const cards = [
    { label: 'Total Leads', value: totals.total, foot: 'All channels combined' },
    { label: 'CallRail Calls', value: totals.callrail, foot: 'Tracked phone calls' },
    { label: 'Form Submissions', value: totals.forms, foot: 'Webflow forms' },
    { label: 'GBP Direct Calls', value: totals.gbp, foot: 'Google profile calls' },
  ];

  return (
    <div className="summary-grid">
      {cards.map((c) => (
        <div key={c.label} className="card card-pad">
          <div className="metric-label">{c.label}</div>
          <div className="metric-value">{fmt(c.value)}</div>
          <div className="metric-foot">{c.foot}</div>
          <div className="metric-accent" />
        </div>
      ))}
    </div>
  );
}
