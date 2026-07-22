'use client';

import { useEffect, useMemo, useState } from 'react';
import type { GBPLocationRow, GBPStateRow } from '@/lib/types';
import type { DateRange, PresetKey } from '@/lib/dateRange';
import { presetRange, inRange, rangeLabel } from '@/lib/dateRange';
import PeriodControl from './PeriodControl';
import GBPStates from './GBPStates';
import GBPLocations from './GBPLocations';

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
interface DailyPayload {
  ok: boolean;
  lagDays: number;
  minDate: string | null;
  dataEnd: string; // today − 3, the reported ceiling
  today: string;
  records: DailyRecord[];
}

const fmt = (iso: string) =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
const addDaysISO = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const clamp = (v: string, lo: string, hi: string) => (v < lo ? lo : v > hi ? hi : v);

function rollUp(records: DailyRecord[], range: DateRange) {
  const rows = records.filter((r) => inRange(r.date, range));
  const locMap = new Map<string, GBPLocationRow>();
  const stateMap = new Map<string, GBPStateRow & { _ids: Set<string> }>();
  for (const r of rows) {
    const name = `${r.city}${r.state ? `, ${r.state}` : ''}`;
    const loc =
      locMap.get(name) ||
      ({ name, state: r.state, location_id: r.location_id, status: 'active', calls: 0, websiteClicks: 0, directions: 0, impressions: 0 } as GBPLocationRow);
    loc.calls = (loc.calls || 0) + r.calls;
    loc.websiteClicks = (loc.websiteClicks || 0) + r.websiteClicks;
    loc.directions = (loc.directions || 0) + r.directions;
    loc.impressions = (loc.impressions || 0) + r.impressions;
    locMap.set(name, loc);

    const st = r.state || 'Unknown';
    const s =
      stateMap.get(st) ||
      ({ state: st, locations: 0, calls: 0, websiteClicks: 0, directions: 0, impressions: 0, _ids: new Set<string>() } as GBPStateRow & { _ids: Set<string> });
    s._ids.add(r.location_id);
    s.calls += r.calls;
    s.websiteClicks += r.websiteClicks;
    s.directions += r.directions;
    s.impressions += r.impressions;
    stateMap.set(st, s);
  }
  const locations = [...locMap.values()].sort((a, b) => (b.calls || 0) - (a.calls || 0));
  const states = [...stateMap.values()]
    .map(({ _ids, ...s }) => ({ ...s, locations: _ids.size }))
    .sort((a, b) => b.calls - a.calls);
  return { locations, states };
}

export default function GBPSection() {
  const [data, setData] = useState<DailyPayload | null>(null);
  const [failed, setFailed] = useState(false);
  const [presetKey, setPresetKey] = useState<PresetKey>('last30');
  const [custom, setCustom] = useState<DateRange | null>(null);

  useEffect(() => {
    let live = true;
    fetch('/api/gbp/daily', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => live && setData(d))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const view = useMemo(() => {
    if (!data || !data.minDate) return null;
    const { minDate, dataEnd, today, records } = data;

    // Selected range: presets end at the reported ceiling (today − 3); a custom
    // range may reach up to today so a picked range can touch the last 3 days.
    let selected: DateRange;
    if (presetKey === 'custom' && custom) {
      selected = {
        from: clamp(custom.from, minDate, today),
        to: clamp(custom.to, minDate, today),
      };
      if (selected.from > selected.to) selected = { from: selected.to, to: selected.from };
    } else {
      selected = presetRange(presetKey, minDate, dataEnd);
    }

    // Effective (what the data can actually honor): clamp to [minDate, dataEnd].
    const effective: DateRange = {
      from: clamp(selected.from, minDate, dataEnd),
      to: clamp(selected.to, minDate, dataEnd),
    };
    const provisional = selected.to > dataEnd; // reaches into the last 3 days
    const beforeFloor = selected.from < minDate;

    const { locations, states } = rollUp(records, effective);
    return { selected, effective, provisional, beforeFloor, locations, states };
  }, [data, presetKey, custom]);

  if (failed) {
    return <div className="card card-pad muted">Couldn’t load GBP data.</div>;
  }
  if (!data) {
    return <div className="card card-pad muted">Loading GBP data…</div>;
  }
  if (!data.minDate || !view) {
    return (
      <div className="card card-pad muted">
        No GBP data available yet — awaiting the backfill.
      </div>
    );
  }

  const { minDate, dataEnd, today } = data;

  return (
    <>
      <PeriodControl
        label="Period"
        presetKey={presetKey}
        range={view.selected}
        minDate={minDate}
        maxDate={today}
        onPreset={(k) => {
          setPresetKey(k);
          if (k !== 'custom') setCustom(null);
        }}
        onCustom={(r) => {
          setPresetKey('custom');
          setCustom(r);
        }}
      />

      <div className="muted" style={{ marginTop: 8, fontSize: 12.5 }}>
        GBP data reports on a ~3-day delay, so this window ends about 3 days before today — keep
        that in mind when comparing GBP to CallRail or Forms for the same period.
      </div>

      {view.beforeFloor && (
        <div className="note-pending" style={{ marginTop: 8 }}>
          No GBP data before {fmt(minDate)} — showing from the earliest available day.
        </div>
      )}
      {view.provisional && (
        <div className="note-pending" style={{ marginTop: 8 }}>
          ⚠ The last 3 days ({fmt(addDaysISO(dataEnd, 1))} – {fmt(today)}) aren’t reported yet
          (Performance API ~3-day lag) — figures shown through {fmt(dataEnd)}.
        </div>
      )}

      <div className="subsection" style={{ marginTop: 12 }}>
        <div className="subsection-label">By state · {rangeLabel(view.effective)}</div>
        <GBPStates rows={view.states} />
      </div>
      <div className="subsection">
        <div className="subsection-label">By location · {rangeLabel(view.effective)}</div>
        <GBPLocations rows={view.locations} />
      </div>
    </>
  );
}
