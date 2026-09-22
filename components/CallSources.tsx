'use client';

import { useMemo } from 'react';
import type { CallRecord } from '@/lib/types';
import type { DateRange } from '@/lib/dateRange';
import { inRange } from '@/lib/dateRange';

// Where the phone calls actually come from. Every panel answers a different
// question a client asks about the phone line:
//   Source / medium  — which channel produced the call
//   Campaign         — which market's ad spend produced it
//   Search terms     — what the caller literally typed
//   Landing page     — which page they were on before they picked up
//   Device           — how they were browsing
//
// All of it comes from CallRail's own session attribution, so it covers calls
// that carry no utm_* at all (someone arriving through Google organic).

type Row = { label: string; count: number; sub?: string };

function tally(
  records: CallRecord[],
  pick: (r: CallRecord) => string | null,
  sub?: (r: CallRecord) => string | null
): Row[] {
  const m = new Map<string, { count: number; subs: Map<string, number> }>();
  for (const r of records) {
    const key = pick(r);
    if (!key) continue;
    const cur = m.get(key) || { count: 0, subs: new Map<string, number>() };
    cur.count += 1;
    const s = sub?.(r);
    if (s) cur.subs.set(s, (cur.subs.get(s) || 0) + 1);
    m.set(key, cur);
  }
  return [...m.entries()]
    .map(([label, v]) => ({
      label,
      count: v.count,
      sub: v.subs.size
        ? [...v.subs.entries()].sort((a, b) => b[1] - a[1])[0][0]
        : undefined,
    }))
    .sort((a, b) => b.count - a.count);
}

/** A ranked list with an inline proportion bar — reads at a glance without a
 *  chart library, and degrades to a plain list when a dimension is empty. */
function RankedList({
  title,
  note,
  rows,
  total,
  limit = 8,
  empty,
}: {
  title: string;
  note?: string;
  rows: Row[];
  total: number;
  limit?: number;
  empty: string;
}) {
  const shown = rows.slice(0, limit);
  const rest = rows.slice(limit).reduce((a, r) => a + r.count, 0);
  const max = shown[0]?.count || 1;

  return (
    <div className="card card-pad">
      <div className="subsection-label" style={{ marginTop: 0 }}>
        {title}
      </div>
      {note && (
        <p className="section-desc" style={{ margin: '0 0 12px', fontSize: 12 }}>
          {note}
        </p>
      )}
      {!shown.length ? (
        <div className="loading" style={{ padding: '18px 0', fontSize: 13 }}>
          {empty}
        </div>
      ) : (
        <ul className="rank-list">
          {shown.map((r) => (
            <li key={r.label} className="rank-row">
              <div className="rank-head">
                <span className="rank-label" title={r.label}>
                  {r.label}
                </span>
                <span className="rank-count">
                  {r.count.toLocaleString('en-US')}
                  <span className="rank-pct">
                    {total ? ` · ${((r.count / total) * 100).toFixed(0)}%` : ''}
                  </span>
                </span>
              </div>
              <div className="rank-track">
                <div className="rank-fill" style={{ width: `${(r.count / max) * 100}%` }} />
              </div>
              {r.sub && <div className="rank-sub">{r.sub}</div>}
            </li>
          ))}
          {rest > 0 && (
            <li className="rank-row rank-rest">
              <div className="rank-head">
                <span className="rank-label">
                  {rows.length - limit} more
                </span>
                <span className="rank-count">{rest.toLocaleString('en-US')}</span>
              </div>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

export default function CallSources({
  records,
  range,
}: {
  records: CallRecord[];
  range: DateRange;
}) {
  const scoped = useMemo(
    () => records.filter((r) => inRange(r.date, range)),
    [records, range]
  );

  const total = scoped.length;

  const bySource = useMemo(
    () =>
      tally(
        scoped,
        (r) => `${r.source} / ${r.medium}`,
        (r) => (r.campaign ? `mostly ${r.campaign}` : null)
      ),
    [scoped]
  );
  const byCampaign = useMemo(() => tally(scoped, (r) => r.campaign), [scoped]);
  const byKeyword = useMemo(
    () => tally(scoped, (r) => (r.keyword ? r.keyword.replace(/^[["']|[\]"']$/g, '') : null)),
    [scoped]
  );
  const byLanding = useMemo(() => tally(scoped, (r) => r.landing), [scoped]);
  const byDevice = useMemo(() => tally(scoped, (r) => r.device), [scoped]);

  // Calls on a named line (e.g. the Google My Business number) came from a
  // listing rather than the website, which is a different acquisition story.
  const offline = useMemo(
    () => scoped.filter((r) => r.tracker && !/\bpool\b/i.test(r.tracker)).length,
    [scoped]
  );
  const unattributed = useMemo(
    () => scoped.filter((r) => r.source === '(direct)' && r.medium === '(none)').length,
    [scoped]
  );

  if (!total) {
    return (
      <div className="card card-pad">
        <div className="loading" style={{ padding: '32px 0' }}>
          No calls in this period.
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="stat-strip">
        <div className="stat-chip">
          <span className="stat-chip-value">{total.toLocaleString('en-US')}</span>
          <span className="stat-chip-label">Calls in period</span>
        </div>
        <div className="stat-chip">
          <span className="stat-chip-value">
            {total ? `${(((total - unattributed) / total) * 100).toFixed(0)}%` : '—'}
          </span>
          <span className="stat-chip-label">Source identified</span>
        </div>
        <div className="stat-chip">
          <span className="stat-chip-value">{offline.toLocaleString('en-US')}</span>
          <span className="stat-chip-label">From a listing, not the site</span>
        </div>
      </div>

      <div className="grid-2">
        <RankedList
          title="Source / medium"
          note="Where the caller came from. Covers calls with no campaign tags, using CallRail's session data."
          rows={bySource}
          total={total}
          empty="No attributed calls."
        />
        <RankedList
          title="Campaign"
          note="Paid campaigns only — organic and direct calls carry no campaign."
          rows={byCampaign}
          total={byCampaign.reduce((a, r) => a + r.count, 0)}
          empty="No calls from a tagged campaign in this period."
        />
        <RankedList
          title="Search terms driving calls"
          note="What the caller searched before reaching the site (paid search)."
          rows={byKeyword}
          total={byKeyword.reduce((a, r) => a + r.count, 0)}
          empty="No search terms recorded in this period."
        />
        <RankedList
          title="Landing page"
          note="The page the caller entered the site on, before they picked up the phone."
          rows={byLanding}
          total={byLanding.reduce((a, r) => a + r.count, 0)}
          empty="No landing pages recorded in this period."
        />
      </div>

      {byDevice.length > 0 && (
        <div className="device-strip">
          {byDevice.map((d) => (
            <span key={d.label} className="device-chip">
              <strong>{d.label}</strong> {d.count.toLocaleString('en-US')}
              <span className="muted">
                {' '}
                ({((d.count / byDevice.reduce((a, r) => a + r.count, 0)) * 100).toFixed(0)}%)
              </span>
            </span>
          ))}
        </div>
      )}
    </>
  );
}
