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
    const callrailAll = sum('callrailAll');
    const callrailFirst = sum('callrailFirst');
    const forms = sum('forms');
    const gbp = sum('gbp');
    const leadtrap = sum('leadtrap');
    const email = sum('email');
    return {
      callrail,
      callrailAll,
      callrailFirst,
      forms,
      gbp,
      leadtrap,
      email,
      total: callrail + forms + gbp + leadtrap + email,
    };
  }, [timeline, range]);

  const totalCard = { label: 'Total Leads', value: totals.total, foot: 'All channels combined' };
  const cards = [
    { label: 'Form Submissions', value: totals.forms, foot: 'Webflow forms' },
    { label: 'GBP Calls', value: totals.gbp, foot: 'Google profile tap-to-call' },
  ];

  // Phone leads as a funnel: every call -> first-time callers -> qualified.
  // "Qualified" = inbound, answered, first-time, past the IVR-adjusted
  // duration bar, deduped by caller — the number that feeds Total Leads.
  const funnel = [
    { label: 'Total calls', value: totals.callrailAll },
    { label: 'First-time callers', value: totals.callrailFirst },
    { label: 'Qualified phone leads', value: totals.callrail },
  ];

  return (
    <div className="summary-grid">
      <div className="card card-pad">
        <div className="metric-label">{totalCard.label}</div>
        <div className="metric-value">{fmt(totalCard.value)}</div>
        <div className="metric-foot">{totalCard.foot}</div>
        <div className="metric-accent" />
      </div>
      <div className="card card-pad">
        <div className="metric-label">Phone Leads (CallRail)</div>
        {funnel.map((f, i) => (
          <div
            key={f.label}
            className="row-flex"
            style={{ alignItems: 'baseline', marginTop: i === 0 ? 10 : 6 }}
          >
            <span className="metric-foot" style={{ marginTop: 0 }}>
              {f.label}
            </span>
            <span
              className="metric-value"
              style={{ fontSize: i === 2 ? 26 : 18, marginLeft: 'auto' }}
            >
              {fmt(f.value)}
            </span>
          </div>
        ))}
        <div className="metric-accent" />
      </div>
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
