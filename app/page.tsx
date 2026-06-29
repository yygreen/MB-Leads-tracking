'use client';

import { useCallback, useEffect, useState } from 'react';
import type { DashboardData } from '@/lib/types';
import TopBar from '@/components/TopBar';
import SummaryCards from '@/components/SummaryCards';
import ChannelTimeline from '@/components/ChannelTimeline';
import SessionsSparkline from '@/components/SessionsSparkline';
import SourceTimeline from '@/components/SourceTimeline';
import ChannelMixTable from '@/components/ChannelMixTable';
import UTMBreakdown from '@/components/UTMBreakdown';
import GBPLocations from '@/components/GBPLocations';
import SourcesStatus from '@/components/SourcesStatus';

function Section({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="block">
      <div className="shell">
        <div className="section-head">
          <h2 className="section-title">{title}</h2>
          {desc && <p className="section-desc">{desc}</p>}
        </div>
        {children}
      </div>
    </section>
  );
}

export default function Page() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/data', { cache: 'no-store' });
    setData(await res.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetch('/api/refresh-all', { method: 'POST' });
    } catch {
      // refresh is best-effort; we still re-read whatever data is current
    } finally {
      await load();
      setRefreshing(false);
    }
  }, [load]);

  if (!data) {
    return (
      <>
        <TopBar lastUpdated="" onRefresh={() => {}} refreshing={false} />
        <div className="loading">Loading dashboard…</div>
      </>
    );
  }

  return (
    <>
      <TopBar lastUpdated={data.lastUpdated} onRefresh={handleRefresh} refreshing={refreshing} />

      {data.isMock && (
        <div className="mock-banner">
          Showing sample data — live sources connect automatically as API credentials arrive.
        </div>
      )}

      <Section title="Overview" desc="Top-of-funnel marketing activity across all lead sources, last 30 days.">
        <SummaryCards summary={data.summary} />
      </Section>

      <Section
        title="Channel Volume Timeline"
        desc="Daily lead activity by source. Toggle the range to see 30, 90, or 180 days."
      >
        <ChannelTimeline timeline={data.timeline} />
      </Section>

      <Section
        title="Website Traffic"
        desc="GA4 website sessions — overall traffic context, separate from the lead channels above."
      >
        <div style={{ maxWidth: 420 }}>
          <SessionsSparkline timeline={data.timeline} />
        </div>
      </Section>

      <Section title="Channel Mix" desc="Where leads came from over the last 30 days, by volume.">
        <ChannelMixTable rows={data.channelMix} />
      </Section>

      <Section
        title="UTM Source Breakdown"
        desc="Attribution from the live UTM tracking installed on mastermindbehavior.com."
      >
        <UTMBreakdown rows={data.utmSources} />
      </Section>

      <Section
        title="Source / Medium Timeline"
        desc="Daily lead volume by UTM source & medium — where leads come from, over time."
      >
        <SourceTimeline utmTimeline={data.utmTimeline} utmSeries={data.utmSeries} />
      </Section>

      <Section
        title="GBP Per-Location"
        desc="Google Business Profile performance by location. Locations awaiting access are flagged."
      >
        <GBPLocations rows={data.gbpLocations} />
      </Section>

      <Section
        title="Data Sources Status"
        desc="Connection state per source. Today, leads come from CallRail + Webflow Forms; GBP and Leadtrap join the lead totals as they come online. GA4 is website traffic, not leads."
      >
        <SourcesStatus sources={data.sources} />
      </Section>
    </>
  );
}
