import type { SummaryCards as Summary } from '@/lib/types';

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

export default function SummaryCards({ summary }: { summary: Summary }) {
  const cards = [
    { label: 'Total Leads (30d)', value: summary.totalLeads30d, foot: 'All channels combined' },
    { label: 'CallRail Calls', value: summary.callrailCalls30d, foot: 'Tracked phone calls (30d)' },
    { label: 'Form Submissions', value: summary.formSubmissions30d, foot: 'Webflow forms (30d)' },
    { label: 'GBP Direct Calls', value: summary.gbpDirectCalls30d, foot: 'Google profile calls (30d)' },
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
