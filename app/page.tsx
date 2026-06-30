'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DashboardData } from '@/lib/types';
import type { DateRange, PresetKey } from '@/lib/dateRange';
import { presetRange } from '@/lib/dateRange';
import TopBar from '@/components/TopBar';
import PeriodControl from '@/components/PeriodControl';
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
  const [presetKey, setPresetKey] = useState<PresetKey>('last30');
  const [customRange, setCustomRange] = useState<DateRange | null>(null);
  // Each trend timeline owns a rolling range; its companion table mirrors it.
  const [channelRange, setChannelRange] = useState<30 | 90 | 180>(90);
  const [sourceRange, setSourceRange] = useState<30 | 90 | 180>(90);

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

  const minDate = data?.timeline?.[0]?.date ?? '';
  const maxDate = data?.timeline?.length ? data.timeline[data.timeline.length - 1].date : '';
  const range = useMemo<DateRange>(() => {
    if (!minDate || !maxDate) return { from: minDate, to: maxDate };
    if (presetKey === 'custom' && customRange) {
      // keep custom range within the data's extent
      const from = customRange.from < minDate ? minDate : customRange.from;
      const to = customRange.to > maxDate ? maxDate : customRange.to;
      return { from: from > to ? to : from, to };
    }
    return presetRange(presetKey, minDate, maxDate);
  }, [presetKey, customRange, minDate, maxDate]);

  const handlePreset = useCallback((key: PresetKey) => {
    setPresetKey(key);
    if (key !== 'custom') setCustomRange(null);
  }, []);
  const handleCustom = useCallback((r: DateRange) => {
    setPresetKey('custom');
    setCustomRange(r);
  }, []);

  // The two breakdown tables mirror their timeline's rolling range.
  const channelDateRange = useMemo<DateRange>(
    () =>
      minDate && maxDate
        ? presetRange(`last${channelRange}` as PresetKey, minDate, maxDate)
        : { from: minDate, to: maxDate },
    [channelRange, minDate, maxDate]
  );
  const sourceDateRange = useMemo<DateRange>(
    () =>
      minDate && maxDate
        ? presetRange(`last${sourceRange}` as PresetKey, minDate, maxDate)
        : { from: minDate, to: maxDate },
    [sourceRange, minDate, maxDate]
  );

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

      <Section
        title="Overview"
        desc="Top-of-funnel marketing activity across all lead sources. Pick a reporting period — a calendar month or a custom range — to set the headline totals below."
      >
        <PeriodControl
          presetKey={presetKey}
          range={range}
          minDate={minDate}
          maxDate={maxDate}
          onPreset={handlePreset}
          onCustom={handleCustom}
        />
        <SummaryCards timeline={data.timeline} range={range} />
      </Section>

      <Section
        title="Channel Volume Timeline"
        desc="Daily lead activity by source. Toggle the range to see 30, 90, or 180 days — the Channel Mix below matches it."
      >
        <ChannelTimeline
          timeline={data.timeline}
          range={channelRange}
          onRangeChange={setChannelRange}
        />
      </Section>

      <Section
        title="Channel Mix"
        desc={`Where leads came from, by volume — matches the ${channelRange}-day range selected in the Channel Volume Timeline above.`}
      >
        <ChannelMixTable timeline={data.timeline} range={channelDateRange} />
      </Section>

      <Section
        title="Source / Medium Timeline"
        desc="Daily lead volume by UTM source & medium — the UTM Source Breakdown below matches the range you pick here. ⚠️ UTM tracking went live the week of June 15, 2026 — dates before then predate tagging, so earlier leads aren't attributed."
      >
        <SourceTimeline
          utmTimeline={data.utmTimeline}
          utmSeries={data.utmSeries}
          range={sourceRange}
          onRangeChange={setSourceRange}
        />
      </Section>

      <Section
        title="UTM Source Breakdown"
        desc={`Attribution over the ${sourceRange}-day range selected in the Source / Medium Timeline above. ⚠️ UTM tracking went live the week of June 15, 2026 — leads before then weren't tagged and fall under (direct), so the 90- and 180-day ranges understate real attribution.`}
      >
        <UTMBreakdown records={data.utmRecords} range={sourceDateRange} />
      </Section>

      <Section
        title="Website Traffic"
        desc="GA4 website sessions — overall traffic context, separate from the lead channels above."
      >
        <div style={{ maxWidth: 420 }}>
          <SessionsSparkline timeline={data.timeline} />
        </div>
      </Section>

      <Section
        title="GBP Per-Location"
        desc="🚧 Under construction — awaiting Google Business Profile API access. Showing placeholder locations until OAuth is approved; live performance data will backfill once connected."
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
