import type {
  DashboardData,
  TimelinePoint,
  ChannelMixRow,
  UTMRow,
  UTMRecord,
  FormRow,
  GBPLocationRow,
  GBPStateRow,
  SourceStatusRow,
} from './types';

// ---------------------------------------------------------------------------
// Deterministic mock data. A seeded PRNG keeps the numbers stable across a
// render so server and client agree, while the date axis is anchored to "today"
// so the timeline always looks fresh. Swap this out source-by-source as real
// credentials arrive — the shape returned here is the contract the UI relies on.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Day-of-week multiplier: busiest Tue–Thu, quiet on weekends. */
function seasonality(dow: number): number {
  // 0 Sun ... 6 Sat
  const table = [0.35, 0.85, 1.15, 1.25, 1.1, 0.8, 0.3];
  return table[dow];
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function randIn(rng: () => number, min: number, max: number, mult: number): number {
  const span = max - min;
  const raw = min + rng() * span;
  return Math.max(0, Math.round(raw * mult));
}

const DAYS = 180;

function buildTimeline(): TimelinePoint[] {
  const rng = mulberry32(0x4d42_1eed); // fixed seed → stable counts
  const points: TimelinePoint[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() - i);
    const s = seasonality(d.getUTCDay());

    const qualified = randIn(rng, 2, 8, s);
    const firstTime = qualified + randIn(rng, 0, 3, s);
    points.push({
      date: isoDate(d),
      callrail: qualified,
      callrailAll: firstTime + randIn(rng, 1, 4, s),
      callrailFirst: firstTime,
      forms: randIn(rng, 1, 4, s),
      leadtrap: rng() < 0.35 * s ? 1 : 0,
      email: rng() < 0.25 * s ? 1 : 0,
      gbp: randIn(rng, 1, 5, s),
      ga4Sessions: randIn(rng, 30, 150, s),
    });
  }
  return points;
}

function sumLast<K extends keyof TimelinePoint>(
  timeline: TimelinePoint[],
  key: K,
  days: number
): number {
  return timeline
    .slice(-days)
    .reduce((acc, p) => acc + (p[key] as number), 0);
}

function buildChannelMix(timeline: TimelinePoint[]): ChannelMixRow[] {
  const channels: Array<{ channel: string; key: keyof TimelinePoint }> = [
    { channel: 'CallRail', key: 'callrail' },
    { channel: 'Forms', key: 'forms' },
    { channel: 'GBP Calls', key: 'gbp' },
    { channel: 'Leadtrap', key: 'leadtrap' },
    { channel: 'Email', key: 'email' },
  ];
  const counts = channels.map((c) => ({
    channel: c.channel,
    count: sumLast(timeline, c.key, 30),
  }));
  const total = counts.reduce((a, c) => a + c.count, 0) || 1;
  return counts
    .map((c) => ({ ...c, pct: Math.round((c.count / total) * 1000) / 10 }))
    .sort((a, b) => b.count - a.count);
}

function buildUTM(totalLeads30d: number): UTMRow[] {
  // Distribution from the live UTM tracking already installed on the site.
  const dist: Array<{ source: string; medium: string; weight: number }> = [
    { source: 'google', medium: 'organic', weight: 0.3 },
    { source: '(direct)', medium: '(none)', weight: 0.25 },
    { source: 'google', medium: 'cpc', weight: 0.15 },
    { source: 'gbp', medium: 'referral', weight: 0.12 },
    { source: 'facebook', medium: 'paid', weight: 0.1 },
    { source: 'referral', medium: 'referral', weight: 0.08 },
  ];
  const base = Math.max(totalLeads30d, 60);
  return dist
    .map((d) => ({
      source: d.source,
      medium: d.medium,
      count: Math.round(base * d.weight),
    }))
    .sort((a, b) => b.count - a.count);
}

// Expand the daily mock source/medium timeline into one row per lead, so the
// UTM breakdown can be recomputed for any reporting period (mirrors how the
// real aggregate emits utmRecords).
function buildUTMRecords(
  utmTimeline: Array<{ date: string; [k: string]: number | string }>
): UTMRecord[] {
  const records: UTMRecord[] = [];
  utmTimeline.forEach((row) => {
    UTM_DIST.forEach((d) => {
      const [source, medium] = d.combo.split(' / ');
      const n = (row[d.combo] as number) || 0;
      // Sample channel split: organic/direct lean forms, the rest calls.
      const channel = medium === 'organic' || source === '(direct)' ? 'forms' : 'callrail';
      for (let i = 0; i < n; i++)
        records.push({ date: row.date as string, source, medium, channel });
    });
  });
  return records;
}

// Distribute each day's lead volume across source/medium combos so the mock
// source timeline mirrors the channel one.
const UTM_DIST: Array<{ combo: string; weight: number }> = [
  { combo: 'google / organic', weight: 0.3 },
  { combo: '(direct) / (none)', weight: 0.25 },
  { combo: 'google / cpc', weight: 0.15 },
  { combo: 'gbp / referral', weight: 0.12 },
  { combo: 'facebook / paid', weight: 0.1 },
  { combo: 'referral / referral', weight: 0.08 },
];

function buildUTMTimeline(timeline: TimelinePoint[]) {
  const rng = mulberry32(0x5e1d_42ab);
  const utmSeries = UTM_DIST.map((d) => ({ key: d.combo, name: d.combo }));
  const utmTimeline = timeline.map((p) => {
    const total = p.callrail + p.forms + p.leadtrap + p.gbp;
    const row: { date: string; [k: string]: number | string } = { date: p.date };
    let assigned = 0;
    UTM_DIST.forEach((d, i) => {
      // last combo absorbs the remainder so the day sums to the lead total
      const v =
        i === UTM_DIST.length - 1
          ? total - assigned
          : Math.round(total * d.weight * (0.7 + rng() * 0.6));
      row[d.combo] = Math.max(0, v);
      assigned += row[d.combo] as number;
    });
    return row;
  });
  return { utmTimeline, utmSeries };
}

function buildForms(formTotal30d: number): FormRow[] {
  const dist: Array<{ name: string; weight: number }> = [
    { name: 'Contact Form', weight: 0.6 },
    { name: 'Consultation Request', weight: 0.3 },
    { name: 'Newsletter', weight: 0.1 },
  ];
  const base = Math.max(formTotal30d, 30);
  return dist
    .map((d) => ({ name: d.name, count: Math.round(base * d.weight) }))
    .sort((a, b) => b.count - a.count);
}

// Sample per-location figures for the four managed profiles (all now in the
// "Mastermind Behavior All Locations" group). Components only — no summed leads.
const MOCK_GBP: GBPLocationRow[] = [
  { name: 'Lakewood, NJ', state: 'NJ', status: 'active', calls: 15, websiteClicks: 61, directions: 40, impressions: 1684 },
  { name: 'Hackensack, NJ', state: 'NJ', status: 'active', calls: 3, websiteClicks: 4, directions: 42, impressions: 196 },
  { name: 'Macon, GA', state: 'GA', status: 'active', calls: 14, websiteClicks: 13, directions: 61, impressions: 472 },
  { name: 'Warner Robins, GA', state: 'GA', status: 'active', calls: 17, websiteClicks: 18, directions: 44, impressions: 182 },
];

function buildGBPLocations(): GBPLocationRow[] {
  return [...MOCK_GBP].sort((a, b) => (b.calls || 0) - (a.calls || 0));
}

function buildGBPStates(): GBPStateRow[] {
  const map = new Map<string, GBPStateRow>();
  MOCK_GBP.forEach((l) => {
    const st = l.state || 'Unknown';
    const cur =
      map.get(st) ||
      { state: st, locations: 0, calls: 0, websiteClicks: 0, directions: 0, impressions: 0 };
    cur.locations += 1;
    cur.calls += l.calls || 0;
    cur.websiteClicks += l.websiteClicks || 0;
    cur.directions += l.directions || 0;
    cur.impressions += l.impressions || 0;
    map.set(st, cur);
  });
  return [...map.values()].sort((a, b) => b.calls - a.calls);
}

function buildSources(): SourceStatusRow[] {
  return [
    { key: 'callrail', label: 'CallRail', status: 'connected', detail: 'API v3' },
    { key: 'forms', label: 'Webflow Forms', status: 'connected', detail: 'Webhook live' },
    { key: 'gbp', label: 'Google Business Profile', status: 'partial', detail: '2 of 4 profiles managed' },
    { key: 'ga4', label: 'GA4', status: 'connected', detail: 'Data API' },
    { key: 'leadtrap', label: 'Leadtrap', status: 'pending', detail: 'API shape TBD' },
    { key: 'email', label: 'Email', status: 'pending', detail: 'Inbox automation TBD' },
  ];
}

export function getMockDashboard(): DashboardData {
  const timeline = buildTimeline();

  const callrail30 = sumLast(timeline, 'callrail', 30);
  const forms30 = sumLast(timeline, 'forms', 30);
  const leadtrap30 = sumLast(timeline, 'leadtrap', 30);
  const email30 = sumLast(timeline, 'email', 30);
  // GBP calls are surfaced as their own components block, NOT counted in Total
  // Leads (headline = CallRail + Forms + Leadtrap + Email only).
  const gbpCalls30 = sumLast(timeline, 'gbp', 30);
  const totalLeads30d = callrail30 + forms30 + leadtrap30 + email30;
  const { utmTimeline, utmSeries } = buildUTMTimeline(timeline);

  return {
    lastUpdated: new Date().toISOString(),
    summary: {
      totalLeads30d,
      callrailCalls30d: callrail30,
      formSubmissions30d: forms30,
      gbpCalls30d: gbpCalls30,
    },
    timeline,
    channelMix: buildChannelMix(timeline),
    utmSources: buildUTM(totalLeads30d),
    utmRecords: buildUTMRecords(utmTimeline),
    utmTimeline,
    utmSeries,
    forms: buildForms(forms30),
    gbpLocations: buildGBPLocations(),
    gbpStates: buildGBPStates(),
    sources: buildSources(),
    isMock: true,
  };
}
