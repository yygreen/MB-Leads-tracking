// Shared data contract for the dashboard. Every ETL source normalizes into
// these shapes, and aggregate.js rolls them up into a single DashboardData
// object that is stored as dashboard.json and served by /api/data.

export type SourceKey =
  | 'callrail'
  | 'forms'
  | 'calendly'
  | 'gbp'
  | 'ga4'
  | 'leadtrap';

export type SourceStatus = 'connected' | 'no_data' | 'pending' | 'partial' | 'na';

export interface TimelinePoint {
  /** ISO date, YYYY-MM-DD */
  date: string;
  callrail: number;
  forms: number;
  calendly: number;
  leadtrap: number;
  gbpCalls: number;
  ga4Sessions: number;
}

export interface SummaryCards {
  totalLeads30d: number;
  callrailCalls30d: number;
  formSubmissions30d: number;
  gbpDirectCalls30d: number;
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

export interface FormRow {
  name: string;
  count: number;
}

export interface GBPLocationRow {
  name: string;
  status: 'active' | 'pending';
  note?: string;
  calls: number | null;
  directions: number | null;
  websiteClicks: number | null;
  impressions: number | null;
}

export interface SourceStatusRow {
  key: SourceKey;
  label: string;
  status: SourceStatus;
  detail?: string;
}

export interface DashboardData {
  lastUpdated: string;
  summary: SummaryCards;
  timeline: TimelinePoint[];
  channelMix: ChannelMixRow[];
  utmSources: UTMRow[];
  forms: FormRow[];
  gbpLocations: GBPLocationRow[];
  sources: SourceStatusRow[];
  /** true when served from mock fallback rather than real blob data */
  isMock?: boolean;
}
