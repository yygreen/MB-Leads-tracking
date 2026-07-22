// Shared data contract for the dashboard. Every ETL source normalizes into
// these shapes, and aggregate.js rolls them up into a single DashboardData
// object that is stored as dashboard.json and served by /api/data.

export type SourceKey =
  | 'callrail'
  | 'forms'
  | 'gbp'
  | 'ga4'
  | 'leadtrap'
  | 'email';

export type SourceStatus = 'connected' | 'no_data' | 'pending' | 'partial' | 'na';

export interface TimelinePoint {
  /** ISO date, YYYY-MM-DD */
  date: string;
  /** QUALIFIED phone leads (inbound + answered + first-time + past the
   *  IVR-adjusted duration bar, deduped by caller) — the lead count. */
  callrail: number;
  /** every inbound call, unfiltered (phone-funnel top) */
  callrailAll: number;
  /** inbound first-time callers (phone-funnel middle) */
  callrailFirst: number;
  forms: number;
  leadtrap: number;
  email: number;
  /** GBP leads = CALL_CLICKS + WEBSITE_CLICKS across the 4 managed profiles
   *  (directions/impressions are visibility, not leads). */
  gbp: number;
  ga4Sessions: number;
}

export interface SummaryCards {
  totalLeads30d: number;
  callrailCalls30d: number;
  formSubmissions30d: number;
  gbpLeads30d: number;
}

export interface ChannelMixRow {
  channel: string;
  count: number;
  pct: number;
}

export interface UTMRow {
  source: string;
  medium: string;
  count: number;
}

/** One lead's source/medium with its date — the raw rows the UTM breakdown
 *  filters by an arbitrary reporting period. `channel` (callrail/forms/leadtrap)
 *  is carried for backend analysis only (e.g. splitting "(direct)" by channel);
 *  it is not surfaced in the dashboard UI. */
export interface UTMRecord {
  date: string;
  source: string;
  medium: string;
  channel: string;
}

export interface FormRow {
  name: string;
  count: number;
}

export interface GBPLocationRow {
  name: string;
  status: 'active' | 'pending';
  note?: string;
  state?: string | null;
  location_id?: string;
  /** leads = calls + website clicks */
  leads?: number | null;
  calls: number | null;
  directions: number | null;
  websiteClicks: number | null;
  impressions: number | null;
}

/** GBP rolled up per state (NJ = Lakewood + Hackensack, GA = Macon + Warner Robins). */
export interface GBPStateRow {
  state: string;
  locations: number;
  /** leads = calls + website clicks */
  leads: number;
  calls: number;
  directions: number;
  websiteClicks: number;
  impressions: number;
}

export interface SourceStatusRow {
  key: SourceKey;
  label: string;
  status: SourceStatus;
  detail?: string;
}

/** One series in the source/medium timeline (a "source / medium" combo). */
export interface UTMSeries {
  key: string;
  name: string;
}

/** A day's lead counts keyed by source/medium combo name (plus the date). */
export interface UTMTimelinePoint {
  date: string;
  [combo: string]: number | string;
}

export interface DashboardData {
  lastUpdated: string;
  summary: SummaryCards;
  timeline: TimelinePoint[];
  channelMix: ChannelMixRow[];
  utmSources: UTMRow[];
  /** raw per-lead source/medium rows, for arbitrary-period UTM breakdowns */
  utmRecords: UTMRecord[];
  /** daily lead counts per source/medium, for the source timeline chart */
  utmTimeline: UTMTimelinePoint[];
  /** the source/medium combos rendered as series (top combos + "Other") */
  utmSeries: UTMSeries[];
  forms: FormRow[];
  gbpLocations: GBPLocationRow[];
  gbpStates: GBPStateRow[];
  sources: SourceStatusRow[];
  /** true when served from mock fallback rather than real blob data */
  isMock?: boolean;
}
