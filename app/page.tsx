'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DashboardData } from '@/lib/types';
import type { DateRange, PresetKey } from '@/lib/dateRange';
import { presetRange, rangeLabel } from '@/lib/dateRange';
import TopBar from '@/components/TopBar';
import PeriodControl from '@/components/PeriodControl';
import SummaryCards from '@/components/SummaryCards';
import ChannelTimeline from '@/components/ChannelTimeline';
import SessionsSparkline from '@/components/SessionsSparkline';
import SourceTimeline from '@/components/SourceTimeline';
import ChannelMixTable from '@/components/ChannelMixTable';
import UTMBreakdown from '@/components/UTMBreakdown';
import GBPLocations from '@/components/GBPLocations';
import GBPStates from '@/components/GBPStates';
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

// Resolve a (preset, custom) selection into a concrete range, clamped to the
// data's extent. Shared by all three period controls.
function resolveRange(
  presetKey: PresetKey,
  custom: DateRange | null,
  minDate: string,
  maxDate: string
): DateRange {
  if (!minDate || !maxDate) return { from: minDate, to: maxDate };
  if (presetKey === 'custom' && custom) {
    const from = custom.from < minDate ? minDate : custom.from;
    const to = custom.to > maxDate ? maxDate : custom.to;
    return { from: from > to ? to : from, to };
  }
  return presetRange(presetKey, minDate, maxDate);
}

export default function Page() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Overview reporting period.
  const [presetKey, setPresetKey] = useState<PresetKey>('last30');
  const [customRange, setCustomRange] = useState<DateRange | null>(null);
  // Each section below owns its own period (presets + custom range), driving
  // both its timeline chart and the companion table.
  const [channelPreset, setChannelPreset] = useState<PresetKey>('last90');
  const [channelCustom, setChannelCustom] = useState<DateRange | null>(null);
  const [sourcePreset, setSourcePreset] = useState<PresetKey>('last90');
  const [sourceCustom, setSourceCustom] = useState<DateRange | null>(null);

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

  const range = useMemo<DateRange>(
    () => resolveRange(presetKey, customRange, minDate, maxDate),
    [presetKey, customRange, minDate, maxDate]
  );
  const channelDateRange = useMemo<DateRange>(
    () => resolveRange(channelPreset, channelCustom, minDate, maxDate),
    [channelPreset, channelCustom, minDate, maxDate]
  );
  const sourceDateRange = useMemo<DateRange>(
    () => resolveRange(sourcePreset, sourceCustom, minDate, maxDate),
    [sourcePreset, sourceCustom, minDate, maxDate]
  );

  const handlePreset = useCallback((key: PresetKey) => {
    setPresetKey(key);
    if (key !== 'custom') setCustomRange(null);
  }, []);
  const handleCustom = useCallback((r: DateRange) => {
    setPresetKey('custom');
    setCustomRange(r);
  }, []);
  const handleChannelPreset = useCallback((key: PresetKey) => {
    setChannelPreset(key);
    if (key !== 'custom') setChannelCustom(null);
  }, []);
  const handleChannelCustom = useCallback((r: DateRange) => {
    setChannelPreset('custom');
    setChannelCustom(r);
  }, []);
  const handleSourcePreset = useCallback((key: PresetKey) => {
    setSourcePreset(key);
    if (key !== 'custom') setSourceCustom(null);
  }, []);
  const handleSourceCustom = useCallback((r: DateRange) => {
    setSourcePreset('custom');
    setSourceCustom(r);
  }, []);

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
        title="Lead Channels"
        desc="Where leads come from, by channel — the volume over time and the mix for the same period. Pick a period (calendar month or custom range); both the timeline and the mix below follow it."
      >
        <PeriodControl
          label="Period"
          presetKey={channelPreset}
          range={channelDateRange}
          minDate={minDate}
          maxDate={maxDate}
          onPreset={handleChannelPreset}
          onCustom={handleChannelCustom}
        />
        <ChannelTimeline timeline={data.timeline} range={channelDateRange} />
        <div className="subsection">
          <div className="subsection-label">Channel mix · {rangeLabel(channelDateRange)}</div>
          <ChannelMixTable timeline={data.timeline} range={channelDateRange} />
        </div>
      </Section>

      <Section
        title="Lead Sources / Mediums"
        desc="Where leads come from, by UTM source & medium — the volume over time and the breakdown for the same period. ⚠️ UTM tracking went live the week of June 15, 2026; periods reaching earlier than mid-June show untagged leads as (direct)."
      >
        <PeriodControl
          label="Period"
          presetKey={sourcePreset}
          range={sourceDateRange}
          minDate={minDate}
          maxDate={maxDate}
          onPreset={handleSourcePreset}
          onCustom={handleSourceCustom}
        />
        <SourceTimeline
          utmTimeline={data.utmTimeline}
          utmSeries={data.utmSeries}
          range={sourceDateRange}
        />
        <div className="subsection">
          <div className="subsection-label">
            Source / medium breakdown · {rangeLabel(sourceDateRange)}
          </div>
          <UTMBreakdown records={data.utmRecords} range={sourceDateRange} />
        </div>
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
        title="Google Business Profile"
        desc="Performance across the four managed profiles — rolled up by state (NJ = Lakewood + Hackensack, GA = Macon + Warner Robins) and broken out per location. A GBP lead = profile calls + website clicks; directions and impressions are visibility, not leads."
      >
        {data.gbpStates.length > 0 && (
          <div className="subsection" style={{ marginTop: 0 }}>
            <div className="subsection-label">By state · last 30 days</div>
            <GBPStates rows={data.gbpStates} />
          </div>
        )}
        <div className="subsection">
          <div className="subsection-label">By location · last 30 days</div>
          <GBPLocations rows={data.gbpLocations} />
        </div>
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
