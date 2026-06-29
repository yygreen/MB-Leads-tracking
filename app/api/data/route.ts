import { NextResponse } from 'next/server';
import { readJSON } from '@/etl/_lib.js';
import { getMockDashboard } from '@/lib/mockData';
import type { DashboardData, SourceStatusRow } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Honest, self-updating source statuses. A pill is only "connected" when the
// credentials it needs are actually present in the environment — so nothing
// claims to be live until it really is. As env vars get added in Vercel, the
// matching pill turns green on the next request. (Webflow Forms has no API key;
// its webhook endpoint is deployed and live regardless.)
function liveSourceStatuses(leadtrapLeads = 0): SourceStatusRow[] {
  const has = (...keys: string[]) => keys.every((k) => Boolean(process.env[k]));

  const callrail = has('CALLRAIL_API_KEY', 'CALLRAIL_ACCOUNT_ID');
  const gbp = has('GBP_CLIENT_ID', 'GBP_CLIENT_SECRET', 'GBP_REFRESH_TOKEN', 'GBP_LOCATION_IDS');
  const ga4 = has('GA4_PROPERTY_ID', 'GA4_SERVICE_ACCOUNT_JSON');

  return [
    {
      key: 'callrail',
      label: 'CallRail',
      status: callrail ? 'connected' : 'pending',
      detail: callrail ? 'API v3' : 'Awaiting API key',
    },
    {
      key: 'forms',
      label: 'Webflow Forms',
      status: 'connected',
      detail: 'Webhook endpoint live',
    },
    {
      key: 'gbp',
      label: 'Google Business Profile',
      status: gbp ? 'connected' : 'pending',
      detail: gbp
        ? 'Performance API · backfills ~6mo history'
        : '2 of 4 profiles managed · awaiting OAuth (backfills history)',
    },
    {
      key: 'ga4',
      label: 'GA4',
      status: ga4 ? 'connected' : 'pending',
      detail: ga4
        ? 'Data API · website traffic, not leads'
        : 'Awaiting service account · traffic stats only (not leads)',
    },
    {
      key: 'leadtrap',
      label: 'Leadtrap',
      status: leadtrapLeads > 0 ? 'connected' : 'pending',
      detail: leadtrapLeads > 0
        ? 'Webhook live · forward-only'
        : 'Webhook live · forward-only, awaiting leads',
    },
  ];
}

// Serves the aggregated dashboard.json. Falls back to rich mock data whenever
// there is no real data yet (no blob written, or an empty roll-up) so preview
// deploys with zero env vars still render every section.
export async function GET() {
  let data: DashboardData | null = null;
  try {
    data = (await readJSON('dashboard.json', null)) as DashboardData | null;
  } catch (err) {
    console.error('[api/data] read failed, serving mock:', err);
  }

  if (!data || !data.summary || data.summary.totalLeads30d === 0) {
    data = getMockDashboard();
  }

  // Older dashboard.json (pre source-timeline) may lack these — default safely
  // until the next aggregate run repopulates them.
  data.utmTimeline = data.utmTimeline || [];
  data.utmSeries = data.utmSeries || [];

  // Always reflect the real credential state in the status row, regardless of
  // whether the rest of the payload is live or sample data.
  const leadtrapLeads = (data.timeline || []).reduce(
    (a, p) => a + ((p as any).leadtrap || 0),
    0
  );
  data.sources = liveSourceStatuses(leadtrapLeads);

  return NextResponse.json(data, {
    headers: {
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
    },
  });
}
